<?php

namespace App\Models;

/**
 * Client-scoped lead transfer requests (see CreateLeadTransfers migration).
 * Soft-deletable so a removed request is recoverable / kept for audit.
 */
class LeadTransferModel extends TenantModel
{
    protected $table         = 'lead_transfers';
    protected $primaryKey    = 'id';
    protected $allowedFields = [
        'client_id', 'lead_id', 'from_staff_id', 'to_staff_id', 'requested_by',
        'reason', 'status', 'decided_by', 'decided_at', 'decision_note',
        // Snapshot at transfer time (for the Auto-Transfer report).
        'rule_id', 'old_status_id', 'new_status_id', 'source_id', 'update_count',
    ];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';
}
