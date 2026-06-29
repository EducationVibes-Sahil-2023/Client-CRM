<?php

namespace App\Models;

/**
 * "Request a demo" submissions from the public /demo page.
 */
class DemoRequestModel extends BaseModel
{
    protected $table         = 'demo_requests';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['name', 'email', 'company', 'phone', 'team_size', 'interest', 'message', 'status'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'name'    => 'required|min_length[2]|max_length[255]',
        'email'   => 'required|valid_email|max_length[255]',
        'company' => 'required|max_length[255]',
    ];

    protected $validationMessages = [
        'email'   => ['valid_email' => 'Please enter a valid email address.'],
        'company' => ['required' => 'Please enter your company.'],
    ];
}
