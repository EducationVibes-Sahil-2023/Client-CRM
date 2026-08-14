<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Snapshot columns on `lead_transfers` so the Auto-Transfer report can show the
 * lead's state AT the moment of each transfer (independent of later edits):
 *   rule_id        — which auto_transfer_rule fired (null = manual/self transfer)
 *   old_status_id  — the lead's status just before the transfer
 *   new_status_id  — the status set on transfer (same as old unless the rule resets it)
 *   source_id      — the lead's source at transfer time
 *   update_count   — activity entries since assignment, at transfer time
 *
 * Added to crm_main.lead_transfers; the table is in TenantSchema::TABLES, so
 * `php spark tenants:sync` (db:upgrade) rolls the columns out to every tenant DB.
 */
class AddTransferSnapshot extends Migration
{
    public function up()
    {
        $add = [];
        foreach ([
            'rule_id'       => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'old_status_id' => ['type' => 'INT', 'constraint' => 11, 'null' => true],
            'new_status_id' => ['type' => 'INT', 'constraint' => 11, 'null' => true],
            'source_id'     => ['type' => 'INT', 'constraint' => 11, 'null' => true],
            'update_count'  => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
        ] as $col => $def) {
            if (! $this->db->fieldExists($col, 'lead_transfers')) {
                $add[$col] = $def;
            }
        }
        if ($add) {
            $this->forge->addColumn('lead_transfers', $add);
        }
    }

    public function down()
    {
        foreach (['rule_id', 'old_status_id', 'new_status_id', 'source_id', 'update_count'] as $col) {
            if ($this->db->fieldExists($col, 'lead_transfers')) {
                $this->forge->dropColumn('lead_transfers', $col);
            }
        }
    }
}
