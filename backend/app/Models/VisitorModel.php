<?php

namespace App\Models;

/** Client-scoped visitor log (office / seminar / other), optionally lead-linked. */
class VisitorModel extends TenantModel
{
    protected $table         = 'visitors';
    protected $primaryKey    = 'id';
    protected $allowedFields = [
        'client_id', 'name', 'phone', 'email', 'type_id', 'status_id', 'lead_id',
        'assigned_to', 'purpose', 'visit_date', 'notes', 'created_by', 'custom_fields',
    ];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'name'      => 'required|min_length[1]',
        'email'     => 'permit_empty|valid_email',
    ];
}
