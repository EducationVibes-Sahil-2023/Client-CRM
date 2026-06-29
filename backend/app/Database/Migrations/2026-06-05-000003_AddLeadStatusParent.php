<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Lead statuses can now nest one level deep: a status with a `parent_id` is a
 * sub-status of its parent. Runs on the main DB; `php spark tenants:sync` rolls
 * the column out to every client database.
 */
class AddLeadStatusParent extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('lead_statuses') && ! $this->db->fieldExists('parent_id', 'lead_statuses')) {
            $this->forge->addColumn('lead_statuses', [
                'parent_id' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true, 'after' => 'name'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->tableExists('lead_statuses') && $this->db->fieldExists('parent_id', 'lead_statuses')) {
            $this->forge->dropColumn('lead_statuses', 'parent_id');
        }
    }
}
