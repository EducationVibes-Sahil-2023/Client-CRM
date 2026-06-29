<?php

namespace App\Database\Migrations;

use App\Libraries\TenantManager;
use App\Libraries\TenantSchema;
use App\Models\ClientModel;
use CodeIgniter\Database\Migration;

/**
 * Adds the soft-delete marker to client_roles (project policy: deletes are never
 * hard removals) and propagates it to every client database. Idempotent.
 */
class AddRoleSoftDelete extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('deleted_at', 'client_roles')) {
            $this->forge->addColumn('client_roles', [
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
                    log_message('error', 'Role soft-delete sync failed for client ' . $c['id'] . ': ' . $e->getMessage());
                }
            }
        } catch (\Throwable $e) {
            log_message('error', 'Role soft-delete propagation skipped: ' . $e->getMessage());
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('deleted_at', 'client_roles')) {
            $this->forge->dropColumn('client_roles', 'deleted_at');
        }
    }
}
