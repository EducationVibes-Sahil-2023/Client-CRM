<?php

namespace App\Libraries;

use App\Models\AppSettingModel;

/**
 * Talks to the Google Calendar API v3 using a Google Cloud **service account**
 * (server-to-server, no interactive OAuth). The super admin pastes the service
 * account JSON key and a target calendar ID in the admin panel; both are stored
 * in `app_settings` (keys: google_service_account, google_calendar_id,
 * google_calendar_timezone).
 *
 * Setup the admin must do once:
 *   1. Create a Google Cloud project and enable the Google Calendar API.
 *   2. Create a service account and download its JSON key.
 *   3. Share the target Google Calendar with the service account's email
 *      (Calendar settings → Share with specific people → "Make changes to events").
 *   4. Paste the JSON key + the calendar ID here.
 *
 * Auth is a signed JWT (RS256) exchanged for a short-lived access token; only
 * PHP's openssl + curl extensions are required — no Composer packages.
 */
class GoogleCalendarService
{
    private const TOKEN_URL = 'https://oauth2.googleapis.com/token';
    private const API_BASE  = 'https://www.googleapis.com/calendar/v3';
    private const SCOPE     = 'https://www.googleapis.com/auth/calendar';

    /** @var array<string,mixed>|null Decoded service account key. */
    private ?array $serviceAccount = null;
    private string $calendarId;
    private string $timezone;
    private ?string $token = null;

    /**
     * @param array{service_account?:?string, calendar_id?:?string}|null $override
     *        Used by the "test connection" action to try values before saving.
     */
    public function __construct(?array $override = null)
    {
        $saved = $this->loadSettings();

        $rawSa = $override['service_account'] ?? $saved['service_account'] ?? '';
        if (is_string($rawSa) && trim($rawSa) !== '') {
            $decoded = json_decode($rawSa, true);
            if (is_array($decoded) && ! empty($decoded['client_email']) && ! empty($decoded['private_key'])) {
                $this->serviceAccount = $decoded;
            }
        }

        $this->calendarId = trim((string) ($override['calendar_id'] ?? $saved['calendar_id'] ?? ''));
        $this->timezone   = trim((string) ($saved['timezone'] ?? '')) ?: date_default_timezone_get();
    }

    /** Read saved settings, tolerating a missing table (pre-migration). */
    private function loadSettings(): array
    {
        try {
            $map = (new AppSettingModel())->getMap();

            return [
                'service_account' => $map['google_service_account'] ?? null,
                'calendar_id'     => $map['google_calendar_id'] ?? null,
                'timezone'        => $map['google_calendar_timezone'] ?? null,
            ];
        } catch (\Throwable $e) {
            return [];
        }
    }

    /** True once a valid service account key and a calendar ID are present. */
    public function isConfigured(): bool
    {
        return $this->serviceAccount !== null && $this->calendarId !== '';
    }

    /** The service account email the admin must share their calendar with. */
    public function getServiceAccountEmail(): ?string
    {
        return $this->serviceAccount['client_email'] ?? null;
    }

    /** Confirm access by reading the calendar's metadata. */
    public function ping(): array
    {
        $data = $this->api('GET', '/calendars/' . rawurlencode($this->calendarId));

        return ['summary' => $data['summary'] ?? $this->calendarId];
    }

    /**
     * Single, expanded (recurring → instances) events between two RFC3339 times,
     * mapped to this app's event shape.
     *
     * @return array<int, array<string, mixed>>
     */
    public function listEvents(string $timeMin, string $timeMax, int $max = 250): array
    {
        $data = $this->api('GET', '/calendars/' . rawurlencode($this->calendarId) . '/events', [
            'timeMin'      => $timeMin,
            'timeMax'      => $timeMax,
            'singleEvents' => 'true',
            'orderBy'      => 'startTime',
            'maxResults'   => $max,
        ]);

        $out = [];
        foreach ($data['items'] ?? [] as $e) {
            if (($e['status'] ?? '') === 'cancelled') {
                continue;
            }
            $out[] = $this->mapEvent($e);
        }

        return $out;
    }

