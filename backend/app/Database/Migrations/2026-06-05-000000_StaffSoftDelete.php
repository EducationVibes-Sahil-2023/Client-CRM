<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Soft-delete support for staff members. Applied to the main canonical
 * `client_staff` table; `php spark tenants:sync` rolls it out to every client DB.
 */
class StaffSoftDelete extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('client_staff') && ! $this->db->fieldExists('deleted_at', 'client_staff')) {
            $this->forge->addColumn('client_staff', [
                'deleted_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->tableExists('client_staff') && $this->db->fieldExists('deleted_at', 'client_staff')) {
            $this->forge->dropColumn('client_staff', 'deleted_at');
        }
    }
}
