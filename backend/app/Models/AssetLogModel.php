<?php

namespace App\Models;

use CodeIgniter\Model;

/**
 * Append-only asset tracker log. Rows are never updated.
 */
class AssetLogModel extends TenantModel
{
    protected $table         = 'asset_logs';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = true;
    protected $createdField  = 'created_at';
    protected $updatedField  = '';
    protected $allowedFields = [
        'client_id', 'asset_id', 'action', 'from_staff_id', 'to_staff_id',
        'note', 'actor_id', 'actor_name',
    ];
}
