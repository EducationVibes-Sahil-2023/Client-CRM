<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Per-client CRM tables (main DB, scoped by client_id): roles & permissions,
 * staff hierarchy, lead statuses, announcements and tasks.
 */
class CreateClientCrmTables extends Migration
{
    public function up()
    {
        // Roles defined by each client.
        $this->forge->addField([
            'id'          => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'name'        => ['type' => 'VARCHAR', 'constraint' => 100],
            'description' => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'is_system'   => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'created_at'  => ['type' => 'DATETIME', 'null' => true],
            'updated_at'  => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->createTable('client_roles');

        // Per-role, per-module CRUD permissions.
        $this->forge->addField([
            'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'role_id'    => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'module'     => ['type' => 'VARCHAR', 'constraint' => 50],
            'can_view'   => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'can_create' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'can_update' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'can_delete' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey(['role_id', 'module']);
        $this->forge->createTable('client_role_permissions');

        // Staff members with a reporting hierarchy.
        $this->forge->addField([
            'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'name'       => ['type' => 'VARCHAR', 'constraint' => 255],
            'email'      => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'phone'      => ['type' => 'VARCHAR', 'constraint' => 50, 'null' => true],
            'role_id'    => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'reports_to' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'status'     => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'active'],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->createTable('client_staff');

        // Configurable lead statuses (pipeline stages) with colour & order.
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
        $this->forge->createTable('lead_statuses');

        // Announcements broadcast to the team.
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

        // Tasks assigned to staff.
        $this->forge->addField([
            'id'          => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'title'       => ['type' => 'VARCHAR', 'constraint' => 255],
            'description' => ['type' => 'TEXT', 'null' => true],
            'assigned_to' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'due_date'    => ['type' => 'DATE', 'null' => true],
            'priority'    => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'medium'],
            'status'      => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'open'],
            'created_at'  => ['type' => 'DATETIME', 'null' => true],
            'updated_at'  => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->createTable('client_tasks');
    }

    public function down()
    {
        foreach (['client_tasks', 'announcements', 'lead_statuses', 'client_staff', 'client_role_permissions', 'client_roles'] as $t) {
            $this->forge->dropTable($t, true);
        }
    }
}
