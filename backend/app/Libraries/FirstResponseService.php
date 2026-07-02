<?php

namespace App\Libraries;

use CodeIgniter\Database\BaseConnection;
use DateTime;

/**
 * First-response SLA: the working-hours time from a lead's assignment to the
 * first connected call by the **assigned user** after assignment.
 *
 * "Working hours" = the assigned staff's office weekly schedule
 * ({@see office_locations.working_hours}); weekends (off days) and holidays are
 * excluded. When the connect itself lands on a weekend/holiday the response is
 * credited a flat 10 seconds (rewarding off-hours effort).
 *
 * Stamped once per lead (only when currently null) into
 * `leads.first_response_seconds` + `leads.first_response_at`. Reusable from the
 * resync command (backfill) and the call-ingest path (going forward).
 */
class FirstResponseService
{
    /** Default weekly schedule: Mon–Sat 10:00–19:00, Sunday off (index 0 = Sun). */
    public static function defaultSchedule(): array
    {
        $days = [];
        for ($d = 0; $d <= 6; $d++) {
            $days[] = ['off' => $d === 0, 'open' => '10:00', 'close' => '19:00'];
        }

        return $days;
    }

    /**
     * Compute + store first-response for leads (all, or a subset). Only stamps
     * leads whose first_response_seconds is still null (a one-time SLA), unless
     * $force. Returns how many were stamped.
     *
     * @param int[]|null $leadIds
     */
    public static function recompute(BaseConnection $db, int $clientId, ?array $leadIds = null, bool $force = false): int
    {
        if (! $db->tableExists('leads') || ! $db->fieldExists('first_response_seconds', 'leads')) {
            return 0;
        }

        $default = self::defaultSchedule();

        // Office weekly schedules (by office id) + shift schedules (by shift id).
        // A staff member's SHIFT hours take priority over their office hours.
        $officeSchedules = [];
        if ($db->tableExists('office_locations')) {
            foreach ($db->table('office_locations')->where('client_id', $clientId)->get()->getResultArray() as $o) {
                $wh                              = json_decode((string) ($o['working_hours'] ?? ''), true);
                $officeSchedules[(int) $o['id']] = (is_array($wh) && count($wh) === 7) ? $wh : $default;
            }
        }
        $shiftSchedules = [];
        if ($db->tableExists('shifts')) {
            foreach ($db->table('shifts')->where('client_id', $clientId)->where('deleted_at', null)->get()->getResultArray() as $sh) {
                $wh                             = json_decode((string) ($sh['working_hours'] ?? ''), true);
                $shiftSchedules[(int) $sh['id']] = (is_array($wh) && count($wh) === 7) ? $wh : $default;
            }
        }

        // Holidays: global (office_location_id NULL → all offices) + per office.
        $globalHol = [];
        $officeHol = [];
        if ($db->tableExists('holidays')) {
            foreach ($db->table('holidays')->where('client_id', $clientId)->where('deleted_at', null)->get()->getResultArray() as $h) {
                $d = substr((string) $h['holiday_date'], 0, 10);
                if ($h['office_location_id'] === null) {
                    $globalHol[$d] = true;
                } else {
                    $officeHol[(int) $h['office_location_id']][$d] = true;
                }
            }
        }

        // Assigned staff → their office + shift (shift wins for the schedule).
        $staffOffice = [];
        $staffShift  = [];
        $hasShiftCol = $db->fieldExists('shift_id', 'client_staff');
        foreach ($db->table('client_staff')->select('id, office_location_id' . ($hasShiftCol ? ', shift_id' : ''))->where('client_id', $clientId)->get()->getResultArray() as $s) {
            $staffOffice[(int) $s['id']] = $s['office_location_id'] !== null ? (int) $s['office_location_id'] : 0;
            $staffShift[(int) $s['id']]  = ($hasShiftCol && $s['shift_id'] !== null) ? (int) $s['shift_id'] : 0;
        }

        // Connected calls indexed by staff + phone, so we can find each lead's
        // first connect by its assigned user quickly.
        $connByStaffPhone = [];
        foreach ($db->table('calls')->select('staff_id, contact, call_start')->where('client_id', $clientId)->where('connected', 1)->where('deleted_at', null)->get()->getResultArray() as $c) {
            $sid = (int) ($c['staff_id'] ?? 0);
            $ph  = (string) ($c['contact'] ?? '');
            $cs  = (string) ($c['call_start'] ?? '');
            if ($sid <= 0 || $ph === '' || $cs === '') {
                continue;
            }
            $connByStaffPhone[$sid][$ph][] = $cs;
        }

        $q = $db->table('leads')->select('id, assigned_to, assigned_date, phone')
            ->where('client_id', $clientId)->where('deleted_at', null)
            ->where('assigned_to IS NOT NULL')->where('assigned_date IS NOT NULL');
        if ($leadIds) {
            $q->whereIn('id', array_map('intval', $leadIds) ?: [0]);
        }
        if (! $force) {
            $q->where('first_response_seconds IS NULL');
        }
        $leads = $q->get()->getResultArray();

        $updated = 0;
        foreach ($leads as $l) {
            $sid      = (int) $l['assigned_to'];
            $ph       = (string) $l['phone'];
            $assigned = (string) $l['assigned_date'];

            // Earliest connected call by the assigned staff at/after assignment.
            $first = null;
            foreach ($connByStaffPhone[$sid][$ph] ?? [] as $t) {
                if ($t >= $assigned && ($first === null || $t < $first)) {
                    $first = $t;
                }
            }
            if ($first === null) {
                continue;
            }

            // Schedule: the staff member's shift hours if mapped, else their
            // office hours, else the default.
            $shiftId  = $staffShift[$sid] ?? 0;
            $officeId = $staffOffice[$sid] ?? 0;
            $schedule = $shiftSchedules[$shiftId] ?? $officeSchedules[$officeId] ?? $default;
            $holset   = $globalHol + ($officeHol[$officeId] ?? []);

            $connDate = substr($first, 0, 10);
            $dow      = (int) (new DateTime($connDate))->format('w'); // 0 = Sun
            $offDay   = ! empty($schedule[$dow]['off']) || isset($holset[$connDate]);
            $seconds  = $offDay ? 10 : self::workingSeconds($schedule, $holset, new DateTime($assigned), new DateTime($first));

            $db->table('leads')->where('id', (int) $l['id'])->where('client_id', $clientId)
                ->update(['first_response_seconds' => $seconds, 'first_response_at' => $first]);
            $updated++;
        }

        return $updated;
    }

