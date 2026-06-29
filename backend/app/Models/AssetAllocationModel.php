<?php

namespace App\Models;

class AssetAllocationModel extends TenantModel
{
    protected $table         = 'asset_allocations';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'asset_id', 'staff_id', 'allocated_at', 'revoked_at', 'status', 'notes'];
}
