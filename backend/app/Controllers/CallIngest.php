<?php

namespace App\Controllers;

use App\Libraries\CallIngestService;
use App\Libraries\TenantManager;
use App\Models\ClientModel;

/**
 * Public call-log ingest for an external calling app (IVR / device dialer).
 *
 * Unlike POST /client/call-logs (which needs a staff login session), this
 * endpoint authenticates with a stable per-client API key, so an unattended
 * device or server can post calls without logging in. The key both authenticates
 * the request and selects which client's database the calls are stored in.
 */
class CallIngest extends ApiController
{
    /**
     * POST /calls/ingest
     *
     * Auth: send the client's key as `X-API-Key: <key>`, `Authorization: Bearer
     * <key>`, or an `api_key` field. Body is the same call payload accepted by
     * /client/call-logs (clean `{ calls: [...] }` or legacy `call_data`).
     */
    public function store()
    {
        $key = $this->apiKey();
        if ($key === '') {
            return $this->failUnauthorized('Missing API key.');
        }

        $client = (new ClientModel())->where('call_api_key', $key)->first();
        if (! $client) {
            return $this->failUnauthorized('Invalid API key.');
        }
        if (! ClientModel::statusAllowsAccess($client['status'] ?? null)) {
            return $this->fail('This workspace is not active.', 403);
        }
        $cid = (int) $client['id'];

        $rows = CallIngestService::parse((array) $this->input(), $this->request->getPost('call_data'));
        if ($rows === null) {
            return $this->failValidationErrors('No call data provided.');
        }
        if (! $rows) {
            return $this->respond(['status' => 1, 'message' => 'No calls to import.', 'inserted' => 0]);
        }

        // Public API contract: every field of every call is mandatory.
        if ($problem = CallIngestService::validate($rows)) {
            return $this->failValidationErrors($problem);
        }

        try {
            $db       = (new TenantManager())->forClient($cid);
            $inserted = CallIngestService::ingest($cid, $db, $rows, null);
        } catch (\Throwable $e) {
            log_message('error', 'Call ingest failed for client ' . $cid . ': ' . $e->getMessage());

            return $this->fail('Could not store calls.', 500);
        }

        $this->logActivity('created', 'calls', null, "Ingested {$inserted} call log(s) via API", $cid);

        return $this->respond(['status' => 1, 'message' => 'Call data saved.', 'inserted' => $inserted]);
    }

    /** Pull the API key from the X-API-Key header, a Bearer token, then the body/query. */
    private function apiKey(): string
    {
        $header = trim($this->request->getHeaderLine('X-API-Key'));
        if ($header !== '') {
            return $header;
        }

        $auth = trim($this->request->getHeaderLine('Authorization'));
        if (stripos($auth, 'Bearer ') === 0) {
            return trim(substr($auth, 7));
        }

        return trim((string) ($this->input('api_key') ?? $this->request->getGet('api_key') ?? ''));
    }
}
