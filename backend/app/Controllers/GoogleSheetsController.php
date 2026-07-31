<?php

namespace App\Controllers;

use App\Libraries\GoogleSheetsService;
use App\Libraries\GoogleSheetsSync;
use App\Libraries\TenantManager;
use App\Models\SettingsModel;
use App\Models\SheetSyncModel;

/**
 * Admin endpoints for the Google Sheets → Leads sync (client-authenticated,
 * admin-only). Each client pastes their OWN Google service-account key (stored in
 * tenant settings, private-key never returned), shares their Sheet with the
 * service account's email, and maps sheet columns → lead fields. New rows create
 * leads; existing leads (matched by the dedupe field) get their status updated;
 * each row's outcome is written back to the sheet's "CRM Status" column.
 *
 * Mapping targets + lookups (sources/statuses/staff) are fetched by the frontend
 * from the Web-to-Lead builder endpoint, so this controller stays lean.
 */
class GoogleSheetsController extends ApiController
{
    private const SA_KEY = 'gsheet_service_account';

    private function cid(): int
    {
        return (int) (($this->currentUser()['client_id'] ?? 0));
    }

    private function isAdmin(): bool
    {
        return in_array($this->currentUser()['role'] ?? '', ['client_admin', 'super_admin'], true);
    }

    private function guard()
    {
        return $this->isAdmin() ? null : $this->failForbidden('Only an admin can manage the Google Sheets integration.');
    }

    private function settingVal(string $key): string
    {
        $r = (new SettingsModel())->where('client_id', $this->cid())->where('setting_key', $key)->first();

        return (string) ($r['setting_value'] ?? '');
    }

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

    /** GET /client/google-sheets — service-account status + connected sheets. */
    public function index()
    {
        if ($r = $this->guard()) {
            return $r;
        }
        $saJson = $this->settingVal(self::SA_KEY);
        $svc    = new GoogleSheetsService($saJson);
        $sheets = (new SheetSyncModel())->where('client_id', $this->cid())->orderBy('id', 'DESC')->findAll();

        return $this->respond([
            'configured' => $svc->isConfigured(),
            'config'     => [
                'has_service_account'   => $svc->isConfigured(),
                'service_account_email' => $svc->serviceAccountEmail(),
            ],
            'sheets'     => array_map([$this, 'sheetOut'], $sheets),
        ]);
    }

    /** POST /client/google-sheets/config — save the service-account JSON key. */
    public function saveConfig()
    {
        if ($r = $this->guard()) {
            return $r;
        }
        $json = trim((string) $this->input('service_account'));
        if ($json !== '') {
            $decoded = json_decode($json, true);
            if (! is_array($decoded) || empty($decoded['client_email']) || empty($decoded['private_key'])) {
                return $this->failValidationErrors(['service_account' => 'That doesn\'t look like a valid service-account JSON key (needs client_email + private_key).']);
            }
            $this->putSetting(self::SA_KEY, $json);
        }
        $this->logActivity('updated', 'settings', null, 'Updated Google Sheets service account', $this->cid());
        $svc = new GoogleSheetsService($this->settingVal(self::SA_KEY));

        return $this->respond(['message' => 'Saved', 'service_account_email' => $svc->serviceAccountEmail()]);
    }

