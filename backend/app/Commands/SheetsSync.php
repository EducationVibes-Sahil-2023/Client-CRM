<?php

namespace App\Commands;

use App\Libraries\GoogleSheetsSync;
use App\Libraries\TenantManager;
use App\Models\ClientModel;
use App\Models\SettingsModel;
use App\Models\SheetSyncModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * Auto-fetch every client's connected Google Sheets and sync them into leads
 * (create new, update existing status, write back the "CRM Status" column).
 *
 *   php spark sheets:sync
 *
 * Add to crontab to auto-fetch, e.g. every 10 minutes:
 *   * /10 * * * *  cd /var/www/crm/backend && php spark sheets:sync >> writable/logs/sheets-sync.log 2>&1
 */
class SheetsSync extends BaseCommand
{
    protected $group       = 'Sheets';
    protected $name        = 'sheets:sync';
    protected $description = 'Sync every client\'s connected Google Sheets into leads.';

    public function run(array $params)
    {
        $clients = (new ClientModel())->findAll();
        $manager = new TenantManager();
        $totalIn = 0;
        $totalUp = 0;
        $sheets  = 0;

        foreach ($clients as $c) {
            $cid = (int) $c['id'];
            if (! ClientModel::statusAllowsAccess($c['status'] ?? null)) {
                continue;
            }
            try {
                $db = $manager->forClient($c);
            } catch (\Throwable $e) {
                CLI::error('  ✗ client #' . $cid . ' DB: ' . $e->getMessage());
                continue;
            }

            $configs = (new SheetSyncModel($db))->where('client_id', $cid)->where('enabled', 1)->findAll();
            if (! $configs) {
                continue;
            }
            $saRow  = (new SettingsModel($db))->where('client_id', $cid)->where('setting_key', 'gsheet_service_account')->first();
            $saJson = (string) ($saRow['setting_value'] ?? '');
            if ($saJson === '') {
                continue; // no service account for this client
            }

            foreach ($configs as $cfg) {
                $sheets++;
                try {
                    $stats = GoogleSheetsSync::run($cid, $db, $cfg, $saJson);
                    $totalIn += $stats['inserted'];
                    $totalUp += $stats['updated'];
                    if ($stats['inserted'] || $stats['updated']) {
                        CLI::write("  ✓ client #{$cid} {$cfg['name']}: +{$stats['inserted']} new, {$stats['updated']} updated", 'green');
                    }
                } catch (\Throwable $e) {
                    CLI::error("  ✗ client #{$cid} {$cfg['name']}: " . $e->getMessage());
                }
            }
        }

        CLI::write("Google Sheets sync done — {$totalIn} new, {$totalUp} updated across {$sheets} sheet(s).", 'cyan');
    }
}
