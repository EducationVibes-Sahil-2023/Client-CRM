<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Marks a lead as converted-to-applicant. Once set, the lead is locked: the
 * Convert button is disabled and the lead can no longer be edited (enforced in
 * updateLead). Lives in each client DB (mirrored via `php spark tenants:sync`).
 */
class AddLeadConvertedAt extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('converted_at', 'leads')) {
            $this->forge->addColumn('leads', [
                'converted_at' => ['type' => 'DATETIME', 'null' => true, 'after' => 'status_id'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('converted_at', 'leads')) {
            $this->forge->dropColumn('leads', 'converted_at');
        }
    }
}
