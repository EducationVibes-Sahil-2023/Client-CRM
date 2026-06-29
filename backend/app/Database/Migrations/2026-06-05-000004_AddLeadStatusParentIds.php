<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Lets a lead sub-status belong to MORE THAN ONE parent status. `parent_ids`
 * holds a JSON array of parent lead_status ids (the source of truth for
 * multi-parent); the existing single `parent_id` is kept in sync with the first
 * entry for backward compatibility (top-vs-sub detection, legacy filters).
 * Mirrored to each client DB via `php spark tenants:sync`.
 */
class AddLeadStatusParentIds extends Migration
{
    public function up()
    {
        $this->forge->addColumn('lead_statuses', [
            'parent_ids' => ['type' => 'TEXT', 'null' => true, 'after' => 'parent_id'],
        ]);
    }

    public function down()
    {
        $this->forge->dropColumn('lead_statuses', 'parent_ids');
    }
}
