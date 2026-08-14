<?php

namespace App\Libraries;

use App\Models\AppNotificationModel;
use App\Models\ClientStaffModel;
use App\Models\LeadModel;
use App\Models\LeadNotificationLogModel;
use App\Models\LeadNotificationRuleModel;
use App\Models\LeadReferenceModel;
use App\Models\LeadSourceModel;
use App\Models\LeadStatusModel;
use App\Models\LeadTypeModel;
use CodeIgniter\Database\ConnectionInterface;

/**
 * Lead notification RULES engine — sessionless & tenant-explicit. Each enabled
 * rule sends a templated reminder to the assigned counsellor and/or their team
 * leader once a lead has sat unworked past an hour/day threshold since assignment.
 *
 * Fires once per assignment cycle (tracked in lead_notification_log; a reassignment
 * re-stamps assigned_date, reopening the cycle). Delivery is in-app always, plus
 * web push when the rule enables it.
 */
class LeadNotify
{
    /** Template variables an admin may use in a message, with a short hint. */
    public const VARIABLES = [
        'name', 'phone', 'alt_phone', 'email', 'status', 'sub_status', 'source',
        'lead_type', 'reference', 'assigned_to', 'city', 'state',
        'follow_date', 'created_date', 'assigned_date',
    ];

    public const CONFIG_DEFAULTS = [
        'status_ids'            => [],
        'lead_type_ids'         => [],
        'source_ids'            => [],
        'exclude_mass_assigned' => false,
        'created_after'         => '',
        'days_since_created'    => 0,
        'max_calls'             => 1,        // remind only if fewer than this many calls (0 = ignore)
        'count_connected_only'  => false,
        'check_updates'         => false,    // enable the "≤ N updates since assignment" filter
        'max_updates'           => 0,
        'age_value'             => 2,        // fire once age ≥ this (may be fractional)
        'age_unit'              => 'clock_hours',
        'notify_rep'            => true,
        'notify_leader'         => false,
        'message'               => 'Follow up with {name} ({phone}) — no response yet.',
        'push_enabled'          => true,
    ];