    /**
     * Working seconds between two datetimes within a weekly schedule, excluding
     * off days and holidays. Each day contributes the overlap of its open→close
     * window with [$from, $to].
     */
    public static function workingSeconds(array $schedule, array $holidaySet, DateTime $from, DateTime $to): int
    {
        if ($to <= $from) {
            return 0;
        }
        $total = 0;
        $day   = new DateTime($from->format('Y-m-d')); // start of the first day
        while ($day < $to) {
            $ymd = $day->format('Y-m-d');
            $dow = (int) $day->format('w'); // 0 = Sun
            $cfg = $schedule[$dow] ?? null;
            if ($cfg && empty($cfg['off']) && ! isset($holidaySet[$ymd])
                && preg_match('/^\d{2}:\d{2}$/', (string) ($cfg['open'] ?? ''))
                && preg_match('/^\d{2}:\d{2}$/', (string) ($cfg['close'] ?? ''))) {
                $open  = new DateTime("{$ymd} {$cfg['open']}:00");
                $close = new DateTime("{$ymd} {$cfg['close']}:00");
                if ($close > $open) {
                    $segStart = $open < $from ? $from : $open;
                    $segEnd   = $close > $to ? $to : $close;
                    if ($segEnd > $segStart) {
                        $total += $segEnd->getTimestamp() - $segStart->getTimestamp();
                    }
                }
            }
            $day->modify('+1 day');
        }

        return $total;
    }
}
