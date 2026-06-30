<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Add a `custom_fields` JSON column to the leads, visitors and client_staff
 * tables so admin-defined custom fields (Form Setup) can store their values.
 * Tasks & assets already have this column. Mirrored to all tenant DBs via
 * TenantSchema / `php spark tenants:sync`.
 */
class AddCustomFieldsColumns extends Migration
{
    private array $tables = ['leads', 'visitors', 'client_staff'];

    public function up()
    {
        foreach ($this->tables as $table) {
            if ($this->db->tableExists($table) && ! $this->db->fieldExists('custom_fields', $table)) {
                $this->forge->addColumn($table, [
                    'custom_fields' => ['type' => 'TEXT', 'null' => true],
                ]);
            }
        }
    }

    public function down()
    {
        foreach ($this->tables as $table) {
            if ($this->db->tableExists($table) && $this->db->fieldExists('custom_fields', $table)) {
                $this->forge->dropColumn($table, 'custom_fields');
            }
        }
    }
}
