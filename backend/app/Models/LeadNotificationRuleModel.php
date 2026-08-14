<?php

namespace App\Models;

/**
 * One admin-built lead notification rule (a timed reminder). Soft-deletable.
 * Criteria + timing + message + recipients live in the JSON `config` column.
 */
class LeadNotificationRuleModel extends TenantModel
{
    protected $table         = 'lead_notification_rules';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'name', 'enabled', 'sequence', 'config'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $useTimestamps = true;
    protected $createdField  = 'created_at';
    protected $updatedField  = 'updated_at';
}
