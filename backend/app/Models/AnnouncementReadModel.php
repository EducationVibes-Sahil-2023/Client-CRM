<?php

namespace App\Models;

/**
 * Per-member read / acknowledge marker for an announcement. One row per
 * (announcement, staff). `read_at` is set when the member opens it;
 * `acknowledged_at` when they explicitly acknowledge. Client-owned (tenant DB).
 */
class AnnouncementReadModel extends TenantModel
{
    protected $table         = 'announcement_reads';
    protected $primaryKey    = 'id';
    protected $allowedFields  = [
        'client_id', 'announcement_id', 'staff_id', 'read_at', 'acknowledged_at',
    ];
}
