<?php

namespace App\Libraries;

use App\Models\ActivityLogModel;
use App\Models\AppNotificationModel;
use App\Models\ClientStaffModel;
use App\Models\LeadModel;
use App\Models\LeadTransferModel;
use App\Models\SettingsModel;
use CodeIgniter\Database\ConnectionInterface;

/**
 * Auto lead-transfer engine — sessionless & tenant-explicit, so it runs the same
 * from the cron command (`leadtransfer:auto`) and from the admin "Run now" button.
 *
 * A lead is auto-transferred to another counsellor when ALL admin-set conditions
 * hold at once:
 *   • it was last assigned/transferred at least `days_since_assigned` days ago,
 *   • the assigned rep has dialled FEWER than `max_calls` calls to it since then,
 *   • its status is one of the selected `status_ids` (e.g. "Not Reachable"), and
 *   • it has been transferred fewer than `max_transfers` times already (the cap).
 *
 * Because `assigned_date` is re-stamped on every transfer, the day clock restarts
 * for the new counsellor — so a lead only moves again after another full window,
 * and stops for good once the transfer cap is reached.
 *
 * Config is one JSON row in the tenant `settings` table (key `auto_transfer_config`).
 */
class AutoLeadTransfer
{
    public const SETTING_KEY = 'auto_transfer_config';

    /** Config defaults (also the shape the admin UI edits). */
    public const DEFAULTS = [
        'enabled'              => false,
        'days_since_assigned'  => 4,     // N — days since assignment/last transfer
        'days_since_created'   => 0,     // lead must be this old since creation (0 = ignore)
        'max_calls'            => 4,     // M — transfer only if rep dialled fewer than this
        'count_connected_only' => false, // count all calls, or only answered ones
        'max_updates'          => 0,     // transfer only if lead has ≤ this many activity entries (0 = ignore)
        'status_ids'           => [],    // lead status must be one of these (required)
        'max_transfers'        => 3,     // K — stop after this many transfers per lead
        'target_staff_ids'     => [],    // pool to reassign among; empty = all active staff
        'assign_cursor'        => 0,     // round-robin cursor, persisted across runs
    ];

    /** Read + normalise this client's config, merged over the defaults. */
    public static function readConfig(int $cid, ConnectionInterface $db): array
    {
        $row = (new SettingsModel($db))
            ->where('client_id', $cid)
            ->where('setting_key', self::SETTING_KEY)
            ->first();

        $stored = [];
        if ($row && ($row['setting_value'] ?? '') !== '') {
            $decoded = json_decode((string) $row['setting_value'], true);
            if (is_array($decoded)) {
                $stored = $decoded;
            }
        }

        return self::normalise(array_merge(self::DEFAULTS, $stored));
    }

    /** Coerce a raw config array into clean, safe types. */
    public static function normalise(array $c): array
    {
        return [
            'enabled'              => ! empty($c['enabled']),
            'days_since_assigned'  => max(0, (int) ($c['days_since_assigned'] ?? 0)),
            'days_since_created'   => max(0, (int) ($c['days_since_created'] ?? 0)),
            'max_calls'            => max(0, (int) ($c['max_calls'] ?? 0)),
            'count_connected_only' => ! empty($c['count_connected_only']),
            'max_updates'          => max(0, (int) ($c['max_updates'] ?? 0)),
            'status_ids'           => array_values(array_unique(array_filter(array_map('intval', (array) ($c['status_ids'] ?? []))))),
            'max_transfers'        => max(1, (int) ($c['max_transfers'] ?? 1)),
            'target_staff_ids'     => array_values(array_unique(array_filter(array_map('intval', (array) ($c['target_staff_ids'] ?? []))))),
            'assign_cursor'        => max(0, (int) ($c['assign_cursor'] ?? 0)),
        ];
    }

    /** Persist a config array (used by the admin save + to advance the cursor). */
    public static function saveConfig(int $cid, ConnectionInterface $db, array $cfg): void
    {
        $model = new SettingsModel($db);
        $row   = $model->where('client_id', $cid)->where('setting_key', self::SETTING_KEY)->first();
        $value = json_encode(self::normalise($cfg));

        if ($row) {
            $model->update($row['id'], ['setting_value' => $value]);
        } else {
            $model->insert(['client_id' => $cid, 'setting_key' => self::SETTING_KEY, 'setting_value' => $value]);
        }
    }

