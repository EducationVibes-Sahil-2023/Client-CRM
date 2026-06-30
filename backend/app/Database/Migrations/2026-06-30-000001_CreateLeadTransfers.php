<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Lead transfer requests — one row per "hand this lead to another rep" request.
 * Lives in each client's own database (mirrored via TenantSchema / tenants:sync).
 *
 * Flow depends on the client's `lead_transfer_mode` setting:
 *   - 'direct'   → the lead is reassigned immediately; the row is logged as
 *                  status='approved' for the audit trail.
 *   - 'approval' → the row is status='pending' and the lead is hidden from every
 *                  list (leads.pending_transfer = 1) until an admin approves or
 *                  rejects it.
 *
 *   status: 'pending' | 'approved' | 'rejected' | 'cancelled'
 */
class CreateLeadTransfers extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('lead_transfers')) {
            return;
        }

        $this->forge->addField([
            'id'            => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'     => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'lead_id'       => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'from_staff_id' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true], // owner at request time
            'to_staff_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],                 // target rep
            'requested_by'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true], // actor (staff id; admin = null)
            'reason'        => ['type' => 'VARCHAR', 'constraint' => 500, 'null' => true],
            'status'        => ['type' => 'VARCHAR', 'constraint' => 16, 'default' => 'pending'],
            'decided_by'    => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'decided_at'    => ['type' => 'DATETIME', 'null' => true],
            'decision_note' => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'created_at'    => ['type' => 'DATETIME', 'null' => true],
            'updated_at'    => ['type' => 'DATETIME', 'null' => true],
            'deleted_at'    => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->addKey('lead_id');
        $this->forge->addKey('status');
        $this->forge->createTable('lead_transfers');
    }

    public function down()
    {
        $this->forge->dropTable('lead_transfers', true);
    }
}
