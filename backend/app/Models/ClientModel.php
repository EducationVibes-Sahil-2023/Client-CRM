<?php

namespace App\Models;

/**
 * Tenant records. Each client has its own database connection details so the
 * platform can isolate per-client CRM data.
 */
class ClientModel extends BaseModel
{
    protected $table         = 'clients';
    protected $primaryKey    = 'id';
    protected $allowedFields = [
        'name', 'subdomain', 'db_name', 'db_username', 'db_password', 'plan',
        'email', 'phone', 'avatar', 'status', 'plan_start', 'plan_end',
    ];

    // Soft delete: deleting a client archives it (reversible) — its database and
    // login records stay intact, and listings exclude soft-deleted rows.
    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    /** Allowed client lifecycle statuses. */
    public const STATUSES = ['active', 'trial', 'suspended', 'inactive'];

    protected $validationRules = [
        'name'        => 'required|min_length[2]|max_length[255]',
        'db_name'     => 'required|alpha_dash|is_unique[clients.db_name,id,{id}]',
        'db_username' => 'required|max_length[255]',
        'plan'        => 'permit_empty|in_list[starter,growth,enterprise]',
        'email'       => 'permit_empty|valid_email|max_length[255]',
        'status'      => 'permit_empty|in_list[active,trial,suspended,inactive]',
    ];

    protected $validationMessages = [
        'db_name' => [
            'is_unique'  => 'A client with that database name already exists.',
            'alpha_dash' => 'Database name may only contain letters, numbers, underscores and dashes.',
        ],
        'email' => [
            'valid_email' => 'Please enter a valid client email address.',
        ],
    ];
}
