<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Conversion types can either carry a manually-entered win `percentage` or
 * auto-calculate it from live lead counts. `auto_percentage` is the mode flag:
 * when 1, the percentage is computed as (leads in the grouped statuses / total
 * leads) and the stored `percentage` is ignored. Applied to the main table;
 * `php spark tenants:sync` rolls the column out to every client database.
 */
class ConversionTypeAutoPercentage extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('auto_percentage', 'conversion_types')) {
            $this->forge->addColumn('conversion_types', [
                'auto_percentage' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0, 'after' => 'percentage'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('auto_percentage', 'conversion_types')) {
            $this->forge->dropColumn('conversion_types', 'auto_percentage');
        }
    }
}
