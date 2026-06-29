<?php

namespace App\Models;

/**
 * Main-DB login index for client staff (email → client/staff/password). Profile
 * data lives in each client's own database; this only carries what login needs.
 */
class StaffAccountModel extends BaseModel
{
    protected $table         = 'staff_accounts';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'staff_id', 'email', 'password', 'status'];
}
