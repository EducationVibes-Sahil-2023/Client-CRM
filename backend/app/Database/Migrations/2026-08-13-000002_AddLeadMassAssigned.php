<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * `leads.mass_assigned` — 1 when a lead's current owner was set by a bulk/mass
 * assignment (admin bulk reassign, or a round-robin import), 0 when the lead was
 * assigned individually / manually. Auto-transfer rules can "exclude mass-assigned
 * leads" so a freshly bulk-dumped batch isn't immediately re-shuffled.
 *
 * Added to crm_main.leads; `leads` is in TenantSchema::TABLES, so
 * `php spark tenants:sync` (db:upgrade) rolls the column out to every tenant DB.
 */
class AddLeadMassAssigned extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('mass_assigned', 'leads')) {
            $this->forge->addColumn('leads', [
                'mass_assigned' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0, 'after' => 'pending_transfer'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('mass_assigned', 'leads')) {
            $this->forge->dropColumn('leads', 'mass_assigned');
        }
    }
}
