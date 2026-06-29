<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Call-tracking log — one row per phone call reported by a client's external
 * call-logging app (IVR or device dialer). Lives in each client's own database
 * (mirrored via TenantSchema / `php spark tenants:sync`).
 *
 * A call is linked to a lead when its `contact` (the other party's last-10-digit
 * number) matches a lead's phone, and to a staff member by their phone. The
 * `connected` flag marks answered calls (duration > 0) — the leads table shows
 * each lead's latest connected call.
 *
 *   source: 'ivr' | 'phone'         — where the call was placed/received
 *   type:   'incoming' | 'outgoing' | 'missed'
 */
class CreateCalls extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('calls')) {
            return;
        }

        $this->forge->addField([
            'id'            => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'     => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'lead_id'       => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'staff_id'      => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'staff_contact' => ['type' => 'VARCHAR', 'constraint' => 30, 'null' => true],
            'contact'       => ['type' => 'VARCHAR', 'constraint' => 20, 'null' => true],
            'call_status'   => ['type' => 'VARCHAR', 'constraint' => 60, 'null' => true],
            'source'        => ['type' => 'VARCHAR', 'constraint' => 16, 'null' => true],  // ivr | phone
            'type'          => ['type' => 'VARCHAR', 'constraint' => 16, 'null' => true],  // incoming | outgoing | missed
            'duration'      => ['type' => 'INT', 'constraint' => 11, 'default' => 0],      // seconds
            'connected'     => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'call_start'    => ['type' => 'DATETIME', 'null' => true],
            'call_end'      => ['type' => 'DATETIME', 'null' => true],
            'created_at'    => ['type' => 'DATETIME', 'null' => true],
            'updated_at'    => ['type' => 'DATETIME', 'null' => true],
            'deleted_at'    => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->addKey('lead_id');
        $this->forge->addKey('contact');
        $this->forge->addKey('call_start');
        $this->forge->createTable('calls');
    }

    public function down()
    {
        $this->forge->dropTable('calls', true);
    }
}
