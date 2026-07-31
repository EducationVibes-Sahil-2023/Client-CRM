<?php

namespace App\Models;

/**
 * Client-scoped Google Sheet → Leads sync configs (tenant table `sheet_syncs`).
 * Soft-deletable so removing a connected sheet is reversible.
 */
class SheetSyncModel extends TenantModel
{
    protected $table         = 'sheet_syncs';
    protected $primaryKey    = 'id';
    protected $allowedFields = [
        'client_id', 'name', 'spreadsheet_id', 'sheet_tab', 'header_row', 'column_map', 'dedupe_field',
        'source_id', 'status_id', 'lead_type_id', 'assigned_to', 'auto_assignee', 'assign_cursor',
        'write_back', 'status_result_column',
        'inserted_count', 'updated_count', 'skipped_count', 'last_synced_at', 'enabled',
    ];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';
}
