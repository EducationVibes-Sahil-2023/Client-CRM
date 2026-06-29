<?php

namespace App\Database\Seeds;

use App\Models\ActivityLogModel;
use App\Models\ClientModel;
use App\Models\ContactMessageModel;
use App\Models\DemoRequestModel;
use CodeIgniter\Database\Seeder;

/**
 * One-time backfill: seeds the audit log with historical "created" entries for
 * demo requests, contact messages and clients that already existed before the
 * activity log was introduced. Idempotent — does nothing once the log has rows.
 *
 * Run with: php spark db:seed ActivityBacklogSeeder
 */
class ActivityBacklogSeeder extends Seeder
{
    public function run()
    {
        $log = new ActivityLogModel();

        if ($log->countAllResults() > 0) {
            return; // already populated — don't duplicate
        }

        $rows = [];

        foreach ((new DemoRequestModel())->orderBy('created_at', 'ASC')->findAll() as $d) {
            $rows[] = [
                'actor_id'    => null,
                'actor_role'  => 'public',
                'actor_name'  => null,
                'action'      => 'created',
                'entity_type' => 'demo_request',
                'entity_id'   => (int) $d['id'],
                'description' => 'New demo request from ' . $d['name'],
                'client_id'   => null,
                'created_at'  => $d['created_at'],
            ];
        }

        foreach ((new ContactMessageModel())->orderBy('created_at', 'ASC')->findAll() as $c) {
            $rows[] = [
                'actor_id'    => null,
                'actor_role'  => 'public',
                'actor_name'  => null,
                'action'      => 'created',
                'entity_type' => 'contact_message',
                'entity_id'   => (int) $c['id'],
                'description' => 'New contact message from ' . $c['name'],
                'client_id'   => null,
                'created_at'  => $c['created_at'],
            ];
        }

        foreach ((new ClientModel())->orderBy('created_at', 'ASC')->findAll() as $cl) {
            $rows[] = [
                'actor_id'    => null,
                'actor_role'  => 'super_admin',
                'actor_name'  => null,
                'action'      => 'created',
                'entity_type' => 'client',
                'entity_id'   => (int) $cl['id'],
                'description' => 'Created client "' . $cl['name'] . '"',
                'client_id'   => (int) $cl['id'],
                'created_at'  => $cl['created_at'],
            ];
        }

        if ($rows) {
            $this->db->table('activity_logs')->insertBatch($rows);
        }
    }
}
