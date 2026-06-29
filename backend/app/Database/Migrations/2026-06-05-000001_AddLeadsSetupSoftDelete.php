<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Add a `deleted_at` column to every Leads Setup lookup table so their rows are
 * soft-deleted (reversible, kept for audit) instead of destroyed. These tables
 * live in each client's own database; this migration runs on the main DB and
 * `php spark tenants:sync` rolls the new column out to every client DB
 * (see TenantSchema).
 */
class AddLeadsSetupSoftDelete extends Migration
{
    private array $tables = ['lead_statuses', 'lead_types', 'lead_sources', 'marketing_types', 'conversion_types'];

    public function up()
    {
        foreach ($this->tables as $table) {
            if ($this->db->tableExists($table) && ! $this->db->fieldExists('deleted_at', $table)) {
                $this->forge->addColumn($table, [
                    'deleted_at' => ['type' => 'DATETIME', 'null' => true],
                ]);
            }
        }
    }

    public function down()
    {
        foreach ($this->tables as $table) {
            if ($this->db->tableExists($table) && $this->db->fieldExists('deleted_at', $table)) {
                $this->forge->dropColumn($table, 'deleted_at');
            }
        }
    }
}
