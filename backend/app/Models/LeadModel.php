<?php

namespace App\Models;

/**
 * Client-scoped leads. Soft-deletable so a removed lead is recoverable.
 *
 * Phone is stored as 10 digits (the controller strips formatting); status is
 * mandatory. Per-row import validation lives in the controller so it can report
 * which rows failed and why.
 */
class LeadModel extends TenantModel
{
    protected $table         = 'leads';
    protected $primaryKey    = 'id';
    protected $allowedFields = [
        'client_id', 'name', 'phone', 'alt_phone', 'status_id', 'sub_status_id',
        'lead_type_id', 'source_id',
        'reference_name', 'email', 'assigned_to', 'created_by', 'assigned_date', 'city', 'state',
        'follow_date', 'created_date',
    ];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'phone'     => 'required|regex_match[/^[0-9]{10}$/]',
        'alt_phone' => 'permit_empty|regex_match[/^[0-9]{10}$/]',
        'status_id' => 'required|is_natural_no_zero',
        'email'     => 'permit_empty|valid_email',
    ];

    protected $validationMessages = [
        'phone'     => ['regex_match' => 'Phone must be exactly 10 digits.'],
        'alt_phone' => ['regex_match' => 'Alternative phone must be exactly 10 digits.'],
        'status_id' => ['required' => 'Status is required.'],
    ];
}
