<?php

/**
 * Drop-in helper for ANOTHER PHP project (your dialer / IVR / backend) to push a
 * single call into the CRM's call-tracking API — POST /calls/ingest.
 *
 * No framework or dependencies: just PHP with cURL. Copy this file (or the
 * function) into your project.
 *
 * Auth: pass the workspace's call API key (CRM → Call Tracker → Connect app).
 * The key both authenticates the request and routes the call to the right
 * client's database.
 *
 * Duplicates are safe: re-sending the same call (same contact + staff_contact +
 * call_start + calling_sim) is rejected by the server — the result's `skipped`
 * will be 1 instead of `inserted` 1. So retries won't create duplicate rows.
 */

/**
 * Send one call's details to the CRM.
 *
 * @param string $endpoint Full URL of the ingest endpoint, e.g.
 *                         "https://client.educationvibes.in/api/calls/ingest"
 *                         (local dev: "http://localhost:8080/calls/ingest").
 * @param string $apiKey   The client's call API key.
 * @param array  $call     One call's fields:
 *   Required:
 *     - contact        string  the lead's phone number (any format; last 10 digits used)
 *     - staff_contact  string  the agent's phone number (matches a staff member)
 *     - type           string  "incoming" | "outgoing" | "missed"
 *     - source         string  "ivr" | "phone"
 *     - status         string  free text, e.g. "ANSWERED", "MISSED", "Busy"
 *     - duration       int     seconds (0 or more; connected = duration > 0)
 *     - call_start     string  "YYYY-MM-DD HH:MM:SS" (IST) or a UNIX timestamp
 *     - call_end       string  same formats as call_start
 *   Optional (SIM tracking):
 *     - sim1, sim2     string  the device's SIM numbers/identifiers
 *     - calling_sim    string  which SIM placed the call ("sim1"/"sim2" or number)
 *     - sim_status     string  SIM/network status
 *     - calling_date   string  the call's date "YYYY-MM-DD" (defaults to call_start's date)
 * @param int    $timeout Seconds to wait before giving up (default 15).
 *
 * @return array {
 *   ok:       bool    true when the request succeeded (HTTP 2xx),
 *   status:   int     HTTP status code (0 on a connection/cURL error),
 *   inserted: int     rows stored (1 on success, 0 if it was a duplicate),
 *   skipped:  int     duplicates rejected (1 if this call already existed),
 *   message:  string  human-readable message from the API,
 *   error:    ?string non-null when something went wrong (network or validation),
 *   raw:      mixed   the decoded response body (for debugging),
 * }
 */
function sendCallData(string $endpoint, string $apiKey, array $call, int $timeout = 15): array
{
    $fail = static function (int $status, string $error, $raw = null): array {
        return ['ok' => false, 'status' => $status, 'inserted' => 0, 'skipped' => 0, 'message' => $error, 'error' => $error, 'raw' => $raw];
    };

    if ($endpoint === '' || $apiKey === '') {
        return $fail(0, 'endpoint and apiKey are required.');
    }

    // The API accepts a batch; we send an array of one.
    $payload = json_encode(['calls' => [$call]]);
    if ($payload === false) {
        return $fail(0, 'Could not JSON-encode the call: ' . json_last_error_msg());
    }

    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => $timeout,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'Accept: application/json',
            'X-API-Key: ' . $apiKey,
        ],
    ]);

    $body   = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $cerr   = curl_error($ch);
    curl_close($ch);

    if ($body === false) {
        return $fail(0, 'Request failed: ' . ($cerr ?: 'unknown cURL error'));
    }

    $data = json_decode((string) $body, true);
    if (! is_array($data)) {
        return $fail($status, 'Unexpected (non-JSON) response.', $body);
    }

    if ($status < 200 || $status >= 300) {
        // The API returns { messages: { error: "..." } } or { message: "..." }.
        $msg = $data['messages']['error'] ?? ($data['message'] ?? "Request failed (HTTP {$status}).");

        return $fail($status, (string) $msg, $data);
    }

    return [
        'ok'       => true,
        'status'   => $status,
        'inserted' => (int) ($data['inserted'] ?? 0),
        'skipped'  => (int) ($data['skipped'] ?? 0),
        'message'  => (string) ($data['message'] ?? 'OK'),
        'error'    => null,
        'raw'      => $data,
    ];
}

// ---------------------------------------------------------------------------
// Example usage (run this file directly: `php send_call_data.php`).
// Remove or guard this block when copying the function into your project.
// ---------------------------------------------------------------------------
if (PHP_SAPI === 'cli' && isset($argv[0]) && realpath($argv[0]) === realpath(__FILE__)) {
    $endpoint = getenv('CRM_CALLS_ENDPOINT') ?: 'http://localhost:8080/calls/ingest';
    $apiKey   = getenv('CRM_CALLS_API_KEY') ?: 'YOUR_API_KEY';

    $result = sendCallData($endpoint, $apiKey, [
        'contact'       => '9876543210',
        'staff_contact' => '9000000000',
        'type'          => 'outgoing',
        'source'        => 'phone',
        'status'        => 'ANSWERED',
        'duration'      => 87,
        'call_start'    => '2026-07-02 10:15:00',
        'call_end'      => '2026-07-02 10:16:27',
        // Optional SIM tracking:
        'sim1'          => '9111111111',
        'sim2'          => '9222222222',
        'calling_sim'   => 'sim1',
        'sim_status'    => 'active',
        'calling_date'  => '2026-07-02',
    ]);

    if ($result['ok']) {
        echo "OK — inserted {$result['inserted']}, skipped {$result['skipped']} ({$result['message']})\n";
    } else {
        echo "FAILED (HTTP {$result['status']}) — {$result['error']}\n";
    }
}
