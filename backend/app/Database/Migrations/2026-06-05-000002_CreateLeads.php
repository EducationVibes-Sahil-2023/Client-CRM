<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * The leads table — one row per captured lead. Lives in each client's own
 * database (mirrored from the main DB via TenantSchema / `php spark
 * tenants:sync`). Soft-deletable so a removed lead is recoverable.
 *
 * status_id / sub_status_id reference lead_statuses (sub-statuses are
 * lead_statuses with a parent_id). assigned_to references client_staff.
 */
class CreateLeads extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('leads')) {
            return;
        }

        $this->forge->addField([
            'id'             => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'      => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'name'           => ['type' => 'VARCHAR', 'constraint' => 150, 'null' => true],
            'phone'          => ['type' => 'VARCHAR', 'constraint' => 20],
            'alt_phone'      => ['type' => 'VARCHAR', 'constraint' => 20, 'null' => true],
            'status_id'      => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'sub_status_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'reference_name' => ['type' => 'VARCHAR', 'constraint' => 150, 'null' => true],
            'email'          => ['type' => 'VARCHAR', 'constraint' => 190, 'null' => true],
            'assigned_to'    => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'assigned_date'  => ['type' => 'DATE', 'null' => true],
            'city'           => ['type' => 'VARCHAR', 'constraint' => 100, 'null' => true],
            'state'          => ['type' => 'VARCHAR', 'constraint' => 100, 'null' => true],
            'follow_date'    => ['type' => 'DATE', 'null' => true],
            'created_date'   => ['type' => 'DATE', 'null' => true],
            'created_at'     => ['type' => 'DATETIME', 'null' => true],
            'updated_at'     => ['type' => 'DATETIME', 'null' => true],
            'deleted_at'     => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->addKey('status_id');
        $this->forge->addKey('assigned_to');
        $this->forge->createTable('leads');
    }

    public function down()
    {
        $this->forge->dropTable('leads', true);
    }
}