    /** POST /client/google-sheets/preview — fetch tabs + header row for the mapping UI. */
    public function preview()
    {
        if ($r = $this->guard()) {
            return $r;
        }
        $svc = new GoogleSheetsService($this->settingVal(self::SA_KEY));
        if (! $svc->isConfigured()) {
            return $this->fail('Add your Google service-account key first.', 400);
        }
        $id = GoogleSheetsService::extractId(trim((string) $this->input('spreadsheet_url')));
        if ($id === '') {
            return $this->failValidationErrors(['spreadsheet_url' => 'Enter the Google Sheet URL.']);
        }
        try {
            $tabs = $svc->tabs($id);
            $tab  = trim((string) $this->input('sheet_tab')) ?: ($tabs[0] ?? '');
            $rows = $svc->getValues($id, $tab !== '' ? "'" . str_replace("'", "''", $tab) . "'" : 'A1:ZZ50');
        } catch (\Throwable $e) {
            return $this->fail($e->getMessage(), 400);
        }
        $headerRow = max(1, (int) ($this->input('header_row') ?? 1));
        $headers   = $rows[$headerRow - 1] ?? [];
        $sample    = array_slice(array_slice($rows, $headerRow), 0, 3);

        return $this->respond([
            'spreadsheet_id' => $id,
            'tabs'           => $tabs,
            'tab'            => $tab,
            'headers'        => array_values(array_map('strval', $headers)),
            'sample'         => $sample,
        ]);
    }

    /** GET /client/google-sheets/(:num) — one sheet config. */
    public function sheet(int $id)
    {
        if ($r = $this->guard()) {
            return $r;
        }
        $s = (new SheetSyncModel())->where('client_id', $this->cid())->find($id);
        if (! $s) {
            return $this->failNotFound('Sheet not found');
        }

        return $this->respond(['sheet' => $this->sheetOut($s)]);
    }

    /** POST /client/google-sheets — create/update a sheet mapping. */
    public function saveSheet()
    {
        if ($r = $this->guard()) {
            return $r;
        }
        $cid   = $this->cid();
        $id    = (int) $this->input('id');
        $model = new SheetSyncModel();
        $data  = $this->sheetPayload($cid);
        if ($data['spreadsheet_id'] === '') {
            return $this->failValidationErrors(['spreadsheet_url' => 'Enter a valid Google Sheet URL.']);
        }
        if ($id) {
            if (! $model->where('client_id', $cid)->find($id)) {
                return $this->failNotFound('Sheet not found');
            }
            $model->update($id, $data);
        } else {
            $id = (int) $model->insert($data);
        }
        $this->logActivity($id ? 'updated' : 'created', 'sheet_sync', $id, 'Google Sheet ' . $data['name'], $cid);

        return $this->respond(['message' => 'Saved', 'id' => $id]);
    }

    /** POST /client/google-sheets/(:num)/delete — soft-delete a sheet mapping. */
    public function deleteSheet(int $id)
    {
        if ($r = $this->guard()) {
            return $r;
        }
        $model = new SheetSyncModel();
        $s     = $model->where('client_id', $this->cid())->find($id);
        if (! $s) {
            return $this->failNotFound('Sheet not found');
        }
        $model->delete($id);
        $this->logActivity('deleted', 'sheet_sync', $id, 'Deleted Google Sheet ' . $s['name'], $this->cid());

        return $this->respond(['message' => 'Deleted']);
    }

    /** POST /client/google-sheets/(:num)/sync — run the sync now. */
    public function syncSheet(int $id)
    {
        if ($r = $this->guard()) {
            return $r;
        }
        $cid = $this->cid();
        $cfg = (new SheetSyncModel())->where('client_id', $cid)->find($id);
        if (! $cfg) {
            return $this->failNotFound('Sheet not found');
        }
        $saJson = $this->settingVal(self::SA_KEY);
        if ($saJson === '') {
            return $this->fail('Add your Google service-account key first.', 400);
        }
        try {
            $db    = (new TenantManager())->forClient($cid);
            $stats = GoogleSheetsSync::run($cid, $db, $cfg, $saJson);
        } catch (\Throwable $e) {
            return $this->fail($e->getMessage(), 400);
        }
        $this->logActivity('created', 'lead', null, "Google Sheet sync: {$stats['inserted']} new, {$stats['updated']} updated", $cid);

        return $this->respond(array_merge(['message' => 'Synced'], $stats));
    }

    // -------------------------------------------------------------- helpers

