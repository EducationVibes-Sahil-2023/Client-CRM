<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Soft-delete support for contact messages and demo requests.
 */
class AddSoftDeletesContactDemo extends Migration
{
    private array $tables = ['contact_messages', 'demo_requests'];

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
