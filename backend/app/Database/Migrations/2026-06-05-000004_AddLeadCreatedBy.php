<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Track who captured each lead (the acting staff member) so a team member's
 * profile can list the leads they created, separate from the leads assigned to
 * them. Applied to the main table; `php spark tenants:sync` rolls the column out
 * to every client database.
 */
class AddLeadCreatedBy extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('created_by', 'leads')) {
            $this->forge->addColumn('leads', [
                'created_by' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true, 'after' => 'assigned_to'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('created_by', 'leads')) {
            $this->forge->dropColumn('leads', 'created_by');
        }
    }
}
