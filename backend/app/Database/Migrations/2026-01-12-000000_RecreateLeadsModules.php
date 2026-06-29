<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Recreate the lead-setup / lookups / announcements tables in the MAIN DB that
 * were dropped earlier. Structure mirrors the original migrations. Per-client
 * databases are recreated by `php spark tenants:sync` (these tables are back in
 * TenantSchema). Idempotent: skips any table that already exists.
 */
class RecreateLeadsModules extends Migration
{
    public function up()
    {
        if (! $this->db->tableExists('lead_statuses')) {
            $this->forge->addField([
                'id'              => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'       => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'name'            => ['type' => 'VARCHAR', 'constraint' => 100],
                'color'           => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'indigo'],
                'conversion_type' => ['type' => 'VARCHAR', 'constraint' => 30, 'default' => 'open'],
                'sequence'        => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
                'enabled'         => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
                'created_at'      => ['type' => 'DATETIME', 'null' => true],
                'updated_at'      => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('client_id');
            $this->forge->createTable('lead_statuses');
        }

        if (! $this->db->tableExists('marketing_types')) {
            $this->forge->addField([
                'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'name'       => ['type' => 'VARCHAR', 'constraint' => 100],
                'color'      => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'indigo'],
                'sequence'   => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
                'enabled'    => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
                'created_at' => ['type' => 'DATETIME', 'null' => true],
                'updated_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('client_id');
            $this->forge->createTable('marketing_types');
        }

        if (! $this->db->tableExists('lead_sources')) {
            $this->forge->addField([
                'id'                => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'name'              => ['type' => 'VARCHAR', 'constraint' => 100],
                'color'             => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'indigo'],
                'sequence'          => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
                'marketing_type_id' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
                'enabled'           => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
                'created_at'        => ['type' => 'DATETIME', 'null' => true],
                'updated_at'        => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('client_id');
            $this->forge->createTable('lead_sources');
        }

        if (! $this->db->tableExists('lead_types')) {
            $this->forge->addField([
                'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'name'       => ['type' => 'VARCHAR', 'constraint' => 100],
                'color'      => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'indigo'],
                'sequence'   => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
                'enabled'    => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
                'created_at' => ['type' => 'DATETIME', 'null' => true],
                'updated_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('client_id');
            $this->forge->createTable('lead_types');
        }

        if (! $this->db->tableExists('conversion_types')) {
            $this->forge->addField([
                'id'            => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'     => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'name'          => ['type' => 'VARCHAR', 'constraint' => 100],
                'color'         => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'indigo'],
                'sequence'      => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
                'enabled'       => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
                'lead_type_ids' => ['type' => 'TEXT', 'null' => true],
                'created_at'    => ['type' => 'DATETIME', 'null' => true],
                'updated_at'    => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('client_id');
            $this->forge->createTable('conversion_types');
        }

        if (! $this->db->tableExists('announcements')) {
            $this->forge->addField([
                'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'title'      => ['type' => 'VARCHAR', 'constraint' => 255],
                'body'       => ['type' => 'TEXT', 'null' => true],
                'pinned'     => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
                'created_by' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
                'created_at' => ['type' => 'DATETIME', 'null' => true],
                'updated_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('client_id');
            $this->forge->createTable('announcements');
        }

        if (! $this->db->tableExists('client_lookups')) {
            $this->forge->addField([
                'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'category'   => ['type' => 'VARCHAR', 'constraint' => 50],
                'name'       => ['type' => 'VARCHAR', 'constraint' => 255],
                'created_at' => ['type' => 'DATETIME', 'null' => true],
                'updated_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey(['client_id', 'category']);
            $this->forge->createTable('client_lookups');
        }
    }

    public function down()
    {
        foreach (['lead_sources', 'marketing_types', 'conversion_types', 'lead_types', 'announcements', 'client_lookups', 'lead_statuses'] as $t) {
            $this->forge->dropTable($t, true);
        }
    }
}
