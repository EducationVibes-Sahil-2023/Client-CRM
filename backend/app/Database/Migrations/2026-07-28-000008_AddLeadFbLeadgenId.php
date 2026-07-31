<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Records the Facebook `leadgen_id` a lead came from — provenance AND idempotency:
 * the webhook and the polling cron can both see a given lead, so this unique-ish
 * marker lets ingest skip a lead already stored. Additive → main DB then tenants:sync.
 */
class AddLeadFbLeadgenId extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('leads') && ! $this->db->fieldExists('fb_leadgen_id', 'leads')) {
            $this->forge->addColumn('leads', [
                'fb_leadgen_id' => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => true, 'after' => 'web_form_id'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('fb_leadgen_id', 'leads')) {
            $this->forge->dropColumn('leads', 'fb_leadgen_id');
        }
    }
}
