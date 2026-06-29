<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Login index for client staff. Staff *profiles* live in each client's own
 * database (`client_staff`), but login happens before any client is known, so
 * a small credentials index is kept in the main DB: email → (client_id,
 * staff_id, password, status). Auth resolves the client from here, then loads
 * the profile/role from that client's database.
 */
class CreateStaffAccounts extends Migration
{
    public function up()
    {
        $this->forge->addField([
            'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'staff_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'email'      => ['type' => 'VARCHAR', 'constraint' => 255],
            'password'   => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'status'     => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'active'],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addUniqueKey('email');
        $this->forge->addUniqueKey(['client_id', 'staff_id']);
        $this->forge->createTable('staff_accounts');
    }

    public function down()
    {
        $this->forge->dropTable('staff_accounts');
    }
}
