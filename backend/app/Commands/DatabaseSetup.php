<?php

namespace App\Commands;

use App\Libraries\TenantManager;
use App\Models\ClientModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;
use Config\Database as DatabaseConfig;
use RuntimeException;
use Throwable;

/**
 * One-shot database bootstrap. Run once on a fresh machine (or any time — every
 * step is idempotent and safe to repeat):
 *
 *   php spark db:setup            # create main DB, load base schema, migrate, seed, sync tenants
 *   php spark db:setup --fresh    # DROP the main DB first, then rebuild from scratch
 *
 * What it does, in order:
 *   1. Creates the main database (from .env database.default.database) if missing.
 *   2. Loads the base/shared tables from database/schema.sql (clients, users,
 *      client_features, permissions, landing_settings, …). Migrations layer on
 *      top of these, so they MUST exist first.
 *   3. Runs every migration against the main database.
 *   4. Seeds the default super admin, permission catalogue and landing content
 *      from database/seed.sql (idempotent — re-running is harmless).
 *   5. Applies the tenant schema to every registered client_* database.
 *
 * The schema/seed SQL hardcodes the database name `crm_main`; the CREATE DATABASE
 * and USE lines are skipped so everything lands in the database your .env names
 * (e.g. `client_crm` in production).
 *
 * Default super admin (change the password after first login):
 *   Email: admin@example.com   Password: Password123!
 */
class DatabaseSetup extends BaseCommand
{
    protected $group       = 'Database';
    protected $name        = 'db:setup';
    protected $description = 'Create + load schema + migrate + seed the main DB and sync all client databases in one command.';
    protected $usage       = 'db:setup [--fresh] [--force]';
    protected $options     = [
        '--fresh' => 'Drop the main database first, then rebuild it from scratch (DESTRUCTIVE).',
        '--force' => 'Allow running on a production environment (off by default for safety).',
    ];

    /** bcrypt of "Password123!" — fallback if database/seed.sql is missing. */
    private const ADMIN_HASH = '$2y$10$ABwydUsAwRU1LZ4591ylCO.pEvr4sJkQ9ht.mcJZb3hZcp4/gWx6K';

    public function run(array $params)
    {
        $fresh = array_key_exists('fresh', $params) || in_array('--fresh', $params, true);
        $force = array_key_exists('force', $params) || in_array('--force', $params, true);

        // Safety: db:setup re-seeds (resets the super-admin password) and --fresh
        // DROPS the database. Neither is safe on live data — block on production
        // and point to the additive `db:upgrade` instead.
        if (ENVIRONMENT === 'production' && ! $force) {
            CLI::error('Refusing to run db:setup on production.');
            CLI::write('  • For a normal update use:  php spark db:upgrade   (additive — never removes data)', 'yellow');
            CLI::write('  • db:setup re-seeds the admin account' . ($fresh ? ' and --fresh DROPS the database' : '') . '.', 'dark_gray');
            CLI::write('  • If you really mean it, re-run with --force.', 'dark_gray');

            return EXIT_ERROR;
        }

        try {
            $this->createMainDatabase($fresh);
            $this->loadBaseSchema();
            $this->runMigrations();
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

    /**
     * Step 1 — create the configured main database. With $fresh, drop it first
     * so the rebuild starts from a guaranteed-empty database (a clean migrate
     * from zero is reliable; migrate:refresh's down()/up() cycle is not, because
     * CodeIgniter caches table field names within a single process).
     */
    private function createMainDatabase(bool $fresh): void
    {
        $default = (new DatabaseConfig())->default;
        $dbName  = (string) ($default['database'] ?? 'crm_main');

        // Connect without selecting a database (it may not exist yet).
        $bootstrap             = $default;
        $bootstrap['database'] = '';
        $conn                  = \Config\Database::connect($bootstrap, false);

        if ($fresh) {
            $conn->query("DROP DATABASE IF EXISTS `{$dbName}`");
            CLI::write('  • dropped existing `' . $dbName . '` (--fresh)', 'dark_gray');
        }

        $conn->query(
            "CREATE DATABASE IF NOT EXISTS `{$dbName}` "
            . 'DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci'
        );
        $conn->close();

        CLI::write('  ✓ main database `' . $dbName . '` ready', 'green');
    }

    /** Step 2 — create the base/shared tables migrations build on top of. */
    private function loadBaseSchema(): void
    {
        $count = $this->runSqlFile(ROOTPATH . 'database/schema.sql');
        CLI::write('  ✓ base schema loaded (' . $count . ' tables)', 'green');
    }

    /** Step 3 — bring the main schema up to date (applies all new migrations). */
    private function runMigrations(): void
    {
        $this->call('migrate', ['-f' => null]);
        CLI::write('  ✓ migrations applied', 'green');
    }

    /** Step 4 — seed admin, permissions and landing content (idempotent). */
    private function seedBaseData(): void
    {
        $seedFile = ROOTPATH . 'database/seed.sql';
        if (is_file($seedFile)) {
            $this->runSqlFile($seedFile);
        } else {
            $this->seedAdminFallback();
        }
        CLI::write('  ✓ base data seeded (super admin, permissions)', 'green');
    }

    /** Minimal admin seed used only when database/seed.sql is absent. */
    private function seedAdminFallback(): void
    {
        $db  = db_connect();
        $now = date('Y-m-d H:i:s');
        $db->query(
            'INSERT INTO `users` (`email`, `password`, `role`, `client_id`, `created_at`, `updated_at`) '
            . "VALUES ('admin@example.com', ?, 'super_admin', NULL, ?, ?) "
            . 'ON DUPLICATE KEY UPDATE `password` = VALUES(`password`)',
            [self::ADMIN_HASH, $now, $now]
        );
    }

    /** Step 5 — provision/upgrade every registered client database. */
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

    /**
     * Execute a multi-statement .sql file against the configured (already
     * selected) database. Strips full-line `--` comments and skips USE /
     * CREATE DATABASE statements so the file's hardcoded DB name is ignored.
     * Returns the number of statements executed.
     */
    private function runSqlFile(string $path): int
    {
        if (! is_file($path)) {
            throw new RuntimeException('SQL file not found: ' . $path);
        }

        $lines = preg_split('/\r\n|\r|\n/', (string) file_get_contents($path));
        $kept  = [];
        foreach ($lines as $line) {
            if (preg_match('/^\s*--/', $line)) {
                continue; // full-line comment
            }
            $kept[] = $line;
        }

        $db  = db_connect();
        $ran = 0;
        foreach (explode(';', implode("\n", $kept)) as $stmt) {
            $stmt = trim($stmt);
            if ($stmt === '' || preg_match('/^(USE|CREATE\s+DATABASE)\b/i', $stmt)) {
                continue;
            }
            $db->query($stmt);
            $ran++;
        }

        return $ran;
    }
}
