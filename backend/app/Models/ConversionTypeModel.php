<?php

namespace App\Models;

class ConversionTypeModel extends TenantModel
{
    protected $table         = 'conversion_types';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'name', 'color', 'sequence', 'enabled', 'lead_type_ids', 'lead_status_ids', 'percentage', 'auto_percentage'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'name'      => 'required|max_length[100]',
    ];
}
