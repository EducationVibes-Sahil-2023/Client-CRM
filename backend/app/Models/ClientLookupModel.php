<?php

namespace App\Models;

/**
 * Admin-managed lookup lists (categories: 'lead_type', 'office_location',
 * 'department'). Client-owned (lives in the client's own DB).
 */
class ClientLookupModel extends TenantModel
{
    protected $table         = 'client_lookups';
    protected $primaryKey    = 'id';
    protected $allowedFields  = ['client_id', 'category', 'name'];
}
