<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Lets a lead STATUS belong to one or more lead TYPES, enabling a
 * Type → Status → Sub-status cascade on the lead form. `type_ids` holds a JSON
 * array of lead_type ids; a status with an empty/absent list is "global" (shows
 * under every type), so existing statuses keep working. Mirrored to each client
 * DB via `php spark tenants:sync`.
 */
class AddLeadStatusTypeIds extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('type_ids', 'lead_statuses')) {
            $this->forge->addColumn('lead_statuses', [
                'type_ids' => ['type' => 'TEXT', 'null' => true, 'after' => 'parent_ids'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('type_ids', 'lead_statuses')) {
            $this->forge->dropColumn('lead_statuses', 'type_ids');
        }
    }
}
