<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Append-only tracker log for every asset action: created, updated, allocated,
 * revoked, transferred, note, deleted — with who/when and from/to staff.
 */
class CreateAssetLogs extends Migration
{
    public function up()
    {
        $this->forge->addField([
            'id'            => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'     => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'asset_id'      => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'action'        => ['type' => 'VARCHAR', 'constraint' => 30],
            'from_staff_id' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'to_staff_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'note'          => ['type' => 'TEXT', 'null' => true],
            'actor_id'      => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'actor_name'    => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'created_at'    => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey(['client_id', 'asset_id']);
        $this->forge->createTable('asset_logs');
    }

    public function down()
    {
        $this->forge->dropTable('asset_logs', true);
    }
}
