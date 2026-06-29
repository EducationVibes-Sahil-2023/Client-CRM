<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Conversion types become pipeline groupings: each carries a win `percentage`
 * and groups multiple lead statuses (`lead_status_ids`, JSON) instead of lead
 * types. Applied to the main `conversion_types` table; `php spark tenants:sync`
 * rolls the columns out to every client database.
 */
class ConversionTypeStatuses extends Migration
{
    public function up()
    {
        $fields = [];
        if (! $this->db->fieldExists('percentage', 'conversion_types')) {
            $fields['percentage'] = ['type' => 'INT', 'null' => true, 'default' => 0];
        }
        if (! $this->db->fieldExists('lead_status_ids', 'conversion_types')) {
            $fields['lead_status_ids'] = ['type' => 'TEXT', 'null' => true];
        }
        if ($fields) {
            $this->forge->addColumn('conversion_types', $fields);
        }
    }

    public function down()
    {
        foreach (['percentage', 'lead_status_ids'] as $col) {
            if ($this->db->fieldExists($col, 'conversion_types')) {
                $this->forge->dropColumn('conversion_types', $col);
            }
        }
    }
}
