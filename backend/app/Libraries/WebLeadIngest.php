<?php

namespace App\Libraries;

use App\Models\AppNotificationModel;
use App\Models\ClientStaffModel;
use App\Models\ClientTaskModel;
use App\Models\LeadModel;
use App\Models\LeadStatusModel;
use CodeIgniter\Database\ConnectionInterface;

/**
 * Shared Web-to-Lead ingest logic: turn a public form submission into a lead in
 * the right client's database. Stateless — every method takes an explicit tenant
 * DB connection, so it works with NO request session (the public endpoint).
 *
 * Responsibilities: validate the form's required (visible) fields, run the
 * anti-duplicate rule, resolve an assignee via the auto-assign engine
 * (state map → round-robin pool → the fixed Responsible), insert the lead
 * (recording `web_form_id` + `source_id`/`status_id`), bump the form's submission
 * counter, and notify staff. On a blocked duplicate it can instead open a task.
 */
class WebLeadIngest
{
    /** Built-in lead columns a public form may capture (source/status/assignee come from the form config). */
    public const BUILTIN_FIELDS = ['name', 'phone', 'alt_phone', 'email', 'city', 'state', 'description'];

    /** Keep the last 10 digits of any phone format (matches how leads store numbers). */
    public static function normalizePhone(?string $raw): string
    {
        $digits = preg_replace('/\D+/', '', (string) $raw);

        return $digits !== '' ? substr($digits, -10) : '';
    }

    /**
     * The form's ordered visible field definitions (decoded from the `fields` JSON),
     * normalised to: key, label, type, required(bool), builtin(bool), options[].
     *
     * @return array<int, array<string, mixed>>
     */
    public static function fields(array $form): array
    {
        $raw = json_decode((string) ($form['fields'] ?? '[]'), true);
        if (! is_array($raw)) {
            return [];
        }
        $out = [];
        foreach ($raw as $f) {
            if (! is_array($f)) {
                continue;
            }
            $key = preg_replace('/[^a-z0-9_]/', '', strtolower((string) ($f['key'] ?? '')));
            if ($key === '') {
                continue;
            }
            $builtin = in_array($key, self::BUILTIN_FIELDS, true);
            $param   = preg_replace('/[^a-z0-9_]/', '', strtolower((string) ($f['param'] ?? $key)));
            $out[] = [
                'key'      => $key,
                // Parameter/JSON name external callers send; defaults to the key.
                'param'    => $param !== '' ? $param : $key,
                'label'    => (string) ($f['label'] ?? $key),
                'type'     => (string) ($f['type'] ?? 'text'),
                'required' => ! empty($f['required']),
                'builtin'  => $builtin,
                'options'  => is_array($f['options'] ?? null) ? array_values(array_map('strval', $f['options'])) : [],
            ];
        }

        return $out;
    }

    /**
     * Remap a submission so each field's admin-chosen `param` (the name external
     * callers send) is available under its canonical `key` (which the lead mapping
     * uses). The embedded form posts by key already; this only helps API callers
     * that use a custom parameter name. Existing keys are never overwritten.
     */
    public static function normalizeInput(array $form, array $input): array
    {
        foreach (self::fields($form) as $f) {
            $param = $f['param'];
            if ($param !== $f['key'] && array_key_exists($param, $input) && ! array_key_exists($f['key'], $input)) {
                $input[$f['key']] = $input[$param];
            }
        }

        return $input;
    }

    /** Read a submitted value for a field key from the flat input or its `custom_fields` map. */
    private static function submitted(array $input, string $key): string
    {
        if (array_key_exists($key, $input)) {
            return trim((string) $input[$key]);
        }
        $custom = $input['custom_fields'] ?? [];
        if (is_string($custom)) {
            $custom = json_decode($custom, true) ?: [];
        }

        return is_array($custom) && array_key_exists($key, $custom) ? trim((string) $custom[$key]) : '';
    }

