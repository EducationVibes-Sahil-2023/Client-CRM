<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Map a staff member to a work shift (client_staff.shift_id). Drives which weekly
 * hours the first-response SLA uses for that user. Additive → tenants:sync.
 */
class AddStaffShift extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('shift_id', 'client_staff')) {
            $this->forge->addColumn('client_staff', [
                'shift_id' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true, 'after' => 'office_location_id'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('shift_id', 'client_staff')) {
            $this->forge->dropColumn('client_staff', 'shift_id');
        }
    }
}