    /**
     * Create an event ("meeting") on the calendar.
     *
     * @param array{title:string, description?:?string, date:string, start_time?:string,
     *              end_time?:string, location?:?string, attendees?:array<int,string>,
     *              with_meet?:bool} $opts
     * @return array<string, mixed> the created event, mapped to this app's shape
     */
    public function insertEvent(array $opts): array
    {
        $date = $opts['date'];
        $body = ['summary' => $opts['title']];

        if (! empty($opts['description'])) {
            $body['description'] = $opts['description'];
        }
        if (! empty($opts['location'])) {
            $body['location'] = $opts['location'];
        }

        $startTime = trim((string) ($opts['start_time'] ?? ''));
        if ($startTime !== '') {
            $endTime = trim((string) ($opts['end_time'] ?? '')) ?: $this->plusHour($startTime);
            $body['start'] = ['dateTime' => $this->rfc3339($date, $startTime), 'timeZone' => $this->timezone];
            $body['end']   = ['dateTime' => $this->rfc3339($date, $endTime), 'timeZone' => $this->timezone];
        } else {
            // All-day event: end date is exclusive, so it must be the next day.
            $body['start'] = ['date' => $date];
            $body['end']   = ['date' => date('Y-m-d', strtotime($date . ' +1 day'))];
        }

        if (! empty($opts['attendees'])) {
            $body['attendees'] = array_map(static fn ($em) => ['email' => $em], $opts['attendees']);
        }

        $query = [];
        if (! empty($opts['with_meet'])) {
            $body['conferenceData'] = [
                'createRequest' => [
                    'requestId'             => bin2hex(random_bytes(8)),
                    'conferenceSolutionKey' => ['type' => 'hangoutsMeet'],
                ],
            ];
            $query['conferenceDataVersion'] = 1;
        }

        $created = $this->api('POST', '/calendars/' . rawurlencode($this->calendarId) . '/events', $query, $body);

        return $this->mapEvent($created);
    }

    // ---------------------------------------------------------------- internals

    /** Map a raw Google event to the {id,title,event_date,start_time,…} shape. */
    private function mapEvent(array $e): array
    {
        $start  = $e['start'] ?? [];
        $end    = $e['end'] ?? [];
        $allDay = isset($start['date']);

        if ($allDay) {
            $date      = (string) $start['date'];
            $startTime = null;
            $endTime   = null;
        } else {
            $dt        = (string) ($start['dateTime'] ?? '');
            $date      = substr($dt, 0, 10);
            $startTime = $dt !== '' ? date('H:i', strtotime($dt)) : null;
            $endTime   = isset($end['dateTime']) ? date('H:i', strtotime((string) $end['dateTime'])) : null;
        }

        $attendees = [];
        foreach ($e['attendees'] ?? [] as $a) {
            if (! empty($a['email'])) {
                $attendees[] = $a['email'];
            }
        }

        return [
            'id'          => (string) ($e['id'] ?? ''),
            'title'       => $e['summary'] ?? '(no title)',
            'description' => $e['description'] ?? null,
            'event_date'  => $date,
            'start_time'  => $startTime,
            'end_time'    => $endTime,
            'all_day'     => $allDay,
            'location'    => $e['location'] ?? null,
            'html_link'   => $e['htmlLink'] ?? null,
            'meet_link'   => $e['hangoutLink'] ?? null,
            'attendees'   => $attendees,
            'organizer'   => $e['organizer']['email'] ?? null,
            'source'      => 'google',
        ];
    }

    /** "HH:MM" + 1 hour, wrapping at 23:59. */
    private function plusHour(string $time): string
    {
        [$h, $m] = array_pad(array_map('intval', explode(':', $time)), 2, 0);

        return sprintf('%02d:%02d', min(23, $h + 1), $m);
    }

    /** Local date+time → RFC3339 without offset (the timeZone field carries it). */
    private function rfc3339(string $date, string $time): string
    {
        return $date . 'T' . substr($time . ':00', 0, 8);
    }

    /** Lazily build and cache an access token from the signed JWT assertion. */
    private function accessToken(): string
    {
        if ($this->token !== null) {
            return $this->token;
        }

        if ($this->serviceAccount === null) {
            throw new \RuntimeException('Google Calendar is not configured.');
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

        [$status, $json] = $this->httpPost(self::TOKEN_URL, http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion'  => $jwt,
        ]), ['Content-Type: application/x-www-form-urlencoded']);

        if ($status >= 400 || empty($json['access_token'])) {
            $msg = $json['error_description'] ?? $json['error'] ?? ('HTTP ' . $status);
            throw new \RuntimeException('Google rejected the service account credentials: ' . $msg);
        }

        return $this->token = (string) $json['access_token'];
    }

    /**
     * Call the Calendar API with a bearer token.
     *
     * @return array<string,mixed>
     */
    private function api(string $method, string $path, array $query = [], ?array $body = null): array
    {
        $url = self::API_BASE . $path;
        if ($query) {
            $url .= '?' . http_build_query($query);
        }

        $headers = ['Authorization: Bearer ' . $this->accessToken()];
        $payload = null;
        if ($body !== null) {
            $payload    = json_encode($body);
            $headers[]  = 'Content-Type: application/json';
        }

        [$status, $json] = $this->http($method, $url, $payload, $headers);

        if ($status >= 400) {
            $msg = $json['error']['message'] ?? ('Calendar API error (HTTP ' . $status . ')');
            throw new \RuntimeException($msg);
        }

        return $json;
    }

    /** @return array{0:int,1:array<string,mixed>} [statusCode, decodedJson] */
    private function httpPost(string $url, string $body, array $headers): array
    {
        return $this->http('POST', $url, $body, $headers);
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
            CURLOPT_TIMEOUT        => 20,
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
