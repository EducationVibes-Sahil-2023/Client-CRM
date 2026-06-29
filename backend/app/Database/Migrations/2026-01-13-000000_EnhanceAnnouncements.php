<?php

namespace App\Database\Migrations;

use App\Libraries\TenantManager;
use App\Libraries\TenantSchema;
use App\Models\ClientModel;
use CodeIgniter\Database\Migration;

/**
 * Turn the bare "announcements" table into a proper targeted-broadcast feature:
 *   - audience targeting  : audience ('all'|'department'|'staff') + target_ids
 *                           (JSON list of department or staff ids).
 *   - attachments         : JSON list of {url,name,type,size}.
 *   - acknowledgement      : require_ack flag.
 *   - read/ack tracking    : new announcement_reads table (one row per
 *                            announcement + staff member).
 *
 * All of these are client-owned tables (mirrored into each client's own DB via
 * TenantSchema). This migration mutates the canonical MAIN-DB structure, then
 * propagates it to every existing client database in one shot.
 */
class EnhanceAnnouncements extends Migration
{
    public function up()
    {
        // 1) New columns on the canonical announcements table.
        $cols = [];
        if (! $this->db->fieldExists('audience', 'announcements')) {
            $cols['audience'] = ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'all', 'null' => false, 'after' => 'pinned'];
        }
        if (! $this->db->fieldExists('target_ids', 'announcements')) {
            $cols['target_ids'] = ['type' => 'TEXT', 'null' => true, 'after' => 'audience'];
        }
        if (! $this->db->fieldExists('attachments', 'announcements')) {
            $cols['attachments'] = ['type' => 'TEXT', 'null' => true, 'after' => 'target_ids'];
        }
        if (! $this->db->fieldExists('require_ack', 'announcements')) {
            $cols['require_ack'] = ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0, 'null' => false, 'after' => 'attachments'];
        }
        // Soft-delete marker (project policy: deletes are never hard removals).
        if (! $this->db->fieldExists('deleted_at', 'announcements')) {
            $cols['deleted_at'] = ['type' => 'DATETIME', 'null' => true];
        }
        if ($cols) {
            $this->forge->addColumn('announcements', $cols);
        }

        // 2) Per-member read / acknowledge tracking.
        if (! $this->db->tableExists('announcement_reads')) {
            $this->forge->addField([
                'id'              => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'       => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'announcement_id' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'staff_id'        => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'read_at'         => ['type' => 'DATETIME', 'null' => true],
                'acknowledged_at' => ['type' => 'DATETIME', 'null' => true],
                'created_at'      => ['type' => 'DATETIME', 'null' => true],
                'updated_at'      => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addUniqueKey(['announcement_id', 'staff_id']);
            $this->forge->addKey('client_id');
            $this->forge->addKey('staff_id');
            $this->forge->createTable('announcement_reads');
        }

        // 3) Roll the new structure out to every existing client database.
        try {
            $schema = new TenantSchema();
            $mgr    = new TenantManager();
            foreach ((new ClientModel())->findAll() as $c) {
                try {
                    $schema->apply($mgr->forClient((int) $c['id']));
                } catch (\Throwable $e) {
                    log_message('error', 'Announcement tenant sync failed for client ' . $c['id'] . ': ' . $e->getMessage());
                }
            }
        } catch (\Throwable $e) {
            log_message('error', 'Announcement tenant propagation skipped: ' . $e->getMessage());
        }
    }

    public function down()
    {
        if ($this->db->tableExists('announcement_reads')) {
            $this->forge->dropTable('announcement_reads', true);
        }
        foreach (['audience', 'target_ids', 'attachments', 'require_ack'] as $col) {
            if ($this->db->fieldExists($col, 'announcements')) {
                $this->forge->dropColumn('announcements', $col);
            }
        }
    }
}
