<?php

namespace App\Models;

use CodeIgniter\Model;

/**
 * MAIN-DB registry mapping a public form token → its owning client + form id, so
 * a sessionless public request can resolve which tenant DB holds the form.
 *
 * Extends the framework Model directly (NOT TenantModel/BaseModel) so it always
 * binds to the default (main) connection. The primary key is the string `token`,
 * so auto-increment is disabled; writes go through insert/update explicitly
 * (see ClientController::syncWebFormIndex).
 */
class WebFormIndexModel extends Model
{
    protected $table            = 'web_form_index';
    protected $primaryKey       = 'token';
    protected $useAutoIncrement = false;
    protected $returnType       = 'array';
    protected $useTimestamps    = true;
    protected $createdField     = 'created_at';
    protected $updatedField     = 'updated_at';
    protected $allowedFields    = ['token', 'client_id', 'form_id', 'enabled'];
}
