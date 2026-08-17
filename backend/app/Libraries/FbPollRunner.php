<?php

namespace App\Libraries;

use App\Controllers\FacebookController;
use App\Models\ClientModel;
use App\Models\FbFormModel;
use App\Models\FbPageModel;

/**
 * Runs one Facebook Lead Ads poll pass across every active client and ingests any
 * new leads. Shared by the CLI command ({@see \App\Commands\FbPoll}) and the
 * secured web-cron endpoint ({@see \App\Controllers\Cron::fbPoll}), so the same
 * logic backs both a server crontab and a URL-based scheduler. Idempotent on the
 * leadgen id (like the real-time webhook), so overlapping runs never duplicate.
 */
class FbPollRunner
{
    /**
     * @return array{leads:int, forms:int, clients:int, errors:array<int,string>}
     */
    public static function run(): array
    {
        $clients = (new ClientModel())->findAll();
        $manager = new TenantManager();
        $leads   = 0;
        $forms   = 0;
        $seen    = 0;
        $errors  = [];

        foreach ($clients as $c) {
            $cid = (int) $c['id'];
            if (! ClientModel::statusAllowsAccess($c['status'] ?? null)) {
                continue;
            }
            try {
                $db = $manager->forClient($c);
            } catch (\Throwable $e) {
                $errors[] = "client #{$cid} DB: " . $e->getMessage();

                continue;
            }

            $fbForms = (new FbFormModel($db))->where('client_id', $cid)->where('enabled', 1)->findAll();
            if (! $fbForms) {
                continue;
            }
            $seen++;
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
                    $leads += (int) ($res['inserted'] ?? 0);
                } catch (\Throwable $e) {
                    $errors[] = "client #{$cid} form {$form['form_id']}: " . $e->getMessage();
                }
            }
        }

        return ['leads' => $leads, 'forms' => $forms, 'clients' => $seen, 'errors' => $errors];
    }
}
