<?php

namespace App\Filters;

use App\Models\ClientModel;
use App\Models\StaffAccountModel;
use CodeIgniter\Filters\FilterInterface;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;

/**
 * Session-based authentication & role guard.
 *
 * Usage in Routes.php:
 *   ['filter' => 'auth']                  -> any authenticated user
 *   ['filter' => 'auth:super_admin']      -> only super_admin
 *   ['filter' => 'auth:client_admin']     -> only client_admin
 *   ['filter' => 'auth:super_admin,client_admin'] -> either role
 */
class AuthFilter implements FilterInterface
{
    public function before(RequestInterface $request, $arguments = null)
    {
        $response = service('response');
        $user     = service('session')->get('user');

        if (! $user) {
            return $response
                ->setStatusCode(ResponseInterface::HTTP_UNAUTHORIZED)
                ->setJSON(['error' => 'Authentication required']);
        }

        if (! empty($arguments) && ! in_array($user['role'] ?? null, $arguments, true)) {
            return $response
                ->setStatusCode(ResponseInterface::HTTP_FORBIDDEN)
                ->setJSON(['error' => 'You do not have access to this resource']);
        }

        // Re-check status on EVERY request so suspending a client (or disabling a
        // staff account) takes effect immediately — not just at next login. Only
        // client-bound roles are checked; super admins own the platform.
        $role     = $user['role'] ?? null;
        $clientId = (int) ($user['client_id'] ?? 0);
        if (in_array($role, ['client_admin', 'staff'], true) && $clientId > 0) {
            $client = (new ClientModel())->find($clientId);
            if (! $client || ! ClientModel::statusAllowsAccess($client['status'] ?? null)) {
                service('session')->remove('user'); // end the now-invalid session
                return $response
                    ->setStatusCode(ResponseInterface::HTTP_FORBIDDEN)
                    ->setJSON(['error' => 'Your workspace has been suspended. Please sign in again or contact support.']);
            }

            // Staff: also honour the staff login account being disabled.
            if ($role === 'staff') {
                $acct = (new StaffAccountModel())
                    ->where('client_id', $clientId)
                    ->where('staff_id', (int) ($user['staff_id'] ?? 0))
                    ->first();
                if (! $acct || ($acct['status'] ?? 'active') !== 'active') {
                    service('session')->remove('user');
                    return $response
                        ->setStatusCode(ResponseInterface::HTTP_FORBIDDEN)
                        ->setJSON(['error' => 'Your access has been disabled. Please contact your administrator.']);
                }
            }
        }

        return null;
    }

    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
        // No-op.
    }
}
