<?php

namespace App\Models;

/**
 * One admin-built auto lead-transfer rule (a criteria card). Soft-deletable so a
 * removed rule is recoverable. Criteria live in the JSON `config` column.
 */
class AutoTransferRuleModel extends TenantModel
{
    protected $table         = 'auto_transfer_rules';
    protected $primaryKey    = 'id';
    protected $allowedFields = [
        'client_id', 'name', 'rule_type', 'enabled', 'sequence', 'config', 'assign_cursor',
    ];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $useTimestamps = true;
    protected $createdField  = 'created_at';
    protected $updatedField  = 'updated_at';
}
