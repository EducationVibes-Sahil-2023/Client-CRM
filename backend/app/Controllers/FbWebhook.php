<?php

namespace App\Controllers;

use App\Libraries\FacebookGraph;
use App\Libraries\FbLeadIngest;
use App\Libraries\TenantManager;
use App\Models\ClientModel;
use App\Models\FbFormModel;
use App\Models\FbPageIndexModel;
use App\Models\FbPageModel;
use App\Models\FbWebhookIndexModel;
use App\Models\SettingsModel;

/**
 * PUBLIC (sessionless) Facebook Lead Ads webhook — FULLY PER-PROJECT. Each client
 * has their OWN webhook URL /public/fb/webhook/{token} (token → client via the
 * main-DB `fb_webhook_index`) and their own Meta app credentials. Two jobs:
 *  - GET  handshake: echo `hub.challenge` when `hub.verify_token` matches THAT
 *    client's own `fb_verify_token`.
 *  - POST leadgen:   verify `X-Hub-Signature-256` (HMAC of the raw body with THAT
 *    client's own app secret), then for each leadgen change resolve the page via
 *    `fb_page_index`, fetch the lead with that page's token, and ingest it.
 *
 * Nothing here reads `.env` — a project that hasn't configured Facebook simply
 * has no webhook token and its URL 403s.
 */
class FbWebhook extends ApiController
{
    /** Resolve the owning client id from a webhook URL token (enabled only), or 0. */
    private function clientForToken(string $token): int
    {
        if ($token === '') {
            return 0;
        }
        $idx = (new FbWebhookIndexModel())->where('token', $token)->first();

        return ($idx && ! empty($idx['enabled'])) ? (int) $idx['client_id'] : 0;
    }

    /** Read one of a client's tenant settings (empty string when unset). */
    private function clientSetting(int $cid, string $key): string
    {
        try {
            $db  = (new TenantManager())->forClient($cid);
            $row = (new SettingsModel($db))->where('client_id', $cid)->where('setting_key', $key)->first();

            return (string) ($row['setting_value'] ?? '');
        } catch (\Throwable $e) {
            return '';
        }
    }

    /** GET /public/fb/webhook/{token} — this project's verification handshake. */
    public function verify(string $token = '')
    {
        $mode      = (string) $this->request->getGet('hub_mode');
        $sent      = (string) $this->request->getGet('hub_verify_token');
        $challenge = (string) $this->request->getGet('hub_challenge');

        $cid      = $this->clientForToken($token);
        $expected = $cid ? trim($this->clientSetting($cid, 'fb_verify_token')) : '';
        if ($mode === 'subscribe' && $expected !== '' && hash_equals($expected, $sent)) {
            // Facebook expects the raw challenge echoed back as plain text.
            return $this->response->setStatusCode(200)->setBody($challenge);
        }

        return $this->response->setStatusCode(403)->setBody('Verification failed');
    }

    /** POST /public/fb/webhook/{token} — receive this project's leadgen events. */
    public function receive(string $token = '')
    {
        $raw  = (string) $this->request->getBody();
        $body = json_decode($raw, true);
        if (! is_array($body) || ($body['object'] ?? '') !== 'page') {
            // Always 200 so Facebook doesn't retry a payload we simply ignore.
            return $this->respond(['status' => 1]);
        }

        // The URL token identifies the project; verify the signature with THAT
        // project's own app secret (no .env). Unknown token / no secret → reject.
        $cid    = $this->clientForToken($token);
        $secret = $cid ? trim($this->clientSetting($cid, 'fb_app_secret')) : '';
        if ($secret === '') {
            return $this->response->setStatusCode(403)->setBody('Unknown or unconfigured webhook.');
        }
        $sig      = (string) $this->request->getHeaderLine('X-Hub-Signature-256');
        $expected = 'sha256=' . hash_hmac('sha256', $raw, $secret);
        if ($sig === '' || ! hash_equals($expected, $sig)) {
            return $this->response->setStatusCode(403)->setBody('Bad signature');
        }

        foreach ((array) ($body['entry'] ?? []) as $entry) {
            $pageId = (string) ($entry['id'] ?? '');
            foreach ((array) ($entry['changes'] ?? []) as $change) {
                if (($change['field'] ?? '') !== 'leadgen') {
                    continue;
                }
                $value     = (array) ($change['value'] ?? []);
                $leadgenId = (string) ($value['leadgen_id'] ?? '');
                $formId    = (string) ($value['form_id'] ?? '');
                $page      = (string) ($value['page_id'] ?? $pageId);
                if ($leadgenId === '' || $page === '') {
                    continue;
                }
                try {
                    $this->handleLead($page, $formId, $leadgenId);
                } catch (\Throwable $e) {
                    log_message('error', 'FB webhook lead failed (' . $leadgenId . '): ' . $e->getMessage());
                }
            }
        }

        // Facebook only needs a 200 to consider delivery successful.
        return $this->respond(['status' => 1]);
    }

