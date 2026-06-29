<?php

namespace App\Models;

/**
 * "Contact us" messages submitted from the public landing page.
 */
class ContactMessageModel extends BaseModel
{
    protected $table         = 'contact_messages';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['name', 'email', 'company', 'message', 'status'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'name'    => 'required|min_length[2]|max_length[255]',
        'email'   => 'required|valid_email|max_length[255]',
        'message' => 'required|min_length[5]',
    ];

    protected $validationMessages = [
        'email'   => ['valid_email' => 'Please enter a valid email address.'],
        'message' => ['min_length' => 'Please enter a slightly longer message.'],
    ];
}
