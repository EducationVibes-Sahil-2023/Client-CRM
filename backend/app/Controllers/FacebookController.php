<?php

namespace App\Controllers;

use App\Libraries\FacebookGraph;
use App\Libraries\FbLeadIngest;
use App\Libraries\TenantManager;
use App\Models\FbFormModel;
use App\Models\FbPageIndexModel;
use App\Models\FbPageModel;
use App\Models\SettingsModel;
use CodeIgniter\Database\ConnectionInterface;

/**
 * Admin endpoints for the Facebook Lead Ads integration (client-authenticated).
 * A client connects their Page(s) via OAuth, then maps each lead form's fields to
 * CRM lead fields. Leads flow in via the public leadgen webhook ({@see FbWebhook})
 * and the polling cron ({@see \App\Commands\FbPoll}); both reuse {@see FbLeadIngest}.
 *
 * Access tokens are stored per Page (tenant `fb_pages`) and never returned to the
 * browser — the API only exposes booleans/status, matching the Gmail convention.
 */
class FacebookController extends ApiController
{
    private function cid(): int
    {
        return (int) (($this->currentUser()['client_id'] ?? 0));
    }

    private function isAdmin(): bool
    {
        return in_array($this->currentUser()['role'] ?? '', ['client_admin', 'super_admin'], true);
    }

    /** 403 unless the caller is the client admin. */
    private function guard()
    {
        return $this->isAdmin() ? null : $this->failForbidden('Only an admin can manage the Facebook integration.');
    }

    /** Read one of this client's tenant settings (empty string when unset). */
    private function settingVal(string $key): string
    {
        $r = (new SettingsModel())->where('client_id', $this->cid())->where('setting_key', $key)->first();

        return (string) ($r['setting_value'] ?? '');
    }

    /** Upsert one of this client's tenant settings. */
    private function putSetting(string $key, string $val): void
    {
        $m = new SettingsModel();
        $r = $m->where('client_id', $this->cid())->where('setting_key', $key)->first();
        if ($r) {
            $m->update((int) $r['id'], ['setting_value' => $val]);
        } else {
            $m->insert(['client_id' => $this->cid(), 'setting_key' => $key, 'setting_value' => $val]);
        }
    }

    /** The Meta App credentials to use — this client's saved values, else the .env fallback. */
    private function creds(): array
    {
        return [
            'app_id'     => trim($this->settingVal('fb_app_id')) ?: (string) env('facebook.appId', ''),
            'app_secret' => trim($this->settingVal('fb_app_secret')) ?: (string) env('facebook.appSecret', ''),
        ];
    }

    /** POST /client/facebook/config — save the client's Meta App ID/Secret (secret blank-preserves). */
    public function saveConfig()
    {
        if ($r = $this->guard()) {
            return $r;
        }
        $this->putSetting('fb_app_id', trim((string) $this->input('app_id')));
        $secret = (string) $this->input('app_secret');
        if (trim($secret) !== '') {
            $this->putSetting('fb_app_secret', trim($secret)); // blank leaves the saved secret untouched
        }
        $this->logActivity('updated', 'settings', null, 'Updated Facebook app credentials', $this->cid());

        return $this->respond(['message' => 'Saved']);
    }

    /** GET /client/facebook — connection status, connected pages + their mapped forms. */
    public function index()
    {
        if ($r = $this->guard()) {
            return $r;
        }
        $cid   = $this->cid();
        $pages = (new FbPageModel())->where('client_id', $cid)->orderBy('id', 'ASC')->findAll();
        $forms = (new FbFormModel())->where('client_id', $cid)->findAll();
        $byPage = [];
        foreach ($forms as $f) {
            $byPage[(string) $f['page_id']][] = $this->formOut($f);
        }

        $creds = $this->creds();

        return $this->respond([
            'configured' => $creds['app_id'] !== '' && $creds['app_secret'] !== '',
            'connected'  => (bool) $pages,
            'config'     => [
                'app_id'       => $creds['app_id'],
                'has_secret'   => $creds['app_secret'] !== '',
                'verify_token' => FacebookGraph::verifyToken(), // shared handshake token (from .env), shown so the admin can copy it into their Meta app
            ],
            'pages'      => array_map(fn ($p) => [
                'id'        => (int) $p['id'],
                'page_id'   => $p['page_id'],
                'page_name' => $p['page_name'],
                'enabled'   => (int) $p['enabled'],
                'forms'     => $byPage[(string) $p['page_id']] ?? [],
            ], $pages),
        ]);
    }