    public static function normaliseConfig(array $c): array
    {
        $ids = static fn ($v) => array_values(array_unique(array_filter(array_map('intval', (array) $v))));
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
            'check_updates'         => ! empty($c['check_updates']),
            'max_updates'           => max(0, (int) ($c['max_updates'] ?? 0)),
            'age_value'             => max(0, (float) ($c['age_value'] ?? 0)),
            'age_unit'              => AutoLeadTransfer::normaliseAgeUnit($c['age_unit'] ?? ''),
            'notify_rep'            => ! empty($c['notify_rep']),
            'notify_leader'         => ! empty($c['notify_leader']),
            'message'               => trim((string) ($c['message'] ?? '')),
            'push_enabled'          => ! empty($c['push_enabled']),
        ];
    }

    public static function ruleConfig(array $rule): array
    {
        $raw = json_decode((string) ($rule['config'] ?? ''), true);

        return self::normaliseConfig(is_array($raw) ? $raw : []);
    }

    public static function readRules(int $cid, ConnectionInterface $db, bool $enabledOnly): array
    {
        $q = (new LeadNotificationRuleModel($db))->where('client_id', $cid);
        if ($enabledOnly) {
            $q->where('enabled', 1);
        }

        return $q->orderBy('sequence', 'ASC')->orderBy('id', 'ASC')->findAll();
    }

    /**
     * Run notification rules for one client.
     *
     * @return array{dry_run:bool,total:int,rules:array<int,array>}
     */
    public static function runAll(int $cid, ConnectionInterface $db, bool $dryRun, ?int $onlyRuleId = null): array
    {
        $rules = self::readRules($cid, $db, $onlyRuleId === null);

        // Per-client context (built once): name maps + reporting edges + schedules.
        $ctx = [
            'staff'     => self::idNameMap((new ClientStaffModel($db))->where('client_id', $cid)->findAll()),
            'reportsTo' => self::reportsToMap($db, $cid),
            'status'    => self::idNameMap((new LeadStatusModel($db))->where('client_id', $cid)->findAll()),
            'source'    => self::idNameMap((new LeadSourceModel($db))->where('client_id', $cid)->findAll()),
            'type'      => self::idNameMap((new LeadTypeModel($db))->where('client_id', $cid)->findAll()),
            'reference' => self::idNameMap((new LeadReferenceModel($db))->where('client_id', $cid)->findAll()),
            'work'      => WorkingDays::loadContext($db, $cid),
        ];

        $out = ['dry_run' => $dryRun, 'total' => 0, 'rules' => []];
        foreach ($rules as $rule) {
            if ($onlyRuleId !== null && (int) $rule['id'] !== $onlyRuleId) {
                continue;
            }
            $res            = self::runRule($cid, $db, $rule, $dryRun, $ctx);
            $res['id']      = (int) $rule['id'];
            $res['name']    = (string) $rule['name'];
            $out['rules'][] = $res;
            $out['total']   += $res['sent'];
        }

        return $out;
    }

    private static function runRule(int $cid, ConnectionInterface $db, array $rule, bool $dryRun, array $ctx): array
    {
        $cfg = self::ruleConfig($rule);
        $out = [
            'reason'             => null,
            'scanned'            => 0,
            'sent'               => 0,
            'skipped_age'        => 0,
            'skipped_calls'      => 0,
            'skipped_updates'    => 0,
            'skipped_sent'       => 0,
            'skipped_recipient'  => 0,
            'details'            => [],
        ];

        if ($cfg['message'] === '') {
            $out['reason'] = 'No message set.';

            return $out;
        }
        if ($cfg['age_value'] <= 0) {
            $out['reason'] = 'No time threshold set.';

            return $out;
        }
        if (! $cfg['notify_rep'] && ! $cfg['notify_leader']) {
            $out['reason'] = 'No recipient selected.';

            return $out;
        }

        // Candidate leads: currently assigned, matching filters, not parked.
        $q = (new LeadModel($db))->where('client_id', $cid)
            ->where('assigned_to >', 0)->where('assigned_date IS NOT NULL')
            ->groupStart()->where('pending_transfer', 0)->orWhere('pending_transfer IS NULL')->groupEnd();
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
        if ($cfg['exclude_mass_assigned']) {
            $q->groupStart()->where('mass_assigned', 0)->orWhere('mass_assigned IS NULL')->groupEnd();
        }

        $leads          = $q->orderBy('assigned_date', 'ASC')->findAll();
        $out['scanned'] = count($leads);

        $logM = new LeadNotificationLogModel($db);
        $now  = date('Y-m-d H:i:s');

        foreach ($leads as $lead) {
            $leadId = (int) $lead['id'];
            $owner  = (int) ($lead['assigned_to'] ?? 0);

            // "Not called" — remind only while the rep has dialled fewer than max_calls.
            if ($cfg['max_calls'] > 0
                && self::assignedCalls($db, $lead, $owner, (string) $lead['assigned_date'], $cfg['count_connected_only']) >= $cfg['max_calls']) {
                $out['skipped_calls']++;
                continue;
            }
            // Not due yet.
            if (WorkingDays::age($ctx['work'], $lead, $cfg['age_unit']) < $cfg['age_value']) {
                $out['skipped_age']++;
                continue;
            }
            if ($cfg['check_updates']) {
                $uq = $db->table('activity_logs')->where('entity_type', 'lead')->where('entity_id', $leadId);
                if (! empty($lead['assigned_date'])) {
                    $uq->where('created_at >', (string) $lead['assigned_date']);
                }
                if ($uq->countAllResults() > $cfg['max_updates']) {
                    $out['skipped_updates']++;
                    continue;
                }
            }

            // Recipients: the assigned rep and/or their team leader.
            $recipients = [];
            if ($cfg['notify_rep']) {
                $recipients[] = $owner;
            }
            if ($cfg['notify_leader']) {
                $mgr = (int) ($ctx['reportsTo'][$owner] ?? 0);
                if ($mgr > 0) {
                    $recipients[] = $mgr;
                }
            }
            $recipients = array_values(array_unique(array_filter($recipients)));
            if (! $recipients) {
                $out['skipped_recipient']++;
                continue;
            }

            // Once per assignment cycle: a prior send is current if sent_at >= assigned_date.
            $already = $logM->where('rule_id', (int) $rule['id'])->where('lead_id', $leadId)
                ->where('sent_at >=', (string) $lead['assigned_date'])->countAllResults();
            if ($already > 0) {
                $out['skipped_sent']++;
                continue;
            }

            $label   = ($lead['name'] ?? '') !== '' ? (string) $lead['name'] : (string) ($lead['phone'] ?? "Lead #{$leadId}");
            $message = self::render($cfg['message'], $lead, $ctx);
            $out['details'][] = [
                'lead_id' => $leadId,
                'lead'    => $label,
                'to'      => implode(', ', array_map(static fn ($id) => $ctx['staff'][$id] ?? "#{$id}", $recipients)),
                'message' => $message,
            ];
            $out['sent']++;

            if ($dryRun) {
                continue;
            }

            $title = (string) $rule['name'] !== '' ? (string) $rule['name'] : 'Lead reminder';
            foreach ($recipients as $sid) {
                self::send($cid, $sid, $title, $message, $cfg['push_enabled']);
            }
            $logM->insert(['client_id' => $cid, 'rule_id' => (int) $rule['id'], 'lead_id' => $leadId, 'sent_at' => $now]);
        }

        return $out;
    }

    /** Replace {var} tokens in a message with this lead's values. */
    public static function render(string $tpl, array $lead, array $ctx): string
    {
        $vals = [
            'name'          => (string) ($lead['name'] ?? ''),
            'phone'         => (string) ($lead['phone'] ?? ''),
            'alt_phone'     => (string) ($lead['alt_phone'] ?? ''),
            'email'         => (string) ($lead['email'] ?? ''),
            'status'        => $ctx['status'][(int) ($lead['status_id'] ?? 0)] ?? '',
            'sub_status'    => $ctx['status'][(int) ($lead['sub_status_id'] ?? 0)] ?? '',
            'source'        => $ctx['source'][(int) ($lead['source_id'] ?? 0)] ?? '',
            'lead_type'     => $ctx['type'][(int) ($lead['lead_type_id'] ?? 0)] ?? '',
            'reference'     => $ctx['reference'][(int) ($lead['reference_id'] ?? 0)] ?? (string) ($lead['reference_name'] ?? ''),
            'assigned_to'   => $ctx['staff'][(int) ($lead['assigned_to'] ?? 0)] ?? '',
            'city'          => (string) ($lead['city'] ?? ''),
            'state'         => (string) ($lead['state'] ?? ''),
            'follow_date'   => (string) ($lead['follow_date'] ?? ''),
            'created_date'  => (string) ($lead['created_date'] ?? ''),
            'assigned_date' => (string) ($lead['assigned_date'] ?? ''),
        ];
        $out = $tpl;
        foreach ($vals as $k => $v) {
            $out = str_replace('{' . $k . '}', $v, $out);
        }

        return $out;
    }

    // --------------------------------------------------------------- internals

    private static function idNameMap(array $rows): array
    {
        $m = [];
        foreach ($rows as $r) {
            $m[(int) $r['id']] = (string) ($r['name'] ?? '');
        }

        return $m;
    }

    /** staffId => manager (reports_to) staffId. */
    private static function reportsToMap(ConnectionInterface $db, int $cid): array
    {
        $m = [];
        foreach ($db->table('client_staff')->select('id, reports_to')->where('client_id', $cid)->get()->getResultArray() as $s) {
            $m[(int) $s['id']] = $s['reports_to'] !== null ? (int) $s['reports_to'] : 0;
        }

        return $m;
    }

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
        $q = $db->table('calls')->where('deleted_at IS NULL')->where('staff_id', $staffId)
            ->whereIn('contact', array_values(array_unique($phones)))->where('call_start >=', $since);
        if ($connectedOnly) {
            $q->where('connected', 1);
        }

        return $q->countAllResults();
    }

    private static function send(int $cid, int $staffId, string $title, string $body, bool $push): void
    {
        try {
            (new AppNotificationModel())->insert([
                'recipient_type' => 'staff',
                'recipient_id'   => $staffId,
                'type'           => 'lead_reminder',
                'title'          => mb_substr($title, 0, 255),
                'body'           => mb_substr($body, 0, 500),
                'link'           => '/client/leads',
            ]);
            if ($push) {
                PushService::sendToRecipient($cid, 'staff', $staffId, $title, $body, '/client/leads');
            }
        } catch (\Throwable $e) {
            log_message('error', 'Lead notify send failed: ' . $e->getMessage());
        }
    }
}
