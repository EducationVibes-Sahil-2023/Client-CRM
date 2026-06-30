<?php

namespace App\Models;

class StateModel extends TenantModel
{
    protected $table         = 'states';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'name', 'color', 'sequence', 'enabled'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'name'      => 'required|max_length[100]',
    ];
}
