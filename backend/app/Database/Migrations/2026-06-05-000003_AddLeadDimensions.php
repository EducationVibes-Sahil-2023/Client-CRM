<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Tag each lead with its lead type and its source so the dashboard can chart
 * lead volume by type and by marketing channel (the source's marketing_type).
 * Status / sub-status already live on the lead; these add the two missing
 * dimensions. Applied to the main table; `php spark tenants:sync` rolls the
 * columns out to every client database.
 */
class AddLeadDimensions extends Migration
{
    public function up()
    {
        $cols = [];
        if (! $this->db->fieldExists('lead_type_id', 'leads')) {
            $cols['lead_type_id'] = ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true, 'after' => 'sub_status_id'];
        }
        if (! $this->db->fieldExists('source_id', 'leads')) {
            $cols['source_id'] = ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true, 'after' => 'lead_type_id'];
        }
        if ($cols) {
            $this->forge->addColumn('leads', $cols);
        }
    }

    public function down()
    {
        foreach (['lead_type_id', 'source_id'] as $c) {
            if ($this->db->fieldExists($c, 'leads')) {
                $this->forge->dropColumn('leads', $c);
            }
        }
    }
}
