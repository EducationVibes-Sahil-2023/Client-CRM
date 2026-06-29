<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Follow-up groups: a named bucket that groups several lead statuses (e.g.
 * "Prospect" = Hot + Warm). The Follow Up Tracker shows one "pending" card per
 * group, counting open follow-ups whose lead status falls in the group. Lives in
 * each client DB (mirrored from the main table via `php spark tenants:sync`).
 */
class CreateFollowupGroups extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('followup_groups')) {
            return;
        }

        $this->forge->addField([
            'id'              => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'       => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'name'            => ['type' => 'VARCHAR', 'constraint' => 100],
            'color'           => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'indigo'],
            'lead_status_ids' => ['type' => 'TEXT', 'null' => true],
            'sequence'        => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
            'enabled'         => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'created_at'      => ['type' => 'DATETIME', 'null' => true],
            'updated_at'      => ['type' => 'DATETIME', 'null' => true],
            'deleted_at'      => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->createTable('followup_groups');
    }

    public function down()
    {
        $this->forge->dropTable('followup_groups', true);
    }
}
