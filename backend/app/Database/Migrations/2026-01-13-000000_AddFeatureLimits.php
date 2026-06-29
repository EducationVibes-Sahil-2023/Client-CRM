<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Per-client feature entitlements gain a numeric quota: limit_value.
 * NULL = unlimited. Used for quota features (leads, lead_import, team).
 */
class AddFeatureLimits extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('limit_value', 'client_features')) {
            $this->forge->addColumn('client_features', [
                'limit_value' => ['type' => 'INT', 'constraint' => 11, 'null' => true, 'after' => 'enabled'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('limit_value', 'client_features')) {
            $this->forge->dropColumn('client_features', 'limit_value');
        }
    }
}
