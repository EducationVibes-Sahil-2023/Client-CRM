<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Professional task tracking: a start date + a completion timestamp (to measure
 * on-time delivery), and a per-task comments thread. All tenant-owned — mirrored
 * to each client DB via `php spark tenants:sync`.
 */
class TaskTrackingAndComments extends Migration
{
    public function up()
    {
        // client_tasks: start_date (begin) — due_date already holds the end date —
        // and completed_at (set when moved to Done; powers on-time tracking).
        $this->forge->addColumn('client_tasks', [
            'start_date'   => ['type' => 'DATE', 'null' => true, 'after' => 'due_date'],
            'completed_at' => ['type' => 'DATETIME', 'null' => true, 'after' => 'status'],
        ]);

        // task_comments — a discussion thread per task.
        $this->forge->addField([
            'id'          => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'task_id'     => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'author_type' => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'user'],
            'author_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'author_name' => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'body'        => ['type' => 'TEXT'],
            'created_at'  => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey(['client_id', 'task_id']);
        $this->forge->createTable('task_comments');
    }

    public function down()
    {
        $this->forge->dropColumn('client_tasks', ['start_date', 'completed_at']);
        $this->forge->dropTable('task_comments');
    }
}
