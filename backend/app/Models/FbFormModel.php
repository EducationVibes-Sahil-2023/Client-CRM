<?php

namespace App\Models;

/**
 * Client-scoped Facebook lead-form mappings (tenant table `fb_forms`). Mirrors
 * web_forms' assignment/dedupe/notify columns so WebLeadIngest can ingest FB
 * leads with the same engine. Soft-deletable.
 */
class FbFormModel extends TenantModel
{
    protected $table         = 'fb_forms';
    protected $primaryKey    = 'id';
    protected $allowedFields = [
        'client_id', 'page_id', 'form_id', 'form_name', 'field_map',
        'source_id', 'status_id', 'lead_type_id', 'assigned_to',
        'auto_assignee', 'auto_assign_state_wise', 'state_assignee_map', 'state_cursors', 'assign_cursor',
        'allow_duplicate', 'prevent_duplicate_field', 'prevent_duplicate_field2', 'create_duplicate_as_task',
        'notify_on_import', 'notify_type', 'notify_staff', 'submission_count', 'last_lead_time', 'enabled',
    ];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';
}
