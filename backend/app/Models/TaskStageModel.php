<?php

namespace App\Models;

/**
 * A column of the Task Management kanban board. Tenant-isolated; a task's
 * `status` stores this stage's `key`. See CreateTaskStages migration.
 */
class TaskStageModel extends TenantModel
{
    protected $table         = 'task_stages';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'name', 'key', 'color', 'is_done', 'is_system', 'sequence', 'enabled'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'name'      => 'required|max_length[100]',
        'key'       => 'required|max_length[60]',
    ];
}
