<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Indexes for the server-side paginated Calls log (order by call_start within a
 * client, filter by type/source/date). Same idempotent pattern; tenant-synced.
 */
class AddCallsListIndexes extends Migration
{
    private array $indexes = [
        ['calls', ['client_id', 'call_start']],
        ['calls', ['client_id', 'type']],
        ['calls', ['client_id', 'source']],
    ];

    public function up()
    {
        foreach ($this->indexes as [$table, $cols]) {
            $this->addIndex($table, $cols);
        }
    }

    public function down()
    {
        foreach ($this->indexes as [$table, $cols]) {
            $name = 'idx_' . $table . '_' . implode('_', $cols);
            if ($this->db->tableExists($table) && $this->indexExists($table, $name)) {
                $this->db->query("ALTER TABLE `{$table}` DROP INDEX `{$name}`");
            }
        }
    }

    private function addIndex(string $table, array $cols): void
    {
        if (! $this->db->tableExists($table)) {
            return;
        }
        $have = array_map('strtolower', $this->db->getFieldNames($table));
        foreach ($cols as $c) {
            if (! in_array(strtolower($c), $have, true)) {
                return;
            }
        }
        $name = 'idx_' . $table . '_' . implode('_', $cols);
        if ($this->indexExists($table, $name)) {
            return;
        }
        $colList = implode('`, `', $cols);
        $this->db->query("ALTER TABLE `{$table}` ADD INDEX `{$name}` (`{$colList}`)");
    }

    private function indexExists(string $table, string $name): bool
    {
        return ! empty($this->db->query("SHOW INDEX FROM `{$table}` WHERE Key_name = " . $this->db->escape($name))->getResultArray());
    }
}
