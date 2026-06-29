<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class CreateMessages extends Migration
{
    public function up()
    {
        $this->forge->addField([
            'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'to_email'   => ['type' => 'VARCHAR', 'constraint' => 255],
            'to_name'    => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'subject'    => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'body'       => ['type' => 'TEXT', 'null' => true],
            'folder'     => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'sent'],
            'starred'    => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'created_by' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('folder');
        $this->forge->createTable('messages');
    }

    public function down()
    {
        $this->forge->dropTable('messages');
    }
}
