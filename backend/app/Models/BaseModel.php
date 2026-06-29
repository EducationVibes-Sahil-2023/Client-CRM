<?php

namespace App\Models;

use CodeIgniter\Model;

/**
 * Shared base for all CRM models. Centralises common settings so individual
 * models only declare their table, fields, and validation rules.
 */
class BaseModel extends Model
{
    protected $returnType     = 'array';
    protected $useTimestamps  = true;
    protected $createdField   = 'created_at';
    protected $updatedField   = 'updated_at';
    protected $useSoftDeletes = false;
}
