<?php

namespace App\Models;

/**
 * Client-scoped departments. Soft-deletable (`deleted_at`) so archiving a
 * department keeps it recoverable and preserves staff `department_id` history.
 */
class DepartmentModel extends TenantModel
{
    protected $table         = 'departments';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'name', 'sequence', 'enabled'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'name'      => 'required|max_length[100]',
    ];
}
