<?php

namespace App\Models;

/**
 * A named work shift = a weekly schedule (working_hours, same 7-day shape as an
 * office). Mapped to staff via client_staff.shift_id; feeds the first-response
 * SLA. Tenant-isolated, soft-deletable.
 */
class ShiftModel extends TenantModel
{
    protected $table         = 'shifts';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'name', 'working_hours', 'sequence', 'enabled'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'name'      => 'required|max_length[100]',
    ];
}
