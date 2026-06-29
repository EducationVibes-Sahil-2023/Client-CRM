<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Adds a `deleted_at` column to the main-DB tables that the super admin can
 * delete, so deletions are soft (reversible) instead of destructive.
 */
class AddSoftDeletes extends Migration
{
    private array $tables = ['clients', 'calendar_events', 'messages'];

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
