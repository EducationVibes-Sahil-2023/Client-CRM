<?php

namespace App\Models;

/**
 * A chat thread. `type` = 'support' (super-admin ↔ client-admin) today;
 * 'team' (client-admin ↔ staff) in a later phase. `client_id` scopes the
 * conversation to a tenant.
 */
class ConversationModel extends BaseModel
{
    protected $table         = 'conversations';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'type', 'title', 'last_message_at'];
}