    /**
     * Apply the rules for one client and (unless $dryRun) perform the transfers.
     *
     * @return array{ran:bool,reason:?string,scanned:int,transferred:int,
     *               skipped_calls:int,skipped_cap:int,skipped_pool:int,
     *               details:array<int,array{lead_id:int,lead:string,from:?string,to:string}>}
     */
    public static function run(int $cid, ConnectionInterface $db, array $cfg, bool $dryRun = false): array
    {
        $cfg = self::normalise($cfg);
        $out = [
            'ran'             => false,
            'reason'          => null,
            'scanned'         => 0,
            'transferred'     => 0,
            'skipped_calls'   => 0,
            'skipped_updates' => 0,
            'skipped_cap'     => 0,
            'skipped_pool'    => 0,
            'details'         => [],
        ];

        if (empty($cfg['status_ids'])) {
            $out['reason'] = 'No trigger status selected.';

            return $out;
        }

        // Build the reassignment pool: active staff, optionally restricted to the
        // admin-chosen list. (Active = staff whose status isn't "inactive".)
        $staffNames = [];
        $activePool = [];
        foreach ((new ClientStaffModel($db))->where('client_id', $cid)->findAll() as $s) {
            $sid              = (int) $s['id'];
            $staffNames[$sid] = (string) ($s['name'] ?? "#{$sid}");
            if ((string) ($s['status'] ?? '') !== 'inactive') {
                $activePool[] = $sid;
            }
        }
        if (! empty($cfg['target_staff_ids'])) {
            $activePool = array_values(array_intersect($activePool, $cfg['target_staff_ids']));
        }
        if (count($activePool) < 1) {
            $out['reason'] = 'No active counsellor available to receive transfers.';

            return $out;
        }

        // Candidate leads: assigned long enough ago, in a trigger status, not parked
        // for a manual transfer.
        $cutoff  = date('Y-m-d H:i:s', strtotime("-{$cfg['days_since_assigned']} days"));
        $leadM   = new LeadModel($db);
        $leadM
            ->where('client_id', $cid)
            ->where('assigned_to >', 0)
            ->where('assigned_date IS NOT NULL')
            ->where('assigned_date <=', $cutoff)
            ->whereIn('status_id', $cfg['status_ids'])
            ->groupStart()->where('pending_transfer', 0)->orWhere('pending_transfer IS NULL')->groupEnd();

        // Optional: the lead must also be at least this old since it was created.
        if ($cfg['days_since_created'] > 0) {
            $createdCut = $db->escapeString(date('Y-m-d H:i:s', strtotime("-{$cfg['days_since_created']} days")));
            $leadM->where("COALESCE(created_date, created_at) <= '{$createdCut}'", null, false);
        }

        $leads = $leadM->orderBy('assigned_date', 'ASC')->findAll();

        $out['scanned'] = count($leads);
        $out['ran']     = true;

        $transferM = new LeadTransferModel($db);
        $cursor    = (int) $cfg['assign_cursor'];
        $poolN     = count($activePool);
        $now       = date('Y-m-d H:i:s');

        foreach ($leads as $lead) {
            $leadId = (int) $lead['id'];
            $from   = (int) ($lead['assigned_to'] ?? 0);

            // Cap: stop once this lead has been transferred K times already.
            $priorTransfers = $transferM->where('lead_id', $leadId)->where('status', 'approved')->countAllResults();
            if ($priorTransfers >= $cfg['max_transfers']) {
                $out['skipped_cap']++;
                continue;
            }

            // Optional: only move barely-worked leads — those with at most `max_updates`
            // activity entries (created/status change/note/reminder/etc. all count).
            if ($cfg['max_updates'] > 0) {
                $updates = (new ActivityLogModel($db))->where('entity_type', 'lead')->where('entity_id', $leadId)->countAllResults();
                if ($updates > $cfg['max_updates']) {
                    $out['skipped_updates']++;
                    continue;
                }
            }

            // Only move it if the assigned rep has dialled fewer than M calls since
            // the assignment (calls matched by the lead's phone/alt).
            if (self::assignedCalls($db, $lead, $from, (string) $lead['assigned_date'], $cfg['count_connected_only']) >= $cfg['max_calls']) {
                $out['skipped_calls']++;
                continue;
            }

            // Next counsellor in the pool that isn't the current owner.
            $pick = 0;
            for ($i = 0; $i < $poolN; $i++) {
                $cand = (int) $activePool[$cursor % $poolN];
                $cursor++;
                if ($cand !== $from) {
                    $pick = $cand;
                    break;
                }
            }
            if ($pick <= 0) {
                $out['skipped_pool']++;
                continue;
            }

            $leadLabel = ($lead['name'] ?? '') !== '' ? (string) $lead['name'] : (string) ($lead['phone'] ?? "Lead #{$leadId}");
            $out['details'][] = [
                'lead_id' => $leadId,
                'lead'    => $leadLabel,
                'from'    => $from ? ($staffNames[$from] ?? null) : null,
                'to'      => $staffNames[$pick] ?? "#{$pick}",
            ];
            $out['transferred']++;

            if ($dryRun) {
                continue;
            }

            // Reassign the lead (fresh assignment date restarts the day clock).
            $leadM->skipValidation(true)->update($leadId, ['assigned_to' => $pick, 'assigned_date' => $now]);

            // Record it exactly like a direct (already-approved) manual transfer.
            $transferM->insert([
                'client_id'     => $cid,
                'lead_id'       => $leadId,
                'from_staff_id' => $from ?: null,
                'to_staff_id'   => $pick,
                'requested_by'  => null, // system-initiated
                'reason'        => 'Auto-transfer: no response within the set window',
                'status'        => 'approved',
                'decided_by'    => null,
                'decided_at'    => $now,
            ]);

            self::logTransfer($db, $cid, $leadId, (string) ($staffNames[$pick] ?? "#{$pick}"));
            self::notify($cid, $pick, $leadLabel);
        }

        // Persist the advanced round-robin cursor so the next run continues fairly.
        if (! $dryRun && $out['transferred'] > 0) {
            $cfg['assign_cursor'] = $cursor;
            self::saveConfig($cid, $db, $cfg);
        }

        return $out;
    }

