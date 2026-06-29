<?php

namespace App\Models;

/**
 * A team announcement, owned by a client (lives in the client's own DB).
 *
 * Targeting: `audience` is 'all' | 'department' | 'staff'. For 'department' /
 * 'staff', `target_ids` is a JSON list of department-lookup ids / staff ids.
 * `attachments` is a JSON list of {url,name,type,size}. `require_ack` flags
 * announcements that ask each recipient to acknowledge (not just read).
 */
class AnnouncementModel extends TenantModel
{
    protected $table         = 'announcements';
    protected $primaryKey    = 'id';

    // Project policy: deletes are soft (rows flagged, never hard-removed). The
    // model auto-excludes soft-deleted rows from normal reads.
    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $allowedFields  = [
        'client_id', 'title', 'body', 'pinned', 'created_by',
        'audience', 'target_ids', 'attachments', 'require_ack',
    ];

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'title'     => 'required|min_length[2]|max_length[255]',
    ];
}