    /** Build a sanitized sheet_syncs row from request input. */
    private function sheetPayload(int $cid): array
    {
        $in = (array) $this->input();

        $intList = static fn ($v): array => array_values(array_unique(array_filter(array_map('intval', is_array($v) ? $v : []))));

        // Column map: sheet header → target (built-in lead key | 'status' | custom_<key>).
        $allowed = ['name', 'phone', 'alt_phone', 'email', 'city', 'state', 'description', 'status'];
        $map     = [];
        foreach ((array) ($in['column_map'] ?? []) as $header => $target) {
            $header = trim((string) $header);
            $target = trim((string) $target);
            if ($header === '' || $target === '') {
                continue;
            }
            if (in_array($target, $allowed, true) || strpos($target, 'custom_') === 0) {
                $map[$header] = $target;
            }
        }

        return [
            'client_id'            => $cid,
            'name'                 => mb_substr(trim((string) ($in['name'] ?? '')), 0, 150) ?: 'Google Sheet',
            'spreadsheet_id'       => GoogleSheetsService::extractId(trim((string) ($in['spreadsheet_url'] ?? $in['spreadsheet_id'] ?? ''))),
            'sheet_tab'            => mb_substr(trim((string) ($in['sheet_tab'] ?? '')), 0, 120),
            'header_row'           => max(1, (int) ($in['header_row'] ?? 1)),
            'column_map'           => json_encode((object) $map),
            'dedupe_field'         => in_array($in['dedupe_field'] ?? 'phone', ['phone', 'email'], true) ? $in['dedupe_field'] : 'phone',
            'source_id'            => (int) ($in['source_id'] ?? 0) ?: null,
            'status_id'            => (int) ($in['status_id'] ?? 0) ?: null,
            'lead_type_id'         => (int) ($in['lead_type_id'] ?? 0) ?: null,
            'assigned_to'          => (int) ($in['assigned_to'] ?? 0) ?: null,
            'auto_assignee'        => json_encode($intList($in['auto_assignee'] ?? [])),
            'write_back'           => array_key_exists('write_back', $in) ? (! empty($in['write_back']) ? 1 : 0) : 1,
            'status_result_column' => mb_substr(trim((string) ($in['status_result_column'] ?? 'CRM Status')), 0, 120) ?: 'CRM Status',
            'enabled'              => array_key_exists('enabled', $in) ? (! empty($in['enabled']) ? 1 : 0) : 1,
        ];
    }

    /** Shape a sheet_syncs row for the admin API (decode JSON columns). */
    private function sheetOut(array $s): array
    {
        $map = json_decode((string) ($s['column_map'] ?? '{}'), true);
        $aa  = json_decode((string) ($s['auto_assignee'] ?? '[]'), true);

        return [
            'id'                   => (int) $s['id'],
            'name'                 => $s['name'],
            'spreadsheet_id'       => $s['spreadsheet_id'],
            'spreadsheet_url'      => 'https://docs.google.com/spreadsheets/d/' . $s['spreadsheet_id'],
            'sheet_tab'            => $s['sheet_tab'],
            'header_row'           => (int) $s['header_row'],
            'column_map'           => (object) (is_array($map) ? $map : []),
            'dedupe_field'         => $s['dedupe_field'],
            'source_id'            => $s['source_id'] !== null ? (int) $s['source_id'] : null,
            'status_id'            => $s['status_id'] !== null ? (int) $s['status_id'] : null,
            'lead_type_id'         => $s['lead_type_id'] !== null ? (int) $s['lead_type_id'] : null,
            'assigned_to'          => $s['assigned_to'] !== null ? (int) $s['assigned_to'] : null,
            'auto_assignee'        => array_map('intval', is_array($aa) ? $aa : []),
            'write_back'           => (int) $s['write_back'],
            'status_result_column' => $s['status_result_column'],
            'inserted_count'       => (int) $s['inserted_count'],
            'updated_count'        => (int) $s['updated_count'],
            'skipped_count'        => (int) $s['skipped_count'],
            'last_synced_at'       => $s['last_synced_at'] ?? null,
            'enabled'              => (int) $s['enabled'],
        ];
    }
}
