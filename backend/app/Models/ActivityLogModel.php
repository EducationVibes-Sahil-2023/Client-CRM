<?php

namespace App\Models;

use CodeIgniter\Model;

/**
 * Append-only audit log of who did what across the platform. Rows are written
 * via ApiController::logActivity() and are never updated, so only created_at
 * is tracked.
 */
class ActivityLogModel extends Model
{
    protected $table         = 'activity_logs';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps  = true;
    protected $createdField   = 'created_at';
    protected $updatedField   = ''; // log rows are immutable
    protected $allowedFields  = [
        'actor_id', 'actor_role', 'actor_name', 'action',
        'entity_type', 'entity_id', 'description', 'client_id',
    ];
}
