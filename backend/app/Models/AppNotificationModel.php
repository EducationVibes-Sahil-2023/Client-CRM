<?php

namespace App\Models;

/**
 * In-app notification addressed to a single recipient (party_type/party_id).
 * Append-only apart from `read_at`.
 */
class AppNotificationModel extends BaseModel
{
    protected $table         = 'app_notifications';
    protected $primaryKey    = 'id';
    protected $useTimestamps  = true;
    protected $createdField   = 'created_at';
    protected $updatedField   = '';
    protected $allowedFields  = [
        'recipient_type', 'recipient_id', 'type', 'title', 'body', 'link', 'read_at',
    ];
}
