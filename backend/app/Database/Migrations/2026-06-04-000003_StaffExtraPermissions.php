<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Per-staff extra permissions (granted on top of the staff member's role).
 * Stored as JSON on `client_staff`. Applied to the main canonical table;
 * `php spark tenants:sync` rolls it out to every client database.
 */
class StaffExtraPermissions extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('client_staff') && ! $this->db->fieldExists('extra_permissions', 'client_staff')) {
            $this->forge->addColumn('client_staff', [
                'extra_permissions' => ['type' => 'TEXT', 'null' => true],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->tableExists('client_staff') && $this->db->fieldExists('extra_permissions', 'client_staff')) {
            $this->forge->dropColumn('client_staff', 'extra_permissions');
        }
    }
}
