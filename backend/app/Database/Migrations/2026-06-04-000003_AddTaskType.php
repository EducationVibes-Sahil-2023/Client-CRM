<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Adds a `type` to client tasks (feature / bug / improvement / task) so the
 * task board can categorise work — mirrored to each client DB via
 * `php spark tenants:sync`.
 */
class AddTaskType extends Migration
{
    public function up()
    {
        $this->forge->addColumn('client_tasks', [
            'type' => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'task', 'after' => 'priority'],
        ]);
    }

    public function down()
    {
        $this->forge->dropColumn('client_tasks', 'type');
    }
}
