<?php

namespace App\Models;

class ClientTaskModel extends TenantModel
{
    protected $table         = 'client_tasks';
    protected $primaryKey    = 'id';

    // Soft delete: delete() sets deleted_at and rows are kept for audit; find()
    // and findAll() transparently exclude deleted tasks.
    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $allowedFields = ['client_id', 'title', 'description', 'assigned_to', 'due_date', 'start_date', 'priority', 'type', 'status', 'completed_at', 'created_by', 'created_by_name', 'updated_by', 'updated_by_name'];

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'title'     => 'required|min_length[2]|max_length[255]',
    ];
}
