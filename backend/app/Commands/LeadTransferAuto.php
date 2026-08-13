<?php

namespace App\Commands;

use App\Libraries\AutoLeadTransfer;
use App\Libraries\TenantManager;
use App\Models\ClientModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * Auto lead-transfer — reassign stale leads to another counsellor per each
 * client's admin-configured rules. Wire to system cron; running it DAILY is
 * usually right (the rules are day-based), but hourly is harmless:
 *
 *   0 6 * * *  cd /path/to/backend && php spark leadtransfer:auto >> writable/logs/lead-transfer.log 2>&1
 *
 *   php spark leadtransfer:auto                # every enabled client
 *   php spark leadtransfer:auto --client=3     # just one client
 *   php spark leadtransfer:auto --dry-run      # report matches, change nothing
 *   php spark leadtransfer:auto --client=3 --dry-run --force   # ignore the enabled flag
 *
 * Each run reads that client's `auto_transfer_config` setting and, if enabled,
 * moves every lead that matches (assigned N+ days ago, fewer than M calls by the
 * assigned rep, status in the selected set, transferred fewer than K times) to
 * the next counsellor in the pool. Disabled clients are skipped unless --force.
 */
class LeadTransferAuto extends BaseCommand
{
    protected $group       = 'Leads';
    protected $name        = 'leadtransfer:auto';
    protected $description = 'Auto-transfer stale leads to another counsellor per each client\'s configured rules (wire to cron).';
    protected $usage       = 'leadtransfer:auto [--client=ID] [--dry-run] [--force]';
    protected $options     = [
        '--client'  => 'Only process this client id.',
        '--dry-run' => 'Report what would transfer without changing anything.',
        '--force'   => 'Run even for clients whose auto-transfer is disabled.',
    ];

    public function run(array $params)
    {
        $only   = isset($params['client']) ? (int) $params['client'] : (int) (CLI::getOption('client') ?? 0);
        $dryRun = array_key_exists('dry-run', $params) || CLI::getOption('dry-run') !== null;
        $force  = array_key_exists('force', $params) || CLI::getOption('force') !== null;

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

            $cfg = AutoLeadTransfer::readConfig((int) $c['id'], $db);
            if (! $cfg['enabled'] && ! $force) {
                continue; // silently skip clients who haven't turned it on
            }

            try {
                $res = AutoLeadTransfer::run((int) $c['id'], $db, $cfg, $dryRun);
            } catch (\Throwable $e) {
                CLI::error("Client #{$c['id']}: run failed — " . $e->getMessage());
                continue;
            }

            CLI::write("Client #{$c['id']} — {$c['db_name']}", 'cyan');
            if ($res['reason']) {
                CLI::write('  • skipped: ' . $res['reason'], 'yellow');
                continue;
            }
            $verb = $dryRun ? 'would transfer' : 'transferred';
            CLI::write("  • scanned {$res['scanned']} lead(s); {$verb} {$res['transferred']}"
                . "; skipped (calls {$res['skipped_calls']}, updates {$res['skipped_updates']}, cap {$res['skipped_cap']}, pool {$res['skipped_pool']})",
                $res['transferred'] > 0 ? 'green' : 'dark_gray');
            foreach ($res['details'] as $d) {
                CLI::write("      → {$d['lead']}: " . ($d['from'] ?? 'Unassigned') . " ⇒ {$d['to']}", 'dark_gray');
            }
            $grandTotal += $res['transferred'];
        }

        CLI::write(($dryRun ? 'Dry run complete — ' : 'Done — ') . "{$grandTotal} lead(s) " . ($dryRun ? 'would move.' : 'transferred.'), 'green');

        return EXIT_SUCCESS;
    }
}
