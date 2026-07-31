<?php

namespace App\Controllers;

use App\Libraries\TenantManager;
use App\Libraries\WebLeadIngest;
use App\Models\ClientModel;
use App\Models\WebFormIndexModel;
use App\Models\WebFormModel;

/**
 * PUBLIC (sessionless) Web-to-Lead endpoints — the embeddable form.
 *
 * A form is addressed only by its opaque token (`/public/forms/{token}`), so the
 * token is resolved to its owning client via the main-DB `web_form_index`, then
 * the live form config is read from — and submissions are written to — that
 * client's own tenant database. Modeled on {@see CallIngest}: no login, tenant
 * selected by the request itself. CORS headers are added globally (Config\Filters).
 */
class WebFormPublic extends ApiController
{
    /**
     * GET /public/forms/{token}
     * Return only what the embedded form needs to render — never the internal
     * routing (source/status/assignee/notify) config.
     */
    public function show(string $token)
    {
        $ctx = $this->resolve($token);
        if (is_array($ctx) && isset($ctx['error'])) {
            return $ctx['error'];
        }
        [$form] = $ctx;

        return $this->respond([
            'status'          => 1,
            'name'            => $form['name'] ?? '',
            'language'        => $form['language'] ?? 'en',
            'submit_text'     => $form['submit_text'] ?: 'Submit',
            'success_message' => $form['success_message'] ?: 'Thank you! Your enquiry has been submitted.',
            'fields'          => WebLeadIngest::fields($form),
        ]);
    }

    /**
     * POST /public/forms/{token}
     * Validate + create the lead in the owning client's DB. Returns the form's
     * configured thank-you message on success.
     */
    public function submit(string $token)
    {
        $ctx = $this->resolve($token);
        if (is_array($ctx) && isset($ctx['error'])) {
            return $ctx['error'];
        }
        [$form, $cid, $db] = $ctx;

        $input = (array) $this->input();

        // Optional API-key auth for server-to-server callers (Postman/Zapier/etc.).
        // The embedded browser form sends no key and stays public; but when a key
        // IS supplied it must match the form's key — so a wrong key is rejected.
        $suppliedKey = trim((string) ($this->request->getHeaderLine('X-Api-Key') ?: ($input['api_key'] ?? '')));
        unset($input['api_key']); // never treat the key as a lead field
        if ($suppliedKey !== '' && ! hash_equals((string) ($form['api_key'] ?? ''), $suppliedKey)) {
            return $this->failUnauthorized('Invalid API key.');
        }

        // Accept each field's admin-chosen parameter name (alias → canonical key).
        $input = WebLeadIngest::normalizeInput($form, $input);

        if ($errors = WebLeadIngest::validate($form, $input)) {
            return $this->failValidationErrors($errors);
        }

        try {
            $result = WebLeadIngest::ingest($cid, $db, $form, $input);
        } catch (\Throwable $e) {
            log_message('error', 'Web-to-lead submit failed (client ' . $cid . '): ' . $e->getMessage());

            return $this->fail('Could not save your submission. Please try again.', 500);
        }

        if (($result['status'] ?? '') === 'error') {
            return $this->fail($result['message'], 500);
        }
        if (($result['status'] ?? '') === 'created') {
            $this->logActivity('created', 'lead', $result['lead_id'], 'Web lead via "' . ($form['name'] ?? 'form') . '"', $cid);
        }

        return $this->respond(['status' => 1, 'message' => $result['message']]);
    }

    /**
     * Resolve a token → [formRow, clientId, tenantDb], or ['error' => Response] on
     * any failure (unknown/disabled token, inactive workspace, missing form).
     *
     * @return array{0: array, 1: int, 2: \CodeIgniter\Database\BaseConnection}|array{error: mixed}
     */
    private function resolve(string $token)
    {
        $token = trim($token);
        if ($token === '') {
            return ['error' => $this->failNotFound('Form not found.')];
        }

        $idx = (new WebFormIndexModel())->where('token', $token)->first();
        if (! $idx || empty($idx['enabled'])) {
            return ['error' => $this->failNotFound('This form is not available.')];
        }
        $cid = (int) $idx['client_id'];

        $client = (new ClientModel())->find($cid);
        if (! $client || ! ClientModel::statusAllowsAccess($client['status'] ?? null)) {
            return ['error' => $this->fail('This form is not available.', 403)];
        }

        try {
            $db   = (new TenantManager())->forClient($cid);
            $form = (new WebFormModel($db))->where('client_id', $cid)->where('enabled', 1)->find((int) $idx['form_id']);
        } catch (\Throwable $e) {
            log_message('error', 'Web-to-lead resolve failed (client ' . $cid . '): ' . $e->getMessage());

            return ['error' => $this->fail('This form is not available.', 500)];
        }
        if (! $form) {
            return ['error' => $this->failNotFound('This form is not available.')];
        }

        return [$form, $cid, $db];
    }
}
