<?php

namespace App\Controllers;

use App\Libraries\FacebookGraph;
use App\Libraries\FbLeadIngest;
use App\Libraries\TenantManager;
use App\Models\ClientModel;
use App\Models\FbFormModel;
use App\Models\FbPageIndexModel;
use App\Models\FbPageModel;
use App\Models\SettingsModel;

/**
 * PUBLIC (sessionless) Facebook Lead Ads webhook. Two jobs:
 *  - GET  handshake: echo `hub.challenge` when `hub.verify_token` matches ours.
 *  - POST leadgen:   verify the `X-Hub-Signature-256` (HMAC of the raw body with
 *    the app secret), then for each leadgen change resolve the client from the
 *    page id via the main-DB `fb_page_index`, fetch the lead from the Graph API
 *    with that page's token, and ingest it into the client's DB.
 *
 * Facebook subscribes at the app level, so one endpoint receives every client's
 * leads; the page id in the payload selects the tenant. Modeled on {@see CallIngest}.
 */
class FbWebhook extends ApiController
{
    /** GET /public/fb/webhook — verification handshake. */
    public function verify()
    {
        $mode      = (string) $this->request->getGet('hub_mode');
        $token     = (string) $this->request->getGet('hub_verify_token');
        $challenge = (string) $this->request->getGet('hub_challenge');

        $expected = FacebookGraph::verifyToken();
        if ($mode === 'subscribe' && $expected !== '' && hash_equals($expected, $token)) {
            // Facebook expects the raw challenge echoed back as plain text.
            return $this->response->setStatusCode(200)->setBody($challenge);
        }

        return $this->response->setStatusCode(403)->setBody('Verification failed');
    }

    /** POST /public/fb/webhook — receive leadgen events. */
    public function receive()
    {
        $raw  = (string) $this->request->getBody();
        $body = json_decode($raw, true);
        if (! is_array($body) || ($body['object'] ?? '') !== 'page') {
            // Always 200 so Facebook doesn't retry a payload we simply ignore.
            return $this->respond(['status' => 1]);
        }

        // Verify the payload signature with the sending client's app secret (each
        // client may run their own Meta app). We resolve the secret from the first
        // page id in the payload; a client with none saved falls back to .env.
        $firstPage = (string) ($body['entry'][0]['id'] ?? '');
        $secret    = $this->secretForPage($firstPage);
        if ($secret !== '') {
            $sig      = (string) $this->request->getHeaderLine('X-Hub-Signature-256');
            $expected = 'sha256=' . hash_hmac('sha256', $raw, $secret);
            if ($sig === '' || ! hash_equals($expected, $sig)) {
                return $this->response->setStatusCode(403)->setBody('Bad signature');
            }
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

    /** The app secret to verify a payload with: the owning client's saved value, else .env. */
    private function secretForPage(string $pageId): string
    {
        $env = FacebookGraph::appSecret();
        if ($pageId === '') {
            return $env;
        }
        $idx = (new FbPageIndexModel())->where('page_id', $pageId)->first();
        if (! $idx) {
            return $env;
        }
        try {
            $cid = (int) $idx['client_id'];
            $db  = (new TenantManager())->forClient($cid);
            $row = (new SettingsModel($db))->where('client_id', $cid)->where('setting_key', 'fb_app_secret')->first();
            $s   = (string) ($row['setting_value'] ?? '');

            return $s !== '' ? $s : $env;
        } catch (\Throwable $e) {
            return $env;
        }
    }

    /** Resolve tenant from page id, fetch the lead, and ingest it. */
    private function handleLead(string $pageId, string $formId, string $leadgenId): void
    {
        $idx = (new FbPageIndexModel())->where('page_id', $pageId)->first();
        if (! $idx || empty($idx['enabled'])) {
            return;
        }
        $cid    = (int) $idx['client_id'];
        $client = (new ClientModel())->find($cid);
        if (! $client || ! ClientModel::statusAllowsAccess($client['status'] ?? null)) {
            return;
        }

        $db   = (new TenantManager())->forClient($cid);
        $page = (new FbPageModel($db))->where('client_id', $cid)->where('page_id', $pageId)->first();
        if (! $page) {
            return;
        }
        // Only ingest for a form the client has mapped + enabled.
        $form = (new FbFormModel($db))->where('client_id', $cid)->where('form_id', $formId)->where('enabled', 1)->first();
        if (! $form) {
            return;
        }

        $lead = FacebookGraph::getLead($leadgenId, (string) $page['access_token']);
        FbLeadIngest::ingest($cid, $db, $form, (array) ($lead['field_data'] ?? []), $leadgenId);
    }
}
