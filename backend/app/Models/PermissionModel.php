<?php

namespace App\Models;

/**
 * Role-to-permission mapping used for permission-based feature access.
 */
class PermissionModel extends BaseModel
{
    protected $table         = 'permissions';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['role', 'permission_key', 'description'];

    protected $validationRules = [
        'role'           => 'required|max_length[50]',
        'permission_key' => 'required|max_length[100]',
    ];

    public function getPermissionsForRole(string $role): array
    {
        return $this->where('role', $role)->findAll();
    }
}
