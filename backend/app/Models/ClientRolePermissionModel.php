<?php

namespace App\Models;

use CodeIgniter\Model;

class ClientRolePermissionModel extends TenantModel
{
    protected $table         = 'client_role_permissions';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps  = false;
    protected $allowedFields = ['client_id', 'role_id', 'module', 'can_view', 'can_create', 'can_update', 'can_delete'];
}
