<?php

namespace App\Filters;

use App\Models\ClientRolePermissionModel;
use App\Models\ClientStaffModel;
use CodeIgniter\Filters\FilterInterface;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;

/**
 * Enforces a staff member's role permissions on a per-module, per-action basis.
 *
 * Usage in Routes.php (after auth:staff):
 *   ['filter' => ['auth:staff', 'permission:tasks']]          -> needs tasks.view
 *   ['filter' => ['auth:staff', 'permission:tasks,create']]   -> needs tasks.create
 *   ['filter' => ['auth:staff', 'permission:team,update']]    -> needs team.update
 *
 * Action defaults to 'view'. A client_admin (or super_admin) bypasses these
 * checks — permissions only constrain staff. The permission matrix lives in
 * `client_role_permissions`, keyed by the staff's role_id.
 */
class PermissionFilter implements FilterInterface
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

        // Admins are not constrained by the staff permission matrix.
        $role = $user['role'] ?? null;
        if ($role === 'super_admin' || $role === 'client_admin') {
            return null;
        }

        $module = $arguments[0] ?? '';
        $action = $arguments[1] ?? 'view';
        if ($module === '') {
            return null;
        }

        $act    = in_array($action, ['view', 'create', 'update', 'delete'], true) ? $action : 'view';
        $roleId = (int) ($user['role_id'] ?? 0);
        $column = 'can_' . $act;

        // A per-staff permission set OVERRIDES the role; otherwise the role applies.
        $allowed = false;
        $staffId = (int) ($user['staff_id'] ?? 0);
        $extra   = null;
        if ($staffId > 0) {
            $staff = (new ClientStaffModel())->find($staffId);
            $decoded = json_decode((string) ($staff['extra_permissions'] ?? ''), true);
            if (is_array($decoded) && ! empty($decoded)) {
                $extra = $decoded;
            }
        }

        if ($extra !== null) {
            $allowed = ! empty($extra[$module][$act]);
        } elseif ($roleId > 0) {
            $perm = (new ClientRolePermissionModel())
                ->where('role_id', $roleId)
                ->where('module', $module)
                ->first();
            $allowed = $perm && (int) ($perm[$column] ?? 0) === 1;
        }

        if (! $allowed) {
            return $response
                ->setStatusCode(ResponseInterface::HTTP_FORBIDDEN)
                ->setJSON([
                    'error'  => 'Your role does not have permission to ' . $action . ' ' . $module . '.',
                    'module' => $module,
                    'action' => $action,
                    'code'   => 'permission_denied',
                ]);
        }

        return null;
    }

    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
        // No-op.
    }
}
