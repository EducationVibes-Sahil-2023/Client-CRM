<?php

namespace App\Models;

class ClientStaffModel extends TenantModel
{
    protected $table         = 'client_staff';
    protected $primaryKey    = 'id';
    protected $allowedFields = [
        'client_id', 'name', 'email', 'phone', 'avatar', 'emp_code', 'designation', 'alt_phone',
        'role_id', 'reports_to', 'lead_type_id', 'office_location_id', 'department_id',
        'facebook', 'linkedin', 'skype', 'email_signature', 'password', 'status',
        'extra_permissions', 'custom_fields',
    ];

    // Removing a staff member soft-deletes them (reversible); listings and the
    // team quota count exclude soft-deleted rows automatically.
    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'name'      => 'required|min_length[2]|max_length[255]',
    ];

    /**
     * IDs of a staff member plus everyone reporting up to them (the whole
     * sub-tree via `reports_to`). Used to scope what a reporting manager can
     * access — they see themselves and the staff under them, nobody else.
     *
     * @return int[] staff ids, always including $staffId itself
     */
    public function subordinateIds(int $clientId, int $staffId): array
    {
        // Load the client's reporting edges once, then walk the tree in memory
        // (avoids N recursive queries and is safe against cycles).
        $rows = $this->select('id, reports_to')->where('client_id', $clientId)->findAll();

        $childrenOf = [];
        foreach ($rows as $r) {
            $parent = $r['reports_to'] !== null ? (int) $r['reports_to'] : 0;
            $childrenOf[$parent][] = (int) $r['id'];
        }

        $result  = [$staffId];
        $seen     = [$staffId => true];
        $stack    = [$staffId];
        while ($stack) {
            $current = array_pop($stack);
            foreach ($childrenOf[$current] ?? [] as $childId) {
                if (! isset($seen[$childId])) {
                    $seen[$childId] = true;
                    $result[]       = $childId;
                    $stack[]        = $childId;
                }
            }
        }

        return $result;
    }
}
