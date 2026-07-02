<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Round 3 of performance indexes — for the server-side paginated leads list
 * (SQL WHERE/ORDER BY/LIMIT over up to 3–5 lakh leads). Every filter + sort
 * column and the follow-up-status EXISTS sub-queries should hit an index.
 *
 * Same idempotent guarded pattern as V1/V2. TenantSchema mirrors non-primary
 * indexes to client DBs, so `php spark tenants:sync` (or `db:upgrade`) rolls
 * these out to every tenant.
 */
class AddPerformanceIndexesV3 extends Migration
{
    /** [table, [columns...]] — index name derived as idx_<table>_<cols>. */
    private array $indexes = [
        // Leads: filter + sort columns (client_id leads for the tenant/scope scan).
        ['leads', ['client_id', 'deleted_at']],
        ['leads', ['client_id', 'source_id']],
        ['leads', ['client_id', 'lead_type_id']],
        ['leads', ['client_id', 'sub_status_id']],
        ['leads', ['client_id', 'assigned_date']],
        ['leads', ['client_id', 'created_at']],
        ['leads', ['client_id', 'follow_date']],
        ['leads', ['reference_name']],

        // Follow-up-status EXISTS + decoration lookups.
        ['lead_notes', ['lead_id', 'created_at']],
        ['lead_notes', ['deleted_at']],
        ['lead_reminders', ['lead_id']],
        ['calls', ['contact', 'connected', 'call_start']],
    ];

    public function up()
    {
        foreach ($this->indexes as [$table, $cols]) {
            $this->addIndex($table, $cols);
        }
    }

    public function down()
    {
        foreach ($this->indexes as [$table, $cols]) {
            $name = $this->indexName($table, $cols);
            if ($this->db->tableExists($table) && $this->indexExists($table, $name)) {
                $this->db->query("ALTER TABLE `{$table}` DROP INDEX `{$name}`");
            }
        }
    }

    private function indexName(string $table, array $cols): string
    {
        return 'idx_' . $table . '_' . implode('_', $cols);
    }

    private function addIndex(string $table, array $cols): void
    {
        if (! $this->db->tableExists($table)) {
            return;
        }
        $have = array_map('strtolower', $this->db->getFieldNames($table));
        foreach ($cols as $c) {
            if (! in_array(strtolower($c), $have, true)) {
                return;
            }
        }
        $name = $this->indexName($table, $cols);
        if ($this->indexExists($table, $name)) {
            return;
        }
        $colList = implode('`, `', $cols);
        $this->db->query("ALTER TABLE `{$table}` ADD INDEX `{$name}` (`{$colList}`)");
    }

    private function indexExists(string $table, string $name): bool
    {
        $rows = $this->db->query("SHOW INDEX FROM `{$table}` WHERE Key_name = " . $this->db->escape($name))->getResultArray();

        return ! empty($rows);
    }
}
