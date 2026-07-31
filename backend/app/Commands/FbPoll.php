<?php

namespace App\Commands;

use App\Controllers\FacebookController;
use App\Libraries\TenantManager;
use App\Models\ClientModel;
use App\Models\FbFormModel;
use App\Models\FbPageModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * Poll Facebook Lead Ads for every client and ingest any new leads — the backfill
 * / safety net alongside the real-time webhook (both are idempotent on leadgen id).
 *
 *   php spark fb:poll
 *
 * Add to crontab to run every few minutes, e.g.:
 *   * /5 * * * *  cd /var/www/crm/backend && php spark fb:poll >> writable/logs/fb-poll.log 2>&1
 */
class FbPoll extends BaseCommand
{
    protected $group       = 'Facebook';
    protected $name        = 'fb:poll';
    protected $description = 'Pull new Facebook Lead Ads leads for every client and ingest them.';

    public function run(array $params)
    {
        $clients = (new ClientModel())->findAll();
        $manager = new TenantManager();
        $totalIn = 0;
        $forms   = 0;

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

            $fbForms = (new FbFormModel($db))->where('client_id', $cid)->where('enabled', 1)->findAll();
            if (! $fbForms) {
                continue;
            }
            // Page token lookup for this client.
            $tokenByPage = [];
            foreach ((new FbPageModel($db))->where('client_id', $cid)->findAll() as $p) {
                $tokenByPage[(string) $p['page_id']] = (string) $p['access_token'];
            }

            foreach ($fbForms as $form) {
                $token = $tokenByPage[(string) $form['page_id']] ?? '';
                if ($token === '') {
                    continue;
                }
                $forms++;
                try {
                    $res = FacebookController::pullForm($cid, $db, $form, $token);
                    $totalIn += $res['inserted'];
                    if ($res['inserted']) {
                        CLI::write("  ✓ client #{$cid} form {$form['form_name']}: +{$res['inserted']}", 'green');
                    }
                } catch (\Throwable $e) {
                    CLI::error("  ✗ client #{$cid} form {$form['form_id']}: " . $e->getMessage());
                }
            }
        }

        CLI::write("Facebook poll done — {$totalIn} new lead(s) across {$forms} form(s).", 'cyan');
    }
}
