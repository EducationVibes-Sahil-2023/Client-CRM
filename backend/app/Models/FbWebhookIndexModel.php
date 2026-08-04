<?php

namespace App\Models;

use CodeIgniter\Model;

/**
 * MAIN-DB registry mapping a per-client Facebook webhook URL token → its owning
 * client, so the sessionless leadgen webhook can resolve the tenant from the
 * token in the URL path alone. Extends the framework Model directly (default/main
 * connection); string PK. Maintained on FB connect/disconnect.
 */
class FbWebhookIndexModel extends Model
{
    protected $table            = 'fb_webhook_index';
    protected $primaryKey       = 'token';
    protected $useAutoIncrement = false;
    protected $returnType       = 'array';
    protected $useTimestamps    = true;
    protected $createdField     = 'created_at';
    protected $updatedField     = 'updated_at';
    protected $allowedFields    = ['token', 'client_id', 'enabled'];
}