    /** GET /client/facebook/oauth-url?redirect_uri=… — the FB login-dialog URL. */
    public function oauthUrl()
    {
        if ($r = $this->guard()) {
            return $r;
        }
        $creds = $this->creds();
        if ($creds['app_id'] === '' || $creds['app_secret'] === '') {
            return $this->fail('Enter your Facebook App ID and App Secret first.', 400);
        }
        $redirect = trim((string) ($this->request->getGet('redirect_uri') ?? '')) ?: FacebookGraph::redirectUri();
        $state    = 'c' . $this->cid() . '.' . bin2hex(random_bytes(8));

        return $this->respond(['url' => FacebookGraph::oauthDialogUrl($creds['app_id'], $redirect, $state)]);
    }

    /** POST /client/facebook/connect {code, redirect_uri?} — exchange the OAuth code, store pages. */
    public function connect()
    {
        if ($r = $this->guard()) {
            return $r;
        }
        $cid  = $this->cid();
        $code = trim((string) $this->input('code'));
        if ($code === '') {
            return $this->failValidationErrors(['code' => 'Missing authorization code.']);
        }
        $redirect = trim((string) $this->input('redirect_uri')) ?: FacebookGraph::redirectUri();
        $creds    = $this->creds();
        if ($creds['app_id'] === '' || $creds['app_secret'] === '') {
            return $this->fail('Enter your Facebook App ID and App Secret first.', 400);
        }

        try {
            $userToken = FacebookGraph::exchangeCode($creds['app_id'], $creds['app_secret'], $redirect, $code);
            if ($userToken === '') {
                return $this->fail('Facebook did not return an access token.', 400);
            }
            $userToken = FacebookGraph::longLivedUserToken($creds['app_id'], $creds['app_secret'], $userToken);
            $pages     = FacebookGraph::listPages($userToken);
        } catch (\Throwable $e) {
            return $this->fail($e->getMessage(), 400);
        }
        if (! $pages) {
            return $this->fail('No Facebook Pages were found for this account.', 400);
        }

        $pageModel = new FbPageModel();
        foreach ($pages as $p) {
            if ($p['id'] === '') {
                continue;
            }
            $existing = $pageModel->where('client_id', $cid)->where('page_id', $p['id'])->withDeleted()->first();
            $row = [
                'client_id'    => $cid,
                'page_id'      => $p['id'],
                'page_name'    => $p['name'],
                'access_token' => $p['access_token'] ?: ($existing['access_token'] ?? null),
                'user_token'   => $userToken,
                'enabled'      => 1,
                'deleted_at'   => null,
            ];
            if ($existing) {
                $pageModel->update((int) $existing['id'], $row);
                $pageRowId = (int) $existing['id'];
            } else {
                $pageRowId = (int) $pageModel->insert($row);
            }
            $this->syncPageIndex($p['id'], $cid, $pageRowId, 1);
        }
        $this->logActivity('created', 'fb_page', null, 'Connected Facebook (' . count($pages) . ' page(s))', $cid);

        return $this->respond(['message' => 'Facebook connected', 'pages' => count($pages)]);
    }

    /** GET /client/facebook/pages/{id}/forms — live lead forms on a connected page. */
    public function pageForms(int $id)
    {
        if ($r = $this->guard()) {
            return $r;
        }
        $page = (new FbPageModel())->where('client_id', $this->cid())->find($id);
        if (! $page) {
            return $this->failNotFound('Page not found');
        }
        try {
            $forms = FacebookGraph::listForms((string) $page['page_id'], (string) $page['access_token']);
        } catch (\Throwable $e) {
            return $this->fail($e->getMessage(), 400);
        }

        return $this->respond(['forms' => $forms]);
    }

