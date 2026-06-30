<?php

namespace App\Models;

/** Client-defined visitor types (Office / Seminar / Other …). */
class VisitorTypeModel extends TenantModel
{
    protected $table         = 'visitor_types';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'name', 'color', 'sequence', 'enabled'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'name'      => 'required|min_length[1]',
    ];
}
