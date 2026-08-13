<?php

namespace App\Commands;

use App\Libraries\AutoLeadTransfer;
use App\Libraries\TenantManager;
use App\Models\ClientModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * Auto lead-transfer — apply each client's enabled auto-transfer RULES (built on
 * the "Auto Lead Transfer" page). Wire to system cron; running it DAILY is usually
 * right (rules are day-based), but hourly is harmless:
 *
 *   0 6 * * *  cd /path/to/backend && php spark leadtransfer:auto >> writable/logs/lead-transfer.log 2>&1
 *
 *   php spark leadtransfer:auto                # every client's enabled rules
 *   php spark leadtransfer:auto --client=3     # just one client
 *   php spark leadtransfer:auto --dry-run      # report matches, change nothing
 *
 * Each enabled rule either TRANSFERS matching already-assigned leads to another
 * counsellor, or DISTRIBUTES matching unassigned leads — per its criteria (status,
 * type, source, created date/age, call count, assignment age, activity count,
 * include/exclude staff, transfer cap). A lead is never moved twice in one run.
 */
class LeadTransferAuto extends BaseCommand
{
    protected $group       = 'Leads';
    protected $name        = 'leadtransfer:auto';
    protected $description = 'Apply each client\'s enabled auto lead-transfer rules (wire to cron).';
    protected $usage       = 'leadtransfer:auto [--client=ID] [--dry-run]';
    protected $options     = [
        '--client'  => 'Only process this client id.',
        '--dry-run' => 'Report what would move without changing anything.',
    ];

    public function run(array $params)
    {
        $only   = isset($params['client']) ? (int) $params['client'] : (int) (CLI::getOption('client') ?? 0);
        $dryRun = array_key_exists('dry-run', $params) || CLI::getOption('dry-run') !== null;

        $clients = (new ClientModel())->findAll();
        if ($only) {
            $clients = array_values(array_filter($clients, static fn ($c) => (int) $c['id'] === $only));
        }
        if (! $clients) {
            CLI::write('No matching clients.', 'yellow');

            return EXIT_SUCCESS;
        }
        if ($dryRun) {
            CLI::write('DRY RUN — no changes will be written.', 'yellow');
        }

        $manager    = new TenantManager();
        $grandTotal = 0;

        foreach ($clients as $c) {
            if (! ClientModel::statusAllowsAccess($c['status'] ?? null)) {
                continue; // skip suspended / disabled clients
            }
            try {
                $db = $manager->forClient($c);
            } catch (\Throwable $e) {
                CLI::error("Client #{$c['id']}: cannot connect — " . $e->getMessage());
                continue;
            }

            try {
                $res = AutoLeadTransfer::runAll((int) $c['id'], $db, $dryRun);
            } catch (\Throwable $e) {
                CLI::error("Client #{$c['id']}: run failed — " . $e->getMessage());
                continue;
            }
            if (! $res['rules']) {
                continue; // no enabled rules for this client
            }

            CLI::write("Client #{$c['id']} — {$c['db_name']}", 'cyan');
            $verb = $dryRun ? 'would move' : 'moved';
            foreach ($res['rules'] as $r) {
                if ($r['reason']) {
                    CLI::write("  • [{$r['name']}] skipped: {$r['reason']}", 'yellow');
                    continue;
                }
                CLI::write("  • [{$r['name']}] ({$r['rule_type']}) scanned {$r['scanned']}; {$verb} {$r['acted']}"
                    . "; skipped (age {$r['skipped_age']}, calls {$r['skipped_calls']}, updates {$r['skipped_updates']}, cap {$r['skipped_cap']}, pool {$r['skipped_pool']}, dup {$r['skipped_dedupe']})",
                    $r['acted'] > 0 ? 'green' : 'dark_gray');
                foreach ($r['details'] as $d) {
                    CLI::write("      → {$d['lead']}: " . ($d['from'] ?? 'Unassigned') . " ⇒ {$d['to']}", 'dark_gray');
                }
            }
            $grandTotal += $res['total'];
        }

        CLI::write(($dryRun ? 'Dry run complete — ' : 'Done — ') . "{$grandTotal} lead(s) " . ($dryRun ? 'would move.' : 'moved.'), 'green');

        return EXIT_SUCCESS;
    }
}
