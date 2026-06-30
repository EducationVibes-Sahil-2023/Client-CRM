<?php

namespace App\Models;

/**
 * Client-defined visitor statuses (Pending / Rescheduled / Completed / …).
 * `is_final` marks terminal statuses that only an admin may change away from.
 */
class VisitorStatusModel extends TenantModel
{
    protected $table         = 'visitor_statuses';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'name', 'color', 'is_final', 'sequence', 'enabled'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'name'      => 'required|min_length[1]',
    ];
}
