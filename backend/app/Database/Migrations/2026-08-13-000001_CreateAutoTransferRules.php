<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Auto lead-transfer RULES. One row = one named criteria card the admin builds
 * (e.g. "Not Reachable", "Fresh Leads"). Each rule either TRANSFERS matching
 * already-assigned leads to another counsellor, or DISTRIBUTES unassigned leads.
 *
 * Created in crm_main so TenantSchema can `CREATE TABLE … LIKE crm_main.auto_transfer_rules`
 * into every tenant DB; the table is in TenantSchema::TABLES, so rule rows live
 * only in each client's isolated database.
 *
 * Most criteria live in the JSON `config` column; only the fields the engine
 * loops on (type, enabled, order, round-robin cursor) are real columns.
 */
class CreateAutoTransferRules extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('auto_transfer_rules')) {
            return;
        }

        $this->forge->addField([
            'id'            => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'     => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'name'          => ['type' => 'VARCHAR', 'constraint' => 150, 'default' => ''],
            // 'transfer' (reassign already-assigned) | 'distribute' (assign unassigned).
            'rule_type'     => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'transfer'],
            'enabled'       => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'sequence'      => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
            // All criteria + target pool, as JSON (see AutoTransferRule::normalise()).
            'config'        => ['type' => 'MEDIUMTEXT', 'null' => true],
            // Per-rule round-robin cursor, persisted for fair distribution.
            'assign_cursor' => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
            'created_at'    => ['type' => 'DATETIME', 'null' => true],
            'updated_at'    => ['type' => 'DATETIME', 'null' => true],
            'deleted_at'    => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->createTable('auto_transfer_rules', true);
    }

    public function down()
    {
        $this->forge->dropTable('auto_transfer_rules', true);
    }
}
