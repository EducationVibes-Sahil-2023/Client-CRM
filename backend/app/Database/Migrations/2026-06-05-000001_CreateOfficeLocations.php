<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Office locations become a first-class, client-scoped entity with their own
 * table (previously a `client_lookups` category) carrying full details (name,
 * address, city, phone). Soft-deletable via `deleted_at`, so archiving an
 * office is reversible. Applied to the main DB; `php spark tenants:sync` rolls
 * the columns out to every client database. Existing office_location lookups
 * are copied across (ids preserved) so staff `office_location_id` keeps resolving.
 */
class CreateOfficeLocations extends Migration
{
    public function up()
    {
        if (! $this->db->tableExists('office_locations')) {
            $this->forge->addField([
                'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'name'       => ['type' => 'VARCHAR', 'constraint' => 150],
                'address'    => ['type' => 'TEXT', 'null' => true],
                'city'       => ['type' => 'VARCHAR', 'constraint' => 100, 'null' => true],
                'phone'      => ['type' => 'VARCHAR', 'constraint' => 40, 'null' => true],
                'sequence'   => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
                'enabled'    => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
                'created_at' => ['type' => 'DATETIME', 'null' => true],
                'updated_at' => ['type' => 'DATETIME', 'null' => true],
                'deleted_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('client_id');
            $this->forge->createTable('office_locations');

            $this->copyFromLookups();
        }
    }

    /** Seed from any existing office_location lookups, preserving ids. */
    private function copyFromLookups(): void
    {
        if (! $this->db->tableExists('client_lookups')) {
            return;
        }
        $rows = $this->db->table('client_lookups')->where('category', 'office_location')->get()->getResultArray();
        if (! $rows) {
            return;
        }
        $this->db->table('office_locations')->insertBatch(array_map(static fn ($r) => [
            'id'         => $r['id'],
            'client_id'  => $r['client_id'],
            'name'       => $r['name'],
            'created_at' => $r['created_at'] ?? null,
            'updated_at' => $r['updated_at'] ?? null,
        ], $rows));
    }

    public function down()
    {
        $this->forge->dropTable('office_locations', true);
    }
}
