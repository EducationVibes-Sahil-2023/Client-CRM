<?php

namespace App\Libraries;

use CodeIgniter\Database\BaseConnection;

/**
 * Keeps every client's database in structural lock-step with the canonical
 * client-domain tables defined in the main database.
 *
 * Each table here lives in *each client's own database* (never the shared main
 * DB). `apply()` creates any missing table (mirroring the main table's exact
 * structure) and adds any missing columns — structure only, never data. So:
 *   - creating a client provisions all of these tables in its DB, and
 *   - adding a column to a main table + `php spark tenants:sync` rolls that
 *     column out to every client, without touching their rows.
 */
class TenantSchema
{
    /**
     * Client-owned tables. Structure is mirrored from the main DB table of the
     * same name; data lives only in the per-client databases.
     */
    public const TABLES = [
        'client_roles',
        'client_role_permissions',
        'client_staff',
        'client_tasks',
        'task_comments',
        'lead_statuses',
        'leads',
        'lead_transfers',
        'lead_reminders',
        'lead_notes',
        'visitor_types',
        'visitor_statuses',
        'visitors',
        'announcements',
        'announcement_reads',
        'client_lookups',
        'assets',
        'asset_allocations',
        'asset_logs',
        'marketing_types',
        'lead_sources',
        'lead_types',
        'conversion_types',
        'followup_groups',
        'states',
        'cities',
        'departments',
        'office_locations',
        'settings',
        'user_table_prefs',
        'calls',
        'activity_logs',
    ];

    private string $mainDb;

    public function __construct()
    {
        $this->mainDb = (string) (config('Database')->default['database'] ?? 'crm_main');
    }

    /** Create missing tables / add missing columns on a client connection. */
    public function apply(BaseConnection $db): void
    {
        foreach (self::TABLES as $table) {
            if (! $db->tableExists($table)) {
                // Mirror the canonical structure (indexes, PK, auto-increment).
                $db->query("CREATE TABLE IF NOT EXISTS `{$table}` LIKE `{$this->mainDb}`.`{$table}`");
                continue;
            }
            $this->addMissingColumns($db, $table);
            $this->addMissingIndexes($db, $table);
        }
    }

    /** Add columns the main table has but this client's table is missing. */
    private function addMissingColumns(BaseConnection $db, string $table): void
    {
        $have = array_map('strtolower', $db->getFieldNames($table));

        $cols = $db->query("SHOW COLUMNS FROM `{$this->mainDb}`.`{$table}`")->getResultArray();
        $prev = null;
        foreach ($cols as $col) {
            $name = $col['Field'];
            if (! in_array(strtolower($name), $have, true)) {
                $after = $prev !== null ? " AFTER `{$prev}`" : '';
                $db->query("ALTER TABLE `{$table}` ADD COLUMN `{$name}` " . $this->columnDdl($col) . $after);
            }
            $prev = $name;
        }
    }

    /**
     * Mirror any non-primary index the main table has but this client's table is
     * missing (same name + same column list/order). Lets a single index change on
     * the canonical schema roll out to every client via `php spark tenants:sync`.
     */
    private function addMissingIndexes(BaseConnection $db, string $table): void
    {
        $have = [];
        foreach ($db->query("SHOW INDEX FROM `{$table}`")->getResultArray() as $row) {
            $have[$row['Key_name']] = true;
        }

        // Group the canonical table's indexes by name, in column order.
        $want = [];
        foreach ($db->query("SHOW INDEX FROM `{$this->mainDb}`.`{$table}`")->getResultArray() as $row) {
            if ($row['Key_name'] === 'PRIMARY') {
                continue;
            }
            $want[$row['Key_name']]['unique']                       = ((int) $row['Non_unique'] === 0);
            $want[$row['Key_name']]['cols'][(int) $row['Seq_in_index']] = $row['Column_name'];
        }

        foreach ($want as $name => $spec) {
            if (isset($have[$name])) {
                continue;
            }
            ksort($spec['cols']);
            $cols   = implode('`, `', array_values($spec['cols']));
            $unique = $spec['unique'] ? 'UNIQUE ' : '';
            try {
                $db->query("ALTER TABLE `{$table}` ADD {$unique}INDEX `{$name}` (`{$cols}`)");
            } catch (\Throwable $e) {
                // Best-effort: ignore duplicates / races — structure sync only.
            }
        }
    }

    /** Build a column definition from a SHOW COLUMNS row. */
    private function columnDdl(array $col): string
    {
        $ddl = $col['Type'];
        $ddl .= $col['Null'] === 'NO' ? ' NOT NULL' : ' NULL';

        if ($col['Default'] !== null) {
            $ddl .= " DEFAULT '" . str_replace("'", "''", (string) $col['Default']) . "'";
        }
        if (! empty($col['Extra'])) {
            $ddl .= ' ' . $col['Extra']; // e.g. auto_increment
        }

        return $ddl;
    }
}