    /**
     * Validate a submission against the form's required visible fields. Phone is
     * always enforced as 10 digits (the lead model requires it). Returns a map of
     * fieldKey → message (empty when valid).
     *
     * @return array<string, string>
     */
    public static function validate(array $form, array $input): array
    {
        $errors = [];
        $fields = self::fields($form);

        $hasPhone = false;
        foreach ($fields as $f) {
            $val = self::submitted($input, $f['key']);
            if ($f['key'] === 'phone') {
                $hasPhone = true;
                if (self::normalizePhone($val) === '' || strlen(self::normalizePhone($val)) !== 10) {
                    $errors['phone'] = 'A valid 10-digit phone number is required.';
                }
                continue;
            }
            if ($f['required'] && $val === '') {
                $errors[$f['key']] = $f['label'] . ' is required.';
            }
            if ($f['key'] === 'email' && $val !== '' && ! filter_var($val, FILTER_VALIDATE_EMAIL)) {
                $errors['email'] = 'Please enter a valid email address.';
            }
        }
        // A form with no phone field can't create a valid lead.
        if (! $hasPhone && self::normalizePhone(self::submitted($input, 'phone')) === '') {
            $errors['phone'] = 'A valid 10-digit phone number is required.';
        }

        return $errors;
    }

    /**
     * Resolve who a submission should be assigned to:
     *   1. state-wise map (lead's state → staff), when enabled and mapped;
     *   2. round-robin across the auto-assignee pool (persists the cursor);
     *   3. the fixed Responsible (`assigned_to`).
     * Only an existing (non-deleted) staff member is returned; else null.
     */
    public static function resolveAssignee(int $cid, ConnectionInterface $db, array &$form, ?string $state): ?int
    {
        $staffModel = new ClientStaffModel($db);
        $isActive   = static function (?int $id) use ($staffModel, $cid): bool {
            if (! $id) {
                return false;
            }
            $row = $staffModel->where('client_id', $cid)->find($id);

            return $row && (string) ($row['status'] ?? '') !== 'inactive';
        };

        // 1) State-wise routing. A state maps to one OR MANY counsellors; multiple
        // counsellors are round-robined via a per-state cursor (independent of the
        // global pool cursor). Legacy single-id maps still work ((array) wraps them).
        if (! empty($form['auto_assign_state_wise']) && trim((string) $state) !== '') {
            $map = json_decode((string) ($form['state_assignee_map'] ?? '{}'), true);
            if (is_array($map)) {
                $want = mb_strtolower(trim((string) $state));
                foreach ($map as $stateName => $ids) {
                    if (mb_strtolower(trim((string) $stateName)) !== $want) {
                        continue;
                    }
                    // Only the state's ACTIVE counsellors are eligible.
                    $list = array_values(array_filter(array_map('intval', (array) $ids), $isActive));
                    if ($list) {
                        $cursors = json_decode((string) ($form['state_cursors'] ?? '{}'), true);
                        $cursors = is_array($cursors) ? $cursors : [];
                        $ck      = (string) $stateName;
                        $c       = (int) ($cursors[$ck] ?? 0);
                        $chosen  = $list[$c % count($list)];
                        // Persist the advanced per-state cursor for the next lead.
                        $cursors[$ck]          = $c + 1;
                        $form['state_cursors'] = json_encode($cursors);

                        return (int) $chosen;
                    }
                    break; // matched the state but it has no active counsellor → fall through
                }
            }
        }

        // 2) Round-robin across the auto-assignee pool.
        $pool = json_decode((string) ($form['auto_assignee'] ?? '[]'), true);
        $pool = is_array($pool) ? array_values(array_filter(array_map('intval', $pool), $isActive)) : [];
        if ($pool) {
            $cursor = (int) ($form['assign_cursor'] ?? 0);
            $chosen = $pool[$cursor % count($pool)];
            // Persist the advanced cursor so the next submission picks the next rep.
            $form['assign_cursor'] = $cursor + 1;

            return (int) $chosen;
        }

        // 3) Fixed Responsible.
        $resp = (int) ($form['assigned_to'] ?? 0);

        return $isActive($resp) ? $resp : null;
    }

