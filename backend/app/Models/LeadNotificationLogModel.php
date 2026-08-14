<?php

namespace App\Models;

/**
 * Append-only record of each lead notification sent, so a reminder fires once per
 * assignment cycle. A send counts as "current" while sent_at >= the lead's
 * assigned_date; a reassignment re-stamps assigned_date and reopens the cycle.
 */
class LeadNotificationLogModel extends TenantModel
{
    protected $table         = 'lead_notification_log';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'rule_id', 'lead_id', 'sent_at'];

    protected $useTimestamps = true;
    protected $createdField  = 'created_at';
    protected $updatedField  = '';
}
