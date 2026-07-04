<?php

namespace App\Controllers;

use App\Libraries\PasswordPolicy;
use App\Libraries\TenantManager;
use App\Models\ClientModel;
use App\Models\ClientStaffModel;
use App\Models\StaffAccountModel;
use App\Models\UserModel;

class Auth extends ApiController
{
    /**
     * POST /auth/login
     * Body: { "email": "...", "password": "..." }
     */
    public function login()
    {
        // Brute-force guard: cap login attempts per IP+email (configurable in .env).
        if ($resp = $this->rateLimitLogin()) {
            return $resp;
        }

        $email    = trim((string) $this->input('email'));
        $password = (string) $this->input('password');

        if ($email === '' || $password === '') {
            return $this->failValidationErrors('Email and password are required');
        }

        // 1) Platform users: super admins and client admins.
        $user = (new UserModel())->findByEmail($email);
        if ($user && password_verify($password, $user['password'])) {
            // A client admin can't sign in while their workspace is suspended/inactive.
            if (($user['role'] ?? '') === 'client_admin' && $user['client_id'] !== null) {
                $client = (new ClientModel())->find((int) $user['client_id']);
                if (! $client || ! ClientModel::statusAllowsAccess($client['status'] ?? null)) {
                    return $this->fail('This workspace has been suspended. Please contact support.', 403);
                }
            }
            $this->session->regenerate(true); // prevent session fixation

            $sessionUser = [
                'id'        => (int) $user['id'],
                'email'     => $user['email'],
                'name'      => $user['name'] ?? $user['email'],
                'role'      => $user['role'],
                'client_id' => $user['client_id'] !== null ? (int) $user['client_id'] : null,
                // Flag accounts still on a weak password so the UI forces a change.
                'must_change_password' => ! PasswordPolicy::isStrong($password, $user['email']),
            ];
            $this->session->set('user', $sessionUser);
            $this->logActivity('login', 'session', (int) $user['id'], 'Signed in');

            return $this->respond(['message' => 'Login successful', 'user' => $sessionUser]);
        }

        // 2) Client staff: identity lives in the main-DB login index; the
        //    profile + role live in the client's own database.
        $account = (new StaffAccountModel())->where('email', $email)->first();
        if (
            $account
            && ($account['status'] ?? 'active') === 'active'
            && ! empty($account['password'])
            && password_verify($password, (string) $account['password'])
        ) {
            $clientId = (int) $account['client_id'];
            $staffId  = (int) $account['staff_id'];

            // Block staff whose workspace is suspended/inactive.
            $client = (new ClientModel())->find($clientId);
            if (! $client || ! ClientModel::statusAllowsAccess($client['status'] ?? null)) {
                return $this->fail('This workspace has been suspended. Please contact support.', 403);
            }

            // Pull display name + role from the client's own database.
            $profile = null;
            try {
                $tenant  = (new TenantManager())->forClient($clientId);
                $profile = (new ClientStaffModel($tenant))->find($staffId);
            } catch (\Throwable $e) {
                $profile = null;
            }

            $this->session->regenerate(true);

            $sessionUser = [
                'id'        => $staffId,
                'email'     => $account['email'],
                'role'      => 'staff',
                'client_id' => $clientId,
                'staff_id'  => $staffId,
                'role_id'   => isset($profile['role_id']) && $profile['role_id'] !== null ? (int) $profile['role_id'] : null,
                'name'      => $profile['name'] ?? $account['email'],
                // Flag accounts still on a weak password so the UI forces a change.
                'must_change_password' => ! PasswordPolicy::isStrong($password, $account['email']),
            ];
            $this->session->set('user', $sessionUser);
            $this->logActivity('login', 'session', $staffId, 'Staff signed in', $clientId);

            return $this->respond(['message' => 'Login successful', 'user' => $sessionUser]);
        }

        return $this->fail('Invalid credentials', 401);
    }

    /**
     * Rate-limit login attempts (default: 3 per 60s per IP+email). Returns a 429
     * response when the limit is exceeded, or null to proceed. Tunable in .env:
     *   ratelimit.enabled          = 1        (set 0 to disable entirely)
     *   ratelimit.login.attempts   = 3
     *   ratelimit.login.seconds    = 60
     */
    private function rateLimitLogin()
    {
        if ((string) (env('ratelimit.enabled') ?? '1') === '0') {
            return null;
        }
        $attempts = (int) (env('ratelimit.login.attempts') ?: 3);
        $seconds  = (int) (env('ratelimit.login.seconds') ?: 60);
        if ($attempts <= 0 || $seconds <= 0) {
            return null;
        }

        $ip    = $this->request->getIPAddress();
        $email = strtolower(trim((string) $this->input('email')));
        // Hash into an alphanumeric key — cache keys can't contain reserved
        // characters like ':' (IPv6 addresses such as ::1 would otherwise break it).
        $key   = 'login_' . md5($ip . '|' . $email);

        $throttler = \Config\Services::throttler();
        if ($throttler->check($key, $attempts, $seconds) === false) {
            $wait = $throttler->getTokentime();

            return $this->response->setStatusCode(429)->setJSON([
                'messages' => ['error' => "Too many login attempts. Please wait {$wait} second" . ($wait === 1 ? '' : 's') . ' and try again.'],
            ]);
        }

        return null;
    }

    /**
     * POST /auth/logout
     */
    public function logout()
    {
        $this->session->destroy();

        return $this->respond(['message' => 'Logged out']);
    }

    /**
     * POST /auth/stop-impersonation — restore the super-admin session that was
     * stashed when they used "Login as client". No-ops (still 200) when the
     * current session isn't an impersonation, so the UI can call it safely.
     */
    public function stopImpersonation()
    {
        $impersonator = $this->session->get('impersonator');
        if (! is_array($impersonator) || empty($impersonator['id'])) {
            return $this->respond(['message' => 'Not impersonating', 'restored' => false]);
        }
        $this->session->remove('impersonator');
        $this->session->set('user', $impersonator);

        return $this->respond(['message' => 'Returned to admin', 'restored' => true, 'user' => $impersonator]);
    }

    /**
     * GET /auth/me — returns the current session user (or 401).
     */
    public function me()
    {
        $user = $this->currentUser();

        if (! $user) {
            return $this->fail('Not authenticated', 401);
        }

        return $this->respond(['user' => $user]);
    }
}