    /**
     * Build + insert the lead from a validated submission. Applies the dedupe rule
     * (optionally opening a task instead), stamps `web_form_id`/`source_id`/
     * `status_id`, bumps `submission_count` (+ persists the assign cursor), and
     * notifies staff. Assumes validate() already passed.
     *
     * @return array{status:string, message:string, lead_id:?int}
     */
    public static function ingest(int $cid, ConnectionInterface $db, array $form, array $input, array $opts = []): array
    {
        // $opts lets other sources (e.g. Facebook Lead Ads) reuse this exact engine
        // with a different config table + provenance columns:
        //   table    — the config table to bump the counter/cursor on (default web_forms)
        //   id_field — the lead column that records the source form id (web_form_id);
        //              pass null to skip (FB records fb_leadgen_id in `extra` instead)
        //   extra    — extra lead columns to merge in (e.g. fb_leadgen_id)
        //   custom   — pre-built custom-field map (skips the web-form `fields` derivation)
        $table   = $opts['table'] ?? 'web_forms';
        $idField = array_key_exists('id_field', $opts) ? $opts['id_field'] : 'web_form_id';
        $formId  = (int) $form['id'];
        $name   = self::submitted($input, 'name');
        $phone  = self::normalizePhone(self::submitted($input, 'phone'));
        $alt    = self::normalizePhone(self::submitted($input, 'alt_phone'));
        $email  = self::submitted($input, 'email');
        $city   = self::submitted($input, 'city');
        $state  = self::submitted($input, 'state');
        $descIn = self::submitted($input, 'description');

        // --- Anti-duplicate rule ------------------------------------------------
        if (empty($form['allow_duplicate'])) {
            $dupWhere = self::dupeMatch($form, $input, ['phone' => $phone, 'alt_phone' => $alt, 'email' => $email, 'name' => $name, 'city' => $city, 'state' => $state]);
            if ($dupWhere !== null) {
                $existing = (new LeadModel($db))->where('client_id', $cid)->where($dupWhere)->first();
                if ($existing) {
                    $makeTask = ! empty($form['create_duplicate_as_task']);
                    // Resolve the assignee first (it advances the cursor), then persist
                    // the counter + cursor in a single bump so a duplicate is counted once.
                    $assignee = $makeTask ? self::resolveAssignee($cid, $db, $form, $state) : null;
                    if ($makeTask) {
                        self::createDuplicateTask($cid, $db, $form, $name ?: $phone, $assignee);
                    }
                    self::bumpForm($db, $cid, $formId, $form, $table);

                    return ['status' => $makeTask ? 'task' : 'duplicate', 'message' => (string) ($form['success_message'] ?? 'Thank you!'), 'lead_id' => null];
                }
            }
        }

        // --- Assignee -----------------------------------------------------------
        $assignee = self::resolveAssignee($cid, $db, $form, $state);

        // --- Status (the lead model requires one) -------------------------------
        $statusId = (int) ($form['status_id'] ?? 0) ?: self::defaultStatusId($cid, $db);

        // --- Custom-field values ------------------------------------------------
        // A caller may pass a pre-built custom map (FB maps by field_map); otherwise
        // derive it from the web form's own `fields` definitions.
        $custom = $opts['custom'] ?? null;
        if ($custom === null) {
            $custom = [];
            foreach (self::fields($form) as $f) {
                if (! $f['builtin']) {
                    $v = self::submitted($input, $f['key']);
                    if ($v !== '') {
                        $custom[$f['key']] = $v;
                    }
                }
            }
        }

        $row = [
            'client_id'    => $cid,
            'name'         => $name,
            'phone'        => $phone,
            'alt_phone'    => $alt !== '' ? $alt : null,
            'email'        => $email !== '' ? $email : null,
            'city'         => $city !== '' ? $city : null,
            'state'        => $state !== '' ? $state : null,
            'description'  => $descIn !== '' ? HtmlSanitizer::clean($descIn) : null,
            'status_id'    => $statusId ?: null,
            'source_id'    => (int) ($form['source_id'] ?? 0) ?: null,
            'lead_type_id' => (int) ($form['lead_type_id'] ?? 0) ?: null,
            'assigned_to'  => $assignee ?: null,
            'assigned_date' => $assignee ? date('Y-m-d H:i:s') : null,
            'created_date' => date('Y-m-d'),
            'follow_date'  => null,
            'custom_fields' => json_encode((object) $custom),
        ];
        if ($idField) {
            $row[$idField] = $formId; // e.g. web_form_id
        }
        if (! empty($opts['extra']) && is_array($opts['extra'])) {
            $row = array_merge($row, $opts['extra']); // e.g. fb_leadgen_id, source override
        }

        $leadModel = new LeadModel($db);
        $leadId    = $leadModel->insert($row);
        if ($leadId === false) {
            return ['status' => 'error', 'message' => 'Could not save your submission.', 'lead_id' => null];
        }

        self::bumpForm($db, $cid, $formId, $form, $table);
        self::notify($cid, $form, $assignee, $name ?: $phone);

        return ['status' => 'created', 'message' => (string) ($form['success_message'] ?? 'Thank you!'), 'lead_id' => (int) $leadId];
    }

