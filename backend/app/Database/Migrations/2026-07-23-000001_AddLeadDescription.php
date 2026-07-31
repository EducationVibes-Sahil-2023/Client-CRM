<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Rich-text `description` on the lead (a longer write-up beyond the name/notes).
 * HTML is sanitized on save. Additive → runs on crm_main, then tenants:sync
 * propagates it to every tenant `leads` table.
 */
class AddLeadDescription extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('description', 'leads')) {
            $this->forge->addColumn('leads', [
                'description' => ['type' => 'MEDIUMTEXT', 'null' => true, 'after' => 'state'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('description', 'leads')) {
            $this->forge->dropColumn('leads', 'description');
        }
    }
}
