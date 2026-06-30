<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Visitor requests — log people who visit (office / seminar / other), with an
 * admin-defined type and status. Standalone, but optionally linked to a lead.
 * All three tables live in each client's own DB (mirrored via TenantSchema).
 *
 * `visitor_statuses.is_final` marks terminal statuses (e.g. Completed / Cancelled):
 * once a visitor reaches one, only an admin may change its status.
 */
class CreateVisitors extends Migration
{
    public function up()
    {
        if (! $this->db->tableExists('visitor_types')) {
            $this->forge->addField([
                'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'name'       => ['type' => 'VARCHAR', 'constraint' => 120],
                'color'      => ['type' => 'VARCHAR', 'constraint' => 30, 'default' => 'indigo'],
                'sequence'   => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
                'enabled'    => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
                'created_at' => ['type' => 'DATETIME', 'null' => true],
                'updated_at' => ['type' => 'DATETIME', 'null' => true],
                'deleted_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('client_id');
            $this->forge->createTable('visitor_types');
        }

        if (! $this->db->tableExists('visitor_statuses')) {
            $this->forge->addField([
                'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'name'       => ['type' => 'VARCHAR', 'constraint' => 120],
                'color'      => ['type' => 'VARCHAR', 'constraint' => 30, 'default' => 'indigo'],
                'is_final'   => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0], // terminal → admin-only changes
                'sequence'   => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
                'enabled'    => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
                'created_at' => ['type' => 'DATETIME', 'null' => true],
                'updated_at' => ['type' => 'DATETIME', 'null' => true],
                'deleted_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('client_id');
            $this->forge->createTable('visitor_statuses');
        }

        if (! $this->db->tableExists('visitors')) {
            $this->forge->addField([
                'id'          => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'name'        => ['type' => 'VARCHAR', 'constraint' => 160],
                'phone'       => ['type' => 'VARCHAR', 'constraint' => 20, 'null' => true],
                'email'       => ['type' => 'VARCHAR', 'constraint' => 160, 'null' => true],
                'type_id'     => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
                'status_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
                'lead_id'     => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true], // optional link
                'assigned_to' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
                'purpose'     => ['type' => 'VARCHAR', 'constraint' => 500, 'null' => true],
                'visit_date'  => ['type' => 'DATETIME', 'null' => true],
                'notes'       => ['type' => 'TEXT', 'null' => true],
                'created_by'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
                'created_at'  => ['type' => 'DATETIME', 'null' => true],
                'updated_at'  => ['type' => 'DATETIME', 'null' => true],
                'deleted_at'  => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('client_id');
            $this->forge->addKey('status_id');
            $this->forge->addKey('visit_date');
            $this->forge->createTable('visitors');
        }
    }

    public function down()
    {
        $this->forge->dropTable('visitors', true);
        $this->forge->dropTable('visitor_statuses', true);
        $this->forge->dropTable('visitor_types', true);
    }
}
