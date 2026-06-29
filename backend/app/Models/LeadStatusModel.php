<?php

namespace App\Models;

class LeadStatusModel extends TenantModel
{
    protected $table         = 'lead_statuses';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'name', 'parent_id', 'parent_ids', 'color', 'conversion_type', 'sequence', 'enabled'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'name'      => 'required|max_length[100]',
    ];
}
