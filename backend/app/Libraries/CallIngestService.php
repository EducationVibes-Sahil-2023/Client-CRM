<?php

namespace App\Libraries;

use App\Models\CallLogModel;
use App\Models\ClientStaffModel;
use App\Models\LeadModel;
use CodeIgniter\Database\ConnectionInterface;

/**
 * Shared call-ingest logic, used by both:
 *  - the session endpoint `POST /client/call-logs` (staff signed in), and
 *  - the public, API-key endpoint `POST /calls/ingest` (external dialer/IVR).
 *
 * Keeping the parsing + lead/staff matching + insert here means both entry points
 * store calls identically. Stateless: every method takes an explicit tenant DB
 * connection so it works with or without a request session.
 */
class CallIngestService
{
    /** Keep the last 10 digits of any phone format (matches how leads/staff store numbers). */
    public static function normalizePhone(?string $raw): string
    {
        $digits = preg_replace('/\D+/', '', (string) $raw);

        return $digits !== '' ? substr($digits, -10) : '';
    }

    /** Android CallLog numeric type → our direction label. */
    private static function callDirection($t): string
    {
        switch ((int) $t) {
            case 1: return 'incoming';
            case 2: return 'outgoing';
            case 3:
            case 5: return 'missed';   // missed / rejected
            default: return 'outgoing';
        }
    }

    /** Indian Standard Time — call times are stored as IST wall-clock (UTC+5:30). */
    private const TZ = 'Asia/Kolkata';

