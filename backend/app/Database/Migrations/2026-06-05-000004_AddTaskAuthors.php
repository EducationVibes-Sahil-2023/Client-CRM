<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Tasks track who created and last updated them. `created_by` / `updated_by`
 * hold the actor id (staff id, or the admin user id); the `*_name` columns
 * snapshot the display name so it shows even if the person is later renamed or
 * removed. Applied to the main DB; rolled out by `php spark tenants:sync`.
 */
class AddTaskAuthors extends Migration
{
    public function up()
    {
        if (! $this->db->tableExists('client_tasks')) {
            return;
        }
        $add = [];
        if (! $this->db->fieldExists('created_by', 'client_tasks')) {
            $add['created_by'] = ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true, 'after' => 'status'];
        }
        if (! $this->db->fieldExists('created_by_name', 'client_tasks')) {
            $add['created_by_name'] = ['type' => 'VARCHAR', 'constraint' => 150, 'null' => true];
        }
        if (! $this->db->fieldExists('updated_by', 'client_tasks')) {
            $add['updated_by'] = ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true];
        }
        if (! $this->db->fieldExists('updated_by_name', 'client_tasks')) {
            $add['updated_by_name'] = ['type' => 'VARCHAR', 'constraint' => 150, 'null' => true];
        }
        if ($add) {
            $this->forge->addColumn('client_tasks', $add);
        }
    }

    public function down()
    {
        foreach (['created_by', 'created_by_name', 'updated_by', 'updated_by_name'] as $col) {
            if ($this->db->fieldExists($col, 'client_tasks')) {
                $this->forge->dropColumn('client_tasks', $col);
            }
        }
    }
}
