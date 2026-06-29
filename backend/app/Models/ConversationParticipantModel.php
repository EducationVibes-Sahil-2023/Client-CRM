<?php

namespace App\Models;

/**
 * Membership + per-member read marker for a conversation. A row is created
 * lazily the first time a participant opens the thread; `last_read_at` drives
 * unread counts.
 */
class ConversationParticipantModel extends BaseModel
{
    protected $table         = 'conversation_participants';
    protected $primaryKey    = 'id';
    protected $useTimestamps  = true;
    protected $createdField   = 'created_at';
    protected $updatedField   = '';
    protected $allowedFields  = ['conversation_id', 'party_type', 'party_id', 'last_read_at'];
}
