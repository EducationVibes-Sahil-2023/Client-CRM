<?php

namespace App\Libraries;

use App\Models\ActivityLogModel;
use App\Models\AppNotificationModel;
use App\Models\AutoTransferRuleModel;
use App\Models\ClientStaffModel;
use App\Models\LeadModel;
use App\Models\LeadTransferModel;
use App\Models\SettingsModel;
use CodeIgniter\Database\ConnectionInterface;
use DateTime;

/**
 * Auto lead-transfer RULES engine — sessionless & tenant-explicit, so it runs the
 * same from the cron command and the admin "Run now" button.
 *
 * Each client has any number of named rules (rows in `auto_transfer_rules`). A
 * rule is either:
 *   • transfer   — reassign already-assigned leads that match its criteria to
 *                  another counsellor (round-robin), or
 *   • distribute — first-assign UNASSIGNED (or mass-assigned) matching leads.
 *
 * Criteria (per rule): status / lead-type / lead-source, created-after date and/or
 * created ≥ N days, call count (assigned rep, since assignment), activity/update
 * count, assignment age (working or calendar days, </> an operator), include/exclude
 * assigned-staff, exclude mass-assigned, and a transfer cap. A per-client run builds
 * the staff/shift/holiday context once, then applies each enabled rule in order,
 * never touching a lead twice in the same run.
 */
class AutoLeadTransfer
{
    /** Legacy single-config setting key (migrated into a rule on first run). */
    public const SETTING_KEY = 'auto_transfer_config';

    /** Per-rule criteria defaults (the shape the admin UI edits, stored as JSON). */
    public const CONFIG_DEFAULTS = [
        'status_ids'            => [],
        'lead_type_ids'         => [],
        'source_ids'            => [],
        'exclude_mass_assigned' => false,
        'created_after'         => '',        // 'Y-m-d' absolute cutoff, or '' to ignore
        'days_since_created'    => 0,         // created ≥ this many days ago (0 = ignore)
        'max_calls'             => 0,         // transfer only if assigned rep dialled fewer (0 = ignore)
        'count_connected_only'  => false,
        'max_updates'           => 0,         // lead has ≤ this many activity entries (0 = ignore)
        'assign_age_op'         => 'gte',     // 'gte' (at least) | 'lt' (less than)
        'assign_age_value'      => 0,         // in the unit below (0 = ignore the age filter)
        'assign_age_unit'       => 'calendar',// 'calendar' | 'working'
        'max_transfers'         => 3,         // stop after this many transfers per lead
        'include_staff_ids'     => [],        // only leads currently assigned to these (empty = any)
        'exclude_staff_ids'     => [],        // never move leads assigned to these
        'target_staff_ids'      => [],        // pool to (re)assign among; empty = all active staff
    ];

    // --------------------------------------------------------------- normalise

    /** Coerce a raw criteria array to clean, safe types. */
    public static function normaliseConfig(array $c): array
    {
        $ids = static fn ($v) => array_values(array_unique(array_filter(array_map('intval', (array) $v))));
        $op  = in_array($c['assign_age_op'] ?? '', ['gte', 'lt'], true) ? $c['assign_age_op'] : 'gte';
        $unit = in_array($c['assign_age_unit'] ?? '', ['calendar', 'working'], true) ? $c['assign_age_unit'] : 'calendar';
        $after = trim((string) ($c['created_after'] ?? ''));
        if ($after !== '' && ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $after)) {
            $after = '';
        }