    /**
     * GET /client/facebook/logs — recent incoming Facebook lead deliveries for THIS
     * client (from the shared fb-leads.log): what data arrived + the outcome.
     */
    public function logs()
    {
        if ($r = $this->guard()) {
            return $r;
        }
        $cid  = $this->cid();
        $file = WRITEPATH . 'logs/fb-leads.log';
        $out  = [];
        if (is_file($file)) {
            $lines = @file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
            foreach (array_slice($lines, -800) as $line) {   // scan the recent tail
                $e = json_decode($line, true);
                if (is_array($e) && (int) ($e['cid'] ?? 0) === $cid) {
                    $out[] = $e;
                }
            }
            $out = array_slice(array_reverse($out), 0, 100); // newest first, capped
        }

        return $this->respond(['entries' => $out]);
    }

    /** POST /client/facebook/forms — create/update a form's field mapping + lead config. */
    public function saveForm()
    {
        if ($r = $this->guard()) {
            return $r;
        }
        $cid   = $this->cid();
        $id    = (int) $this->input('id');
        $model = new FbFormModel();
        $data  = $this->formPayload($cid);
        if ($data['form_id'] === '' || $data['page_id'] === '') {
            return $this->failValidationErrors(['form_id' => 'A page and form are required.']);
        }

        if ($id) {
            $existing = $model->where('client_id', $cid)->find($id);
            if (! $existing) {
                return $this->failNotFound('Form not found');
            }
            $model->update($id, $data);
        } else {
            $id = (int) $model->insert($data);
        }

        // Subscribe the app to this page's leadgen webhook (real-time delivery).
        $page = (new FbPageModel())->where('client_id', $cid)->where('page_id', $data['page_id'])->first();
        if ($page) {
            try {
                FacebookGraph::subscribePageToApp((string) $page['page_id'], (string) $page['access_token']);
            } catch (\Throwable $e) {
                log_message('warning', 'FB subscribe failed (client ' . $cid . '): ' . $e->getMessage());
            }
        }
        $this->logActivity($id ? 'updated' : 'created', 'fb_form', $id, 'Facebook form ' . $data['form_name'], $cid);

        return $this->respond(['message' => 'Saved', 'id' => $id]);
    }

    /** POST /client/facebook/forms/{id}/delete — soft-delete a form mapping. */
    public function deleteForm(int $id)
    {
        if ($r = $this->guard()) {
            return $r;
        }
        $model = new FbFormModel();
        $form  = $model->where('client_id', $this->cid())->find($id);
        if (! $form) {
            return $this->failNotFound('Form not found');
        }
        $model->delete($id);
        $this->logActivity('deleted', 'fb_form', $id, 'Deleted Facebook form ' . $form['form_name'], $this->cid());

        return $this->respond(['message' => 'Deleted']);
    }

    /** POST /client/facebook/forms/{id}/sync — pull this form's new leads now (polling on demand). */
    public function syncForm(int $id)
    {
        if ($r = $this->guard()) {
            return $r;
        }
        $cid   = $this->cid();
        $model = new FbFormModel();
        $form  = $model->where('client_id', $cid)->find($id);
        if (! $form) {
            return $this->failNotFound('Form not found');
        }
        $page = (new FbPageModel())->where('client_id', $cid)->where('page_id', $form['page_id'])->first();
        if (! $page) {
            return $this->fail('The page for this form is no longer connected.', 400);
        }
        try {
            $db     = (new TenantManager())->forClient($cid); // the client's own DB (not main)
            $result = self::pullForm($cid, $db, $form, (string) $page['access_token']);
        } catch (\Throwable $e) {
            return $this->fail($e->getMessage(), 400);
        }
        $this->logActivity('created', 'lead', null, "Synced {$result['inserted']} Facebook lead(s)", $cid);

        return $this->respond(['message' => 'Synced', 'inserted' => $result['inserted'], 'skipped' => $result['skipped']]);
    }

