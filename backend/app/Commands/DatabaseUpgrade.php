<?php

namespace App\Commands;

use App\Libraries\TenantManager;
use App\Models\ClientModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;
use Throwable;

/**
 * The SAFE production-update command. Run this after deploying new code:
 *
 *   php spark db:upgrade
 *
 * It does exactly two things, both purely additive — it never drops a table,
 * column or index, never deletes rows, and never re-seeds (so the super-admin
 * password is untouched):
 *
 *   1. `migrate`       — applies only new, unapplied migrations (their up()).
 *   2. tenant sync     — adds any missing tables/columns/indexes to every
 *                        client_* database, mirroring the main DB structure.
 *
 * Use this instead of `db:setup` on production. Never run `db:setup --fresh`
 * (drops the DB) or `migrate:rollback` / `migrate:refresh` (run destructive
 * down() methods) against live data.
 */
class DatabaseUpgrade extends BaseCommand
{
    protected $group       = 'Database';
    protected $name        = 'db:upgrade';
    protected $description = 'Safe production update: apply new migrations + sync tenant DBs (additive, never removes data).';

    public function run(array $params)
    {
        try {
            // 1) Apply new migrations to the main DB (forward-only; additive).
            CLI::write('Applying new migrations (additive — never drops data)…', 'dark_gray');
            $this->call('migrate');
            CLI::write('  ✓ main database migrated', 'green');

            // 2) Roll any new structure out to every client tenant database.
            $clients = (new ClientModel())->findAll();
            if (! $clients) {
                CLI::write('  • no client tenants registered — nothing to sync', 'dark_gray');
            } else {
                $manager = new TenantManager();
                $ok      = 0;
                foreach ($clients as $c) {
                    try {
                        $manager->provision($c);
                        $ok++;
                    } catch (Throwable $e) {
                        CLI::error('  ✗ ' . ($c['db_name'] ?? ('client #' . $c['id'])) . ': ' . $e->getMessage());
                    }
                }
                CLI::write("  ✓ synced {$ok}/" . count($clients) . ' client database(s)', 'green');
            }
        } catch (Throwable $e) {
            CLI::error('Upgrade failed: ' . $e->getMessage());

            return EXIT_ERROR;
        }

        CLI::newLine();
        CLI::write('Upgrade complete. New columns/tables are live; no data was removed.', 'green');

        return EXIT_SUCCESS;
    }
}
