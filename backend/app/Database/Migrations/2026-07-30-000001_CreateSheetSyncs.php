<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Per-client Google Sheet → Leads sync configs. Each row is one connected sheet:
 * which spreadsheet/tab, how its columns map to lead fields, the dedupe key, and
 * lead defaults. Pull-based (on-demand + `php spark sheets:sync` cron) using the
 * client's own service-account key (stored in tenant settings) — so no public
 * webhook / main-DB registry is needed. Tenant table (in TenantSchema::TABLES).
 */
class CreateSheetSyncs extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('sheet_syncs')) {
            return;
        }
        $this->forge->addField([
            'id'                   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'            => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'name'                 => ['type' => 'VARCHAR', 'constraint' => 150, 'default' => ''],
            'spreadsheet_id'       => ['type' => 'VARCHAR', 'constraint' => 120, 'default' => ''],
            'sheet_tab'            => ['type' => 'VARCHAR', 'constraint' => 120, 'default' => ''], // tab title; '' = first tab
            'header_row'           => ['type' => 'INT', 'constraint' => 11, 'default' => 1],
            'column_map'           => ['type' => 'MEDIUMTEXT', 'null' => true], // JSON: sheet header → leadKey | status | custom_<key>
            'dedupe_field'         => ['type' => 'VARCHAR', 'constraint' => 40, 'default' => 'phone'],
            // Lead defaults for NEW leads.
            'source_id'            => ['type' => 'INT', 'constraint' => 11, 'null' => true],
            'status_id'            => ['type' => 'INT', 'constraint' => 11, 'null' => true], // fallback when no status mapped
            'lead_type_id'         => ['type' => 'INT', 'constraint' => 11, 'null' => true],
            'assigned_to'          => ['type' => 'INT', 'constraint' => 11, 'null' => true],
            'auto_assignee'        => ['type' => 'TEXT', 'null' => true],
            'assign_cursor'        => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
            // Write-back of the per-row result ("insert or not") into the sheet.
            'write_back'           => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'status_result_column' => ['type' => 'VARCHAR', 'constraint' => 120, 'default' => 'CRM Status'],
            // Run stats.
            'inserted_count'       => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
            'updated_count'        => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
            'skipped_count'        => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
            'last_synced_at'       => ['type' => 'DATETIME', 'null' => true],
            'enabled'              => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'created_at'           => ['type' => 'DATETIME', 'null' => true],
            'updated_at'           => ['type' => 'DATETIME', 'null' => true],
            'deleted_at'           => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->createTable('sheet_syncs', true);
    }

    public function down()
    {
        $this->forge->dropTable('sheet_syncs', true);
    }
}