        return [
            'status_ids'            => $ids($c['status_ids'] ?? []),
            'lead_type_ids'         => $ids($c['lead_type_ids'] ?? []),
            'source_ids'            => $ids($c['source_ids'] ?? []),
            'exclude_mass_assigned' => ! empty($c['exclude_mass_assigned']),
            'created_after'         => $after,
            'days_since_created'    => max(0, (int) ($c['days_since_created'] ?? 0)),
            'max_calls'             => max(0, (int) ($c['max_calls'] ?? 0)),
            'count_connected_only'  => ! empty($c['count_connected_only']),
            'max_updates'           => max(0, (int) ($c['max_updates'] ?? 0)),
            'assign_age_op'         => $op,
            'assign_age_value'      => max(0, (int) ($c['assign_age_value'] ?? 0)),
            'assign_age_unit'       => $unit,
            'max_transfers'         => max(1, (int) ($c['max_transfers'] ?? 1)),
            'include_staff_ids'     => $ids($c['include_staff_ids'] ?? []),
            'exclude_staff_ids'     => $ids($c['exclude_staff_ids'] ?? []),
            'target_staff_ids'      => $ids($c['target_staff_ids'] ?? []),
        ];
    }

    /** Decode + normalise a rule row's JSON config. */
    public static function ruleConfig(array $rule): array
    {
        $raw = json_decode((string) ($rule['config'] ?? ''), true);

        return self::normaliseConfig(is_array($raw) ? $raw : []);
    }

    // ------------------------------------------------------------------- rules

    /**
     * Load a client's rules (seeding one from the legacy single-config the first
     * time). `$enabledOnly` limits to enabled rules; ordered by sequence then id.
     */
    public static function readRules(int $cid, ConnectionInterface $db, bool $enabledOnly): array
    {
        self::seedFromLegacy($cid, $db);

        $q = (new AutoTransferRuleModel($db))->where('client_id', $cid);
        if ($enabledOnly) {
            $q->where('enabled', 1);
        }

        return $q->orderBy('sequence', 'ASC')->orderBy('id', 'ASC')->findAll();
    }

    /**
     * Run rules for one client. `$onlyRuleId` runs just that rule (even if
     * disabled) for the admin "Run now / Preview"; otherwise every enabled rule.
     *
     * @return array{dry_run:bool,total:int,rules:array<int,array>}
     */
    public static function runAll(int $cid, ConnectionInterface $db, bool $dryRun, ?int $onlyRuleId = null): array
    {
        $rules = self::readRules($cid, $db, $onlyRuleId === null);

        // Build the shared per-client context once (staff names, active pool,
        // shift/holiday calendar for working-day maths).
        $names  = [];
        $active = [];
        foreach ((new ClientStaffModel($db))->where('client_id', $cid)->findAll() as $s) {
            $id         = (int) $s['id'];
            $names[$id] = (string) ($s['name'] ?? "#{$id}");
            if ((string) ($s['status'] ?? '') !== 'inactive') {
                $active[] = $id;
            }
        }
        $ctx = ['names' => $names, 'active' => $active, 'work' => WorkingDays::loadContext($db, $cid)];

        $out   = ['dry_run' => $dryRun, 'total' => 0, 'rules' => []];
        $acted = [];
        foreach ($rules as $rule) {
            if ($onlyRuleId !== null && (int) $rule['id'] !== $onlyRuleId) {
                continue;
            }
            $res             = self::runRule($cid, $db, $rule, $dryRun, $ctx, $acted);
            $res['id']       = (int) $rule['id'];
            $res['name']     = (string) $rule['name'];
            $res['rule_type'] = (string) $rule['rule_type'];
            $out['rules'][]  = $res;
            $out['total']    += $res['acted'];
        }

        return $out;
    }

    /**
     * Apply one rule. Mutates $acted (lead ids already handled this run) so a lead
     * matched by an earlier rule is never touched again.
     */
    private static function runRule(int $cid, ConnectionInterface $db, array $rule, bool $dryRun, array $ctx, array &$acted): array
    {
        $cfg      = self::ruleConfig($rule);
        $distribute = ((string) $rule['rule_type']) === 'distribute';
        $out      = [
            'reason'          => null,
            'scanned'         => 0,
            'acted'           => 0,
            'skipped_age'     => 0,
            'skipped_calls'   => 0,
            'skipped_updates' => 0,
            'skipped_cap'     => 0,
            'skipped_pool'    => 0,
            'skipped_dedupe'  => 0,
            'details'         => [],
        ];

        if (! $distribute && empty($cfg['status_ids']) && empty($cfg['lead_type_ids']) && empty($cfg['source_ids'])) {
            $out['reason'] = 'No status / type / source filter set — too broad to run.';

            return $out;
        }

        // Pool = active staff, optionally restricted to the rule's target list.
        $pool = $ctx['active'];
        if (! empty($cfg['target_staff_ids'])) {
            $pool = array_values(array_intersect($pool, $cfg['target_staff_ids']));
        }
        if (count($pool) < 1) {
            $out['reason'] = 'No active counsellor available to receive leads.';

            return $out;
        }

        // ---- Candidate query ------------------------------------------------
        $q = (new LeadModel($db))->where('client_id', $cid);
        if ($cfg['status_ids']) {
            $q->whereIn('status_id', $cfg['status_ids']);
        }
        if ($cfg['lead_type_ids']) {
            $q->whereIn('lead_type_id', $cfg['lead_type_ids']);
        }
        if ($cfg['source_ids']) {
            $q->whereIn('source_id', $cfg['source_ids']);
        }
        if ($cfg['created_after'] !== '') {
            $q->where('COALESCE(created_date, created_at) >= ' . $db->escape($cfg['created_after'] . ' 00:00:00'), null, false);
        }
        if ($cfg['days_since_created'] > 0) {
            $cc = date('Y-m-d H:i:s', strtotime("-{$cfg['days_since_created']} days"));
            $q->where('COALESCE(created_date, created_at) <= ' . $db->escape($cc), null, false);
        }
        $q->groupStart()->where('pending_transfer', 0)->orWhere('pending_transfer IS NULL')->groupEnd();

        if ($distribute) {
            // Unassigned OR previously mass-assigned (up for grabs).
            $q->groupStart()->where('assigned_to IS NULL')->orWhere('assigned_to', 0)->orWhere('mass_assigned', 1)->groupEnd();
        } else {
            $q->where('assigned_to >', 0)->where('assigned_date IS NOT NULL');
            if ($cfg['exclude_mass_assigned']) {
                $q->groupStart()->where('mass_assigned', 0)->orWhere('mass_assigned IS NULL')->groupEnd();
            }
            if ($cfg['include_staff_ids']) {
                $q->whereIn('assigned_to', $cfg['include_staff_ids']);
            }
            if ($cfg['exclude_staff_ids']) {
                $q->whereNotIn('assigned_to', $cfg['exclude_staff_ids']);
            }
        }

        $leads          = $q->orderBy($distribute ? 'id' : 'assigned_date', 'ASC')->findAll();
        $out['scanned'] = count($leads);

        $transferM = new LeadTransferModel($db);
        $leadM     = new LeadModel($db);
        $cursor    = (int) $rule['assign_cursor'];
        $poolN     = count($pool);
        $now       = date('Y-m-d H:i:s');
        $nowDt     = new DateTime($now);

        foreach ($leads as $lead) {
            $leadId = (int) $lead['id'];
            if (isset($acted[$leadId])) {
                $out['skipped_dedupe']++;
                continue;
            }
            $owner = (int) ($lead['assigned_to'] ?? 0);

            if (! $distribute) {
                // Assignment age (working or calendar days), when a value is set.
                if ($cfg['assign_age_value'] > 0) {
                    $assignedDt = new DateTime((string) $lead['assigned_date']);
                    if ($cfg['assign_age_unit'] === 'working') {
                        [$sch, $hol] = WorkingDays::scheduleFor($ctx['work'], $owner);
                        $age         = WorkingDays::elapsedWorkingDays($sch, $hol, $assignedDt, $nowDt);
                    } else {
                        $age = WorkingDays::elapsedCalendarDays($assignedDt, $nowDt);
                    }
                    $passes = $cfg['assign_age_op'] === 'lt' ? ($age < $cfg['assign_age_value']) : ($age >= $cfg['assign_age_value']);
                    if (! $passes) {
                        $out['skipped_age']++;
                        continue;
                    }
                }

                // Assigned rep's calls since assignment.
                if ($cfg['max_calls'] > 0
                    && self::assignedCalls($db, $lead, $owner, (string) $lead['assigned_date'], $cfg['count_connected_only']) >= $cfg['max_calls']) {
                    $out['skipped_calls']++;
                    continue;
                }

                // Transfer cap.
                $prior = $transferM->where('lead_id', $leadId)->where('status', 'approved')->countAllResults();
                if ($prior >= $cfg['max_transfers']) {
                    $out['skipped_cap']++;
                    continue;
                }
            }

            // Update/activity count (barely-worked filter) — applies to both types.
            if ($cfg['max_updates'] > 0) {
                $updates = (new ActivityLogModel($db))->where('entity_type', 'lead')->where('entity_id', $leadId)->countAllResults();
                if ($updates > $cfg['max_updates']) {
                    $out['skipped_updates']++;
                    continue;
                }
            }

            // Pick the next pool member that isn't the current owner.
            $pick = 0;
            for ($i = 0; $i < $poolN; $i++) {
                $cand = (int) $pool[$cursor % $poolN];
                $cursor++;
                if ($cand !== $owner) {
                    $pick = $cand;
                    break;
                }
            }
            if ($pick <= 0) {
                $out['skipped_pool']++;
                continue;
            }

            $label            = ($lead['name'] ?? '') !== '' ? (string) $lead['name'] : (string) ($lead['phone'] ?? "Lead #{$leadId}");
            $out['details'][] = [
                'lead_id' => $leadId,
                'lead'    => $label,
                'from'    => $owner ? ($ctx['names'][$owner] ?? null) : null,
                'to'      => $ctx['names'][$pick] ?? "#{$pick}",
            ];
            $out['acted']++;
            $acted[$leadId] = true;

            if ($dryRun) {
                continue;
            }

            $leadM->skipValidation(true)->update($leadId, ['assigned_to' => $pick, 'assigned_date' => $now, 'mass_assigned' => 0]);
            if ($distribute) {
                self::logAction($db, $cid, $leadId, 'assigned', 'Auto-distributed to ' . ($ctx['names'][$pick] ?? "#{$pick}"));
                self::notify($cid, $pick, $label, false);
            } else {
                $transferM->insert([
                    'client_id'     => $cid,
                    'lead_id'       => $leadId,
                    'from_staff_id' => $owner ?: null,
                    'to_staff_id'   => $pick,
                    'requested_by'  => null,
                    'reason'        => 'Auto-transfer rule: ' . (string) $rule['name'],
                    'status'        => 'approved',
                    'decided_by'    => null,
                    'decided_at'    => $now,
                ]);
                self::logAction($db, $cid, $leadId, 'transferred', 'Auto-transferred to ' . ($ctx['names'][$pick] ?? "#{$pick}"));
                self::notify($cid, $pick, $label, true);
            }
        }

        // Persist the advanced round-robin cursor for next time.
        if (! $dryRun && $out['acted'] > 0) {
            (new AutoTransferRuleModel($db))->update((int) $rule['id'], ['assign_cursor' => $cursor]);
        }

        return $out;
    }

    // --------------------------------------------------------------- internals

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

    /** Append an activity-timeline row for the lead (system actor). */
    private static function logAction(ConnectionInterface $db, int $cid, int $leadId, string $action, string $desc): void
    {
        try {
            (new ActivityLogModel($db))->insert([
                'actor_id'    => null,
                'actor_role'  => 'system',
                'actor_name'  => 'Auto Transfer',
                'action'      => $action,
                'entity_type' => 'lead',
                'entity_id'   => $leadId,
                'description' => mb_substr($desc, 0, 255),
                'client_id'   => $cid,
            ]);
        } catch (\Throwable $e) {
            log_message('error', 'Auto-transfer activity log failed: ' . $e->getMessage());
        }
    }

    /** In-app + push notification to the counsellor now owning the lead. */
    private static function notify(int $cid, int $staffId, string $leadLabel, bool $isTransfer): void
    {
        $title = 'Lead assigned to you';
        $body  = $isTransfer ? "{$leadLabel} was auto-transferred to you." : "{$leadLabel} was assigned to you.";
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

    /**
     * One-time migration: if a client has no rules yet but has the old single
     * `auto_transfer_config` setting, seed it as a first "transfer" rule so nothing
     * is lost when the multi-rule system takes over.
     */
    private static function seedFromLegacy(int $cid, ConnectionInterface $db): void
    {
        $model = new AutoTransferRuleModel($db);
        if ($model->where('client_id', $cid)->countAllResults() > 0) {
            return;
        }
        $row = (new SettingsModel($db))->where('client_id', $cid)->where('setting_key', self::SETTING_KEY)->first();
        if (! $row || ($row['setting_value'] ?? '') === '') {
            return;
        }
        $legacy = json_decode((string) $row['setting_value'], true);
        if (! is_array($legacy) || empty($legacy['status_ids'])) {
            return;
        }

        $cfg = self::normaliseConfig([
            'status_ids'           => $legacy['status_ids'] ?? [],
            'days_since_created'   => $legacy['days_since_created'] ?? 0,
            'max_calls'            => $legacy['max_calls'] ?? 0,
            'count_connected_only' => $legacy['count_connected_only'] ?? false,
            'max_updates'          => $legacy['max_updates'] ?? 0,
            'max_transfers'        => $legacy['max_transfers'] ?? 3,
            'target_staff_ids'     => $legacy['target_staff_ids'] ?? [],
            'assign_age_op'        => 'gte',
            'assign_age_value'     => (int) ($legacy['days_since_assigned'] ?? 0),
            'assign_age_unit'      => 'calendar',
        ]);
        $model->insert([
            'client_id'     => $cid,
            'name'          => 'Not Reachable (migrated)',
            'rule_type'     => 'transfer',
            'enabled'       => ! empty($legacy['enabled']) ? 1 : 0,
            'sequence'      => 0,
            'config'        => json_encode($cfg),
            'assign_cursor' => (int) ($legacy['assign_cursor'] ?? 0),
        ]);
    }
}
