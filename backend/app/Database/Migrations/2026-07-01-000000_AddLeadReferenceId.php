<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Leads now store the reference's stable **id** (`leads.reference_id`) alongside
 * the existing free-text `reference_name`. The id is the source of truth: the
 * display name is resolved live from it at read time, so renaming a reference no
 * longer needs to rewrite every lead. `reference_name` is kept as a denormalised
 * snapshot (exports/search/legacy free-text imports that map to no reference).
 *
 * Lives in each client DB (mirrored via `php spark tenants:sync`).
 */
class AddLeadReferenceId extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('reference_id', 'leads')) {
            $this->forge->addColumn('leads', [
                'reference_id' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true, 'after' => 'source_id'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('reference_id', 'leads')) {
            $this->forge->dropColumn('leads', 'reference_id');
        }
    }
}
