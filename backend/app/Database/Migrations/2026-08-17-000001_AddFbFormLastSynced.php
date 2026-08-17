<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * `fb_forms.last_synced_at` — the last time the poll/manual sync actually RAN for
 * this form (updated every run, even when 0 new leads), so the admin can see the
 * lead-sync freshness. (`last_lead_time` is the newest LEAD's time — the cursor —
 * which is different and only moves when a newer lead is seen.)
 *
 * Added to crm_main.fb_forms; the table is in TenantSchema::TABLES, so
 * `php spark tenants:sync` (db:upgrade) rolls it out to every tenant DB.
 */
class AddFbFormLastSynced extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('last_synced_at', 'fb_forms')) {
            $this->forge->addColumn('fb_forms', [
                'last_synced_at' => ['type' => 'DATETIME', 'null' => true, 'after' => 'last_lead_time'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('last_synced_at', 'fb_forms')) {
            $this->forge->dropColumn('fb_forms', 'last_synced_at');
        }
    }
}
