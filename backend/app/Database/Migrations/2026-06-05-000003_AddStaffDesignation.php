<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Staff gain a free-text `designation` (job title, e.g. "Senior Sales Executive")
 * distinct from their permission `role`. Applied to the main DB; rolled out to
 * every client database by `php spark tenants:sync`.
 */
class AddStaffDesignation extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('client_staff') && ! $this->db->fieldExists('designation', 'client_staff')) {
            $this->forge->addColumn('client_staff', [
                'designation' => ['type' => 'VARCHAR', 'constraint' => 120, 'null' => true, 'after' => 'emp_code'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->tableExists('client_staff') && $this->db->fieldExists('designation', 'client_staff')) {
            $this->forge->dropColumn('client_staff', 'designation');
        }
    }
}
