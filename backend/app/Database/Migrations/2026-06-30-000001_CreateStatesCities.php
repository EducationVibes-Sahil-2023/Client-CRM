<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Managed States + Cities lookups for the leads pipeline. A city belongs to a
 * state (`state_id`), mirroring the lead-source → marketing-type relationship.
 * Created in the MAIN DB; `php spark tenants:sync` rolls them out to every
 * client database (both are added to TenantSchema::TABLES). Idempotent.
 */
class CreateStatesCities extends Migration
{
    public function up()
    {
        if (! $this->db->tableExists('states')) {
            $this->forge->addField([
                'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'name'       => ['type' => 'VARCHAR', 'constraint' => 100],
                'color'      => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'indigo'],
                'sequence'   => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
                'enabled'    => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
                'created_at' => ['type' => 'DATETIME', 'null' => true],
                'updated_at' => ['type' => 'DATETIME', 'null' => true],
                'deleted_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('client_id');
            $this->forge->createTable('states');
        }

        if (! $this->db->tableExists('cities')) {
            $this->forge->addField([
                'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'name'       => ['type' => 'VARCHAR', 'constraint' => 100],
                'color'      => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'indigo'],
                'sequence'   => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
                'state_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
                'enabled'    => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
                'created_at' => ['type' => 'DATETIME', 'null' => true],
                'updated_at' => ['type' => 'DATETIME', 'null' => true],
                'deleted_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('client_id');
            $this->forge->addKey('state_id');
            $this->forge->createTable('cities');
        }
    }

    public function down()
    {
        $this->forge->dropTable('cities', true);
        $this->forge->dropTable('states', true);
    }
}
