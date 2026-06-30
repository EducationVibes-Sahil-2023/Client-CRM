<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Assets gain a `custom_fields` JSON column holding the values for admin-defined
 * custom fields (definitions live in the per-client `settings` table under
 * `asset_custom_fields`). Structure only — rolled out via `php spark tenants:sync`.
 */
class AddAssetCustomFields extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('assets') && ! $this->db->fieldExists('custom_fields', 'assets')) {
            $this->forge->addColumn('assets', [
                'custom_fields' => ['type' => 'TEXT', 'null' => true, 'after' => 'status'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->tableExists('assets') && $this->db->fieldExists('custom_fields', 'assets')) {
            $this->forge->dropColumn('assets', 'custom_fields');
        }
    }
}
