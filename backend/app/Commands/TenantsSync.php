<?php

namespace App\Commands;

use App\Libraries\TenantManager;
use App\Models\ClientModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * Create or upgrade every client's database to the current {@see \App\Libraries\TenantSchema}.
 * Run after editing the tenant schema (new table / new column):
 *
 *   php spark tenants:sync
 *
 * Structure only — never touches client data.
 */
class TenantsSync extends BaseCommand
{
    protected $group       = 'Tenants';
    protected $name        = 'tenants:sync';
    protected $description = 'Apply the tenant schema to every client database (create tables / add columns).';

    public function run(array $params)
    {
        $clients = (new ClientModel())->findAll();
        if (! $clients) {
            CLI::write('No clients to sync.', 'yellow');

            return;
        }

        $manager = new TenantManager();
        $ok      = 0;
        foreach ($clients as $c) {
            try {
                $manager->provision($c);
                CLI::write('  ✓ ' . $c['db_name'] . ' (client #' . $c['id'] . ')', 'green');
                $ok++;
            } catch (\Throwable $e) {
                CLI::error('  ✗ ' . ($c['db_name'] ?? ('client #' . $c['id'])) . ': ' . $e->getMessage());
            }
        }

        CLI::write("Synced {$ok}/" . count($clients) . ' client databases.', 'cyan');
    }
}
