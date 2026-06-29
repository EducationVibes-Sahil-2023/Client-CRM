<?php

namespace App\Models;

/**
 * Client-scoped office locations. Soft-deletable (`deleted_at`) so archiving an
 * office keeps it recoverable and preserves staff `office_location_id` history.
 */
class OfficeLocationModel extends TenantModel
{
    protected $table         = 'office_locations';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'name', 'address', 'city', 'pincode', 'phone', 'latitude', 'longitude', 'map_url', 'sequence', 'enabled'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'name'      => 'required|max_length[150]',
    ];
}
