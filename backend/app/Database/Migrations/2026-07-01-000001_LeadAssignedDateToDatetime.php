<?php

namespace App\Database\Migrations;

use App\Libraries\TenantManager;
use App\Models\ClientModel;
use CodeIgniter\Database\BaseConnection;
use CodeIgniter\Database\Migration;

/**
 * Widen `leads.assigned_date` from DATE to DATETIME so the exact time of
 * assignment is captured (stamped in IST, the app timezone). Lossless: existing
 * dates keep their day with a 00:00:00 time.
 *
 * A column *type* change isn't handled by the additive `tenants:sync`, so this
 * migration alters the column on the main DB **and** every client database.
 */
class LeadAssignedDateToDatetime extends Migration
{
    public function up()
    {
        $this->setType($this->db, 'DATETIME');

        try {
            $mgr = new TenantManager();
            foreach ((new ClientModel())->findAll() as $c) {
                try {
                    $this->setType($mgr->forClient((int) $c['id']), 'DATETIME');
                } catch (\Throwable $e) {
                    log_message('error', 'assigned_date DATETIME sync failed for client ' . $c['id'] . ': ' . $e->getMessage());
                }
            }
        } catch (\Throwable $e) {
            log_message('error', 'assigned_date DATETIME propagation skipped: ' . $e->getMessage());
        }
    }

    public function down()
    {
        $this->setType($this->db, 'DATE');

        try {
            $mgr = new TenantManager();
            foreach ((new ClientModel())->findAll() as $c) {
                try {
                    $this->setType($mgr->forClient((int) $c['id']), 'DATE');
                } catch (\Throwable $e) {
                    // best-effort revert
                }
            }
        } catch (\Throwable $e) {
            // ignore
        }
    }

    /** Set the assigned_date column to the given type on one connection (idempotent). */
    private function setType(BaseConnection $db, string $type): void
    {
        if (! $db->tableExists('leads') || ! $db->fieldExists('assigned_date', 'leads')) {
            return;
        }
        foreach ($db->query('SHOW COLUMNS FROM `leads` LIKE ' . $db->escape('assigned_date'))->getResultArray() as $col) {
            if (strcasecmp((string) $col['Type'], $type) !== 0) {
                $db->query("ALTER TABLE `leads` MODIFY COLUMN `assigned_date` {$type} NULL");
            }
        }
    }
}
