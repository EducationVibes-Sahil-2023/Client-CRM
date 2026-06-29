<?php

namespace App\Models;

/**
 * A single chat message. Append-only — messages are never edited, so only
 * created_at is tracked.
 */
class ChatMessageModel extends BaseModel
{
    protected $table         = 'chat_messages';
    protected $primaryKey    = 'id';
    protected $useTimestamps  = true;
    protected $createdField   = 'created_at';
    protected $updatedField   = '';
    protected $allowedFields  = [
        'conversation_id', 'sender_type', 'sender_id', 'body',
        'attachment_url', 'attachment_name', 'attachment_type', 'attachment_size',
    ];
}
