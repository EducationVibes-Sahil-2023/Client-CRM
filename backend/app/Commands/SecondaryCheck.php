<?php

namespace App\Commands;

use App\Libraries\SecondaryDb;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;
use Config\Database;
use Throwable;

/**
 * Diagnose the SECONDARY (read-only) database used by the Applicant section.
 *
 *   php spark secondary:check
 *
 * Reports, in order, exactly where it breaks on THIS deployment:
 *   1. config    — are database.secondary.* set in .env? (which keys are missing)
 *   2. connect   — can we open the connection + run SELECT 1?
 *   3. tables    — do tblclients / tblbasic_details exist and return a count?
 * Nothing is written; every query is a SELECT.
 */
class SecondaryCheck extends BaseCommand
{
    protected $group       = 'Database';
    protected $name        = 'secondary:check';
    protected $description = 'Diagnose the Applicant/secondary read-only DB (config, connection, tables).';

    public function run(array $params)
    {
        $sdb = new SecondaryDb();
        $cfg = config(Database::class)->secondary ?? [];

        // 1) Config presence (never prints the password).
        CLI::write('1) Config (.env database.secondary.*)', 'yellow');
        foreach (['hostname', 'database', 'username', 'password', 'port', 'DBDriver'] as $k) {
            $v = (string) ($cfg[$k] ?? '');
            $shown = $k === 'password' ? ($v !== '' ? '(set)' : '(EMPTY)') : ($v !== '' ? $v : '(EMPTY)');
            CLI::write(sprintf('   %-9s = %s', $k, $shown), $v === '' && in_array($k, ['hostname', 'database'], true) ? 'red' : 'dark_gray');
        }
        if (! $sdb->isConfigured()) {
            CLI::error('=> NOT CONFIGURED. Set database.secondary.hostname and database.secondary.database (plus username/password) in .env, then clear config cache / restart.');

            return EXIT_ERROR;
        }
        CLI::write('   ✓ configured', 'green');

        // 2) Connection.
        CLI::write('2) Connection', 'yellow');
        try {
            $one = $sdb->selectRow('SELECT 1 AS ok');
            CLI::write('   ✓ connected + SELECT works (ok=' . ($one['ok'] ?? '?') . ')', 'green');
        } catch (Throwable $e) {
            CLI::error('   ✗ cannot connect / query: ' . $e->getMessage());
            CLI::write('     Likely: wrong host/user/password, OR the DB server firewall / MySQL grant does not allow THIS server\'s IP. The account must reach ' . ($cfg['hostname'] ?? '?') . ':' . ($cfg['port'] ?? 3306) . '.', 'dark_gray');

            return EXIT_ERROR;
        }

        // 3) Applicant tables.
        CLI::write('3) Applicant tables', 'yellow');
        foreach (['tblclients', 'tblbasic_details'] as $t) {
            try {
                $r = $sdb->selectRow("SELECT COUNT(*) AS n FROM {$t}");
                CLI::write("   ✓ {$t}: " . (int) ($r['n'] ?? 0) . ' rows', 'green');
            } catch (Throwable $e) {
                CLI::error("   ✗ {$t}: " . $e->getMessage());
            }
        }

        CLI::newLine();
        CLI::write('Done. If all three are green, the Applicant section can read the secondary DB.', 'green');

        return EXIT_SUCCESS;
    }
}
