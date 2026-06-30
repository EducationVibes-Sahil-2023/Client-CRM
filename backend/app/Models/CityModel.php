<?php

namespace App\Models;

class CityModel extends TenantModel
{
    protected $table         = 'cities';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'name', 'color', 'sequence', 'state_id', 'enabled'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'name'      => 'required|max_length[100]',
    ];
}