    /** POST /client/facebook/disconnect — remove all pages/forms (soft) + disable the registry. */
    public function disconnect()
    {
        if ($r = $this->guard()) {
            return $r;
        }
        $cid  = $this->cid();
        $pages = (new FbPageModel())->where('client_id', $cid)->findAll();
        foreach ($pages as $p) {
            (new FbPageModel())->delete((int) $p['id']);
            (new FbPageIndexModel())->where('page_id', $p['page_id'])->set(['enabled' => 0])->update();
        }
        (new FbFormModel())->where('client_id', $cid)->delete(); // soft-delete all forms
        $this->logActivity('deleted', 'fb_page', null, 'Disconnected Facebook', $cid);

        return $this->respond(['message' => 'Disconnected']);
    }

    // -------------------------------------------------------------- shared

    /**
     * Pull a form's new leads (since its high-water mark) and ingest them. Shared
     * by the on-demand sync here and the polling cron. Returns inserted/skipped.
     */
    public static function pullForm(int $cid, ConnectionInterface $db, array $form, string $pageToken): array
    {
        $since = ! empty($form['last_lead_time']) ? strtotime((string) $form['last_lead_time']) : 0;
        $leads = FacebookGraph::getFormLeads((string) $form['form_id'], $pageToken, $since ?: 0);

        $inserted = 0;
        $skipped  = 0;
        $maxTime  = $since;
        // Oldest-first so the cursor/counter advance in submission order.
        foreach (array_reverse($leads) as $l) {
            $res = FbLeadIngest::ingest($cid, $db, $form, (array) ($l['field_data'] ?? []), (string) ($l['id'] ?? ''));
            if (($res['status'] ?? '') === 'created') {
                $inserted++;
            } else {
                $skipped++;
            }
            $t = strtotime((string) ($l['created_time'] ?? ''));
            if ($t && $t > $maxTime) {
                $maxTime = $t;
            }
        }
        if ($maxTime > $since) {
            (new FbFormModel($db))->where('client_id', $cid)->where('id', (int) $form['id'])
                ->set(['last_lead_time' => date('Y-m-d H:i:s', $maxTime)])->update();
        }

        return ['inserted' => $inserted, 'skipped' => $skipped];
    }

    /** Upsert the main-DB page→client registry the webhook resolves against. */
    private function syncPageIndex(string $pageId, int $cid, int $pageRowId, int $enabled): void
    {
        $model = new FbPageIndexModel();
        if ($model->where('page_id', $pageId)->first()) {
            $model->where('page_id', $pageId)->set(['client_id' => $cid, 'page_row_id' => $pageRowId, 'enabled' => $enabled])->update();
        } else {
            $model->insert(['page_id' => $pageId, 'client_id' => $cid, 'page_row_id' => $pageRowId, 'enabled' => $enabled]);
        }
    }

