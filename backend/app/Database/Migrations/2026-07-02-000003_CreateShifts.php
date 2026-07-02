<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Named work shifts — each a weekly schedule (same 7-day working_hours shape as
 * an office). A staff member can be mapped to a shift (client_staff.shift_id);
 * the first-response SLA then uses the user's shift hours (falling back to their
 * office, then the default). Lives in each client DB (mirrored via tenants:sync).
 */
class CreateShifts extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('shifts')) {
            return;
        }

        $this->forge->addField([
            'id'            => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'     => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'name'          => ['type' => 'VARCHAR', 'constraint' => 100],
            'working_hours' => ['type' => 'TEXT', 'null' => true],
            'sequence'      => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
            'enabled'       => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'created_at'    => ['type' => 'DATETIME', 'null' => true],
            'updated_at'    => ['type' => 'DATETIME', 'null' => true],
            'deleted_at'    => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->createTable('shifts');
    }

    public function down()
    {
        $this->forge->dropTable('shifts', true);
    }
}
