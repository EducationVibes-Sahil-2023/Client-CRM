<?php

namespace App\Models;

class LeadSourceModel extends TenantModel
{
    protected $table         = 'lead_sources';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'name', 'color', 'sequence', 'marketing_type_id', 'enabled'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'name'      => 'required|max_length[100]',
    ];
}
