<?php

namespace App\Libraries;

/**
 * Reads and writes a Google Sheet via the Sheets API v4 using a Google Cloud
 * **service account** (server-to-server, no interactive OAuth) — the same auth
 * mechanism as {@see GoogleCalendarService}: a signed JWT (RS256) exchanged for a
 * short-lived access token, using only PHP's openssl + cURL (no Composer packages).
 *
 * Per-client: the client admin pastes their own service-account JSON in the
 * Google Sheets module, then shares the target Sheet with the service account's
 * email (Viewer to read, Editor if write-back of the "CRM Status" column is on).
 */
class GoogleSheetsService
{
    private const TOKEN_URL = 'https://oauth2.googleapis.com/token';
    private const API_BASE  = 'https://sheets.googleapis.com/v4/spreadsheets';
    private const SCOPE     = 'https://www.googleapis.com/auth/spreadsheets';

    /** @var array<string,mixed>|null Decoded service account key. */
    private ?array $serviceAccount = null;
    private ?string $token = null;

    public function __construct(?string $serviceAccountJson)
    {
        if (is_string($serviceAccountJson) && trim($serviceAccountJson) !== '') {
            $decoded = json_decode($serviceAccountJson, true);
            if (is_array($decoded) && ! empty($decoded['client_email']) && ! empty($decoded['private_key'])) {
                $this->serviceAccount = $decoded;
            }
        }
    }

    public function isConfigured(): bool
    {
        return $this->serviceAccount !== null;
    }

    /** The service account's email — the admin shares their Sheet with this address. */
    public function serviceAccountEmail(): string
    {
        return (string) ($this->serviceAccount['client_email'] ?? '');
    }

    /** Extract a spreadsheet id from a full Google Sheets URL (or return the id as-is). */
    public static function extractId(string $urlOrId): string
    {
        if (preg_match('#/spreadsheets/d/([a-zA-Z0-9-_]+)#', $urlOrId, $m)) {
            return $m[1];
        }

        return trim($urlOrId);
    }

    /**
     * The tab titles in a spreadsheet (for the mapping UI's tab picker).
     *
     * @return array<int, string>
     */
    public function tabs(string $spreadsheetId): array
    {
        $res = $this->api('GET', '/' . rawurlencode($spreadsheetId), ['fields' => 'sheets.properties.title']);
        $out = [];
        foreach ((array) ($res['sheets'] ?? []) as $s) {
            $t = (string) ($s['properties']['title'] ?? '');
            if ($t !== '') {
                $out[] = $t;
            }
        }

        return $out;
    }

    /**
     * Read a rectangular block of cell values (rows of strings).
     *
     * @return array<int, array<int, string>>
     */
    public function getValues(string $spreadsheetId, string $range): array
    {
        $res  = $this->api('GET', '/' . rawurlencode($spreadsheetId) . '/values/' . rawurlencode($range), ['majorDimension' => 'ROWS']);
        $rows = [];
        foreach ((array) ($res['values'] ?? []) as $r) {
            $rows[] = array_map(static fn ($c) => (string) $c, (array) $r);
        }

        return $rows;
    }

    /**
     * Write a block of values (RAW) to a range — used for the "CRM Status" column
     * write-back.
     *
     * @param array<int, array<int, string>> $values
     */
    public function updateValues(string $spreadsheetId, string $range, array $values): void
    {
        $this->api('PUT', '/' . rawurlencode($spreadsheetId) . '/values/' . rawurlencode($range), ['valueInputOption' => 'RAW'], ['range' => $range, 'majorDimension' => 'ROWS', 'values' => $values]);
    }

    /** Convert a 0-based column index to an A1 column letter (0→A, 26→AA). */
    public static function colLetter(int $index): string
    {
        $s = '';
        $n = $index + 1;
        while ($n > 0) {
            $r = ($n - 1) % 26;
            $s = chr(65 + $r) . $s;
            $n = intdiv($n - 1, 26);
        }

        return $s;
    }

    // ------------------------------------------------------------------ HTTP

    /** @return array<string,mixed> */
    private function api(string $method, string $path, array $query = [], ?array $body = null): array
    {
        $url = self::API_BASE . $path;
        if ($query) {
            $url .= '?' . http_build_query($query);
        }
        $headers = ['Authorization: Bearer ' . $this->accessToken()];
        $payload = null;
        if ($body !== null) {
            $payload   = json_encode($body);
            $headers[] = 'Content-Type: application/json';
        }
        [$status, $json] = $this->http($method, $url, $payload, $headers);
        if ($status >= 400) {
            $msg = $json['error']['message'] ?? ('Google Sheets API error (HTTP ' . $status . ')');
            throw new \RuntimeException($msg);
        }

        return $json;
    }

    /** Lazily build + cache an access token from the signed JWT assertion. */
    private function accessToken(): string
    {
        if ($this->token !== null) {
            return $this->token;
        }
        if ($this->serviceAccount === null) {
            throw new \RuntimeException('Google Sheets is not configured — add a service-account key.');
        }
        $now    = time();
        $header = $this->b64url(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
        $claim  = $this->b64url(json_encode([
            'iss'   => $this->serviceAccount['client_email'],
            'scope' => self::SCOPE,
            'aud'   => self::TOKEN_URL,
            'iat'   => $now,
            'exp'   => $now + 3600,
        ]));
        $signature = '';
        if (! openssl_sign($header . '.' . $claim, $signature, $this->serviceAccount['private_key'], OPENSSL_ALGO_SHA256)) {
            throw new \RuntimeException('Could not sign the token request — the service account private key looks invalid.');
        }
        $jwt = $header . '.' . $claim . '.' . $this->b64url($signature);

        [$status, $json] = $this->http('POST', self::TOKEN_URL, http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion'  => $jwt,
        ]), ['Content-Type: application/x-www-form-urlencoded']);

        if ($status >= 400 || empty($json['access_token'])) {
            $msg = $json['error_description'] ?? $json['error'] ?? ('HTTP ' . $status);
            throw new \RuntimeException('Google rejected the service account credentials: ' . $msg);
        }

        return $this->token = (string) $json['access_token'];
    }

    /** @return array{0:int,1:array<string,mixed>} [statusCode, decodedJson] */
    private function http(string $method, string $url, ?string $body, array $headers): array
    {
        if (! function_exists('curl_init')) {
            throw new \RuntimeException('The PHP cURL extension is not enabled on the server.');
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_CONNECTTIMEOUT => 10,
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $res = curl_exec($ch);
        if ($res === false) {
            $err = curl_error($ch);
            curl_close($ch);
            throw new \RuntimeException('Network error reaching Google: ' . $err);
        }
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        $json = json_decode((string) $res, true);

        return [$status, is_array($json) ? $json : []];
    }

    /** URL-safe base64 without padding (JWT encoding). */
    private function b64url(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
}
