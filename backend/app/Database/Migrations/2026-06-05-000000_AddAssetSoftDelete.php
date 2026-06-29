<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Add a `deleted_at` column to the canonical `assets` table so assets are
 * soft-deleted (reversible, kept for audit) instead of destroyed. This runs on
 * the main DB; `php spark tenants:sync` rolls the new column out to every
 * client database (assets live in each client's own DB — see TenantSchema).
 */
class AddAssetSoftDelete extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('assets') && ! $this->db->fieldExists('deleted_at', 'assets')) {
            $this->forge->addColumn('assets', [
                'deleted_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->tableExists('assets') && $this->db->fieldExists('deleted_at', 'assets')) {
            $this->forge->dropColumn('assets', 'deleted_at');
        }
    }
}
