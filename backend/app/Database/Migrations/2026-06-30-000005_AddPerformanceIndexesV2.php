<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Round 2 of performance indexes — covers hot paths and tables added after the
 * original AddPerformanceIndexes (lead assignment scoping, visitors, lead
 * transfers, the announcement-unread poll, the due-task sweep, etc.).
 *
 * Sized for ~30 clients × ~100 users with up to ~500MB of data each: the goal is
 * that every list/scope/poll query hits an index instead of scanning the table.
 *
 * Same idempotent, guarded pattern as round 1 (table + every column must exist
 * and the index must be absent), so it's safe to re-run and across schema drift.
 * After migrating, run `php spark tenants:sync` to mirror these to client DBs
 * (or `php spark db:upgrade`, which does both).
 */
class AddPerformanceIndexesV2 extends Migration
{
    /** [table, [columns...]] — index name is derived as idx_<table>_<cols>. */
    private array $indexes = [
        // ---- leads: the dominant query is "this client's leads, scoped to a
        // rep (or their reports), newest first". assigned_to + status_id were
        // unindexed; phone is used for call matching + search. ----
        ['leads', ['client_id', 'assigned_to']],   // staff-scoped lists + groupBy assigned_to
        ['leads', ['client_id', 'status_id']],      // analytics/pipeline groupBy + filters
        ['leads', ['phone']],                       // call matching + lookup
        ['leads', ['alt_phone']],

        // ---- calls: leads list builds "latest connected call per number", and
        // the dashboard scans this client's connected calls. ----
        ['calls', ['client_id', 'connected']],
        ['calls', ['staff_id']],

        // ---- tasks: the due/overdue sweep runs on every dashboard + tasks load. ----
        ['client_tasks', ['due_date']],
        ['client_tasks', ['status']],

        // ---- announcements: the unread-count badge is polled every 30s per user. ----
        ['announcement_reads', ['client_id', 'staff_id']],

        // ---- visitors (newer module) ----
        ['visitors', ['client_id', 'status_id']],
        ['visitors', ['assigned_to']],
        ['visitors', ['lead_id']],
        ['visitors', ['type_id']],
        ['visitors', ['deleted_at']],

        // ---- lead transfers (newer module): the pending queue + recipient lookups. ----
        ['lead_transfers', ['client_id', 'status']],
        ['lead_transfers', ['to_staff_id']],
        ['lead_transfers', ['deleted_at']],

        // ---- audit feed: ordered by created_at within a client. ----
        ['activity_logs', ['client_id', 'created_at']],

        // ---- states / cities (lead form lookups) ----
        ['cities', ['client_id', 'state_id']],
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

    /** Add the index only when the table + every column exist and it's absent. */
    private function addIndex(string $table, array $cols): void
    {
        if (! $this->db->tableExists($table)) {
            return;
        }
        $have = array_map('strtolower', $this->db->getFieldNames($table));
        foreach ($cols as $c) {
            if (! in_array(strtolower($c), $have, true)) {
                return; // column not present in this install — skip silently
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
