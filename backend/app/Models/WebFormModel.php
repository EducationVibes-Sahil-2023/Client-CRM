<?php

namespace App\Models;

/**
 * Client-scoped Web-to-Lead form definitions (the "web_forms" table lives in each
 * client's own database). Soft-deletable so a removed form is recoverable.
 *
 * `fields`, `auto_assignee`, `state_assignee_map` and `notify_staff` are stored as
 * JSON text; the controllers/`WebLeadIngest` encode/decode them.
 */
class WebFormModel extends TenantModel
{
    protected $table         = 'web_forms';
    protected $primaryKey    = 'id';
    protected $allowedFields = [
        'client_id', 'name', 'token', 'api_key', 'language', 'submit_text', 'success_message', 'fields',
        'source_id', 'status_id', 'assigned_to', 'lead_type_id',
        'auto_assignee', 'auto_assign_state_wise', 'state_assignee_map', 'state_cursors', 'assign_cursor',
        'auto_mark_public', 'allow_location_fields', 'notify_on_transfer', 'allow_duplicate',
        'prevent_duplicate_field', 'prevent_duplicate_field2', 'create_duplicate_as_task',
        'notify_on_import', 'notify_type', 'notify_staff', 'submission_count', 'enabled',
    ];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'name'      => 'required|min_length[1]|max_length[150]',
        'token'     => 'required|max_length[64]',
    ];
}
