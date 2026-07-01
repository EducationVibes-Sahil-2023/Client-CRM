<?php

namespace App\Models;

/**
 * Call-tracking log rows, ingested from a client's external call-logging app
 * (IVR or device dialer). Client-scoped and soft-deletable so the "Calls
 * activity" view can show only active calls while keeping an audit trail.
 */
class CallLogModel extends TenantModel
{
    protected $table         = 'calls';
    protected $primaryKey    = 'id';
    protected $allowedFields = [
        'client_id', 'lead_id', 'staff_id', 'staff_contact', 'contact',
        'call_status', 'source', 'type', 'duration', 'connected',
        'call_start', 'call_end',
        // SIM tracking: the device's SIMs, which SIM called, its status, the date.
        'sim1', 'sim2', 'calling_sim', 'sim_status', 'calling_date',
    ];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
    ];
}
