<?php

namespace App\Commands;

use App\Libraries\TenantManager;
use App\Models\ClientModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;
use CodeIgniter\Database\BaseConnection;

/**
 * Convert the main database and EVERY tenant database — and all of their tables —
 * to utf8mb4, so names in any language (Hindi, etc.) store correctly instead of
 * turning into "?????". Run once after a server/DB that was created under a latin1
 * default:
 *
 *   php spark db:charset
 *
 * Idempotent: converting an already-utf8mb4 table is a harmless no-op. NOTE: this
 * fixes storage going forward — data ALREADY saved as literal "?" (the character
 * was lost at write time) cannot be recovered and must be re-entered.
 */
class DbCharset extends BaseCommand
{
    protected $group       = 'Database';
    protected $name        = 'db:charset';
    protected $description = 'Convert the main + every tenant database (and all tables) to utf8mb4 (multilingual).';

    private const COLLATE = 'utf8mb4_unicode_ci';

    public function run(array $params)
    {
        // Main DB.
        $mainName = (string) (config('Database')->default['database'] ?? '');
        $this->convert(\Config\Database::connect(), $mainName);

        // Every tenant DB.
        $manager = new TenantManager();
        foreach ((new ClientModel())->findAll() as $c) {
            if (empty($c['db_name'])) {
                continue;
            }
            try {
                $this->convert($manager->forClient($c), (string) $c['db_name']);
            } catch (\Throwable $e) {
                CLI::error('  ✗ ' . ($c['db_name'] ?? ('client #' . $c['id'])) . ': ' . $e->getMessage());
            }
        }

        CLI::write('Done — databases converted to utf8mb4. New data in any language will now store correctly.', 'cyan');
        CLI::write('(Any names already showing "?????" were lost at write time and must be re-entered.)', 'yellow');
    }

    /** ALTER a database's default charset + CONVERT every table to utf8mb4. */
    private function convert(BaseConnection $db, string $dbName): void
    {
        if ($dbName === '') {
            return;
        }
        try {
            $db->query('ALTER DATABASE `' . $dbName . '` CHARACTER SET utf8mb4 COLLATE ' . self::COLLATE);
        } catch (\Throwable $e) {
            CLI::error('  ✗ ALTER DATABASE ' . $dbName . ': ' . $e->getMessage());
        }

        $ok = 0;
        foreach ($db->query('SHOW TABLES')->getResultArray() as $row) {
            $table = (string) array_values($row)[0];
            try {
                $db->query('ALTER TABLE `' . $table . '` CONVERT TO CHARACTER SET utf8mb4 COLLATE ' . self::COLLATE);
                $ok++;
            } catch (\Throwable $e) {
                CLI::error("  ✗ {$dbName}.{$table}: " . $e->getMessage());
            }
        }
        CLI::write("  ✓ {$dbName}: {$ok} table(s) → utf8mb4", 'green');
    }
}
