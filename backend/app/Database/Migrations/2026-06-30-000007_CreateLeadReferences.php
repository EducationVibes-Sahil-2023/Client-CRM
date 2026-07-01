<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Reference names — an admin-managed lookup (like lead sources/types) plus a
 * single reference assigned to a staff member. A staff member who has a
 * reference set sees ONLY leads whose `reference_name` matches it (the leads
 * visibility scope flips from assigned_to → reference for those "agent" users).
 *
 * `leads.reference_name` is left as-is (free text): the lead form just becomes a
 * dropdown of these references and stores the chosen reference's name, so all
 * existing reference values, columns, filters and activity logs keep working and
 * matching is by name. Renaming a reference bulk-renames matching leads (handled
 * in the controller) so the scope never drifts.
 *
 * Additive + idempotent (guarded), so safe to re-run. Mirrored to every tenant
 * DB via TenantSchema / `php spark tenants:sync` (or `php spark db:upgrade`).
 */
class CreateLeadReferences extends Migration
{
    public function up()
    {
        if (! $this->db->tableExists('lead_references')) {
            $this->forge->addField([
                'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'name'       => ['type' => 'VARCHAR', 'constraint' => 150],
                'color'      => ['type' => 'VARCHAR', 'constraint' => 30, 'default' => 'indigo'],
                'sequence'   => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
                'enabled'    => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
                'created_at' => ['type' => 'DATETIME', 'null' => true],
                'updated_at' => ['type' => 'DATETIME', 'null' => true],
                'deleted_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('client_id');
            $this->forge->createTable('lead_references');
        }

        // The single reference assigned to a staff member (their "agent" scope).
        if ($this->db->tableExists('client_staff') && ! $this->db->fieldExists('reference_id', 'client_staff')) {
            $this->forge->addColumn('client_staff', [
                'reference_id' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true, 'after' => 'lead_type_id'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->tableExists('client_staff') && $this->db->fieldExists('reference_id', 'client_staff')) {
            $this->forge->dropColumn('client_staff', 'reference_id');
        }
        $this->forge->dropTable('lead_references', true);
    }
}
