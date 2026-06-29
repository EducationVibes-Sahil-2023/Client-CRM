<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Adds covering indexes to the hot query paths across the platform (main DB) and
 * the canonical client-domain tables. Because TenantSchema mirrors indexes from
 * the main DB, running `php spark tenants:sync` after this migration rolls the
 * same indexes out to every client's database too.
 *
 * Every add is guarded (table + columns must exist, index must be absent), so
 * the migration is idempotent and safe across installs with slight schema drift.
 */
class AddPerformanceIndexes extends Migration
{
    /** [table, [columns...]] — index name is derived as idx_<table>_<cols>. */
    private array $indexes = [
        // ---- leads & engagement (the heaviest CRM tables) ----
        ['leads', ['client_id', 'deleted_at']],
        ['leads', ['sub_status_id']],
        ['leads', ['source_id']],
        ['leads', ['lead_type_id']],
        ['leads', ['follow_date']],
        ['leads', ['created_date']],
        ['leads', ['created_by']],
        ['leads', ['created_at']],
        ['lead_reminders', ['client_id']],
        ['lead_reminders', ['lead_id']],
        ['lead_reminders', ['remind_at']],
        ['lead_reminders', ['notified_at']],
        ['lead_reminders', ['deleted_at']],
        ['lead_notes', ['client_id']],
        ['lead_notes', ['lead_id']],
        ['lead_notes', ['deleted_at']],
        ['lead_statuses', ['client_id', 'parent_id']],
        ['lead_sources', ['client_id']],
        ['lead_types', ['client_id']],

        // ---- tasks, team, assets, announcements, calls ----
        ['client_tasks', ['client_id']],
        ['client_tasks', ['assigned_to']],
        ['client_tasks', ['deleted_at']],
        ['task_comments', ['task_id']],
        ['client_staff', ['client_id']],
        ['client_staff', ['reports_to']],
        ['client_staff', ['role_id']],
        ['client_staff', ['deleted_at']],
        ['assets', ['client_id']],
        ['asset_allocations', ['asset_id']],
        ['asset_allocations', ['staff_id']],
        ['asset_logs', ['asset_id']],
        ['announcements', ['client_id']],
        ['announcement_reads', ['announcement_id']],
        ['announcement_reads', ['staff_id']],
        ['calls', ['client_id']],
        ['calls', ['lead_id']],
        ['calls', ['staff_id']],
        ['calls', ['call_start']],

        // ---- per-client config / audit ----
        ['activity_logs', ['client_id', 'entity_type', 'entity_id']],
        ['activity_logs', ['created_at']],
        ['user_table_prefs', ['client_id', 'user_id', 'table_key']],
        ['settings', ['client_id', 'setting_key']],

        // ---- platform / main-DB tables ----
        ['users', ['email']],
        ['users', ['role']],
        ['users', ['client_id']],
        ['clients', ['status']],
        ['clients', ['plan']],
        ['clients', ['created_at']],
        ['demo_requests', ['status']],
        ['demo_requests', ['created_at']],
        ['contact_messages', ['status']],
        ['contact_messages', ['created_at']],
        ['app_notifications', ['client_id']],
        ['app_notifications', ['user_id']],
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
