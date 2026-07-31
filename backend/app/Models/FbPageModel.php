<?php

namespace App\Models;

/**
 * Client-scoped connected Facebook Pages (tenant table `fb_pages`). Holds the
 * long-lived Page/User access tokens; soft-deletable so disconnecting is reversible.
 */
class FbPageModel extends TenantModel
{
    protected $table         = 'fb_pages';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'page_id', 'page_name', 'access_token', 'user_token', 'enabled'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';
}
