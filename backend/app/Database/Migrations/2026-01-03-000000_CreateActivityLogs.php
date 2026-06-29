<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Append-only audit log: records every create/update/delete (and logins)
 * across the platform, attributed to the acting super admin, client admin,
 * user, or anonymous public visitor.
 */
class CreateActivityLogs extends Migration
{
    public function up()
    {
        $this->forge->addField([
            'id'          => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'actor_id'    => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'actor_role'  => ['type' => 'VARCHAR', 'constraint' => 30, 'default' => 'system'],
            'actor_name'  => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'action'      => ['type' => 'VARCHAR', 'constraint' => 30],
            'entity_type' => ['type' => 'VARCHAR', 'constraint' => 50, 'null' => true],
            'entity_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'description' => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'client_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'created_at'  => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('created_at');
        $this->forge->addKey('actor_role');
        $this->forge->addKey('entity_type');
        $this->forge->createTable('activity_logs');
    }

    public function down()
    {
        $this->forge->dropTable('activity_logs');
    }
}
