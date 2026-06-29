<?php

namespace App\Models;

/**
 * Outgoing / composed messages from the super-admin inbox (Sent folder).
 */
class MessageModel extends BaseModel
{
    protected $table         = 'messages';
    protected $primaryKey    = 'id';
    protected $allowedFields = [
        'to_email', 'to_name', 'subject', 'body', 'folder', 'starred', 'created_by',
    ];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'to_email' => 'required|valid_email|max_length[255]',
    ];

    protected $validationMessages = [
        'to_email' => ['valid_email' => 'Please enter a valid recipient email.'],
    ];
}
