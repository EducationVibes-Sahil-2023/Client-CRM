<?php

namespace App\Database\Migrations;

use App\Libraries\TenantManager;
use App\Libraries\TenantSchema;
use App\Models\ClientModel;
use CodeIgniter\Database\Migration;

/**
 * Adds the soft-delete marker to announcements (project policy: deletes are
 * never hard removals) and propagates it to every client database. Split from
 * EnhanceAnnouncements so it still applies on installs where that migration had
 * already run before the column was introduced. Idempotent.
 */
class AddAnnouncementSoftDelete extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('deleted_at', 'announcements')) {
            $this->forge->addColumn('announcements', [
                'deleted_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
        }

        try {
            $schema = new TenantSchema();
            $mgr    = new TenantManager();
            foreach ((new ClientModel())->findAll() as $c) {
                try {
                    $schema->apply($mgr->forClient((int) $c['id']));
                } catch (\Throwable $e) {
                    log_message('error', 'Announcement soft-delete sync failed for client ' . $c['id'] . ': ' . $e->getMessage());
                }
            }
        } catch (\Throwable $e) {
            log_message('error', 'Announcement soft-delete propagation skipped: ' . $e->getMessage());
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('deleted_at', 'announcements')) {
            $this->forge->dropColumn('announcements', 'deleted_at');
        }
    }
}