    /**
     * Normalise a date into IST 'Y-m-d H:i:s', or null if unparseable.
     *
     *  - A UNIX timestamp is an absolute instant (epoch/UTC) → converted to the
     *    IST wall-clock (i.e. +5:30 is applied).
     *  - A 'YYYY-MM-DD HH:MM:SS' string is treated as IST as-given (no shifting),
     *    so the time the dialer recorded is stored unchanged.
     */
    private static function toDateTime($v): ?string
    {
        if ($v === '' || $v === null) {
            return null;
        }

        $tz = new \DateTimeZone(self::TZ);
        try {
            if (is_numeric($v)) {
                // Epoch is UTC; shift to IST for display/storage.
                return (new \DateTime('@' . (int) $v))->setTimezone($tz)->format('Y-m-d H:i:s');
            }

            // Parse the wall-clock string in IST so it isn't shifted.
            return (new \DateTime((string) $v, $tz))->format('Y-m-d H:i:s');
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Normalise either payload shape into a flat list of call rows with keys:
     * contact, staff_contact, status, source, type, duration, call_start,
     * call_end. Returns null when nothing usable was sent (no calls / call_data).
     *
     * @param array       $body        decoded request body (JSON or form array)
     * @param string|null $rawCallData the legacy `call_data` field, if posted
     */
    public static function parse(array $body, ?string $rawCallData = null): ?array
    {
        // Clean JSON: { calls: [ ... ] }
        if (! empty($body['calls']) && is_array($body['calls'])) {
            $out = [];
            foreach ($body['calls'] as $c) {
                if (! is_array($c)) {
                    continue;
                }
                $out[] = [
                    'contact'       => $c['contact'] ?? ($c['phonenumber'] ?? ''),
                    'staff_contact' => $c['staff_contact'] ?? ($c['callassignee'] ?? ''),
                    'status'        => $c['status'] ?? ($c['call_status'] ?? ''),
                    'source'        => $c['source'] ?? '',
                    'type'          => $c['type'] ?? '',
                    'duration'      => $c['duration'] ?? 0,
                    'call_start'    => self::toDateTime($c['call_start'] ?? ''),
                    'call_end'      => self::toDateTime($c['call_end'] ?? ''),
                ];
            }

            return $out;
        }

        // Legacy: call_data = JSON string { type, formData }
        $raw = $rawCallData ?? ($body['call_data'] ?? null);
        if ($raw === null) {
            return null;
        }
        $data = json_decode((string) $raw, true);
        if (! is_array($data)) {
            return null;
        }

        $sourceType = (int) ($data['type'] ?? 1);   // legacy: 1 = IVR, 2 = phone (device)
        $source     = $sourceType === 2 ? 'phone' : 'ivr';

        $items = [];
        if (! empty($data['formData']) && is_array($data['formData'])) {
            // Bulk payloads are a list; a single payload is an associative object.
            $items = isset($data['formData'][0]) ? $data['formData'] : [$data['formData']];
        }

        $out = [];
        foreach ($items as $f) {
            if (! is_array($f)) {
                continue;
            }
            $out[] = [
                'contact'       => $f['phonenumber'] ?? '',
                'staff_contact' => $f['callassignee'] ?? '',
                'status'        => $f['form-cf-13'] ?? 'Not Found',
                'source'        => $source,
                'type'          => self::callDirection($f['calls_type'] ?? 2),
                'duration'      => $f['call_duration'] ?? 0,
                'call_start'    => self::toDateTime($f['startdate_time'] ?? ''),
                'call_end'      => self::toDateTime($f['enddate_time'] ?? ''),
            ];
        }

        return $out;
    }

    /**
     * Strict validation for the public API: EVERY field of EVERY call must be
     * present and valid. Returns the first problem as a human-readable string, or
     * null when all rows are complete. (The session endpoint stays lenient for the
     * legacy app; this is only enforced on POST /calls/ingest.)
     *
     * @param array $rows output of {@see self::parse()}
     */
    public static function validate(array $rows): ?string
    {
        if (! $rows) {
            return 'No calls provided.';
        }

        foreach ($rows as $i => $r) {
            $n = $i + 1;
            if (self::normalizePhone($r['contact'] ?? '') === '') {
                return "Call #{$n}: 'contact' (the lead's phone number) is required.";
            }
            if (self::normalizePhone($r['staff_contact'] ?? '') === '') {
                return "Call #{$n}: 'staff_contact' (the agent's phone number) is required.";
            }
            if (! in_array($r['type'] ?? '', ['incoming', 'outgoing', 'missed'], true)) {
                return "Call #{$n}: 'type' must be one of incoming, outgoing or missed.";
            }
            if (! in_array($r['source'] ?? '', ['ivr', 'phone'], true)) {
                return "Call #{$n}: 'source' must be one of ivr or phone.";
            }
            if (trim((string) ($r['status'] ?? '')) === '') {
                return "Call #{$n}: 'status' is required.";
            }
            if (! is_numeric($r['duration'] ?? null) || (int) $r['duration'] < 0) {
                return "Call #{$n}: 'duration' (seconds, 0 or more) is required.";
            }
            if (empty($r['call_start'])) {
                return "Call #{$n}: 'call_start' is required (YYYY-MM-DD HH:MM:SS or a UNIX timestamp).";
            }
            if (empty($r['call_end'])) {
                return "Call #{$n}: 'call_end' is required (YYYY-MM-DD HH:MM:SS or a UNIX timestamp).";
            }
        }

        return null;
    }

    /**
     * Insert parsed call rows into a client's `calls` table, matching each call to
     * a lead (by contact number) and a staff member (by staff_contact number).
     * Unmatched staff fall back to $defaultStaffId (the posting staff, or null on
     * the keyed endpoint). Returns the number of rows inserted.
     *
     * @param array $rows output of {@see self::parse()}
     */
    public static function ingest(int $clientId, ConnectionInterface $db, array $rows, ?int $defaultStaffId = null): int
    {
        if (! $rows) {
            return 0;
        }

        // Phone → id maps for matching leads and staff within this client.
        $leadByPhone = [];
        foreach ((new LeadModel($db))->select('id, phone, alt_phone')->where('client_id', $clientId)->findAll() as $l) {
            foreach ([$l['phone'] ?? '', $l['alt_phone'] ?? ''] as $p) {
                $k = self::normalizePhone($p);
                if ($k !== '') {
                    $leadByPhone[$k] = (int) $l['id'];
                }
            }
        }
        $staffByPhone = [];
        foreach ((new ClientStaffModel($db))->select('id, phone, alt_phone')->where('client_id', $clientId)->findAll() as $s) {
            foreach ([$s['phone'] ?? '', $s['alt_phone'] ?? ''] as $p) {
                $k = self::normalizePhone($p);
                if ($k !== '') {
                    $staffByPhone[$k] = (int) $s['id'];
                }
            }
        }

        $model    = new CallLogModel($db);
        $inserted = 0;
        foreach ($rows as $row) {
            $contact      = self::normalizePhone($row['contact'] ?? '');
            $staffContact = self::normalizePhone($row['staff_contact'] ?? '');
            $rowStaffId   = ($staffContact !== '' && isset($staffByPhone[$staffContact])) ? $staffByPhone[$staffContact] : $defaultStaffId;
            $duration     = (int) ($row['duration'] ?? 0);

            $model->insert([
                'client_id'     => $clientId,
                'lead_id'       => $contact !== '' ? ($leadByPhone[$contact] ?? null) : null,
                'staff_id'      => $rowStaffId ?: null,
                'staff_contact' => $staffContact ?: null,
                'contact'       => $contact ?: null,
                'call_status'   => mb_substr((string) ($row['status'] ?? ''), 0, 60) ?: null,
                'source'        => in_array($row['source'] ?? '', ['ivr', 'phone'], true) ? $row['source'] : null,
                'type'          => in_array($row['type'] ?? '', ['incoming', 'outgoing', 'missed'], true) ? $row['type'] : null,
                'duration'      => $duration,
                'connected'     => $duration > 0 ? 1 : 0,
                'call_start'    => $row['call_start'] ?? null,
                'call_end'      => $row['call_end'] ?? null,
            ]);
            $inserted++;
        }

        return $inserted;
    }
}
