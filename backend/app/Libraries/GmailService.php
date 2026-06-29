<?php

namespace App\Libraries;

use App\Models\AppSettingModel;

/**
 * Reads a Gmail mailbox over IMAP using an App Password.
 *
 * Credentials are managed from the admin panel and stored in the `app_settings`
 * table (keys: gmail_user, gmail_app_password, gmail_mailbox). The .env keys
 * gmail.user / gmail.appPassword / gmail.mailbox are used only as a fallback.
 *
 * Every public call opens its own connection and closes it in a finally block,
 * so a failure never leaks an IMAP stream.
 */
class GmailService
{
    public const DEFAULT_MAILBOX = '{imap.gmail.com:993/imap/ssl}INBOX';

    private string $mailbox;
    private string $user;
    private string $pass;

    public function __construct(?array $override = null)
    {
        // Saved settings take priority; fall back to .env, then sensible defaults.
        // An explicit $override (used by the "test connection" action) wins over both.
        $saved = $override ?? $this->loadSettings();

        $this->user    = trim((string) ($saved['gmail_user'] ?? env('gmail.user', '')));
        // App passwords are shown with spaces for readability; IMAP wants them stripped.
        $this->pass    = str_replace(' ', '', (string) ($saved['gmail_app_password'] ?? env('gmail.appPassword', '')));
        $mailbox       = trim((string) ($saved['gmail_mailbox'] ?? env('gmail.mailbox', '')));
        $this->mailbox = $mailbox !== '' ? $mailbox : self::DEFAULT_MAILBOX;
    }

    /** Read the saved Gmail settings, tolerating a missing table (pre-migration). */
    private function loadSettings(): array
    {
        try {
            $map = (new AppSettingModel())->getMap();

            return [
                'gmail_user'         => $map['gmail_user'] ?? null,
                'gmail_app_password' => $map['gmail_app_password'] ?? null,
                'gmail_mailbox'      => $map['gmail_mailbox'] ?? null,
            ];
        } catch (\Throwable $e) {
            return [];
        }
    }

    /** True once an account + app password are present in the environment. */
    public function isConfigured(): bool
    {
        return $this->user !== '' && $this->pass !== '';
    }

    /**
     * One page of messages, newest first.
     *
     * @return array{rows: array<int, array<string, mixed>>, total: int}
     */
    public function listMessages(int $page, int $perPage, string $q = ''): array
    {
        $imap = $this->connect();

        try {
            $criteria = 'ALL';
            if ($q !== '') {
                // Quote-strip so the search string can't break out of the criteria.
                $criteria = 'TEXT "' . str_replace('"', '', $q) . '"';
            }

            $uids = imap_search($imap, $criteria, SE_UID) ?: [];
            rsort($uids); // newest UID first

            $total = count($uids);
            $slice = array_slice($uids, ($page - 1) * $perPage, $perPage);

            $rows = [];
            foreach ($slice as $uid) {
                $rows[] = $this->summary($imap, (int) $uid);
            }

            return ['rows' => $rows, 'total' => $total];
        } finally {
            imap_close($imap);
        }
    }

    /**
     * Full message (HTML + plain text). Marks the message as read.
     *
     * @return array<string, mixed>|null
     */
    public function getMessage(int $uid): ?array
    {
        $imap = $this->connect();

        try {
            $overview = imap_fetch_overview($imap, (string) $uid, FT_UID);
            $o        = $overview[0] ?? null;
            if (! $o) {
                return null;
            }

            [$name, $email]  = $this->parseAddress($o->from ?? '');
            $structure       = imap_fetchstructure($imap, $uid, FT_UID);
            [$html, $text]   = $this->extractBody($imap, $uid, $structure);

            // Opening a message marks it read, like a real mail client.
            imap_setflag_full($imap, (string) $uid, '\\Seen', ST_UID);

            return [
                'uid'     => $uid,
                'name'    => $name,
                'email'   => $email,
                'to'      => isset($o->to) ? $this->decodeMime($o->to) : '',
                'subject' => $this->cleanSubject($o->subject ?? ''),
                'date'    => isset($o->udate) ? date('Y-m-d H:i:s', $o->udate) : '',
                'html'    => $html,
                'text'    => $text,
            ];
        } finally {
            imap_close($imap);
        }
    }

    // ---------------------------------------------------------------- internals

    /** @return \IMAP\Connection|resource */
    private function connect()
    {
        if (! function_exists('imap_open')) {
            throw new \RuntimeException('The PHP IMAP extension is not enabled on the server.');
        }

        $imap = @imap_open($this->mailbox, $this->user, $this->pass, 0, 1);
        if ($imap === false) {
            $err = imap_last_error() ?: 'check the Gmail address and App Password.';
            imap_errors(); // drain so the error doesn't surface on a later call
            throw new \RuntimeException('Could not connect to Gmail: ' . $err);
        }

        return $imap;
    }

