<?php

namespace App\Libraries;

use CodeIgniter\Database\BaseConnection;
use DateTime;

/**
 * Working-day arithmetic for a client: how many *working days* have elapsed
 * since a datetime, honouring each staff member's shift (weekly off days) plus
 * the client's global + office holiday calendar.
 *
 * Loading mirrors FirstResponseService::recompute() (shifts → working_hours JSON;
 * holidays split global vs per-office; staff → shift + office). Build the context
 * once per client run, then call elapsedWorkingDays() per lead.
 */
class WorkingDays
{
    /**
     * Load the per-client scheduling context once. Returns:
     *   ['default'=>schedule, 'shiftSchedules'=>[id=>schedule], 'globalHol'=>set,
     *    'officeHol'=>[officeId=>set], 'staffShift'=>[id=>shiftId], 'staffOffice'=>[id=>officeId]]
     */
    public static function loadContext(BaseConnection $db, int $clientId): array
    {
        $default = FirstResponseService::defaultSchedule();

        $shiftSchedules = [];
        if ($db->tableExists('shifts')) {
            foreach ($db->table('shifts')->where('client_id', $clientId)->where('deleted_at', null)->get()->getResultArray() as $sh) {
                $wh                              = json_decode((string) ($sh['working_hours'] ?? ''), true);
                $shiftSchedules[(int) $sh['id']] = (is_array($wh) && count($wh) === 7) ? $wh : $default;
            }
        }

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

        $staffShift  = [];
        $staffOffice = [];
        $hasShiftCol = $db->fieldExists('shift_id', 'client_staff');
        foreach ($db->table('client_staff')->select('id, office_location_id' . ($hasShiftCol ? ', shift_id' : ''))->where('client_id', $clientId)->get()->getResultArray() as $s) {
            $staffOffice[(int) $s['id']] = $s['office_location_id'] !== null ? (int) $s['office_location_id'] : 0;
            $staffShift[(int) $s['id']]  = ($hasShiftCol && $s['shift_id'] !== null) ? (int) $s['shift_id'] : 0;
        }

        return compact('default', 'shiftSchedules', 'globalHol', 'officeHol', 'staffShift', 'staffOffice');
    }

    /** The [schedule, holidaySet] a given staff member works to. */
    public static function scheduleFor(array $ctx, int $staffId): array
    {
        $shiftId  = $ctx['staffShift'][$staffId] ?? 0;
        $officeId = $ctx['staffOffice'][$staffId] ?? 0;
        $schedule = $ctx['shiftSchedules'][$shiftId] ?? $ctx['default'];
        $holset   = $ctx['globalHol'] + ($ctx['officeHol'][$officeId] ?? []);

        return [$schedule, $holset];
    }

    /**
     * Working days elapsed between two datetimes: count of working days strictly
     * after the `from` day, up to and including the `to` day. Assigned today = 0.
     */
    public static function elapsedWorkingDays(array $schedule, array $holidaySet, DateTime $from, DateTime $to): int
    {
        $day = new DateTime($from->format('Y-m-d'));
        $day->modify('+1 day');
        $end = new DateTime($to->format('Y-m-d'));

        $count = 0;
        while ($day <= $end) {
            $ymd = $day->format('Y-m-d');
            $dow = (int) $day->format('w'); // 0 = Sun
            $cfg = $schedule[$dow] ?? null;
            if ($cfg && empty($cfg['off']) && ! isset($holidaySet[$ymd])) {
                $count++;
            }
            $day->modify('+1 day');
        }

        return $count;
    }

    /** Plain calendar days elapsed between two datetimes (date granularity). */
    public static function elapsedCalendarDays(DateTime $from, DateTime $to): int
    {
        $a = new DateTime($from->format('Y-m-d'));
        $b = new DateTime($to->format('Y-m-d'));

        return $b >= $a ? (int) $a->diff($b)->days : 0;
    }
}
