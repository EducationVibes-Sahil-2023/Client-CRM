<?php

namespace App\Models;

class AssetModel extends TenantModel
{
    protected $table         = 'assets';
    protected $primaryKey    = 'id';

    // Soft delete: delete() sets deleted_at and rows are kept for audit; find()
    // and findAll() transparently exclude deleted assets.
    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $allowedFields = [
        'client_id', 'asset_code', 'name', 'quantity', 'unit', 'series_model',
        'asset_group', 'managed_by', 'asset_location', 'purchase_date',
        'warranty_months', 'unit_price', 'depreciation_months', 'supplier_name',
        'supplier_phone', 'supplier_address', 'description', 'attachment', 'status', 'custom_fields',
    ];

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'name'      => 'required|min_length[1]|max_length[255]',
    ];
}
