<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * `leads.pending_transfer` — set to 1 while a lead has a transfer awaiting admin
 * approval, which hides it from every leads list until the transfer is decided.
 * Mirrored to all tenant DBs via TenantSchema / `php spark tenants:sync`.
 */
class AddLeadPendingTransfer extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('leads') && ! $this->db->fieldExists('pending_transfer', 'leads')) {
            $this->forge->addColumn('leads', [
                'pending_transfer' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0, 'after' => 'assigned_date'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('pending_transfer', 'leads')) {
            $this->forge->dropColumn('leads', 'pending_transfer');
        }
    }
}
