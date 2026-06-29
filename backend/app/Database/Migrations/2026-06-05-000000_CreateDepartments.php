<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Departments become a first-class, client-scoped lookup with its own table
 * (previously a `client_lookups` category). Soft-deletable via `deleted_at`,
 * so archiving a department is reversible. Applied to the main DB; the column
 * set is rolled out to every client database by `php spark tenants:sync`.
 *
 * Existing `client_lookups` department rows are copied across (ids preserved)
 * so staff `department_id` and announcement targets keep resolving.
 */
class CreateDepartments extends Migration
{
    public function up()
    {
        if (! $this->db->tableExists('departments')) {
            $this->forge->addField([
                'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'name'       => ['type' => 'VARCHAR', 'constraint' => 100],
                'sequence'   => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
                'enabled'    => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
                'created_at' => ['type' => 'DATETIME', 'null' => true],
                'updated_at' => ['type' => 'DATETIME', 'null' => true],
                'deleted_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('client_id');
            $this->forge->createTable('departments');

            $this->copyFromLookups();
        }
    }

    /** Seed the new table from any existing department lookups, preserving ids. */
    private function copyFromLookups(): void
    {
        if (! $this->db->tableExists('client_lookups')) {
            return;
        }
        $rows = $this->db->table('client_lookups')->where('category', 'department')->get()->getResultArray();
        if (! $rows) {
            return;
        }
        $this->db->table('departments')->insertBatch(array_map(static fn ($r) => [
            'id'         => $r['id'],
            'client_id'  => $r['client_id'],
            'name'       => $r['name'],
            'created_at' => $r['created_at'] ?? null,
            'updated_at' => $r['updated_at'] ?? null,
        ], $rows));
    }

    public function down()
    {
        $this->forge->dropTable('departments', true);
    }
}
