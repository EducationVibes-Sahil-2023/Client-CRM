<?php

namespace App\Models;

/**
 * Per-user table layout preferences (columns shown, order, widths, alignment)
 * for a given logical table such as "leads". One row per (user, table) inside
 * each client's own database, so a user's saved layout follows them across
 * sessions/devices and never affects another user's view.
 */
class UserTablePrefModel extends TenantModel
{
    protected $table         = 'user_table_prefs';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'user_id', 'table_key', 'config'];

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'user_id'   => 'required|is_natural_no_zero',
        'table_key' => 'required|max_length[64]',
    ];

    /** The saved config row for one user + table, or null if none yet. */
    public function forUser(int $clientId, int $userId, string $tableKey): ?array
    {
        return $this->where([
            'client_id' => $clientId,
            'user_id'   => $userId,
            'table_key' => $tableKey,
        ])->first();
    }
}
