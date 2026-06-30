<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Tasks gain a `custom_fields` JSON column holding the values for any admin-defined
 * custom fields (the field definitions themselves live in the per-client `settings`
 * table under `task_custom_fields`). Structure only — rolled out to each client DB
 * via `php spark tenants:sync`.
 */
class AddTaskCustomFields extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('client_tasks') && ! $this->db->fieldExists('custom_fields', 'client_tasks')) {
            $this->forge->addColumn('client_tasks', [
                'custom_fields' => ['type' => 'TEXT', 'null' => true, 'after' => 'status'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->tableExists('client_tasks') && $this->db->fieldExists('custom_fields', 'client_tasks')) {
            $this->forge->dropColumn('client_tasks', 'custom_fields');
        }
    }
}
