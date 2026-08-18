<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Records the ORIGIN id of a lead imported from an external/legacy CRM
 * (tblleads.id in the old system), so the `leads:import-legacy` sync is
 * idempotent: a re-run UPDATES the same lead instead of creating a duplicate.
 * NULL for leads created natively. Lives in each client DB (mirrored via
 * `php spark tenants:sync` — it copies new columns + indexes from crm_main).
 */
class AddLeadLegacyId extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('legacy_id', 'leads')) {
            $this->forge->addColumn('leads', [
                'legacy_id' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true, 'after' => 'id'],
            ]);
        }
        // Index so the per-lead upsert lookup (client_id + legacy_id) is cheap.
        $has = $this->db->query("SHOW INDEX FROM `leads` WHERE Key_name = 'leads_legacy_id'")->getResultArray();
        if (! $has) {
            $this->db->query('ALTER TABLE `leads` ADD INDEX `leads_legacy_id` (`legacy_id`)');
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('legacy_id', 'leads')) {
            $this->forge->dropColumn('leads', 'legacy_id');
        }
    }
}
