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
     * Normalise a call time to 'Y-m-d H:i:s', stored **exactly as the dialer sent
     * it** — no timezone shift. The dialer's times are already IST wall-clock (they
     * include +5:30), so we must NOT add another +5:30.
     *
     *  - A 'YYYY-MM-DD HH:MM:SS' (or ISO, or with a +05:30 suffix) string keeps its
     *    literal wall-clock digits.
     *  - A UNIX epoch (seconds, or milliseconds) is formatted as its wall-clock
     *    with no offset applied.
     */
    private static function toDateTime($v): ?string
    {
        if ($v === '' || $v === null) {
            return null;
        }

        if (is_numeric($v)) {
            $ts = (int) $v;
            if ($ts > 20000000000) {
                $ts = (int) ($ts / 1000); // milliseconds → seconds
            }

            return gmdate('Y-m-d H:i:s', $ts); // wall-clock, no +5:30 added
        }

        // Take the literal date+time digits, ignoring any timezone marker so an
        // already-+5:30 value isn't shifted again.
        if (preg_match('/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/', (string) $v, $m)) {
            return sprintf('%04d-%02d-%02d %02d:%02d:%02d', $m[1], $m[2], $m[3], $m[4], $m[5], $m[6] ?? 0);
        }

        // Fallback: best-effort parse as an IST wall-clock (no shift).
        try {
            return (new \DateTime((string) $v, new \DateTimeZone(self::TZ)))->format('Y-m-d H:i:s');
        } catch (\Throwable $e) {
            return null;
        }
    }

    /** Normalise a value into an IST 'Y-m-d' date, or null if unparseable/blank. */
    private static function toDate($v): ?string
    {
        $dt = self::toDateTime($v);

        return $dt !== null ? substr($dt, 0, 10) : null;
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
                    'sim1'          => $c['sim1'] ?? '',
                    'sim2'          => $c['sim2'] ?? '',
                    'calling_sim'   => $c['calling_sim'] ?? ($c['callingsim'] ?? ''),
                    'sim_status'    => $c['sim_status'] ?? ($c['simstatus'] ?? ''),
                    'calling_date'  => self::toDate($c['calling_date'] ?? ($c['call_start'] ?? '')),
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
                'sim1'          => $f['sim1'] ?? '',
                'sim2'          => $f['sim2'] ?? '',
                'calling_sim'   => $f['calling_sim'] ?? ($f['callingsim'] ?? ''),
                'sim_status'    => $f['sim_status'] ?? ($f['simstatus'] ?? ''),
                'calling_date'  => self::toDate($f['calling_date'] ?? ($f['startdate_time'] ?? '')),
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

    /** Stable identity of a call for duplicate detection. */
    private static function dupKey(?string $contact, ?string $staffContact, ?string $start, ?string $sim): string
    {
        return self::normalizePhone($contact) . '|' . self::normalizePhone($staffContact)
            . '|' . trim((string) $start) . '|' . mb_strtolower(trim((string) $sim));
    }

    /**
     * Insert parsed call rows into a client's `calls` table, matching each call to
     * a lead (by contact number) and a staff member (by staff_contact number).
     * Unmatched staff fall back to $defaultStaffId (the posting staff, or null on
     * the keyed endpoint).
     *
     * Duplicates are rejected: a call whose (contact, staff_contact, call_start,
     * calling_sim) already exists for this client — or repeats within the same
     * batch — is skipped. Returns ['inserted' => int, 'skipped' => int].
     *
     * @param array $rows output of {@see self::parse()}
     */
    public static function ingest(int $clientId, ConnectionInterface $db, array $rows, ?int $defaultStaffId = null): array
    {
        if (! $rows) {
            return ['inserted' => 0, 'skipped' => 0];
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

        $model = new CallLogModel($db);

        // Pre-load existing dup keys for the call_starts in this batch so we don't
        // re-insert a call already stored on an earlier post. Chunk the IN(...)
        // lookup so a 1000+-call batch doesn't build one giant query.
        $starts = array_values(array_unique(array_filter(array_map(static fn ($r) => $r['call_start'] ?? null, $rows))));
        $seen   = [];
        foreach (array_chunk($starts, 500) as $chunk) {
            foreach ((new CallLogModel($db))->select('contact, staff_contact, call_start, calling_sim')
                ->where('client_id', $clientId)->whereIn('call_start', $chunk)->findAll() as $e) {
                $seen[self::dupKey($e['contact'] ?? '', $e['staff_contact'] ?? '', $e['call_start'] ?? '', $e['calling_sim'] ?? '')] = true;
            }
        }

        // Build the rows to insert (skipping duplicates), then write them in one
        // batched, chunked INSERT — so 1000+ calls cost a few queries, not 1000.
        $toInsert = [];
        $skipped  = 0;
        foreach ($rows as $row) {
            // Accept both the clean field names and the external dialer's variants
            // (calls_source/calls_type/call_status/simnumber/simstatus/datetime).
            $srcRaw    = (string) ($row['source'] ?? $row['calls_source'] ?? '');
            $typeRaw   = (string) ($row['type'] ?? $row['calls_type'] ?? '');
            $statusRaw = (string) ($row['status'] ?? $row['call_status'] ?? '');
            $simNumRaw = (string) ($row['calling_sim'] ?? $row['simnumber'] ?? '');
            $simStatRaw = (string) ($row['sim_status'] ?? $row['simstatus'] ?? '');
            $callDate  = $row['calling_date'] ?? $row['datetime'] ?? null;

            $contact      = self::normalizePhone($row['contact'] ?? '');
            $staffContact = self::normalizePhone($row['staff_contact'] ?? '');
            $rowStaffId   = ($staffContact !== '' && isset($staffByPhone[$staffContact])) ? $staffByPhone[$staffContact] : $defaultStaffId;
            $duration     = (int) ($row['duration'] ?? 0);
            $callStart    = $row['call_start'] ?? null;
            $callingSim   = mb_substr(trim($simNumRaw), 0, 30);

            // Reject duplicates — but only when we have a call_start (the stable
            // timestamp that makes a call identifiable); undated rows always insert.
            // The in-memory $seen set also dedupes repeats within this same batch.
            if ($callStart) {
                $key = self::dupKey($contact, $staffContact, $callStart, $callingSim);
                if (isset($seen[$key])) {
                    $skipped++;
                    continue;
                }
                $seen[$key] = true;
            }

            $toInsert[] = [
                'client_id'     => $clientId,
                'lead_id'       => $contact !== '' ? ($leadByPhone[$contact] ?? null) : null,
                'staff_id'      => $rowStaffId ?: null,
                'staff_contact' => $staffContact ?: null,
                'contact'       => $contact ?: null,
                // Preserve the dialer's status text; normalise type/source to
                // lower-case. Type stays an enum (case-insensitive); source keeps
                // whatever the dialer sends (e.g. "Mobile" → "mobile"), so it's not
                // dropped just because it isn't "ivr"/"phone".
                'call_status'   => mb_substr(trim($statusRaw), 0, 60) ?: null,
                'source'        => mb_substr(strtolower(trim($srcRaw)), 0, 30) ?: null,
                'type'          => in_array(strtolower(trim($typeRaw)), ['incoming', 'outgoing', 'missed'], true) ? strtolower(trim($typeRaw)) : null,
                'duration'      => $duration,
                // Answered when there's talk time, or the dialer flags the status.
                'connected'     => ($duration > 0 || in_array(strtoupper(trim($statusRaw)), ['ANSWERED', 'ANSWER', 'CONNECTED'], true)) ? 1 : 0,
                'call_start'    => $callStart,
                'call_end'      => $row['call_end'] ?? null,
                'sim1'          => mb_substr(trim((string) ($row['sim1'] ?? '')), 0, 30) ?: null,
                'sim2'          => mb_substr(trim((string) ($row['sim2'] ?? '')), 0, 30) ?: null,
                'calling_sim'   => $callingSim ?: null,
                'sim_status'    => mb_substr(trim($simStatRaw), 0, 60) ?: null,
                'calling_date'  => $callDate ?: ($callStart ? substr($callStart, 0, 10) : null),
            ];
        }

        if ($toInsert) {
            $model->insertBatch($toInsert, null, 500); // CI4 chunks internally

            // Reflect the call activity on each matched lead's "Last updated" — bump
            // updated_at to the newest of (existing, this batch's call for the lead).
            $leadMaxCall = [];
            foreach ($toInsert as $c) {
                $lid = $c['lead_id'];
                $cs  = $c['call_start'];
                if ($lid && $cs && (! isset($leadMaxCall[$lid]) || $cs > $leadMaxCall[$lid])) {
                    $leadMaxCall[$lid] = $cs;
                }
            }
            foreach ($leadMaxCall as $lid => $cs) {
                $db->table('leads')
                    ->where('id', (int) $lid)->where('client_id', $clientId)
                    ->set('updated_at', "GREATEST(COALESCE(updated_at, created_at, '1000-01-01 00:00:00'), " . $db->escape($cs) . ')', false)
                    ->update();
            }

            // Stamp first-response for any of those leads that just got their first
            // connected call from the assigned user (one-time; only unset leads).
            if ($leadMaxCall) {
                FirstResponseService::recompute($db, $clientId, array_map('intval', array_keys($leadMaxCall)));
            }
        }

        return ['inserted' => count($toInsert), 'skipped' => $skipped];
    }
}
