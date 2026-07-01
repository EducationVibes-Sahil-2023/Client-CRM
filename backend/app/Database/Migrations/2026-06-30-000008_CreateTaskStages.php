<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Task stages: the columns of the Task Management kanban board, now data-driven
 * instead of hardcoded. Each client owns its own set of stages (mirrored to
 * every client DB via `php spark tenants:sync`). A task's free-form `status`
 * column stores a stage `key`.
 *
 * Two stages are flagged `is_system` and can never be deleted: the entry stage
 * (`open`) and the terminal stage (`done`). Everything between them — and any
 * new stage an admin creates — is fully editable, re-orderable and removable.
 */
class CreateTaskStages extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('task_stages')) {
            return;
        }

        $this->forge->addField([
            'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'name'       => ['type' => 'VARCHAR', 'constraint' => 100],
            'key'        => ['type' => 'VARCHAR', 'constraint' => 60],
            'color'      => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'slate'],
            'is_done'    => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'is_system'  => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'sequence'   => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
            'enabled'    => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
            'deleted_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->createTable('task_stages');
    }

    public function down()
    {
        $this->forge->dropTable('task_stages', true);
    }
}