    /** Build the WHERE for the dedupe rule, or null when the field(s) have no value. */
    private static function dupeMatch(array $form, array $input, array $vals): ?array
    {
        $f1 = (string) ($form['prevent_duplicate_field'] ?? 'phone') ?: 'phone';
        $v1 = $vals[$f1] ?? self::submitted($input, $f1);
        if ($v1 === '' || $v1 === null) {
            return null;
        }
        $where = [$f1 => $v1];

        $f2 = trim((string) ($form['prevent_duplicate_field2'] ?? ''));
        if ($f2 !== '' && $f2 !== $f1) {
            $v2 = $vals[$f2] ?? self::submitted($input, $f2);
            if ($v2 === '' || $v2 === null) {
                return null; // both fields must be present to match a pair
            }
            $where[$f2] = $v2;
        }

        return $where;
    }

    /** The client's first (parent) lead status, used when the form has none set. */
    private static function defaultStatusId(int $cid, ConnectionInterface $db): int
    {
        $row = (new LeadStatusModel($db))->where('client_id', $cid)
            ->groupStart()->where('parent_id', null)->orWhere('parent_id', 0)->groupEnd()
            ->orderBy('sequence', 'ASC')->orderBy('id', 'ASC')->first();

        return $row ? (int) $row['id'] : 0;
    }

    /** Increment the form's submission counter and persist any advanced assign cursor. */
    private static function bumpForm(ConnectionInterface $db, int $cid, int $formId, array $form, string $table = 'web_forms'): void
    {
        $db->table($table)->where('id', $formId)->where('client_id', $cid)->update([
            'submission_count' => (int) ($form['submission_count'] ?? 0) + 1,
            'assign_cursor'    => (int) ($form['assign_cursor'] ?? 0),
            'state_cursors'    => (string) ($form['state_cursors'] ?? '{}'),
            'updated_at'       => date('Y-m-d H:i:s'),
        ]);
        // Keep the in-memory copy in step for a possible second bump in the same request.
        $form['submission_count'] = (int) ($form['submission_count'] ?? 0) + 1;
    }

    /** Open a task for a blocked duplicate, assigned to the resolved staff member. */
    private static function createDuplicateTask(int $cid, ConnectionInterface $db, array $form, string $who, ?int $assignee): void
    {
        try {
            (new ClientTaskModel($db))->insert([
                'client_id'   => $cid,
                'title'       => 'Duplicate web lead: ' . mb_substr($who, 0, 200),
                'description' => 'A duplicate submission arrived from the "' . ($form['name'] ?? 'web') . '" form.',
                'assigned_to' => $assignee ?: null,
                'type'        => 'lead',
                'status'      => 'todo',
            ]);
        } catch (\Throwable $e) {
            log_message('error', 'Web-to-lead duplicate task failed: ' . $e->getMessage());
        }
    }

    /** Notify the assignee (in-app + web push) that a web lead came in. */
    private static function notify(int $cid, array $form, ?int $assignee, string $who): void
    {
        if (empty($form['notify_on_import'])) {
            return;
        }
        $recipients = [];
        $type       = (string) ($form['notify_type'] ?? 'responsible');
        if ($type === 'specific') {
            $ids = json_decode((string) ($form['notify_staff'] ?? '[]'), true);
            $recipients = is_array($ids) ? array_map('intval', $ids) : [];
        } elseif ($assignee) {
            $recipients = [$assignee]; // 'responsible' (and 'roles' fallback)
        }
        $recipients = array_values(array_unique(array_filter($recipients)));
        if (! $recipients) {
            return;
        }
        $title = 'New web lead: ' . ($form['name'] ?? 'form');
        foreach ($recipients as $sid) {
            try {
                (new AppNotificationModel())->insert([
                    'recipient_type' => 'staff',
                    'recipient_id'   => $sid,
                    'type'           => 'lead_web',
                    'title'          => mb_substr($title, 0, 255),
                    'body'           => mb_substr($who, 0, 500),
                    'link'           => '/client/leads',
                ]);
                PushService::sendToRecipient($cid, 'staff', $sid, $title, $who, '/client/leads');
            } catch (\Throwable $e) {
                log_message('error', 'Web-to-lead notify failed: ' . $e->getMessage());
            }
        }
    }
}
