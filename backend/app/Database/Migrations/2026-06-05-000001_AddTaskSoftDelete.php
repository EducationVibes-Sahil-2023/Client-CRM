<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Add a `deleted_at` column to the canonical `client_tasks` table so tasks are
 * soft-deleted (reversible, kept for audit) instead of destroyed. This runs on
 * the main DB; `php spark tenants:sync` rolls the new column out to every
 * client database (tasks live in each client's own DB — see TenantSchema).
 */
class AddTaskSoftDelete extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('client_tasks') && ! $this->db->fieldExists('deleted_at', 'client_tasks')) {
            $this->forge->addColumn('client_tasks', [
                'deleted_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->tableExists('client_tasks') && $this->db->fieldExists('deleted_at', 'client_tasks')) {
            $this->forge->dropColumn('client_tasks', 'deleted_at');
        }
    }
}
