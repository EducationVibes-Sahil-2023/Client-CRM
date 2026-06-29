<?php

namespace App\Models;

class ClientRoleModel extends TenantModel
{
    protected $table         = 'client_roles';
    protected $primaryKey    = 'id';

    // Project policy: deletes are soft (rows flagged, never hard-removed).
    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $allowedFields = ['client_id', 'name', 'description', 'is_system'];

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'name'      => 'required|min_length[2]|max_length[100]',
    ];
}
