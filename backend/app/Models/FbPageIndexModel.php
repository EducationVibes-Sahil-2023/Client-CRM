<?php

namespace App\Models;

use CodeIgniter\Model;

/**
 * MAIN-DB registry mapping a Facebook Page id → its owning client, so the
 * sessionless leadgen webhook can resolve the tenant from the page id alone.
 * Extends the framework Model directly (default/main connection); string PK.
 */
class FbPageIndexModel extends Model
{
    protected $table            = 'fb_page_index';
    protected $primaryKey       = 'page_id';
    protected $useAutoIncrement = false;
    protected $returnType       = 'array';
    protected $useTimestamps    = true;
    protected $createdField     = 'created_at';
    protected $updatedField     = 'updated_at';
    protected $allowedFields    = ['page_id', 'client_id', 'page_row_id', 'enabled'];
}
