<?php

namespace App\Commands;

use App\Libraries\TenantManager;
use App\Models\ClientModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * Move each client's own audit-log rows out of the shared main DB and into the
 * client's database, so the super-admin feed (main DB) holds only platform
 * activity and each client's feed (its own DB) holds only theirs.
 *
 * Copies main `activity_logs` rows for a client where the actor is NOT a super
 * admin — super-admin actions scoped to a client stay in the main DB as
 * platform activity. Idempotent (INSERT IGNORE preserves ids); main copies are
 * left intact for rollback.
 *
 *   php spark tenants:migrate-activity
 */
class TenantsMigrateActivity extends BaseCommand
{
    protected $group       = 'Tenants';
    protected $name        = 'tenants:migrate-activity';
    protected $description = 'Copy each client\'s own activity_logs rows from the main DB into its tenant DB.';

    public function run(array $params)
    {
        $main    = \Config\Database::connect();
        $manager = new TenantManager();
        $clients = (new ClientModel())->findAll();

        if (! $main->tableExists('activity_logs')) {
            CLI::error('Main DB has no activity_logs table.');

            return;
        }
        if (! $clients) {
            CLI::write('No clients to migrate.', 'yellow');

            return;
        }

        foreach ($clients as $c) {
            $cid = (int) $c['id'];
            CLI::write("Client #{$cid} — {$c['db_name']}", 'cyan');

            try {
                $tenant = $manager->provision($c); // ensure activity_logs exists
            } catch (\Throwable $e) {
                CLI::error('  cannot connect: ' . $e->getMessage());
                continue;
            }

            $rows = $main->table('activity_logs')
                ->where('client_id', $cid)
                ->where('actor_role !=', 'super_admin')
                ->get()->getResultArray();

            if (! $rows) {
                CLI::write('  • no rows', 'yellow');
                continue;
            }

            $tenant->table('activity_logs')->ignore(true)->insertBatch($rows);
            CLI::write('  • activity_logs: ' . count($rows) . ' rows', 'green');
        }

        CLI::write('Done. Main-DB rows left intact for rollback.', 'cyan');
    }
}
