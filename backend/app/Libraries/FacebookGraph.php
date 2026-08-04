<?php

namespace App\Libraries;

/**
 * Thin Facebook Graph API client for the Lead Ads integration. Fully PER-PROJECT:
 * every client supplies their own Meta App ID/Secret/verify-token (stored in that
 * client's DB settings — nothing here reads `.env`). App credentials are passed
 * in per call; each client connects their own Page via OAuth and we store that
 * Page's long-lived access token.
 *
 * Stateless helpers over cURL — every call takes the token it needs. Errors are
 * surfaced as RuntimeExceptions carrying Facebook's own message so the admin UI
 * can show what went wrong. Nothing here needs a DB or session.
 */
class FacebookGraph
{
    /** Graph API version — a platform-wide constant (not a per-project secret). */
    public const GRAPH_VERSION = 'v19.0';

    public static function graphVersion(): string
    {
        return self::GRAPH_VERSION;
    }

    /** Default OAuth redirect (the deployment's own /client/facebook URL). Callers
     *  usually pass the exact browser origin; this is only the fallback. */
    public static function redirectUri(): string
    {
        return rtrim((string) base_url('client/facebook'), '/');
    }

    private static function base(): string
    {
        return 'https://graph.facebook.com/' . self::graphVersion();
    }

    /**
     * The OAuth login-dialog URL a client is sent to when connecting a Page.
     * $appId is the client's (or platform's) Meta App ID.
     */
    public static function oauthDialogUrl(string $appId, string $redirectUri, string $state): string
    {
        $params = http_build_query([
            'client_id'    => $appId,
            'redirect_uri' => $redirectUri,
            'state'        => $state,
            'response_type' => 'code',
            'scope'        => 'pages_show_list,leads_retrieval,pages_manage_metadata,pages_read_engagement,business_management',
        ]);

        return 'https://www.facebook.com/' . self::graphVersion() . '/dialog/oauth?' . $params;
    }

    /** Exchange an OAuth `code` for a (short-lived) user access token. */
    public static function exchangeCode(string $appId, string $appSecret, string $redirectUri, string $code): string
    {
        $res = self::get('/oauth/access_token', [
            'client_id'     => $appId,
            'client_secret' => $appSecret,
            'redirect_uri'  => $redirectUri,
            'code'          => $code,
        ]);

        return (string) ($res['access_token'] ?? '');
    }

    /** Upgrade a short-lived user token to a long-lived one (~60 days). */
    public static function longLivedUserToken(string $appId, string $appSecret, string $shortToken): string
    {
        $res = self::get('/oauth/access_token', [
            'grant_type'        => 'fb_exchange_token',
            'client_id'         => $appId,
            'client_secret'     => $appSecret,
            'fb_exchange_token' => $shortToken,
        ]);

        return (string) ($res['access_token'] ?? $shortToken);
    }

    /**
     * The Pages this user manages, each with its own (long-lived, when the user
     * token is long-lived) Page access token.
     *
     * @return array<int, array{id:string, name:string, access_token:string}>
     */
    public static function listPages(string $userToken): array
    {
        $out  = [];
        $res  = self::get('/me/accounts', ['fields' => 'id,name,access_token', 'limit' => 100, 'access_token' => $userToken]);
        foreach ((array) ($res['data'] ?? []) as $p) {
            $out[] = ['id' => (string) ($p['id'] ?? ''), 'name' => (string) ($p['name'] ?? ''), 'access_token' => (string) ($p['access_token'] ?? '')];
        }

        return $out;
    }

    /** Subscribe the app to this Page's `leadgen` webhook field (needed for real-time). */
    public static function subscribePageToApp(string $pageId, string $pageToken): bool
    {
        $res = self::post('/' . $pageId . '/subscribed_apps', ['subscribed_fields' => 'leadgen', 'access_token' => $pageToken]);

        return ! empty($res['success']);
    }

    /**
     * The lead forms on a Page.
     *
     * @return array<int, array{id:string, name:string, status:string}>
     */
    public static function listForms(string $pageId, string $pageToken): array
    {
        $out = [];
        $res = self::get('/' . $pageId . '/leadgen_forms', ['fields' => 'id,name,status', 'limit' => 200, 'access_token' => $pageToken]);
        foreach ((array) ($res['data'] ?? []) as $f) {
            $out[] = ['id' => (string) ($f['id'] ?? ''), 'name' => (string) ($f['name'] ?? ''), 'status' => (string) ($f['status'] ?? '')];
        }

        return $out;
    }

    /**
     * A single lead's data by leadgen id (used by the real-time webhook).
     *
     * @return array{id:string, created_time:string, field_data:array, form_id:string}
     */
    public static function getLead(string $leadgenId, string $pageToken): array
    {
        $res = self::get('/' . $leadgenId, ['fields' => 'id,created_time,field_data,form_id', 'access_token' => $pageToken]);

        return [
            'id'           => (string) ($res['id'] ?? $leadgenId),
            'created_time' => (string) ($res['created_time'] ?? ''),
            'field_data'   => (array) ($res['field_data'] ?? []),
            'form_id'      => (string) ($res['form_id'] ?? ''),
        ];
    }

    /**
     * Leads submitted to a form since $sinceUnix (used by the polling cron).
     *
     * @return array<int, array{id:string, created_time:string, field_data:array}>
     */
    public static function getFormLeads(string $formId, string $pageToken, int $sinceUnix = 0): array
    {
        $params = ['fields' => 'id,created_time,field_data', 'limit' => 200, 'access_token' => $pageToken];
        if ($sinceUnix > 0) {
            $params['filtering'] = json_encode([['field' => 'time_created', 'operator' => 'GREATER_THAN', 'value' => $sinceUnix]]);
        }
        $res = self::get('/' . $formId . '/leads', $params);

        $out = [];
        foreach ((array) ($res['data'] ?? []) as $l) {
            $out[] = ['id' => (string) ($l['id'] ?? ''), 'created_time' => (string) ($l['created_time'] ?? ''), 'field_data' => (array) ($l['field_data'] ?? [])];
        }

        return $out;
    }

    // ------------------------------------------------------------------ HTTP

    /** @param array<string,mixed> $params */
    private static function get(string $path, array $params): array
    {
        return self::request('GET', $path, $params);
    }

    /** @param array<string,mixed> $params */
    private static function post(string $path, array $params): array
    {
        return self::request('POST', $path, $params);
    }

    /**
     * Issue a Graph request and return the decoded JSON, throwing FB's own error
     * message on any API/transport failure.
     *
     * @param array<string,mixed> $params
     */
    private static function request(string $method, string $path, array $params): array
    {
        $url = self::base() . $path;
        $ch  = curl_init();
        if ($method === 'GET') {
            $url .= '?' . http_build_query($params);
            curl_setopt($ch, CURLOPT_URL, $url);
        } else {
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($params));
        }
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 20);
        $body = curl_exec($ch);
        $err  = curl_error($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($body === false) {
            throw new \RuntimeException('Could not reach Facebook: ' . ($err ?: 'network error'));
        }
        $data = json_decode((string) $body, true);
        if (! is_array($data)) {
            throw new \RuntimeException('Unexpected response from Facebook.');
        }
        if (isset($data['error'])) {
            throw new \RuntimeException((string) ($data['error']['message'] ?? 'Facebook API error') . ' (code ' . ($data['error']['code'] ?? $code) . ')');
        }

        return $data;
    }
}