    /** Calls the assigned rep dialled to this lead's phone/alt since assignment. */
    private static function assignedCalls(ConnectionInterface $db, array $lead, int $staffId, string $since, bool $connectedOnly): int
    {
        $phones = [];
        foreach ([$lead['phone'] ?? '', $lead['alt_phone'] ?? ''] as $p) {
            $p = trim((string) $p);
            if ($p !== '') {
                $phones[] = $p;
            }
        }
        if (! $phones || $staffId <= 0 || $since === '') {
            return 0;
        }

        $q = $db->table('calls')
            ->where('deleted_at IS NULL')
            ->where('staff_id', $staffId)
            ->whereIn('contact', array_values(array_unique($phones)))
            ->where('call_start >=', $since);
        if ($connectedOnly) {
            $q->where('connected', 1);
        }

        return $q->countAllResults();
    }

    /** Append a "transferred" row to the lead's activity timeline (system actor). */
    private static function logTransfer(ConnectionInterface $db, int $cid, int $leadId, string $toName): void
    {
        try {
            (new ActivityLogModel($db))->insert([
                'actor_id'    => null,
                'actor_role'  => 'system',
                'actor_name'  => 'Auto Transfer',
                'action'      => 'transferred',
                'entity_type' => 'lead',
                'entity_id'   => $leadId,
                'description' => mb_substr("Auto-transferred to {$toName}", 0, 255),
                'client_id'   => $cid,
            ]);
        } catch (\Throwable $e) {
            log_message('error', 'Auto-transfer activity log failed: ' . $e->getMessage());
        }
    }

    /** In-app + push notification to the counsellor now receiving the lead. */
    private static function notify(int $cid, int $staffId, string $leadLabel): void
    {
        $title = 'Lead assigned to you';
        $body  = "{$leadLabel} was auto-transferred to you.";
        try {
            (new AppNotificationModel())->insert([
                'recipient_type' => 'staff',
                'recipient_id'   => $staffId,
                'type'           => 'lead_transfer',
                'title'          => mb_substr($title, 0, 255),
                'body'           => mb_substr($body, 0, 500),
                'link'           => '/client/leads',
            ]);
            PushService::sendToRecipient($cid, 'staff', $staffId, $title, $body, '/client/leads');
        } catch (\Throwable $e) {
            log_message('error', 'Auto-transfer notify failed: ' . $e->getMessage());
        }
    }
}
