<?php

namespace App\Models;

/**
 * A follow-up group: a named bucket grouping several lead statuses (e.g.
 * "Prospect" = Hot + Warm). Used by the Follow Up Tracker's pending cards.
 * Client-scoped and soft-deletable.
 */
class FollowupGroupModel extends TenantModel
{
    protected $table         = 'followup_groups';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'name', 'color', 'lead_status_ids', 'sequence', 'enabled'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'name'      => 'required|max_length[100]',
    ];
}
