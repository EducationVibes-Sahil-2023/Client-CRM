<?php

namespace App\Commands;

use App\Libraries\TenantManager;
use App\Models\ClientModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;
use Config\Database as DatabaseConfig;
use Throwable;

/**
 * One-shot database bootstrap. Run once on a fresh machine (or any time — every
 * step is idempotent and safe to repeat):
 *
 *   php spark db:setup            # create main DB, migrate, seed admin, sync tenants
 *   php spark db:setup --fresh    # same, but rolls back & re-runs ALL migrations first
 *
 * What it does, in order:
 *   1. Creates the main database (crm_main) if it does not exist.
 *   2. Runs every migration against the main database.
 *   3. Seeds the default super admin, permission catalogue and landing content
 *      (mirrors database/seed.sql; ON DUPLICATE KEY so re-running is harmless).
 *   4. Applies the tenant schema to every registered client_* database.
 *
 * Default super admin (change the password after first login):
 *   Email: admin@example.com   Password: Password123!
 */
class DatabaseSetup extends BaseCommand
{
    protected $group       = 'Database';
    protected $name        = 'db:setup';
    protected $description = 'Create + migrate + seed the main DB and sync all client databases in one command.';
    protected $usage       = 'db:setup [--fresh]';
    protected $options     = ['--fresh' => 'Roll back and re-run all migrations (drops & rebuilds main tables).'];

    /** bcrypt of "Password123!" — same hash used by database/seed.sql. */
    private const ADMIN_HASH = '$2y$10$ABwydUsAwRU1LZ4591ylCO.pEvr4sJkQ9ht.mcJZb3hZcp4/gWx6K';

    public function run(array $params)
    {
        $fresh = array_key_exists('fresh', $params) || in_array('--fresh', $params, true);

        try {
            $this->createMainDatabase();
            $this->runMigrations($fresh);
            $this->seedBaseData();
            $this->syncTenants();
        } catch (Throwable $e) {
            CLI::error('Setup failed: ' . $e->getMessage());

            return EXIT_ERROR;
        }

        CLI::newLine();
        CLI::write('Database setup complete.', 'green');
        CLI::write('  Super admin login:  admin@example.com / Password123!', 'yellow');
        CLI::write('  Change this password after first login.', 'dark_gray');

        return EXIT_SUCCESS;
    }

    /** Step 1 — create the configured main database if it is missing. */
    private function createMainDatabase(): void
    {
        $default = (new DatabaseConfig())->default;
        $dbName  = (string) ($default['database'] ?? 'crm_main');

        // Connect without selecting a database (crm_main may not exist yet).
        $bootstrap             = $default;
        $bootstrap['database'] = '';
        $conn                  = \Config\Database::connect($bootstrap, false);

        $conn->query(
            "CREATE DATABASE IF NOT EXISTS `{$dbName}` "
            . 'DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci'
        );
        $conn->close();

        CLI::write('  ✓ main database `' . $dbName . '` ready', 'green');
    }

    /** Step 2 — bring the main schema up to date. */
    private function runMigrations(bool $fresh): void
    {
        if ($fresh) {
            CLI::write('  • refreshing migrations (--fresh)…', 'dark_gray');
            $this->call('migrate:refresh', ['-f' => null]);
        } else {
            $this->call('migrate', ['-f' => null]);
        }
        CLI::write('  ✓ migrations applied', 'green');
    }

    /** Step 3 — idempotent seed of admin, permissions and landing content. */
    private function seedBaseData(): void
    {
        $db  = db_connect();
        $now = date('Y-m-d H:i:s');

        $db->query(
            'INSERT INTO `users` (`email`, `password`, `role`, `client_id`, `created_at`, `updated_at`) '
            . "VALUES ('admin@example.com', ?, 'super_admin', NULL, ?, ?) "
            . 'ON DUPLICATE KEY UPDATE `password` = VALUES(`password`)',
            [self::ADMIN_HASH, $now, $now]
        );

        $perms = [
            ['super_admin', 'clients.manage', 'Create and manage client tenants'],
            ['super_admin', 'features.manage', 'Toggle feature entitlements per client'],
            ['super_admin', 'admins.manage', 'Create client admin accounts'],
            ['client_admin', 'crm.view', 'View the client CRM dashboard'],
            ['client_admin', 'contacts.manage', 'Manage contacts'],
            ['client_admin', 'settings.manage', 'Manage client CRM settings'],
        ];
        foreach ($perms as [$role, $key, $desc]) {
            $db->query(
                'INSERT INTO `permissions` (`role`, `permission_key`, `description`, `created_at`, `updated_at`) '
                . 'VALUES (?, ?, ?, ?, ?) '
                . 'ON DUPLICATE KEY UPDATE `description` = VALUES(`description`)',
                [$role, $key, $desc, $now, $now]
            );
        }

        CLI::write('  ✓ base data seeded (super admin, permissions)', 'green');
    }

    /** Step 4 — provision/upgrade every registered client database. */
    private function syncTenants(): void
    {
        $clients = (new ClientModel())->findAll();
        if (! $clients) {
            CLI::write('  • no client tenants registered yet — skipping tenant sync', 'dark_gray');

            return;
        }

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
}
