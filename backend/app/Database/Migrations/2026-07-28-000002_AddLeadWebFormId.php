<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Records which Web-to-Lead form (if any) a lead came in through, so submissions
 * can be counted per form and filtered later. Additive → runs on crm_main, then
 * tenants:sync propagates it to every tenant `leads` table.
 */
class AddLeadWebFormId extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('leads') && ! $this->db->fieldExists('web_form_id', 'leads')) {
            $this->forge->addColumn('leads', [
                'web_form_id' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true, 'after' => 'source_id'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('web_form_id', 'leads')) {
            $this->forge->dropColumn('leads', 'web_form_id');
        }
    }
}