    /** Build a sanitized fb_forms row from request input. */
    private function formPayload(int $cid): array
    {
        $in = (array) $this->input();

        $intList = static function ($v): array {
            return array_values(array_unique(array_filter(array_map('intval', is_array($v) ? $v : []))));
        };

        // Field map: fbFieldName → leadKey | custom_<key> (drop blanks).
        $map = [];
        foreach ((array) ($in['field_map'] ?? []) as $fb => $target) {
            $fb     = trim((string) $fb);
            $target = trim((string) $target);
            if ($fb !== '' && $target !== '') {
                $map[$fb] = $target;
            }
        }
        // State → counsellors (arrays, round-robined at ingest).
        $stateMap = [];
        foreach ((array) ($in['state_assignee_map'] ?? []) as $state => $ids) {
            $state = trim((string) $state);
            $list  = $intList(is_array($ids) ? $ids : [$ids]);
            if ($state !== '' && $list) {
                $stateMap[$state] = $list;
            }
        }

        return [
            'client_id'                => $cid,
            'page_id'                  => trim((string) ($in['page_id'] ?? '')),
            'form_id'                  => trim((string) ($in['form_id'] ?? '')),
            'form_name'                => mb_substr(trim((string) ($in['form_name'] ?? '')), 0, 191),
            'field_map'                => json_encode((object) $map),
            'source_id'                => (int) ($in['source_id'] ?? 0) ?: null,
            'status_id'                => (int) ($in['status_id'] ?? 0) ?: null,
            'lead_type_id'             => (int) ($in['lead_type_id'] ?? 0) ?: null,
            'assigned_to'              => (int) ($in['assigned_to'] ?? 0) ?: null,
            'auto_assignee'            => json_encode($intList($in['auto_assignee'] ?? [])),
            'auto_assign_state_wise'   => ! empty($in['auto_assign_state_wise']) ? 1 : 0,
            'state_assignee_map'       => json_encode((object) $stateMap),
            'allow_duplicate'          => ! empty($in['allow_duplicate']) ? 1 : 0,
            'prevent_duplicate_field'  => mb_substr(trim((string) ($in['prevent_duplicate_field'] ?? 'phone')), 0, 40) ?: null,
            'prevent_duplicate_field2' => mb_substr(trim((string) ($in['prevent_duplicate_field2'] ?? '')), 0, 40) ?: null,
            'create_duplicate_as_task' => ! empty($in['create_duplicate_as_task']) ? 1 : 0,
            'notify_on_import'         => array_key_exists('notify_on_import', $in) ? (! empty($in['notify_on_import']) ? 1 : 0) : 1,
            'notify_type'              => in_array($in['notify_type'] ?? '', ['specific', 'roles', 'responsible'], true) ? $in['notify_type'] : 'responsible',
            'notify_staff'             => json_encode($intList($in['notify_staff'] ?? [])),
            'enabled'                  => array_key_exists('enabled', $in) ? (! empty($in['enabled']) ? 1 : 0) : 1,
        ];
    }

    /** Shape an fb_forms row for the admin API (decode JSON columns). */
    private function formOut(array $f): array
    {
        $arr = static fn ($v) => (is_array($j = json_decode((string) $v, true)) ? $j : []);
        $smap = [];
        foreach ($arr($f['state_assignee_map']) as $st => $ids) {
            $smap[$st] = array_values(array_map('intval', is_array($ids) ? $ids : [$ids]));
        }

        return [
            'id'                       => (int) $f['id'],
            'page_id'                  => $f['page_id'],
            'form_id'                  => $f['form_id'],
            'form_name'                => $f['form_name'],
            'field_map'                => (object) $arr($f['field_map']),
            'source_id'                => $f['source_id'] !== null ? (int) $f['source_id'] : null,
            'status_id'                => $f['status_id'] !== null ? (int) $f['status_id'] : null,
            'lead_type_id'             => $f['lead_type_id'] !== null ? (int) $f['lead_type_id'] : null,
            'assigned_to'              => $f['assigned_to'] !== null ? (int) $f['assigned_to'] : null,
            'auto_assignee'            => array_map('intval', $arr($f['auto_assignee'])),
            'auto_assign_state_wise'   => (int) $f['auto_assign_state_wise'],
            'state_assignee_map'       => (object) $smap,
            'allow_duplicate'          => (int) $f['allow_duplicate'],
            'prevent_duplicate_field'  => $f['prevent_duplicate_field'],
            'prevent_duplicate_field2' => $f['prevent_duplicate_field2'],
            'create_duplicate_as_task' => (int) $f['create_duplicate_as_task'],
            'notify_on_import'         => (int) $f['notify_on_import'],
            'notify_type'              => $f['notify_type'] ?: 'responsible',
            'notify_staff'             => array_map('intval', $arr($f['notify_staff'])),
            'submission_count'         => (int) $f['submission_count'],
            'enabled'                  => (int) $f['enabled'],
        ];
    }
}