    /** Lightweight row for the message list (sender, subject, snippet, flags). */
    private function summary($imap, int $uid): array
    {
        $overview      = imap_fetch_overview($imap, (string) $uid, FT_UID);
        $o             = $overview[0] ?? null;
        [$name, $email] = $this->parseAddress($o->from ?? '');
        $structure     = imap_fetchstructure($imap, $uid, FT_UID);
        [$html, $text] = $this->extractBody($imap, $uid, $structure);

        return [
            'uid'     => $uid,
            'name'    => $name,
            'email'   => $email,
            'subject' => $this->cleanSubject($o->subject ?? ''),
            'snippet' => $this->snippet($html, $text),
            'date'    => isset($o->udate) ? date('Y-m-d H:i:s', $o->udate) : '',
            'seen'    => ! empty($o->seen),
        ];
    }

    /** Parse an RFC822 "From" into [displayName, email]. */
    private function parseAddress(string $raw): array
    {
        $raw  = $this->decodeMime($raw);
        $list = imap_rfc822_parse_adrlist($raw, 'gmail.com');

        if (! empty($list)) {
            $a     = $list[0];
            $email = ($a->mailbox ?? '') . '@' . ($a->host ?? '');
            $name  = trim((string) ($a->personal ?? ''));

            return [$name !== '' ? $this->decodeMime($name) : $email, $email];
        }

        return [$raw, $raw];
    }

    /** Decode MIME-encoded header words (=?UTF-8?…?=) to a UTF-8 string. */
    private function decodeMime(string $s): string
    {
        $out = '';
        foreach (imap_mime_header_decode($s) as $part) {
            $charset = $part->charset === 'default' ? 'UTF-8' : $part->charset;
            $piece   = @iconv($charset, 'UTF-8//TRANSLIT', $part->text);
            $out    .= $piece !== false ? $piece : $part->text;
        }

        return trim($out);
    }

    private function cleanSubject($subject): string
    {
        $s = $this->decodeMime((string) $subject);

        return $s !== '' ? $s : '(no subject)';
    }

    /** Build a one-line preview from the HTML/plain body. */
    private function snippet(string $html, string $text): string
    {
        $src = $text !== '' ? $text : strip_tags($html);
        $src = preg_replace('/\s+/', ' ', (string) $src);

        return trim(mb_substr((string) $src, 0, 160));
    }

    /**
     * Walk the MIME structure and return [html, text] bodies.
     *
     * @return array{0:string,1:string}
     */
    private function extractBody($imap, int $uid, $structure): array
    {
        $html = '';
        $text = '';

        if (! $structure) {
            return [$html, $text];
        }

        // Single-part message: the whole body is the content.
        if (empty($structure->parts)) {
            $body    = imap_body($imap, $uid, FT_UID | FT_PEEK);
            $body    = $this->decodeContent($body, (int) ($structure->encoding ?? 0));
            $body    = $this->toUtf8($body, $structure);
            $subtype = strtoupper((string) ($structure->subtype ?? 'PLAIN'));

            if ($subtype === 'HTML') {
                $html = $body;
            } else {
                $text = $body;
            }

            return [$html, $text];
        }

        $this->walkParts($imap, $uid, $structure->parts, '', $html, $text);

        return [$html, $text];
    }

    private function walkParts($imap, int $uid, array $parts, string $prefix, string &$html, string &$text): void
    {
        foreach ($parts as $i => $part) {
            $section = $prefix === '' ? (string) ($i + 1) : $prefix . '.' . ($i + 1);

            // Nested multipart (e.g. multipart/alternative): recurse.
            if (! empty($part->parts)) {
                $this->walkParts($imap, $uid, $part->parts, $section, $html, $text);
                continue;
            }

            // Skip attachments — we only want the readable body.
            if (strtoupper((string) ($part->disposition ?? '')) === 'ATTACHMENT') {
                continue;
            }

            if ((int) ($part->type ?? 0) !== 0) {
                continue; // not text/*
            }

            $subtype = strtoupper((string) ($part->subtype ?? ''));
            $raw     = imap_fetchbody($imap, $uid, $section, FT_UID | FT_PEEK);
            $decoded = $this->toUtf8($this->decodeContent($raw, (int) ($part->encoding ?? 0)), $part);

            if ($subtype === 'HTML' && $html === '') {
                $html = $decoded;
            } elseif ($subtype === 'PLAIN' && $text === '') {
                $text = $decoded;
            }
        }
    }

    /** Decode a body part according to its IMAP transfer encoding. */
    private function decodeContent(string $raw, int $encoding): string
    {
        return match ($encoding) {
            3       => (string) base64_decode($raw),        // ENC BASE64
            4       => quoted_printable_decode($raw),        // ENC QUOTED-PRINTABLE
            default => $raw,                                 // 7BIT / 8BIT / BINARY / OTHER
        };
    }

    /** Convert a part to UTF-8 using its declared charset, if any. */
    private function toUtf8(string $s, $part): string
    {
        $charset = '';
        if (! empty($part->parameters)) {
            foreach ($part->parameters as $p) {
                if (strtoupper((string) $p->attribute) === 'CHARSET') {
                    $charset = (string) $p->value;
                }
            }
        }

        if ($charset !== '' && strtoupper($charset) !== 'UTF-8') {
            $conv = @iconv($charset, 'UTF-8//TRANSLIT', $s);
            if ($conv !== false) {
                return $conv;
            }
        }

        return $s;
    }
}
