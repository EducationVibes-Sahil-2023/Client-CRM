<?php

namespace App\Models;

/**
 * Comments on a client task. Tenant-owned (per-client DB). created_at is
 * tracked; deletes are soft (deleted_at) so removed comments stay recoverable
 * and never leave the database — in line with the project soft-delete policy.
 */
class TaskCommentModel extends TenantModel
{
    protected $table         = 'task_comments';
    protected $primaryKey    = 'id';
    protected $useTimestamps  = true;
    protected $createdField   = 'created_at';
    protected $updatedField   = '';
    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';
    protected $allowedFields  = ['client_id', 'task_id', 'author_type', 'author_id', 'author_name', 'body'];

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'task_id'   => 'required|is_natural_no_zero',
        'body'      => 'required|min_length[1]',
    ];
}
