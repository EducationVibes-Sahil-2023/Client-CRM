<?php

namespace App\Commands;

use App\Libraries\BackupRunner;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;
use Throwable;

/**
 * Scheduled database backup — wire this to system cron, run it HOURLY:
 *
 *   0 * * * *  cd /path/to/backend && php spark backup:run >> writable/logs/backup.log 2>&1
 *
 * Each run backs up the main DB (when the global schedule is due) and any client
 * whose own schedule is due at the current hour. Running hourly lets it honour
 * each client's chosen time of day. Use --force to back up everything now.
 */
class BackupRun extends BaseCommand
{
    protected $group       = 'Database';
    protected $name        = 'backup:run';
    protected $description = 'Run scheduled DB backups to writable/backups when due (wire to cron).';
    protected $usage       = 'backup:run [--force] [--main-only]';
    protected $options     = [
        '--force'     => 'Back up now even if not due / auto-backup is disabled.',
        '--main-only' => 'Back up only the main DB (skip client tenant databases).',
    ];

    public function run(array $params)
    {
        $force    = array_key_exists('force', $params) || in_array('--force', $params, true);
        $mainOnly = array_key_exists('main-only', $params) || in_array('--main-only', $params, true);

        $runner = new BackupRunner();

        try {
            // --force backs up everything now; otherwise run the schedule, which
            // checks the global (main) + each client's own schedule.
            $res = $force ? $runner->run($mainOnly ? 'main' : null) : $runner->runScheduled();
        } catch (Throwable $e) {
            CLI::error('Backup run failed: ' . $e->getMessage());

            return EXIT_ERROR;
        }

        foreach ($res['made'] as $file) {
            CLI::write('  ✓ ' . $file, 'green');
        }
        foreach ($res['errors'] as $err) {
            CLI::error('  ✗ ' . $err);
        }
        CLI::write($res['status'], 'cyan');
        CLI::write('Saved to: ' . $runner->dir(), 'dark_gray');

        return EXIT_SUCCESS;
    }
}
