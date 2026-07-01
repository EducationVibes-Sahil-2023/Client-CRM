<?php

namespace App\Models;

/**
 * Admin-managed holidays (year-wise). `office_location_id` NULL = applies to
 * every office. Tenant-isolated; excluded from the first-response SLA.
 */
class HolidayModel extends TenantModel
{
    protected $table         = 'holidays';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'office_location_id', 'holiday_date', 'name'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id'    => 'required|is_natural_no_zero',
        'holiday_date' => 'required',
        'name'         => 'required|max_length[150]',
    ];
}
