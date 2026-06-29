<?php

namespace App\Controllers;

use App\Libraries\TenantManager;
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
        $email    = trim((string) $this->input('email'));
        $password = (string) $this->input('password');

        if ($email === '' || $password === '') {
            return $this->failValidationErrors('Email and password are required');
        }

        // 1) Platform users: super admins and client admins.
        $user = (new UserModel())->findByEmail($email);
        if ($user && password_verify($password, $user['password'])) {
            $this->session->regenerate(true); // prevent session fixation

            $sessionUser = [
                'id'        => (int) $user['id'],
                'email'     => $user['email'],
                'name'      => $user['name'] ?? $user['email'],
                'role'      => $user['role'],
                'client_id' => $user['client_id'] !== null ? (int) $user['client_id'] : null,
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
            ];
            $this->session->set('user', $sessionUser);
            $this->logActivity('login', 'session', $staffId, 'Staff signed in', $clientId);

            return $this->respond(['message' => 'Login successful', 'user' => $sessionUser]);
        }

        return $this->fail('Invalid credentials', 401);
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
