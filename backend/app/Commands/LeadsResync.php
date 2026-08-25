<?php

namespace App\Commands;

use App\Libraries\LeadsResyncRunner;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * Recompute the *derived* lead fields that the app normally maintains itself, so
 * leads/reminders/notes/calls added straight into the database (bulk import,
 * manual SQL) display correctly. Recompute-only — never deletes rows and only
 * updates the rows that actually need it. Logic lives in {@see LeadsResyncRunner}.
 *
 *   php spark leads:resync                # every client
 *   php spark leads:resync --client=3     # one client
 *   php spark leads:resync --dry-run      # report what would change, change nothing
 *
 * To run it AUTOMATICALLY after raw-SQL/manual inserts (no manual run), schedule
 * it every few minutes — server crontab, or the secured web-cron URL
 *   GET /public/cron/leads-resync?key=<cron.key>   ({@see \App\Controllers\Cron}).
 *
 * What it fixes: leads.follow_date (latest reminder date), leads.reference_id
 * (from reference_name), calls.lead_id (from contact phone), leads.updated_at
 * (newest note/reminder/call), and the first-response SLA.
 */
class LeadsResync extends BaseCommand
{
    protected $group       = 'Leads';
    protected $name        = 'leads:resync';
    protected $description = 'Recompute derived lead fields (follow_date, reference_id, calls.lead_id, updated_at) after manual/imported data.';
    protected $usage       = 'leads:resync [--client=ID] [--dry-run]';

    public function run(array $params)
    {
        $only   = isset($params['client']) ? (int) $params['client'] : (int) (CLI::getOption('client') ?? 0);
        $dryRun = array_key_exists('dry-run', $params) || CLI::getOption('dry-run') !== null;

        if ($dryRun) {
            CLI::write('DRY RUN — no changes will be written.', 'yellow');
        }

        $r = LeadsResyncRunner::run($only ?: null, $dryRun);
        foreach ($r['errors'] as $e) {
            CLI::error('  ✗ ' . $e);
        }
        $verb = $dryRun ? 'would change' : 'changed';
        CLI::write("Resync across {$r['clients']} client(s): follow_date {$r['follow_date']}, reference_id {$r['reference_id']}, calls.lead_id {$r['calls_lead_id']}, updated_at {$r['updated_at']} {$verb}; first_response {$r['first_response']} stamped.", 'cyan');
        CLI::write($dryRun ? 'Dry run complete.' : 'Resync complete.', 'green');
    }
}
