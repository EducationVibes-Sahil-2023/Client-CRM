<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * SIM tracking for call logs — records which SIM placed each call plus the
 * device's SIM numbers/status, and the call's calendar date. Mirrored to each
 * client DB via `php spark tenants:sync` (`calls` is in TenantSchema::TABLES).
 *
 *   sim1 / sim2   — the device's SIM 1 / SIM 2 numbers (or identifiers)
 *   calling_sim   — which SIM made the call (e.g. "sim1"/"sim2" or the number)
 *   sim_status    — SIM/network status reported by the dialer
 *   calling_date  — the call's date (DATE); defaults to call_start's date
 *
 * Duplicate calls are rejected at ingest time by (contact, staff_contact,
 * call_start, calling_sim); a covering index speeds that lookup.
 */
class AddCallSimFields extends Migration
{
    public function up()
    {
        $add = [];
        foreach ([
            'sim1'         => ['type' => 'VARCHAR', 'constraint' => 30, 'null' => true, 'after' => 'staff_contact'],
            'sim2'         => ['type' => 'VARCHAR', 'constraint' => 30, 'null' => true, 'after' => 'sim1'],
            'calling_sim'  => ['type' => 'VARCHAR', 'constraint' => 30, 'null' => true, 'after' => 'sim2'],
            'sim_status'   => ['type' => 'VARCHAR', 'constraint' => 60, 'null' => true, 'after' => 'calling_sim'],
            'calling_date' => ['type' => 'DATE', 'null' => true, 'after' => 'call_end'],
        ] as $col => $def) {
            if (! $this->db->fieldExists($col, 'calls')) {
                $add[$col] = $def;
            }
        }
        if ($add) {
            $this->forge->addColumn('calls', $add);
        }

        // Speeds up the duplicate-detection lookup done on every ingest. Not a
        // UNIQUE index — existing tenants may already hold duplicate rows, and
        // uniqueness is enforced in application code (CallIngestService::ingest).
        if (! $this->indexExists('calls', 'calls_dup_idx')) {
            $this->db->query('CREATE INDEX calls_dup_idx ON calls (client_id, contact, call_start)');
        }
    }

    public function down()
    {
        if ($this->indexExists('calls', 'calls_dup_idx')) {
            $this->db->query('DROP INDEX calls_dup_idx ON calls');
        }
        foreach (['sim1', 'sim2', 'calling_sim', 'sim_status', 'calling_date'] as $col) {
            if ($this->db->fieldExists($col, 'calls')) {
                $this->forge->dropColumn('calls', $col);
            }
        }
    }

    private function indexExists(string $table, string $index): bool
    {
        $db = $this->db->getDatabase();
        $row = $this->db->query(
            'SELECT COUNT(*) AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?',
            [$db, $table, $index],
        )->getRow();

        return $row && (int) $row->c > 0;
    }
}
