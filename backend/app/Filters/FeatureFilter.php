<?php

namespace App\Filters;

use App\Libraries\FeatureService;
use CodeIgniter\Filters\FilterInterface;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;

/**
 * Blocks access to a feature the client's plan/subscription doesn't include.
 *
 * Usage in Routes.php (after an auth filter):
 *   ['filter' => ['auth:client_admin', 'feature:assets']]
 *   ['filter' => ['auth:staff', 'feature:leads']]
 *
 * Resolves the signed-in user's client_id, then checks the effective feature
 * set (plan preset + per-client overrides). Super admins are never gated.
 */
class FeatureFilter implements FilterInterface
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

        // Super admins operate above plan gating.
        if (($user['role'] ?? null) === 'super_admin') {
            return null;
        }

        $feature  = $arguments[0] ?? '';
        $clientId = (int) ($user['client_id'] ?? 0);

        if ($feature === '' || $clientId <= 0) {
            return null; // nothing to gate
        }

        if (! (new FeatureService())->isEnabled($clientId, $feature)) {
            return $response
                ->setStatusCode(ResponseInterface::HTTP_FORBIDDEN)
                ->setJSON([
                    'error'   => 'This feature is not included in your current plan.',
                    'feature' => $feature,
                    'code'    => 'feature_disabled',
                ]);
        }

        return null;
    }

    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
        // No-op.
    }
}
