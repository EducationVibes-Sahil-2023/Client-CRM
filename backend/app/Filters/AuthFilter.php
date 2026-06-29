<?php

namespace App\Filters;

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

        return null;
    }

    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
        // No-op.
    }
}