    /** Resolve tenant from page id, fetch the lead, and ingest it. */
    private function handleLead(string $pageId, string $formId, string $leadgenId): void
    {
        $idx = (new FbPageIndexModel())->where('page_id', $pageId)->first();
        if (! $idx || empty($idx['enabled'])) {
            $this->fbLog(0, ['event' => 'skipped', 'reason' => 'page not connected/enabled', 'page_id' => $pageId, 'form_id' => $formId, 'leadgen_id' => $leadgenId]);

            return;
        }
        $cid    = (int) $idx['client_id'];
        $client = (new ClientModel())->find($cid);
        if (! $client || ! ClientModel::statusAllowsAccess($client['status'] ?? null)) {
            $this->fbLog($cid, ['event' => 'skipped', 'reason' => 'client inactive', 'page_id' => $pageId, 'form_id' => $formId, 'leadgen_id' => $leadgenId]);

            return;
        }

        $db   = (new TenantManager())->forClient($cid);
        $page = (new FbPageModel($db))->where('client_id', $cid)->where('page_id', $pageId)->first();
        if (! $page) {
            $this->fbLog($cid, ['event' => 'skipped', 'reason' => 'page not found for client', 'page_id' => $pageId, 'form_id' => $formId, 'leadgen_id' => $leadgenId]);

            return;
        }
        // Only ingest for a form the client has mapped + enabled.
        $form = (new FbFormModel($db))->where('client_id', $cid)->where('form_id', $formId)->where('enabled', 1)->first();
        if (! $form) {
            $this->fbLog($cid, ['event' => 'skipped', 'reason' => 'form not mapped/enabled', 'page_id' => $pageId, 'form_id' => $formId, 'leadgen_id' => $leadgenId]);

            return;
        }

        $lead      = FacebookGraph::getLead($leadgenId, (string) $page['access_token']);
        $fieldData = (array) ($lead['field_data'] ?? []);
        // Flatten FB's [{name, values:[...]}] into a readable {name: value} map.
        $flat = [];
        foreach ($fieldData as $f) {
            $flat[(string) ($f['name'] ?? '')] = implode(', ', (array) ($f['values'] ?? []));
        }

        $result = FbLeadIngest::ingest($cid, $db, $form, $fieldData, $leadgenId);
        $this->fbLog($cid, [
            'event'      => 'received',
            'form'       => $form['form_name'] ?? $formId,
            'form_id'    => $formId,
            'page_id'    => $pageId,
            'leadgen_id' => $leadgenId,
            'data'       => $flat,
            'result'     => $result['status'] ?? 'unknown',
            'lead_id'    => $result['lead_id'] ?? null,
        ]);
    }

    /** Append one timestamped JSON line to the shared Facebook-lead log file. */
    private function fbLog(int $cid, array $entry): void
    {
        try {
            $line = json_encode(['ts' => date('Y-m-d H:i:s'), 'cid' => $cid] + $entry) . "\n";
            @file_put_contents(WRITEPATH . 'logs/fb-leads.log', $line, FILE_APPEND | LOCK_EX);
        } catch (\Throwable $e) {
            // logging must never break ingestion
        }
    }
}
