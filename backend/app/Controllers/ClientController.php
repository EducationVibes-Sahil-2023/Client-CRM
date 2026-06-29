<?php

namespace App\Controllers;

use App\Libraries\GmailService;
use App\Libraries\GoogleCalendarService;
use App\Libraries\MailerService;
use App\Models\ActivityLogModel;
use App\Models\AnnouncementModel;
use App\Models\AnnouncementReadModel;
use App\Models\AppNotificationModel;
use App\Models\AssetAllocationModel;
use App\Models\AssetLogModel;
use App\Models\AssetModel;
use App\Models\CallLogModel;
use App\Models\ClientFeatureModel;
use App\Models\ClientLookupModel;
use App\Models\ClientModel;
use App\Models\ClientRoleModel;
use App\Models\ClientRolePermissionModel;
use App\Models\ClientStaffModel;
use App\Models\ClientTaskModel;
use App\Models\ConversionTypeModel;
use App\Models\FollowupGroupModel;
use App\Models\DepartmentModel;
use App\Models\LeadModel;
use App\Models\LeadNoteModel;
use App\Models\LeadReminderModel;
use App\Models\LeadSourceModel;
use App\Models\LeadStatusModel;
use App\Models\LeadTypeModel;
use App\Models\MarketingTypeModel;
use App\Models\OfficeLocationModel;
use App\Models\SettingsModel;
use App\Models\StaffAccountModel;
use App\Models\TaskCommentModel;
use App\Models\UserTablePrefModel;

/**
 * Client-admin endpoints. The whole group is protected by the
 * `auth:client_admin` filter, so a session user (with client_id) always exists.
 * Every query is scoped to the signed-in admin's client_id.
 */
class ClientController extends ApiController
{
    /** Modules that roles can be granted CRUD permissions on. */
    public const MODULES = [
        'dashboard', 'leads', 'leads_setup', 'team', 'roles', 'tasks', 'assets',
        'chat', 'notifications', 'email_config', 'settings',
    ];

    /**
     * Branding / appearance settings a client can customise, with their
     * defaults. Stored as key/value rows in the per-client `settings` table.
     * `menu_order` holds a JSON array of main-nav keys.
     */
    public const BRANDING_DEFAULTS = [
        'brand_color'   => '#10b981',
        'app_name'      => 'My CRM',
        'app_tagline'   => 'Client Panel',
        'logo_url'      => '',
        'theme_mode'    => 'light',        // light | dark | system
        'density'       => 'comfortable',  // comfortable | compact
        'sidebar_style' => 'subtle',       // subtle | solid
        'menu_order'    => '',             // JSON array of nav keys
    ];

    /** Subscription plans the client can be on, with monthly pricing (INR). */
    public const PLAN_CATALOG = [
        'starter'    => ['key' => 'starter', 'name' => 'Starter', 'price' => 0, 'cycle' => 'month', 'blurb' => 'Essentials to get going'],
        'growth'     => ['key' => 'growth', 'name' => 'Growth', 'price' => 2999, 'cycle' => 'month', 'blurb' => 'For growing teams'],
        'enterprise' => ['key' => 'enterprise', 'name' => 'Enterprise', 'price' => 7999, 'cycle' => 'month', 'blurb' => 'Everything, unlimited'],
    ];

    private function clientId(): int
    {
        return (int) ($this->currentUser()['client_id'] ?? 0);
    }

    // ---------------------------------------------------- ACCESS (admin/staff)
    //
    // The /client dashboard serves both the client admin and their staff. Admins
    // are unconstrained; staff are limited by their role/extra permissions and
    // see only their own data plus everyone reporting up to them.

    private function role(): string
    {
        return (string) ($this->currentUser()['role'] ?? '');
    }

    private function isAdmin(): bool
    {
        return in_array($this->role(), ['client_admin', 'super_admin'], true);
    }

    private function staffId(): int
    {
        return (int) ($this->currentUser()['staff_id'] ?? 0);
    }

    /** Id of whoever is acting: the staff id for staff, else the admin user id. */
    private function actorId(): int
    {
        $u = $this->currentUser();

        return (int) ($u['staff_id'] ?? $u['id'] ?? 0);
    }

    /** Display name of the acting user, snapshotted onto audited records. */
    private function actorName(): ?string
    {
        $u = $this->currentUser();

        return $u['name'] ?? $u['email'] ?? null;
    }

    /** Effective per-module permission map for the current user. Admin => all true. */
    private function effectivePermissions(): array
    {
        $out = [];
        foreach (self::MODULES as $m) {
            $out[$m] = ['view' => $this->isAdmin(), 'create' => $this->isAdmin(), 'update' => $this->isAdmin(), 'delete' => $this->isAdmin()];
        }
        if ($this->isAdmin()) {
            return $out;
        }

        $staff = $this->staffId() ? (new ClientStaffModel())->where('client_id', $this->clientId())->find($this->staffId()) : null;
        $extra = $staff ? json_decode((string) ($staff['extra_permissions'] ?? ''), true) : null;

        if (is_array($extra) && $extra) {
            // Per-staff override takes precedence over the role.
            foreach ($extra as $m => $p) {
                if (isset($out[$m]) && is_array($p)) {
                    $out[$m] = ['view' => ! empty($p['view']), 'create' => ! empty($p['create']), 'update' => ! empty($p['update']), 'delete' => ! empty($p['delete'])];
                }
            }
        } elseif ($staff && ! empty($staff['role_id'])) {
            foreach ((new ClientRolePermissionModel())->where('role_id', (int) $staff['role_id'])->findAll() as $perm) {
                $m = $perm['module'];
                if (isset($out[$m])) {
                    $out[$m] = ['view' => (bool) $perm['can_view'], 'create' => (bool) $perm['can_create'], 'update' => (bool) $perm['can_update'], 'delete' => (bool) $perm['can_delete']];
                }
            }
        }

        return $out;
    }

    private function can(string $module, string $action = 'view'): bool
    {
        if ($this->isAdmin()) {
            return true;
        }
        $p = $this->effectivePermissions();

        return ! empty($p[$module][$action]);
    }

    /** Returns a 403 response when the current user lacks the permission, else null. */
    private function requirePermission(string $module, string $action = 'view')
    {
        return $this->can($module, $action) ? null : $this->failForbidden("You do not have permission to {$action} {$module}.");
    }

    /**
     * Staff ids whose records the current user may see: null = unrestricted
     * (admin), otherwise the user plus everyone reporting up to them.
     *
     * @return int[]|null
     */
    private function visibleStaffIds(): ?array
    {
        if ($this->isAdmin()) {
            return null;
        }
        $sid = $this->staffId();
        if (! $sid) {
            return [0]; // unknown staff => see nothing
        }

        return (new ClientStaffModel())->subordinateIds($this->clientId(), $sid);
    }

    /** GET /client/me — current user, whether they're an admin, and their permissions. */
    public function me()
    {
        return $this->respond([
            'user'        => $this->currentUser(),
            'is_admin'    => $this->isAdmin(),
            'role'        => $this->role(),
            'permissions' => $this->effectivePermissions(),
            'modules'     => self::MODULES,
        ]);
    }

    /** Logical tables a user may save a layout for. Guards the table_key param. */
    private const TABLE_PREF_KEYS = ['leads', 'leads_filters', 'calls'];

    /** The signed-in user's own auth id — the per-user key for saved layouts. */
    private function userId(): int
    {
        return (int) ($this->currentUser()['id'] ?? 0);
    }

    /**
     * GET /client/table-prefs/(:segment) — the current user's saved layout
     * (visible columns, order, widths, alignment) for the given table, or null
     * when they haven't customised it yet.
     */
    public function tablePrefs(string $key)
    {
        if (! in_array($key, self::TABLE_PREF_KEYS, true)) {
            return $this->failNotFound('Unknown table.');
        }

        $row    = (new UserTablePrefModel())->forUser($this->clientId(), $this->userId(), $key);
        $config = $row ? json_decode((string) $row['config'], true) : null;

        return $this->respond(['config' => is_array($config) ? $config : null]);
    }

    /**
     * POST /client/table-prefs/(:segment) — save (upsert) the current user's
     * layout for the given table. The whole config object is stored as JSON, so
     * one user's layout never affects another's.
     */
    public function saveTablePrefs(string $key)
    {
        if (! in_array($key, self::TABLE_PREF_KEYS, true)) {
            return $this->failNotFound('Unknown table.');
        }

        $config = $this->input('config');
        if (! is_array($config)) {
            return $this->failValidationErrors('A config object is required.');
        }

        $model = new UserTablePrefModel();
        $cid   = $this->clientId();
        $uid   = $this->userId();
        $json  = json_encode($config);

        $existing = $model->forUser($cid, $uid, $key);
        if ($existing) {
            $model->skipValidation(true)->update($existing['id'], ['config' => $json]);
        } else {
            $model->insert(['client_id' => $cid, 'user_id' => $uid, 'table_key' => $key, 'config' => $json]);
        }

        return $this->respond(['message' => 'Layout saved', 'config' => $config]);
    }

    /**
     * GET /client/table-labels/(:segment) — the CLIENT-WIDE custom column names
     * for a table, shared by everyone in the client. Any signed-in client user
     * may read them; only the client admin may change them (see save below).
     */
    public function tableLabels(string $key)
    {
        if (! in_array($key, self::TABLE_PREF_KEYS, true)) {
            return $this->failNotFound('Unknown table.');
        }

        return $this->respond(['labels' => $this->tableLabelsFor($this->clientId(), $key)]);
    }

    /**
     * POST /client/table-labels/(:segment) — replace the client-wide custom
     * column names for a table. Client-admin only; staff see them read-only.
     * Body: { labels: { <columnKey>: <name>, ... } }. Empty names are dropped
     * (the column falls back to its built-in header).
     */
    public function saveTableLabels(string $key)
    {
        if (! in_array($key, self::TABLE_PREF_KEYS, true)) {
            return $this->failNotFound('Unknown table.');
        }
        if (! $this->isAdmin()) {
            return $this->failForbidden('Only the client admin can rename columns.');
        }

        $labels = $this->input('labels');
        $clean  = [];
        if (is_array($labels)) {
            foreach ($labels as $col => $name) {
                if (! is_string($col) || $col === '') {
                    continue;
                }
                $name = is_string($name) ? trim($name) : '';
                if ($name !== '') {
                    $clean[$col] = mb_substr($name, 0, 60);
                }
            }
        }

        $cid = $this->clientId();
        $this->upsertSetting(new SettingsModel(), $cid, 'table_labels.' . $key, (string) json_encode($clean));
        $this->logActivity('updated', 'settings', null, 'Renamed columns on the ' . $key . ' table', $cid);

        return $this->respond(['message' => 'Column names saved', 'labels' => $clean]);
    }

    /** Client-wide custom column names for a table (columnKey => label). */
    private function tableLabelsFor(int $cid, string $key): array
    {
        $row = (new SettingsModel())->where(['client_id' => $cid, 'setting_key' => 'table_labels.' . $key])->first();
        $val = $row ? json_decode((string) $row['setting_value'], true) : null;

        return is_array($val) ? $val : [];
    }

    /**
     * Whether the signed-in user may perform $action ('view'|'create'|'update'|
     * 'delete') on $module. The client-admin (account owner) implicitly holds
     * every permission; a staff user must be granted it by their role's
     * permission matrix or by their per-staff extra grants.
     */
    private function hasPerm(string $module, string $action): bool
    {
        $user = $this->currentUser();
        if (($user['role'] ?? null) === 'client_admin') {
            return true; // account owner has full rights
        }

        if (! empty($user['role_id'])) {
            $p = (new ClientRolePermissionModel())
                ->where(['role_id' => $user['role_id'], 'module' => $module])->first();
            if ($p && ! empty($p['can_' . $action])) {
                return true;
            }
        }

        if (! empty($user['staff_id'])) {
            $staff = (new ClientStaffModel())->find((int) $user['staff_id']);
            $extra = json_decode((string) ($staff['extra_permissions'] ?? ''), true);
            if (is_array($extra) && ! empty($extra[$module][$action])) {
                return true;
            }
        }

        return false;
    }

    /**
     * Guard a write action behind a permission. Returns a 403 response to
     * short-circuit the caller when the permission is missing, or null when the
     * action is allowed.
     */
    private function denyUnlessPerm(string $module, string $action)
    {
        return $this->hasPerm($module, $action)
            ? null
            : $this->failForbidden("You don't have permission to {$action} {$module}.");
    }

    /** GET /client/dashboard */
    public function dashboard()
    {
        $cid    = $this->clientId();
        $client = (new ClientModel())->find($cid);

        if (! $client) {
            return $this->failNotFound('Client not found');
        }
        unset($client['db_password'], $client['db_username']);

        $this->generateDueTaskAlerts();

        // Staff see only their own + their reports' tasks/people; admins see all.
        $scope    = $this->visibleStaffIds();
        $tasksQ   = (new ClientTaskModel())->where('client_id', $cid);
        if ($scope !== null) {
            $tasksQ->whereIn('assigned_to', $scope ?: [0]);
        }
        $allTasks = $tasksQ->orderBy('id', 'DESC')->findAll();
        $names    = $this->idNameMap((new ClientStaffModel())->where('client_id', $cid)->findAll());
        foreach ($allTasks as &$t) {
            $t['assignee_name'] = $t['assigned_to'] ? ($names[$t['assigned_to']] ?? null) : null;
            $t['overdue']       = $this->isOverdue($t);
        }
        unset($t);

        $taskSummary = $this->taskSummary($allTasks);

        // Upcoming: not-done tasks with a due date, soonest first (overdue included).
        $upcoming = array_values(array_filter($allTasks, static fn ($t) => $t['status'] !== 'done' && ! empty($t['due_date'])));
        usort($upcoming, static fn ($a, $b) => strcmp((string) $a['due_date'], (string) $b['due_date']));
        $upcoming = array_slice($upcoming, 0, 6);

        $staffCount = $scope === null
            ? (new ClientStaffModel())->where('client_id', $cid)->countAllResults()
            : count($scope);

        return $this->respond([
            'client'        => $client,
            'features'      => (new ClientFeatureModel())->getClientFeatures($cid),
            'stats'         => [
                'staff'         => $staffCount,
                'roles'         => (new ClientRoleModel())->where('client_id', $cid)->countAllResults(),
                'tasks_open'    => ($taskSummary['open'] ?? 0) + ($taskSummary['in_progress'] ?? 0),
            ],
            'task_summary'  => $taskSummary,
            'recent_tasks'  => array_slice($allTasks, 0, 5),
            'upcoming_tasks' => $upcoming,
        ]);
    }

    /** GET /client/settings */
    public function settings()
    {
        return $this->respond([
            'settings' => (new SettingsModel())->getSettingsForClient($this->clientId()),
            'modules'  => self::MODULES,
            'branding' => $this->brandingFor($this->clientId()),
        ]);
    }

    /**
     * GET /client/branding — the resolved branding/appearance config (defaults
     * merged with the client's saved settings). Loaded by the client shell to
     * theme the whole panel (colour, logo, menu order, mode, density, …).
     */
    public function branding()
    {
        return $this->respond(['branding' => $this->brandingFor($this->clientId())]);
    }

    /**
     * POST /client/settings — save branding/appearance settings. Only the
     * whitelisted BRANDING_DEFAULTS keys present in the body are written.
     */
    public function saveSettings()
    {
        if ($resp = $this->denyUnlessPerm('settings', 'update')) {
            return $resp;
        }

        $cid   = $this->clientId();
        $model = new SettingsModel();
        $body  = (array) $this->input();

        foreach (self::BRANDING_DEFAULTS as $key => $_default) {
            if (! array_key_exists($key, $body)) {
                continue; // only touch keys the client actually sent
            }
            $value = $body[$key];

            if ($key === 'menu_order') {
                $value = json_encode(is_array($value) ? array_values(array_map('strval', $value)) : []);
            } elseif ($key === 'brand_color') {
                $value = $this->sanitizeHexColor((string) $value);
            } else {
                $value = mb_substr(trim((string) $value), 0, 255);
            }

            $this->upsertSetting($model, $cid, $key, (string) $value);
        }

        $this->logActivity('updated', 'settings', null, 'Updated branding & appearance', $cid);

        return $this->respond(['message' => 'Appearance saved', 'branding' => $this->brandingFor($cid)]);
    }

    /** Resolved branding: defaults overlaid with the client's saved settings. */
    private function brandingFor(int $cid): array
    {
        $rows = (new SettingsModel())
            ->where('client_id', $cid)
            ->whereIn('setting_key', array_keys(self::BRANDING_DEFAULTS))
            ->findAll();

        $saved = [];
        foreach ($rows as $r) {
            $saved[$r['setting_key']] = $r['setting_value'];
        }

        $out = [];
        foreach (self::BRANDING_DEFAULTS as $key => $default) {
            $out[$key] = ($saved[$key] ?? '') !== '' ? $saved[$key] : $default;
        }

        // menu_order is stored as JSON; hand it back as an array.
        $order             = json_decode((string) ($saved['menu_order'] ?? ''), true);
        $out['menu_order'] = is_array($order) ? array_values($order) : [];

        return $out;
    }

    /** Insert or update a single setting key for a client. */
    private function upsertSetting(SettingsModel $model, int $cid, string $key, string $value): void
    {
        $existing = $model->where(['client_id' => $cid, 'setting_key' => $key])->first();
        if ($existing) {
            $model->skipValidation(true)->update($existing['id'], ['setting_value' => $value]);
        } else {
            $model->insert(['client_id' => $cid, 'setting_key' => $key, 'setting_value' => $value]);
        }
    }

    /** Validate a #rrggbb colour, falling back to the default brand colour. */
    private function sanitizeHexColor(string $hex): string
    {
        $hex = trim($hex);

        return preg_match('/^#[0-9a-fA-F]{6}$/', $hex) === 1
            ? strtolower($hex)
            : self::BRANDING_DEFAULTS['brand_color'];
    }

    /**
     * GET /client/features — the effective feature map for this client
     * (plan-tier preset merged with the super admin's per-client overrides).
     * Drives client-side gating of the sidebar and pages.
     */
    public function features()
    {
        $cid = $this->clientId();
        $svc = new \App\Libraries\FeatureService();

        return $this->respond([
            'features' => $svc->effective($cid),
            'limits'   => $svc->limits($cid),     // quota feature => int|null
            'usage'    => $this->featureUsage($cid),
        ]);
    }

    /** Current usage counts for quota features (drives "used / limit" in the UI). */
    private function featureUsage(int $cid): array
    {
        return [
            'team'        => (new ClientStaffModel())->where('client_id', $cid)->countAllResults(),
            'leads'       => 0, // leads module not built yet
            'lead_import' => 0,
        ];
    }

    /**
     * GET /client/billing — this client's plan, subscription window, pricing
     * and the features/limits/usage included in the plan. Read-only: plan
     * changes are handled by the platform admin.
     */
    public function billing()
    {
        $cid    = $this->clientId();
        $client = (new ClientModel())->find($cid);
        if (! $client) {
            return $this->failNotFound('Client not found');
        }

        $planKey = strtolower(trim((string) ($client['plan'] ?? 'starter'))) ?: 'starter';
        $svc     = new \App\Libraries\FeatureService();

        $effective = $svc->effective($cid);
        $limits    = $svc->limits($cid);
        $usage     = $this->featureUsage($cid);

        $features = [];
        foreach (\App\Libraries\FeatureService::CATALOG as $key => $meta) {
            $isQuota = in_array($key, \App\Libraries\FeatureService::QUOTA_FEATURES, true);
            $features[] = [
                'key'     => $key,
                'label'   => $meta['label'],
                'enabled' => $effective[$key] ?? false,
                'quota'   => $isQuota,
                'limit'   => $isQuota ? ($limits[$key] ?? null) : null, // null = unlimited
                'usage'   => $isQuota ? ($usage[$key] ?? 0) : null,
            ];
        }

        return $this->respond([
            'currency' => '₹',
            'client'   => [
                'name'       => $client['name'],
                'plan'       => $planKey,
                'status'     => $client['status'],
                'plan_start' => $client['plan_start'],
                'plan_end'   => $client['plan_end'],
                'created_at' => $client['created_at'],
            ],
            'plan'     => self::PLAN_CATALOG[$planKey] ?? self::PLAN_CATALOG['starter'],
            'catalog'  => array_values(self::PLAN_CATALOG),
            'features' => $features,
        ]);
    }

    /**
     * Throw-style guard: if a quota feature is at/over its limit, returns an
     * error response to send; otherwise null. ($count = current usage.)
     */
    private function overLimit(string $feature, int $count)
    {
        $limit = (new \App\Libraries\FeatureService())->limitFor($this->clientId(), $feature);
        if ($limit !== null && $count >= $limit) {
            return $this->fail("You've reached your plan limit ({$limit}). Contact your administrator to raise it.", 403);
        }

        return null;
    }

    // ----------------------------------------------------- EMAIL / INTEGRATIONS

    /** This client's settings as a flat key => value map. */
    private function settingsMap(): array
    {
        $map = [];
        foreach ((new SettingsModel())->getSettingsForClient($this->clientId()) as $row) {
            $map[$row['setting_key']] = $row['setting_value'];
        }

        return $map;
    }

    /** Insert or update one of this client's settings. */
    private function setSetting(string $key, ?string $value): void
    {
        $cid   = $this->clientId();
        $model = new SettingsModel();
        $row   = $model->where('client_id', $cid)->where('setting_key', $key)->first();

        if ($row) {
            $model->update($row['id'], ['setting_value' => $value]);
        } else {
            $model->insert(['client_id' => $cid, 'setting_key' => $key, 'setting_value' => $value]);
        }
    }

    /**
     * Per-client Gmail credentials shaped for GmailService's $override. Always
     * provides all three keys (even if blank) so the service uses THIS client's
     * settings and never falls back to the global .env account.
     */
    private function gmailOverride(?array $map = null): array
    {
        $map ??= $this->settingsMap();

        return [
            'gmail_user'         => (string) ($map['gmail_user'] ?? ''),
            'gmail_app_password' => (string) ($map['gmail_app_password'] ?? ''),
            'gmail_mailbox'      => (string) ($map['gmail_mailbox'] ?? ''),
        ];
    }

    /** GET /client/integrations/gmail — this client's Gmail inbox settings. */
    public function gmailSettings()
    {
        $map = $this->settingsMap();

        return $this->respond([
            'user'            => $map['gmail_user'] ?? '',
            'mailbox'         => $map['gmail_mailbox'] ?? '',
            'has_password'    => ! empty($map['gmail_app_password']),
            'configured'      => (new GmailService($this->gmailOverride($map)))->isConfigured(),
            'default_mailbox' => GmailService::DEFAULT_MAILBOX,
        ]);
    }

    /**
     * POST /client/integrations/gmail — save this client's Gmail settings.
     * Body: { user, app_password?, mailbox? }. A blank app_password is kept.
     */
    public function saveGmailSettings()
    {
        $user     = trim((string) $this->input('user'));
        $password = (string) $this->input('app_password');
        $mailbox  = trim((string) $this->input('mailbox'));

        if ($user !== '' && ! filter_var($user, FILTER_VALIDATE_EMAIL)) {
            return $this->failValidationErrors(['user' => 'Please enter a valid Gmail address.']);
        }

        $this->setSetting('gmail_user', $user);
        $this->setSetting('gmail_mailbox', $mailbox !== '' ? $mailbox : GmailService::DEFAULT_MAILBOX);

        $cleanPassword = str_replace(' ', '', $password);
        if ($cleanPassword !== '') {
            $this->setSetting('gmail_app_password', $cleanPassword);
        }

        $this->logActivity('updated', 'settings', $this->clientId(), 'Updated Gmail inbox settings', $this->clientId());

        return $this->gmailSettings();
    }

    /**
     * POST /client/integrations/gmail/test — try connecting with the saved (or
     * just-entered) credentials and report success or the exact error.
     */
    public function testGmailSettings()
    {
        $map      = $this->settingsMap();
        $user     = trim((string) $this->input('user'));
        $password = str_replace(' ', '', (string) $this->input('app_password'));
        $mailbox  = trim((string) $this->input('mailbox'));

        // Fall back to this client's stored password when the form left it blank.
        if ($password === '') {
            $password = (string) ($map['gmail_app_password'] ?? '');
        }

        $gmail = new GmailService([
            'gmail_user'         => $user !== '' ? $user : (string) ($map['gmail_user'] ?? ''),
            'gmail_app_password' => $password,
            'gmail_mailbox'      => $mailbox !== '' ? $mailbox : (string) ($map['gmail_mailbox'] ?? ''),
        ]);

        if (! $gmail->isConfigured()) {
            return $this->respond(['ok' => false, 'error' => 'Enter a Gmail address and App Password first.']);
        }

        try {
            $res = $gmail->listMessages(1, 1, '');
        } catch (\Throwable $e) {
            return $this->respond(['ok' => false, 'error' => $e->getMessage()]);
        }

        return $this->respond(['ok' => true, 'total' => $res['total']]);
    }

    /**
     * POST /client/integrations/email-test — send a one-off test email through
     * this client's own Gmail SMTP to confirm outgoing mail works. The frontend
     * asks for confirmation before calling this, since it sends a real email.
     */
    public function emailTest()
    {
        $to = trim((string) $this->input('to'));
        if ($to === '' || ! filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return $this->failValidationErrors(['to' => 'Enter a valid recipient email.']);
        }

        $mailer = new MailerService($this->gmailOverride());
        if (! $mailer->isConfigured()) {
            return $this->respond(['ok' => false, 'error' => 'Save your Gmail address and App Password first.']);
        }

        $html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b">'
            . '<p>This is a test email from your CRM workspace.</p>'
            . '<p>If you can read this, outgoing email (Gmail SMTP) is working. 🎉</p>'
            . '</div>';

        $result = $mailer->send($to, 'CRM — test email', $html, $this->currentUser()['name'] ?? null);

        $this->logActivity('updated', 'settings', $this->clientId(), 'Sent a test email to ' . $to . ($result['ok'] ? '' : ' (failed)'), $this->clientId());

        return $this->respond(['ok' => $result['ok'], 'error' => $result['ok'] ? null : ($result['error'] ?? 'Send failed.')]);
    }

    /** GET /client/inbox — a page of this client's Gmail, newest first. */
    public function inbox()
    {
        $page    = max(1, (int) ($this->request->getGet('page') ?? 1));
        $perPage = max(1, min(50, (int) ($this->request->getGet('per_page') ?? 12)));
        $q       = trim((string) ($this->request->getGet('q') ?? ''));

        $gmail = new GmailService($this->gmailOverride());
        if (! $gmail->isConfigured()) {
            return $this->respond([
                'configured' => false,
                'emails'     => [],
                'pagination' => ['page' => $page, 'per_page' => $perPage, 'total' => 0, 'total_pages' => 1],
            ]);
        }

        try {
            $res = $gmail->listMessages($page, $perPage, $q);
        } catch (\Throwable $e) {
            return $this->respond([
                'configured' => true,
                'error'      => $e->getMessage(),
                'emails'     => [],
                'pagination' => ['page' => $page, 'per_page' => $perPage, 'total' => 0, 'total_pages' => 1],
            ]);
        }

        $total = $res['total'];

        return $this->respond([
            'configured' => true,
            'emails'     => $res['rows'],
            'pagination' => [
                'page'        => $page,
                'per_page'    => $perPage,
                'total'       => $total,
                'total_pages' => (int) max(1, ceil($total / $perPage)),
            ],
        ]);
    }

    /** GET /client/inbox/{uid} — full body of one of this client's messages. */
    public function inboxMessage(int $uid)
    {
        $gmail = new GmailService($this->gmailOverride());
        if (! $gmail->isConfigured()) {
            return $this->failNotFound('Gmail is not configured.');
        }

        try {
            $message = $gmail->getMessage($uid);
        } catch (\Throwable $e) {
            return $this->fail($e->getMessage());
        }

        if (! $message) {
            return $this->failNotFound('Message not found.');
        }

        return $this->respond(['email' => $message]);
    }

    /** Per-client Google Calendar credentials shaped for the service $override. */
    private function calendarOverride(?array $map = null): array
    {
        $map ??= $this->settingsMap();

        return [
            'service_account' => (string) ($map['google_service_account'] ?? ''),
            'calendar_id'     => (string) ($map['google_calendar_id'] ?? ''),
        ];
    }

    /** GET /client/integrations/google-calendar — this client's Calendar settings. */
    public function googleCalendarSettings()
    {
        $map  = $this->settingsMap();
        $gcal = new GoogleCalendarService($this->calendarOverride($map));

        return $this->respond([
            'calendar_id'           => $map['google_calendar_id'] ?? '',
            'has_service_account'   => ! empty($map['google_service_account']),
            'service_account_email' => $gcal->getServiceAccountEmail(),
            'configured'            => $gcal->isConfigured(),
        ]);
    }

    /**
     * POST /client/integrations/google-calendar — save Calendar settings.
     * Body: { calendar_id, service_account? (JSON key) }. A blank key is kept.
     */
    public function saveGoogleCalendarSettings()
    {
        $calendarId = trim((string) $this->input('calendar_id'));
        $sa         = $this->input('service_account');

        if (is_string($sa) && trim($sa) !== '') {
            $decoded = json_decode($sa, true);
            if (! is_array($decoded) || empty($decoded['client_email']) || empty($decoded['private_key'])) {
                return $this->failValidationErrors([
                    'service_account' => 'That is not a valid service account JSON key (missing client_email / private_key).',
                ]);
            }
            $this->setSetting('google_service_account', json_encode($decoded));
        }

        $this->setSetting('google_calendar_id', $calendarId);

        $this->logActivity('updated', 'settings', $this->clientId(), 'Updated Google Calendar settings', $this->clientId());

        return $this->googleCalendarSettings();
    }

    /**
     * POST /client/integrations/google-calendar/test — verify access with the
     * saved (or just-entered) credentials and report success or the error.
     */
    public function testGoogleCalendarSettings()
    {
        $map        = $this->settingsMap();
        $sa         = $this->input('service_account');
        $calendarId = trim((string) $this->input('calendar_id'));

        $gcal = new GoogleCalendarService([
            'service_account' => is_string($sa) && trim($sa) !== '' ? $sa : (string) ($map['google_service_account'] ?? ''),
            'calendar_id'     => $calendarId !== '' ? $calendarId : (string) ($map['google_calendar_id'] ?? ''),
        ]);

        if (! $gcal->isConfigured()) {
            return $this->respond(['ok' => false, 'error' => 'Paste the service account JSON and the calendar ID first.']);
        }

        try {
            $info = $gcal->ping();
        } catch (\Throwable $e) {
            return $this->respond(['ok' => false, 'error' => $e->getMessage()]);
        }

        return $this->respond(['ok' => true, 'calendar' => $info['summary'] ?? $calendarId]);
    }

    // ---------------------------------------------------------------- ROLES

    /** GET /client/roles */
    public function roles()
    {
        if ($resp = $this->requirePermission('roles')) {
            return $resp;
        }
        $cid       = $this->clientId();
        $roles     = (new ClientRoleModel())->where('client_id', $cid)->orderBy('id', 'ASC')->findAll();
        $permModel = new ClientRolePermissionModel();

        $staffModel = new ClientStaffModel();
        foreach ($roles as &$r) {
            $map = [];
            foreach ($permModel->where('role_id', $r['id'])->findAll() as $p) {
                $map[$p['module']] = [
                    'view'   => (bool) $p['can_view'],
                    'create' => (bool) $p['can_create'],
                    'update' => (bool) $p['can_update'],
                    'delete' => (bool) $p['can_delete'],
                ];
            }
            $r['permissions'] = $map;
            // How many team members are on this role (drives the delete guard).
            $r['staff_count'] = $staffModel->where('client_id', $cid)->where('role_id', $r['id'])->countAllResults();
        }

        return $this->respond(['roles' => $roles, 'modules' => self::MODULES]);
    }

    /** POST /client/roles */
    public function createRole()
    {
        $cid   = $this->clientId();
        $model = new ClientRoleModel();
        $id    = $model->insert([
            'client_id'   => $cid,
            'name'        => trim((string) $this->input('name')),
            'description' => trim((string) ($this->input('description') ?? '')) ?: null,
        ]);

        if ($id === false) {
            return $this->failValidationErrors($model->errors());
        }

        $this->savePermissions($cid, (int) $id, (array) ($this->input('permissions') ?? []));
        $this->logActivity('created', 'role', (int) $id, 'Created role ' . $this->input('name'));

        return $this->respondCreated(['message' => 'Role created', 'id' => $id]);
    }

    /** POST /client/roles/{id} */
    public function updateRole(int $id)
    {
        $cid   = $this->clientId();
        $model = new ClientRoleModel();
        $role  = $model->where('client_id', $cid)->find($id);
        if (! $role) {
            return $this->failNotFound('Role not found');
        }

        $data = [];
        if (($n = $this->input('name')) !== null) {
            $data['name'] = trim((string) $n);
        }
        if (($d = $this->input('description')) !== null) {
            $data['description'] = trim((string) $d) ?: null;
        }
        if ($data) {
            $model->skipValidation(true)->update($id, $data);
        }

        if (($perms = $this->input('permissions')) !== null) {
            $this->savePermissions($cid, $id, (array) $perms);
        }
        $this->logActivity('updated', 'role', $id, 'Updated role');

        return $this->respond(['message' => 'Role updated']);
    }

    /** POST /client/roles/{id}/delete — soft delete, blocked while staff use it. */
    public function deleteRole(int $id)
    {
        $cid  = $this->clientId();
        $role = (new ClientRoleModel())->where('client_id', $cid)->find($id);
        if (! $role) {
            return $this->failNotFound('Role not found');
        }

        if (! empty($role['is_system'])) {
            return $this->fail('This is a system role and cannot be deleted.', 409);
        }

        // Guard: a role with team members assigned can't be removed until those
        // members are moved off it (re-assigned or removed).
        $assigned = (new ClientStaffModel())->where('client_id', $cid)->where('role_id', $id)->countAllResults();
        if ($assigned > 0) {
            return $this->fail(
                $assigned === 1
                    ? '1 team member is still on this role. Reassign or remove them first.'
                    : $assigned . ' team members are still on this role. Reassign or remove them first.',
                409
            );
        }

        // Soft delete (model flags deleted_at). Permission rows are kept so the
        // role can be restored later.
        (new ClientRoleModel())->delete($id);
        $this->logActivity('deleted', 'role', $id, 'Deleted role ' . ($role['name'] ?? ''));

        return $this->respond(['message' => 'Role deleted']);
    }

    /** Replace a role's permission matrix. */
    private function savePermissions(int $cid, int $roleId, array $permissions): void
    {
        $model = new ClientRolePermissionModel();
        $model->where('role_id', $roleId)->delete();

        $rows = [];
        foreach ($permissions as $module => $p) {
            if (! in_array($module, self::MODULES, true) || ! is_array($p)) {
                continue;
            }
            $rows[] = [
                'client_id'  => $cid,
                'role_id'    => $roleId,
                'module'     => $module,
                'can_view'   => ! empty($p['view']) ? 1 : 0,
                'can_create' => ! empty($p['create']) ? 1 : 0,
                'can_update' => ! empty($p['update']) ? 1 : 0,
                'can_delete' => ! empty($p['delete']) ? 1 : 0,
            ];
        }
        if ($rows) {
            $model->insertBatch($rows);
        }
    }

    // ----------------------------------------------------------------- LEADS
    //
    // Captured leads. status_id / sub_status_id point at lead_statuses (a
    // sub-status is a status with a parent_id); assigned_to points at staff.
    // Deletes are soft (the frontend confirms first).

    /** GET /client/leads — this client's leads, newest first, name-decorated. */
    public function leads()
    {
        $cid = $this->clientId();
        $q   = (new LeadModel())->where('client_id', $cid);

        // Staff see only leads assigned to themselves (or anyone reporting to them).
        $scope = $this->visibleStaffIds();
        if ($scope !== null) {
            $q->whereIn('assigned_to', $scope ?: [0]);
        }
        $rows = $q->orderBy('id', 'DESC')->findAll();

        $statusNames = $this->idNameMap($this->lookupRows(LeadStatusModel::class, $cid));
        $staffNames  = $this->idNameMap((new ClientStaffModel())->where('client_id', $cid)->findAll());
        $sourceNames = $this->idNameMap($this->lookupRows(LeadSourceModel::class, $cid));
        $typeNames   = $this->idNameMap($this->lookupRows(LeadTypeModel::class, $cid));

        // Reminders & notes per lead — for the latest-reminder column and the
        // follow-up status flag (orange upcoming / red overdue / green done).
        $remindersByLead = [];
        foreach ((new LeadReminderModel())->select('lead_id, remind_at')->where('client_id', $cid)->findAll() as $row) {
            $remindersByLead[(int) $row['lead_id']][] = $row['remind_at'];
        }
        $notesByLead = [];
        foreach ((new LeadNoteModel())->select('lead_id, created_at')->where('client_id', $cid)->findAll() as $row) {
            $notesByLead[(int) $row['lead_id']][] = $row['created_at'];
        }
        // Latest connected (answered) call per phone — for the "Last call" column.
        $callByPhone = [];
        foreach ((new CallLogModel())->select('contact, call_start')->where('client_id', $cid)->where('connected', 1)->findAll() as $row) {
            $k = (string) ($row['contact'] ?? '');
            if ($k === '' || $row['call_start'] === null) {
                continue;
            }
            if (! isset($callByPhone[$k]) || $row['call_start'] > $callByPhone[$k]) {
                $callByPhone[$k] = $row['call_start'];
            }
        }
        $today = date('Y-m-d'); // IST (app timezone)

        foreach ($rows as &$r) {
            $r['status']           = $r['status_id'] ? ($statusNames[(int) $r['status_id']] ?? null) : null;
            $r['sub_status']       = $r['sub_status_id'] ? ($statusNames[(int) $r['sub_status_id']] ?? null) : null;
            $r['assigned_to_name'] = $r['assigned_to'] ? ($staffNames[(int) $r['assigned_to']] ?? null) : null;
            $r['source']           = $r['source_id'] ? ($sourceNames[(int) $r['source_id']] ?? null) : null;
            $r['lead_type']        = $r['lead_type_id'] ? ($typeNames[(int) $r['lead_type_id']] ?? null) : null;

            $rem = $remindersByLead[(int) $r['id']] ?? [];
            $r['last_reminder_at'] = $rem ? max($rem) : null;
            $r['follow_flag']      = $this->followFlag($r['follow_date'], $rem, $notesByLead[(int) $r['id']] ?? [], $today);
            $r['last_call_at']     = $callByPhone[(string) ($r['phone'] ?? '')]
                ?? (($r['alt_phone'] ?? '') !== '' ? ($callByPhone[(string) $r['alt_phone']] ?? null) : null);
        }
        unset($r);

        return $this->respond(['leads' => $rows]);
    }

    /**
     * Follow-up status flag for the leads table:
     *   - 'upcoming' (orange): the follow-up date is still in the future.
     *   - 'done'     (green):  the follow-up is due/past AND a note was logged on
     *                          the follow-up date, after that day's reminder time
     *                          (evidence the lead was actually followed up).
     *   - 'overdue'  (red):    the follow-up is due/past with no such note.
     * Returns null when the lead has no follow-up date.
     */
    private function followFlag(?string $followDate, array $reminders, array $notes, string $today): ?string
    {
        if (empty($followDate)) {
            return null;
        }
        $fd = substr($followDate, 0, 10);
        if ($fd > $today) {
            return 'upcoming';
        }

        // The reminder set for the follow-up day (latest, if several); notes count
        // only when logged on that day at or after the reminder fired.
        $reminderAt = null;
        foreach ($reminders as $ra) {
            if (substr((string) $ra, 0, 10) === $fd && ($reminderAt === null || $ra > $reminderAt)) {
                $reminderAt = $ra;
            }
        }
        foreach ($notes as $na) {
            if (substr((string) $na, 0, 10) === $fd && ($reminderAt === null || $na >= $reminderAt)) {
                return 'done';
            }
        }

        return 'overdue';
    }

    /**
     * GET /client/lead-analytics — lead volume broken down by each pipeline
     * dimension, ready for bar charts: by status, sub-status, lead type,
     * marketing channel (the source's marketing type) and conversion stage.
     * Each series is a list of { label, value, color }, sorted high→low.
     */
    public function leadAnalytics()
    {
        $cid   = $this->clientId();
        $model = new LeadModel();

        $statuses  = $this->lookupRows(LeadStatusModel::class, $cid);
        $statusMap = [];
        foreach ($statuses as $s) {
            $statusMap[(int) $s['id']] = ['name' => $s['name'], 'color' => $s['color']];
        }
        $typeMap = [];
        foreach ($this->lookupRows(LeadTypeModel::class, $cid) as $t) {
            $typeMap[(int) $t['id']] = ['name' => $t['name'], 'color' => $t['color']];
        }
        $marketingMap = [];
        foreach ($this->lookupRows(MarketingTypeModel::class, $cid) as $m) {
            $marketingMap[(int) $m['id']] = ['name' => $m['name'], 'color' => $m['color']];
        }
        $sourceMap         = [];
        $sourceToMarketing = [];
        foreach ($this->lookupRows(LeadSourceModel::class, $cid) as $src) {
            $sourceMap[(int) $src['id']]         = ['name' => $src['name'], 'color' => $src['color']];
            $sourceToMarketing[(int) $src['id']] = $src['marketing_type_id'] !== null ? (int) $src['marketing_type_id'] : 0;
        }

        // Staff see only their own + their reports' leads; admins see everything.
        // Counts are scoped to match, so the figures line up with the leads table.
        $scope = $this->visibleStaffIds();

        // One grouped query per dimension.
        $statusCounts = $this->leadCountsBy($model, $cid, 'status_id', $scope);
        $subCounts    = $this->leadCountsBy($model, $cid, 'sub_status_id', $scope);
        $typeCounts   = $this->leadCountsBy($model, $cid, 'lead_type_id', $scope);
        $srcCounts    = $this->leadCountsBy($model, $cid, 'source_id', $scope);
        $totalQ       = (new LeadModel())->where('client_id', $cid);
        if ($scope !== null) {
            $totalQ->whereIn('assigned_to', $scope ?: [0]);
        }
        $total = $totalQ->countAllResults();

        // Parent statuses (no parent_id) vs sub-statuses (have a parent_id).
        $byStatus = [];
        $bySub    = [];
        foreach ($statusCounts as $sid => $c) {
            $meta       = $statusMap[$sid] ?? null;
            $byStatus[] = ['id' => $sid, 'label' => $meta['name'] ?? "#{$sid}", 'value' => $c, 'color' => $meta['color'] ?? 'slate'];
        }
        foreach ($subCounts as $sid => $c) {
            $meta    = $statusMap[$sid] ?? null;
            $bySub[] = ['id' => $sid, 'label' => $meta['name'] ?? "#{$sid}", 'value' => $c, 'color' => $meta['color'] ?? 'slate'];
        }

        $byType = [];
        foreach ($typeCounts as $tid => $c) {
            $meta     = $typeMap[$tid] ?? null;
            $byType[] = ['id' => $tid, 'label' => $meta['name'] ?? "#{$tid}", 'value' => $c, 'color' => $meta['color'] ?? 'slate'];
        }

        // Per lead source (used by the leads-page summary; clickable to filter).
        $bySource = [];
        foreach ($srcCounts as $srcId => $c) {
            $meta       = $sourceMap[$srcId] ?? null;
            $bySource[] = ['id' => $srcId, 'label' => $meta['name'] ?? "#{$srcId}", 'value' => $c, 'color' => $meta['color'] ?? 'slate'];
        }

        // Roll lead sources up to their marketing channel.
        $marketingCounts = [];
        foreach ($srcCounts as $srcId => $c) {
            $mid                   = $sourceToMarketing[$srcId] ?? 0;
            $marketingCounts[$mid] = ($marketingCounts[$mid] ?? 0) + $c;
        }
        $byMarketing = [];
        foreach ($marketingCounts as $mid => $c) {
            $meta          = $marketingMap[$mid] ?? null;
            $byMarketing[] = ['id' => $mid, 'label' => $meta['name'] ?? 'Unclassified', 'value' => $c, 'color' => $meta['color'] ?? 'slate'];
        }

        // Conversion stages: count leads whose status falls in each stage's group.
        $byConversion = [];
        foreach ($this->lookupRows(ConversionTypeModel::class, $cid) as $stage) {
            $ids = json_decode((string) ($stage['lead_status_ids'] ?? ''), true);
            $ids = is_array($ids) ? array_map('intval', $ids) : [];
            if (! $ids) {
                continue; // unmapped stage — nothing to count
            }
            $c = 0;
            foreach ($ids as $sid) {
                $c += $statusCounts[$sid] ?? 0;
            }
            $byConversion[] = ['id' => (int) $stage['id'], 'label' => $stage['name'], 'value' => $c, 'color' => $stage['color'] ?: 'slate'];
        }

        $sortDesc = static function (array $a) {
            usort($a, static fn ($x, $y) => $y['value'] <=> $x['value']);

            return $a;
        };

        return $this->respond([
            'total'         => $total,
            'by_status'     => $sortDesc($byStatus),
            'by_sub_status' => $sortDesc($bySub),
            'by_lead_type'  => $sortDesc($byType),
            'by_source'     => $sortDesc($bySource),
            'by_marketing'  => $sortDesc($byMarketing),
            'by_conversion' => $byConversion, // keep configured stage order
        ]);
    }

    /**
     * Lead counts grouped by a column (ignoring null/zero keys). When $scope is
     * a list of staff ids the counts are limited to leads assigned to them
     * (so a staff member's view matches the leads they can actually see).
     *
     * @param int[]|null $scope
     * @return array<int,int> column value => lead count
     */
    private function leadCountsBy(LeadModel $model, int $cid, string $column, ?array $scope = null): array
    {
        $b = $model->builder()
            ->select("{$column} AS k, COUNT(*) AS c")
            ->where('client_id', $cid)
            ->where("{$column} IS NOT NULL")
            ->where("{$column} >", 0)
            ->where('deleted_at', null);
        if ($scope !== null) {
            $b->whereIn('assigned_to', $scope ?: [0]);
        }
        $rows = $b->groupBy($column)->get()->getResultArray();

        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['k']] = (int) $r['c'];
        }

        return $out;
    }

    /** POST /client/leads — create one lead. */
    public function createLead()
    {
        $cid   = $this->clientId();
        $model = new LeadModel();
        $data  = $this->leadData($cid);
        // Stamp who captured the lead (used by the team-member leads view).
        $data['created_by'] = $this->actorId() ?: null;

        // System-managed dates — not editable from the lead form. Created date is
        // stamped today; assigned date is stamped only when the lead is assigned;
        // the follow-up date is driven by the reminders flow, not the form.
        $today                 = date('Y-m-d');
        $data['created_date']  = $today;
        $data['assigned_date'] = ! empty($data['assigned_to']) ? $today : null;
        $data['follow_date']   = null;

        $id = $model->insert($data);
        if ($id === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('created', 'lead', (int) $id, 'Added lead ' . ($data['name'] ?: $data['phone']));

        return $this->respondCreated(['message' => 'Created', 'id' => $id]);
    }

    /** POST /client/leads/{id} — update one lead. */
    public function updateLead(int $id)
    {
        $cid   = $this->clientId();
        $model = new LeadModel();
        $old   = $model->where('client_id', $cid)->find($id);
        if (! $old) {
            return $this->failNotFound('Lead not found');
        }

        $data = $this->leadData($cid);

        // System-managed dates — not editable from the lead form. Preserve the
        // stored created/follow-up dates, and re-stamp the assigned date only
        // when the lead's assignee actually changes (cleared when unassigned).
        unset($data['created_date'], $data['follow_date']);
        $oldAssigned = (int) ($old['assigned_to'] ?? 0);
        $newAssigned = (int) ($data['assigned_to'] ?? 0);
        if ($newAssigned === 0) {
            $data['assigned_date'] = null;
        } elseif ($newAssigned !== $oldAssigned) {
            $data['assigned_date'] = date('Y-m-d');
        } else {
            unset($data['assigned_date']);
        }

        if ($model->update($id, $data) === false) {
            return $this->failValidationErrors($model->errors());
        }

        // Record each meaningful change on the lead's activity timeline as its
        // own readable "from → to" entry; falls back to a generic note otherwise.
        $logged = false;

        if ((int) ($old['status_id'] ?? 0) !== (int) ($data['status_id'] ?? 0)) {
            $names = $this->idNameMap($this->lookupRows(LeadStatusModel::class, $cid));
            $from  = $old['status_id'] ? ($names[(int) $old['status_id']] ?? '—') : '—';
            $to    = $data['status_id'] ? ($names[(int) $data['status_id']] ?? '—') : '—';
            $this->logActivity('updated', 'lead', $id, "Status changed: {$from} → {$to}");
            $logged = true;
        }

        if ((int) ($old['assigned_to'] ?? 0) !== (int) ($data['assigned_to'] ?? 0)) {
            $staff = $this->idNameMap((new ClientStaffModel())->where('client_id', $cid)->findAll());
            $from  = $old['assigned_to'] ? ($staff[(int) $old['assigned_to']] ?? '—') : 'Unassigned';
            $to    = $data['assigned_to'] ? ($staff[(int) $data['assigned_to']] ?? '—') : 'Unassigned';
            $this->logActivity('updated', 'lead', $id, "Reassigned: {$from} → {$to}");
            $logged = true;
        }

        if ((int) ($old['source_id'] ?? 0) !== (int) ($data['source_id'] ?? 0)) {
            $names = $this->idNameMap($this->lookupRows(LeadSourceModel::class, $cid));
            $from  = $old['source_id'] ? ($names[(int) $old['source_id']] ?? '—') : 'None';
            $to    = $data['source_id'] ? ($names[(int) $data['source_id']] ?? '—') : 'None';
            $this->logActivity('updated', 'lead', $id, "Source changed: {$from} → {$to}");
            $logged = true;
        }

        if (! $logged) {
            $this->logActivity('updated', 'lead', $id, 'Updated lead details');
        }

        return $this->respond(['message' => 'Updated']);
    }

    /** POST /client/leads/{id}/delete — soft-delete one lead. */
    public function deleteLead(int $id)
    {
        $cid   = $this->clientId();
        $model = new LeadModel();
        $row   = $model->where('client_id', $cid)->find($id);
        if (! $row) {
            return $this->failNotFound('Lead not found');
        }
        $model->delete($id);
        $this->logActivity('deleted', 'lead', $id, 'Deleted lead ' . ($row['name'] ?? $row['phone'] ?? ''));

        return $this->respond(['message' => 'Deleted']);
    }

    /**
     * POST /client/leads/import — bulk-create leads from parsed CSV rows.
     * Body: { rows: [{ name, phone, status, ... }] }. Each row is validated
     * independently (phone 10 digits, status resolvable, email valid); valid
     * rows are inserted and the rest reported back by line number.
     */
    public function importLeads()
    {
        $cid  = $this->clientId();
        $rows = $this->input('rows');
        if (! is_array($rows) || $rows === []) {
            return $this->failValidationErrors(['rows' => 'No rows to import.']);
        }

        // Resolve statuses by name and staff by email-or-name, once.
        $statusByName = [];
        foreach ($this->lookupRows(LeadStatusModel::class, $cid) as $s) {
            $statusByName[mb_strtolower(trim((string) $s['name']))] = (int) $s['id'];
        }
        $staffByKey = [];
        foreach ((new ClientStaffModel())->where('client_id', $cid)->findAll() as $st) {
            if (! empty($st['email'])) {
                $staffByKey[mb_strtolower(trim((string) $st['email']))] = (int) $st['id'];
            }
            $staffByKey[mb_strtolower(trim((string) $st['name']))] = (int) $st['id'];
        }

        $model    = new LeadModel();
        $inserted = 0;
        $errors   = [];

        foreach ($rows as $i => $row) {
            $line  = (int) $i + 2; // +1 for the header row, +1 to be 1-based
            $row   = is_array($row) ? $row : [];
            $phone = preg_replace('/\D/', '', (string) ($row['phone'] ?? ''));
            if (strlen((string) $phone) !== 10) {
                $errors[] = ['row' => $line, 'message' => 'Phone must be exactly 10 digits.'];
                continue;
            }

            $statusKey = mb_strtolower(trim((string) ($row['status'] ?? '')));
            if ($statusKey === '' || ! isset($statusByName[$statusKey])) {
                $errors[] = ['row' => $line, 'message' => 'Status is required and must match an existing lead status.'];
                continue;
            }

            $email = trim((string) ($row['email'] ?? ''));
            if ($email !== '' && ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $errors[] = ['row' => $line, 'message' => 'Invalid email address.'];
                continue;
            }

            $subKey    = mb_strtolower(trim((string) ($row['sub_status'] ?? '')));
            $assignKey = mb_strtolower(trim((string) ($row['assigned'] ?? '')));
            $altPhone  = preg_replace('/\D/', '', (string) ($row['alt_phone'] ?? ''));

            $data = [
                'client_id'      => $cid,
                'name'           => trim((string) ($row['name'] ?? '')),
                'phone'          => $phone,
                'alt_phone'      => $altPhone !== '' ? $altPhone : null,
                'status_id'      => $statusByName[$statusKey],
                'sub_status_id'  => $subKey !== '' && isset($statusByName[$subKey]) ? $statusByName[$subKey] : null,
                'reference_name' => trim((string) ($row['reference_name'] ?? '')) ?: null,
                'email'          => $email !== '' ? $email : null,
                'assigned_to'    => $assignKey !== '' && isset($staffByKey[$assignKey]) ? $staffByKey[$assignKey] : null,
                'assigned_date'  => $this->normalizeDate($row['assigned_date'] ?? null),
                'city'           => trim((string) ($row['city'] ?? '')) ?: null,
                'state'          => trim((string) ($row['state'] ?? '')) ?: null,
                'follow_date'    => $this->normalizeDate($row['follow_date'] ?? null),
                'created_date'   => $this->normalizeDate($row['created_date'] ?? null),
                'created_by'     => $this->actorId() ?: null,
            ];

            if ($model->insert($data) === false) {
                $first    = $model->errors();
                $errors[] = ['row' => $line, 'message' => $first ? reset($first) : 'Could not save row.'];
                continue;
            }
            $inserted++;
        }

        $this->logActivity('created', 'lead', null, "Imported {$inserted} lead(s)" . ($errors ? ', ' . count($errors) . ' skipped' : ''));

        return $this->respond([
            'inserted' => $inserted,
            'failed'   => count($errors),
            'errors'   => array_slice($errors, 0, 50),
        ]);
    }

    /** Build a lead row from the request body, sanitising phones and dates. */
    private function leadData(int $cid): array
    {
        $phone    = preg_replace('/\D/', '', (string) $this->input('phone'));
        $altPhone = preg_replace('/\D/', '', (string) $this->input('alt_phone'));
        $statusId = $this->input('status_id');
        $subId    = $this->input('sub_status_id');
        $typeId   = $this->input('lead_type_id');
        $srcId    = $this->input('source_id');
        $assigned = $this->input('assigned_to');

        return [
            'client_id'      => $cid,
            // Stored as '' (not null) when blank: some tenant `leads` tables
            // predate this module and have a NOT NULL `name` column.
            'name'           => trim((string) $this->input('name')),
            'phone'          => $phone,
            'alt_phone'      => $altPhone !== '' ? $altPhone : null,
            'status_id'      => $statusId ? (int) $statusId : null,
            'sub_status_id'  => $subId ? (int) $subId : null,
            'lead_type_id'   => $typeId ? (int) $typeId : null,
            'source_id'      => $srcId ? (int) $srcId : null,
            'reference_name' => trim((string) $this->input('reference_name')) ?: null,
            'email'          => trim((string) $this->input('email')) ?: null,
            'assigned_to'    => $assigned ? (int) $assigned : null,
            'assigned_date'  => $this->normalizeDate($this->input('assigned_date')),
            'city'           => trim((string) $this->input('city')) ?: null,
            'state'          => trim((string) $this->input('state')) ?: null,
            'follow_date'    => $this->normalizeDate($this->input('follow_date')),
            'created_date'   => $this->normalizeDate($this->input('created_date')),
        ];
    }

    /** Normalise a date string to Y-m-d, or null when blank/unparseable. */
    private function normalizeDate($value): ?string
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }
        if (preg_match('/^\d{4}-\d{2}-\d{2}/', $value)) {
            return substr($value, 0, 10);
        }
        $ts = strtotime($value);

        return $ts ? date('Y-m-d', $ts) : null;
    }

    // -------------------------------------------- LEAD REMINDERS / NOTES / LOG
    //
    // A lead carries timed reminders, free-text notes, and an activity timeline
    // (drawn from the audit log). A reminder turns into a notification once its
    // remind_at passes — see remindersPoll(), which the client polls.

    /**
     * GET /client/leads/{id}/detail — the lead plus its reminders, notes and
     * activity timeline, for the detail drawer.
     */
    public function leadDetail(int $id)
    {
        $cid  = $this->clientId();
        $lead = (new LeadModel())->where('client_id', $cid)->find($id);
        if (! $lead) {
            return $this->failNotFound('Lead not found');
        }

        // Staff may only open leads assigned to themselves (or their reports).
        $scope = $this->visibleStaffIds();
        if ($scope !== null && ! in_array((int) ($lead['assigned_to'] ?? 0), $scope, true)) {
            return $this->failNotFound('Lead not found');
        }

        $statusNames = $this->idNameMap($this->lookupRows(LeadStatusModel::class, $cid));
        $staffNames  = $this->idNameMap((new ClientStaffModel())->where('client_id', $cid)->findAll());
        $lead['status']           = $lead['status_id'] ? ($statusNames[(int) $lead['status_id']] ?? null) : null;
        $lead['sub_status']       = $lead['sub_status_id'] ? ($statusNames[(int) $lead['sub_status_id']] ?? null) : null;
        $lead['assigned_to_name'] = $lead['assigned_to'] ? ($staffNames[(int) $lead['assigned_to']] ?? null) : null;

        $now       = date('Y-m-d H:i:s');
        $reminders = (new LeadReminderModel())->where('client_id', $cid)->where('lead_id', $id)
            ->orderBy('remind_at', 'ASC')->findAll();
        foreach ($reminders as &$r) {
            $r['due'] = $r['remind_at'] <= $now;
        }
        unset($r);

        $notes = (new LeadNoteModel())->where('client_id', $cid)->where('lead_id', $id)
            ->orderBy('id', 'DESC')->findAll();

        $activity = $this->activityLogModel('client_admin', $cid)
            ->where('client_id', $cid)->where('entity_type', 'lead')->where('entity_id', $id)
            ->orderBy('id', 'DESC')->findAll(100);

        // Call logs matched to this lead (by phone), newest first.
        $calls = (new CallLogModel())->where('client_id', $cid)->where('lead_id', $id)
            ->orderBy('call_start', 'DESC')->orderBy('id', 'DESC')->findAll();
        foreach ($calls as &$c) {
            $c['staff_name'] = $c['staff_id'] ? ($staffNames[(int) $c['staff_id']] ?? null) : null;
            $c['connected']  = (bool) $c['connected'];
        }
        unset($c);

        return $this->respond([
            'lead'      => $lead,
            'reminders' => $reminders,
            'notes'     => $notes,
            'activity'  => $activity,
            'calls'     => $calls,
        ]);
    }

    // ------------------------------------------------------------ CALL TRACKING

    /** Normalise a phone to its last 10 digits (drops +91 / formatting). */
    private function normalizePhone(?string $raw): string
    {
        $digits = preg_replace('/\D+/', '', (string) $raw);

        return $digits !== '' ? substr($digits, -10) : '';
    }

    /** Android CallLog numeric type → our direction label. */
    private function callDirection($t): string
    {
        switch ((int) $t) {
            case 1: return 'incoming';
            case 2: return 'outgoing';
            case 3:
            case 5: return 'missed';   // missed / rejected
            default: return 'outgoing';
        }
    }

    /** Parse a date string or UNIX timestamp into 'Y-m-d H:i:s', or null. */
    private function toDateTime($v): ?string
    {
        if ($v === '' || $v === null) {
            return null;
        }
        $ts = is_numeric($v) ? (int) $v : strtotime((string) $v);

        return $ts ? date('Y-m-d H:i:s', $ts) : null;
    }

    /**
     * Normalise either ingest payload into a flat list of call rows with keys:
     * contact, staff_contact, status, source, type, duration, call_start,
     * call_end. Returns null when nothing usable was sent.
     */
    private function parseCallPayload(): ?array
    {
        $body = (array) $this->input();

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
                    'call_start'    => $this->toDateTime($c['call_start'] ?? ''),
                    'call_end'      => $this->toDateTime($c['call_end'] ?? ''),
                ];
            }

            return $out;
        }

        // Legacy: POST field call_data = JSON { type, formData }
        $raw = $this->request->getPost('call_data') ?? ($body['call_data'] ?? null);
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
                'type'          => $this->callDirection($f['calls_type'] ?? 2),
                'duration'      => $f['call_duration'] ?? 0,
                'call_start'    => $this->toDateTime($f['startdate_time'] ?? ''),
                'call_end'      => $this->toDateTime($f['enddate_time'] ?? ''),
            ];
        }

        return $out;
    }

    /**
     * POST /client/call-logs — ingest call records from a client's external
     * call-logging app. Authenticated as the logged-in staff (session); calls
     * land in that staff's client DB, are matched to a lead by phone and to a
     * staff member by phone, and are flagged connected when answered.
     */
    public function createCallLogs()
    {
        $cid     = $this->clientId();
        $staffId = $this->staffId();

        $rows = $this->parseCallPayload();
        if ($rows === null) {
            return $this->failValidationErrors('No call data provided.');
        }
        if (! $rows) {
            return $this->respond(['status' => 1, 'message' => 'No calls to import.', 'inserted' => 0]);
        }

        // Phone → id maps for matching leads and staff within this client.
        $leadByPhone = [];
        foreach ((new LeadModel())->select('id, phone, alt_phone')->where('client_id', $cid)->findAll() as $l) {
            foreach ([$l['phone'] ?? '', $l['alt_phone'] ?? ''] as $p) {
                $k = $this->normalizePhone($p);
                if ($k !== '') {
                    $leadByPhone[$k] = (int) $l['id'];
                }
            }
        }
        $staffByPhone = [];
        foreach ((new ClientStaffModel())->select('id, phone, alt_phone')->where('client_id', $cid)->findAll() as $s) {
            foreach ([$s['phone'] ?? '', $s['alt_phone'] ?? ''] as $p) {
                $k = $this->normalizePhone($p);
                if ($k !== '') {
                    $staffByPhone[$k] = (int) $s['id'];
                }
            }
        }

        $model    = new CallLogModel();
        $inserted = 0;
        foreach ($rows as $row) {
            $contact      = $this->normalizePhone($row['contact'] ?? '');
            $staffContact = $this->normalizePhone($row['staff_contact'] ?? '');
            $rowStaffId   = ($staffContact !== '' && isset($staffByPhone[$staffContact])) ? $staffByPhone[$staffContact] : $staffId;
            $duration     = (int) ($row['duration'] ?? 0);

            $model->insert([
                'client_id'     => $cid,
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

        $this->logActivity('created', 'calls', null, "Synced {$inserted} call log(s)", $cid);

        return $this->respond(['status' => 1, 'message' => 'Call data saved.', 'inserted' => $inserted]);
    }

    /**
     * GET /client/calls — all active calls for the client (most recent first),
     * enriched with lead and staff names for the Calls activity page.
     */
    public function calls()
    {
        $cid = $this->clientId();
        $q   = (new CallLogModel())->where('client_id', $cid);

        // Staff see only their own calls (or their reports').
        $scope = $this->visibleStaffIds();
        if ($scope !== null) {
            $q->whereIn('staff_id', $scope ?: [0]);
        }
        $rows = $q->orderBy('call_start', 'DESC')->orderBy('id', 'DESC')->findAll();

        $staffNames = $this->idNameMap((new ClientStaffModel())->where('client_id', $cid)->findAll());
        $leadNames  = [];
        foreach ((new LeadModel())->select('id, name, phone')->where('client_id', $cid)->findAll() as $l) {
            $leadNames[(int) $l['id']] = ($l['name'] ?? '') !== '' ? $l['name'] : $l['phone'];
        }
        foreach ($rows as &$r) {
            $r['staff_name'] = $r['staff_id'] ? ($staffNames[(int) $r['staff_id']] ?? null) : null;
            $r['lead_name']  = $r['lead_id'] ? ($leadNames[(int) $r['lead_id']] ?? null) : null;
            $r['connected']  = (bool) $r['connected'];
        }
        unset($r);

        return $this->respond(['calls' => $rows]);
    }

    /**
     * GET /client/call-dashboard — aggregated call-tracking analytics for the
     * "Sales Call Tracker" dashboard, for one day (default today): KPIs (vs the
     * previous day), hourly distribution, calls by lead status, a per-rep
     * performance table, and a 7-day trend. Optional filters: assign (staff),
     * lead_status, lead_source, department, office (comma-separated ids).
     */
    public function callDashboard()
    {
        $cid  = $this->clientId();
        $date = (string) ($this->request->getGet('date') ?: date('Y-m-d'));
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            $date = date('Y-m-d');
        }

        $ids = function (string $k): array {
            $v = $this->request->getGet($k);
            if ($v === null || $v === '') {
                return [];
            }
            $v = is_array($v) ? $v : explode(',', (string) $v);

            return array_values(array_filter(array_map('intval', $v)));
        };
        $fStaff  = $ids('assign');
        $fStatus = $ids('lead_status');
        $fSource = $ids('lead_source');
        $fDept   = $ids('department');
        $fOffice = $ids('office');

        $windowStart = date('Y-m-d', strtotime("{$date} -6 day"));
        $prevDate    = date('Y-m-d', strtotime("{$date} -1 day"));

        // Lookups.
        $staffMap = [];
        foreach ((new ClientStaffModel())->where('client_id', $cid)->findAll() as $s) {
            $staffMap[(int) $s['id']] = ['name' => $s['name'], 'dept' => (int) ($s['department_id'] ?? 0), 'office' => (int) ($s['office_location_id'] ?? 0)];
        }
        $leadMap = [];
        foreach ((new LeadModel())->select('id, status_id, source_id')->where('client_id', $cid)->findAll() as $l) {
            $leadMap[(int) $l['id']] = ['status' => (int) ($l['status_id'] ?? 0), 'source' => (int) ($l['source_id'] ?? 0)];
        }
        $statusMeta = [];
        foreach ($this->lookupRows(LeadStatusModel::class, $cid) as $st) {
            $statusMeta[(int) $st['id']] = ['name' => $st['name'], 'color' => $st['color']];
        }

        // Window of calls (covers the day, the previous day, and the 7-day trend).
        $scope = $this->visibleStaffIds();
        $q     = (new CallLogModel())->where('client_id', $cid)
            ->where('call_start >=', "{$windowStart} 00:00:00")
            ->where('call_start <=', "{$date} 23:59:59");
        if ($scope !== null) {
            $q->whereIn('staff_id', $scope ?: [0]);
        }
        $calls = $q->findAll();

        // Apply filters (staff / lead status / lead source / department / office).
        $dayCalls = [];
        $prevCalls = [];
        $byDay     = [];
        foreach ($calls as $c) {
            $sid  = (int) ($c['staff_id'] ?? 0);
            $lead = $leadMap[(int) ($c['lead_id'] ?? 0)] ?? null;
            if ($fStaff && ! in_array($sid, $fStaff, true)) {
                continue;
            }
            if ($fStatus && (! $lead || ! in_array($lead['status'], $fStatus, true))) {
                continue;
            }
            if ($fSource && (! $lead || ! in_array($lead['source'], $fSource, true))) {
                continue;
            }
            $sm = $staffMap[$sid] ?? null;
            if ($fDept && (! $sm || ! in_array($sm['dept'], $fDept, true))) {
                continue;
            }
            if ($fOffice && (! $sm || ! in_array($sm['office'], $fOffice, true))) {
                continue;
            }
            $d            = substr((string) $c['call_start'], 0, 10);
            $byDay[$d][]  = $c;
            if ($d === $date) {
                $dayCalls[] = $c;
            } elseif ($d === $prevDate) {
                $prevCalls[] = $c;
            }
        }

        $kpi = static function (array $set): array {
            $conn = 0;
            $talk = 0;
            $uniq = [];
            foreach ($set as $c) {
                if (! empty($c['connected'])) {
                    $conn++;
                }
                $talk += (int) $c['duration'];
                if (! empty($c['contact'])) {
                    $uniq[(string) $c['contact']] = 1;
                }
            }
            $total = count($set);

            return [
                'total'        => $total,
                'unique'       => count($uniq),
                'connected'    => $conn,
                'talk_sec'     => $talk,
                'avg_sec'      => $total ? (int) round($talk / $total) : 0,
                'connect_rate' => $total ? (int) round(100 * $conn / $total) : 0,
            ];
        };
        $today = $kpi($dayCalls);
        $prev  = $kpi($prevCalls);
        $delta = static fn ($cur, $old) => $old ? (int) round(100 * ($cur - $old) / $old) : null;

        // Hourly distribution across office hours (9am–8pm).
        $hourly = [];
        for ($h = 9; $h <= 20; $h++) {
            $hourly[$h] = ['hour' => $h, 'calls' => 0, 'talk_sec' => 0];
        }
        foreach ($dayCalls as $c) {
            $h = (int) substr((string) $c['call_start'], 11, 2);
            if (isset($hourly[$h])) {
                $hourly[$h]['calls']++;
                $hourly[$h]['talk_sec'] += (int) $c['duration'];
            }
        }

        // Calls + talk time grouped by the lead's status.
        $statusAgg = [];
        foreach ($dayCalls as $c) {
            $lead = $leadMap[(int) ($c['lead_id'] ?? 0)] ?? null;
            if (! $lead || ! $lead['status']) {
                continue;
            }
            $sid = $lead['status'];
            $statusAgg[$sid] ??= ['calls' => 0, 'talk_sec' => 0];
            $statusAgg[$sid]['calls']++;
            $statusAgg[$sid]['talk_sec'] += (int) $c['duration'];
        }
        $byStatus = [];
        foreach ($statusAgg as $sid => $a) {
            $m          = $statusMeta[$sid] ?? ['name' => "#{$sid}", 'color' => 'slate'];
            $byStatus[] = ['label' => $m['name'], 'color' => $m['color'], 'calls' => $a['calls'], 'talk_sec' => $a['talk_sec']];
        }
        usort($byStatus, static fn ($a, $b) => $b['talk_sec'] <=> $a['talk_sec']);

        // Per-rep table. "Fresh" = the first call to a given lead that day.
        $firstByLead = [];
        foreach ($dayCalls as $i => $c) {
            $lid = (int) ($c['lead_id'] ?? 0);
            if (! $lid) {
                continue;
            }
            $t = (string) $c['call_start'];
            if (! isset($firstByLead[$lid]) || $t < $firstByLead[$lid]['t']) {
                $firstByLead[$lid] = ['t' => $t, 'i' => $i];
            }
        }
        $freshIdx = [];
        foreach ($firstByLead as $f) {
            $freshIdx[$f['i']] = true;
        }

        $reps = [];
        foreach ($dayCalls as $i => $c) {
            $sid = (int) ($c['staff_id'] ?? 0);
            if (! $sid) {
                continue;
            }
            $reps[$sid] ??= ['id' => $sid, 'name' => $staffMap[$sid]['name'] ?? "#{$sid}", 'total' => 0, 'uniq' => [], 'connected' => 0, 'talk_sec' => 0, 'fresh' => 0, 'fresh_connected' => 0, 'fresh_talk_sec' => 0];
            $reps[$sid]['total']++;
            if (! empty($c['contact'])) {
                $reps[$sid]['uniq'][(string) $c['contact']] = 1;
            }
            if (! empty($c['connected'])) {
                $reps[$sid]['connected']++;
            }
            $reps[$sid]['talk_sec'] += (int) $c['duration'];
            if (isset($freshIdx[$i])) {
                $reps[$sid]['fresh']++;
                if (! empty($c['connected'])) {
                    $reps[$sid]['fresh_connected']++;
                }
                $reps[$sid]['fresh_talk_sec'] += (int) $c['duration'];
            }
        }
        $repList = [];
        foreach ($reps as $r) {
            $r['unique']      = count($r['uniq']);
            unset($r['uniq']);
            $r['avg_sec']     = $r['total'] ? (int) round($r['talk_sec'] / $r['total']) : 0;
            $r['connect_pct'] = $r['total'] ? (int) round(100 * $r['connected'] / $r['total']) : 0;
            $repList[]        = $r;
        }
        usort($repList, static fn ($a, $b) => $b['total'] <=> $a['total']);

        // 7-day trend ending at the selected date.
        $trend = [];
        for ($d = 6; $d >= 0; $d--) {
            $dd   = date('Y-m-d', strtotime("{$date} -{$d} day"));
            $set  = $byDay[$dd] ?? [];
            $talk = 0;
            foreach ($set as $c) {
                $talk += (int) $c['duration'];
            }
            $trend[] = ['date' => $dd, 'calls' => count($set), 'avg_sec' => count($set) ? (int) round($talk / count($set)) : 0];
        }

        return $this->respond([
            'date'  => $date,
            'kpis'  => [
                'today' => $today,
                'prev'  => $prev,
                'delta' => [
                    'total'        => $delta($today['total'], $prev['total']),
                    'unique'       => $delta($today['unique'], $prev['unique']),
                    'avg_sec'      => $delta($today['avg_sec'], $prev['avg_sec']),
                    'connect_rate' => $delta($today['connect_rate'], $prev['connect_rate']),
                    'talk_sec'     => $delta($today['talk_sec'], $prev['talk_sec']),
                ],
            ],
            'hourly'    => array_values($hourly),
            'by_status' => $byStatus,
            'reps'      => $repList,
            'trend'     => $trend,
        ]);
    }

    /**
     * GET /client/followup-dashboard — follow-up performance, "as of" a date
     * (default today): KPIs (upcoming / due today / overdue / done +
     * completion %), the upcoming 7-day workload, overdue ageing buckets,
     * follow-ups by lead status, and a per-rep table. Same optional filters as
     * the call dashboard (assign, lead_status, lead_source, department, office).
     */
    public function followupDashboard()
    {
        $cid  = $this->clientId();
        $date = (string) ($this->request->getGet('date') ?: date('Y-m-d'));
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            $date = date('Y-m-d');
        }

        $ids = function (string $k): array {
            $v = $this->request->getGet($k);
            if ($v === null || $v === '') {
                return [];
            }
            $v = is_array($v) ? $v : explode(',', (string) $v);

            return array_values(array_filter(array_map('intval', $v)));
        };
        $fStaff  = $ids('assign');
        $fStatus = $ids('lead_status');
        $fSource = $ids('lead_source');
        $fDept   = $ids('department');
        $fOffice = $ids('office');

        // Optional follow-up date range (counts only follow-ups whose follow_date
        // falls between from..to). Status is still classified relative to $date
        // (today). Blank = all follow-ups.
        $dt   = function (string $k): string {
            $v = (string) ($this->request->getGet($k) ?? '');

            return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : '';
        };
        $from = $dt('from');
        $to   = $dt('to');
        if ($from !== '' && $to !== '' && $from > $to) {
            [$from, $to] = [$to, $from];
        }

        $staffMap = [];
        foreach ((new ClientStaffModel())->where('client_id', $cid)->findAll() as $s) {
            $staffMap[(int) $s['id']] = ['name' => $s['name'], 'dept' => (int) ($s['department_id'] ?? 0), 'office' => (int) ($s['office_location_id'] ?? 0)];
        }
        $statusMeta = [];
        $statusById = [];
        foreach ($this->lookupRows(LeadStatusModel::class, $cid) as $st) {
            $statusMeta[(int) $st['id']] = ['name' => $st['name'], 'color' => $st['color']];
            $statusById[(int) $st['id']] = $st;
        }
        // Resolve any (sub-)status to its top-level parent status id. Top-level
        // statuses are the "Prospect / Funnel / Callback" buckets; their
        // sub-statuses form each bucket's breakdown.
        $resolveTop = static function (int $id) use ($statusById): int {
            $seen = [];
            $cur  = $id;
            while ($cur && isset($statusById[$cur]) && ! isset($seen[$cur])) {
                $seen[$cur] = true;
                $s          = $statusById[$cur];
                $pid        = (int) ($s['parent_id'] ?? 0);
                if (! $pid) {
                    $pids = json_decode((string) ($s['parent_ids'] ?? ''), true);
                    $pid  = (is_array($pids) && $pids) ? (int) $pids[0] : 0;
                }
                if (! $pid) {
                    return $cur;
                }
                $cur = $pid;
            }

            return $cur ?: $id;
        };

        // Call attempts per lead → "ghosted" leads (3+ tries, none connected),
        // joining the call-tracking table to follow-ups. Also track the most
        // recent attempt for the "N days ago" column.
        $callStats = [];
        foreach ((new CallLogModel())->select('lead_id, connected, call_start')->where('client_id', $cid)->where('lead_id IS NOT NULL')->findAll() as $c) {
            $lid = (int) $c['lead_id'];
            $callStats[$lid] ??= ['attempts' => 0, 'connected' => 0, 'last' => null];
            $callStats[$lid]['attempts']++;
            if ((int) $c['connected']) {
                $callStats[$lid]['connected']++;
            }
            $cs = (string) ($c['call_start'] ?? '');
            if ($cs !== '' && ($callStats[$lid]['last'] === null || $cs > $callStats[$lid]['last'])) {
                $callStats[$lid]['last'] = $cs;
            }
        }

        // Leads with a follow-up date, scoped to who the user can see.
        $scope = $this->visibleStaffIds();
        $q     = (new LeadModel())->where('client_id', $cid)->where('follow_date IS NOT NULL')->where('follow_date !=', '');
        if ($scope !== null) {
            $q->whereIn('assigned_to', $scope ?: [0]);
        }
        $leads = $q->findAll();

        // Reminders + notes per lead → used to decide if a follow-up was actioned.
        $remByLead = [];
        foreach ((new LeadReminderModel())->select('lead_id, remind_at')->where('client_id', $cid)->findAll() as $row) {
            $remByLead[(int) $row['lead_id']][] = $row['remind_at'];
        }
        $notesByLead = [];
        foreach ((new LeadNoteModel())->select('lead_id, created_at')->where('client_id', $cid)->findAll() as $row) {
            $notesByLead[(int) $row['lead_id']][] = $row['created_at'];
        }

        $blank = ['total' => 0, 'upcoming' => 0, 'due_today' => 0, 'overdue' => 0, 'done' => 0];
        $tot   = $blank;
        $reps  = [];
        $statusAgg = [];
        $upDays    = [];
        for ($i = 0; $i <= 6; $i++) {
            $upDays[date('Y-m-d', strtotime("{$date} +{$i} day"))] = 0;
        }
        $aging = ['d1' => 0, 'd2' => 0, 'd3' => 0, 'd4plus' => 0];

        // Overview-card accumulators (the top summary in the screenshot).
        $completedToday = 0;   // follow-ups scheduled for `date` that are done
        $ghosted        = 0;   // not-done leads with 3+ calls, none connected
        $ghostedLeads   = [];  // the actual rows behind the ghosted count (for the list)
        $pendBuckets    = [];  // topStatusId => ['value'=>n, 'bd'=>[statusId=>n]] (due today, pending)
        $odBuckets      = [];  // topStatusId => n (overdue till now)

        // Configured follow-up groups (Leads Setup) drive the per-group "pending"
        // cards: each is a named set of lead statuses (e.g. Prospect = Hot + Warm).
        // When none are configured, fall back to auto top-level status grouping.
        $groupSets = [];
        foreach ($this->lookupRows(FollowupGroupModel::class, $cid) as $g) {
            $sids = json_decode((string) ($g['lead_status_ids'] ?? ''), true);
            $sids = is_array($sids) ? array_map('intval', $sids) : [];
            if (! $sids) {
                continue;
            }
            $groupSets[] = ['id' => (int) $g['id'], 'name' => $g['name'], 'color' => $g['color'], 'set' => array_fill_keys($sids, true)];
        }
        $useGroups = $groupSets !== [];
        $gPend     = [];  // groupId => ['value'=>n, 'bd'=>[statusId=>n]]
        $gOd       = [];  // groupId => n

        foreach ($leads as $l) {
            $sid  = (int) ($l['assigned_to'] ?? 0);
            $stId = (int) ($l['status_id'] ?? 0);
            if ($fStaff && ! in_array($sid, $fStaff, true)) {
                continue;
            }
            if ($fStatus && ! in_array($stId, $fStatus, true)) {
                continue;
            }
            if ($fSource && ! in_array((int) ($l['source_id'] ?? 0), $fSource, true)) {
                continue;
            }
            $sm = $staffMap[$sid] ?? null;
            if ($fDept && (! $sm || ! in_array($sm['dept'], $fDept, true))) {
                continue;
            }
            if ($fOffice && (! $sm || ! in_array($sm['office'], $fOffice, true))) {
                continue;
            }

            $fd = substr((string) $l['follow_date'], 0, 10);
            // Restrict to the selected follow-up date range, when set.
            if (($from !== '' && $fd < $from) || ($to !== '' && $fd > $to)) {
                continue;
            }
            $isDone = $this->followFlag($l['follow_date'], $remByLead[(int) $l['id']] ?? [], $notesByLead[(int) $l['id']] ?? [], $date) === 'done';
            if ($isDone) {
                $bucket = 'done';
            } elseif ($fd > $date) {
                $bucket = 'upcoming';
            } elseif ($fd === $date) {
                $bucket = 'due_today';
            } else {
                $bucket = 'overdue';
            }

            $tot['total']++;
            $tot[$bucket]++;

            // Per-rep tally.
            $reps[$sid] ??= ['id' => $sid, 'name' => $staffMap[$sid]['name'] ?? "#{$sid}", 'buckets' => []] + $blank;
            $reps[$sid]['total']++;
            $reps[$sid][$bucket]++;

            // By lead status — total + a per-bucket (done/upcoming/due/overdue) split.
            if ($stId) {
                $statusAgg[$stId]['count']  = ($statusAgg[$stId]['count'] ?? 0) + 1;
                $statusAgg[$stId][$bucket]  = ($statusAgg[$stId][$bucket] ?? 0) + 1;
            }

            // Upcoming workload (next 7 days incl. today) — not-done only.
            if ($bucket === 'upcoming' || $bucket === 'due_today') {
                if (isset($upDays[$fd])) {
                    $upDays[$fd]++;
                }
            }

            // Overdue ageing — exact days past due (1 / 2 / 3 / 4+).
            if ($bucket === 'overdue') {
                $age = (int) floor((strtotime($date) - strtotime($fd)) / 86400);
                $key = $age <= 1 ? 'd1' : ($age === 2 ? 'd2' : ($age === 3 ? 'd3' : 'd4plus'));
                $aging[$key]++;
            }

            // Overview cards: pending-today & overdue grouped by top-level status,
            // completed-today, and ghosted (3+ calls, none connected).
            $topId = $stId ? $resolveTop($stId) : 0;
            if ($bucket === 'due_today' && $topId) {
                $pendBuckets[$topId]['value']        = ($pendBuckets[$topId]['value'] ?? 0) + 1;
                $pendBuckets[$topId]['bd'][$stId]    = ($pendBuckets[$topId]['bd'][$stId] ?? 0) + 1;
            } elseif ($bucket === 'overdue' && $topId) {
                $odBuckets[$topId] = ($odBuckets[$topId] ?? 0) + 1;
            }
            // Per configured follow-up group: open follow-ups (due today + overdue),
            // broken down by the lead's status. A lead can match several groups.
            if ($useGroups && ($bucket === 'due_today' || $bucket === 'overdue')) {
                $subId = (int) ($l['sub_status_id'] ?? 0);
                $bdKey = $stId ?: $subId;
                foreach ($groupSets as $g) {
                    if (! isset($g['set'][$stId]) && ! ($subId && isset($g['set'][$subId]))) {
                        continue;
                    }
                    $gPend[$g['id']]['value']      = ($gPend[$g['id']]['value'] ?? 0) + 1;
                    $gPend[$g['id']]['bd'][$bdKey] = ($gPend[$g['id']]['bd'][$bdKey] ?? 0) + 1;
                    if ($bucket === 'overdue') {
                        $gOd[$g['id']] = ($gOd[$g['id']] ?? 0) + 1;
                    }
                }
            }
            // Per-rep pending split by top-level status (accountability table).
            if ($bucket !== 'done' && $topId) {
                $reps[$sid]['buckets'][$topId] = ($reps[$sid]['buckets'][$topId] ?? 0) + 1;
            }
            if ($fd === $date && $isDone) {
                $completedToday++;
            }
            if ($bucket !== 'done') {
                $cs = $callStats[(int) $l['id']] ?? null;
                if ($cs && $cs['attempts'] >= 3 && $cs['connected'] === 0) {
                    $ghosted++;
                    $sm2            = $statusMeta[$stId] ?? ['name' => null, 'color' => 'slate'];
                    $ghostedLeads[] = [
                        'id'         => (int) $l['id'],
                        'name'       => ($l['name'] ?? '') !== '' ? $l['name'] : $l['phone'],
                        'phone'      => $l['phone'] ?? null,
                        'counsellor' => $staffMap[$sid]['name'] ?? null,
                        'status'     => $sm2['name'],
                        'color'      => $sm2['color'],
                        'attempts'   => $cs['attempts'],
                        'last_call'  => $cs['last'],
                    ];
                }
            }
        }
        // Most-attempted ghosts first; cap the payload.
        usort($ghostedLeads, static fn ($a, $b) => $b['attempts'] <=> $a['attempts']);
        $ghostedLeads = array_slice($ghostedLeads, 0, 200);

        $pct = static fn ($done, $overdue) => ($done + $overdue) ? (int) round(100 * $done / ($done + $overdue)) : 0;

        $repList = [];
        foreach ($reps as $r) {
            $r['on_time_pct'] = $pct($r['done'], $r['overdue']);
            $repList[]        = $r;
        }
        usort($repList, static fn ($a, $b) => $b['total'] <=> $a['total']);

        $byStatus = [];
        foreach ($statusAgg as $stId => $a) {
            $m          = $statusMeta[$stId] ?? ['name' => "#{$stId}", 'color' => 'slate'];
            $count      = $a['count'] ?? 0;
            $done       = $a['done'] ?? 0;
            $byStatus[] = [
                'label' => $m['name'], 'color' => $m['color'], 'count' => $count,
                'completed' => $done, 'pending' => $count - $done,
                'upcoming' => $a['upcoming'] ?? 0, 'due_today' => $a['due_today'] ?? 0, 'overdue' => $a['overdue'] ?? 0,
            ];
        }
        usort($byStatus, static fn ($a, $b) => $b['count'] <=> $a['count']);

        // Pending / overdue buckets for the cards + alert banner. Driven by the
        // configured follow-up groups when present; else auto top-level status.
        $statusBd = function (array $bd): array {
            $out = [];
            foreach ($bd as $sId => $n) {
                $m     = $statusMeta[$sId] ?? ['name' => "#{$sId}", 'color' => 'slate'];
                $out[] = ['label' => $m['name'], 'color' => $m['color'], 'value' => $n];
            }
            usort($out, static fn ($a, $b) => $b['value'] <=> $a['value']);

            return $out;
        };

        $pendingBuckets = [];
        $overdueBuckets = [];
        if ($useGroups) {
            foreach ($groupSets as $g) {
                $info             = $gPend[$g['id']] ?? ['value' => 0, 'bd' => []];
                $pendingBuckets[] = ['id' => $g['id'], 'name' => $g['name'], 'color' => $g['color'], 'value' => $info['value'] ?? 0, 'breakdown' => $statusBd($info['bd'] ?? [])];
                $od               = $gOd[$g['id']] ?? 0;
                if ($od > 0) {
                    $overdueBuckets[] = ['id' => $g['id'], 'name' => $g['name'], 'color' => $g['color'], 'value' => $od];
                }
            }
        } else {
            foreach ($pendBuckets as $topId => $info) {
                $tm               = $statusMeta[$topId] ?? ['name' => "#{$topId}", 'color' => 'slate'];
                $pendingBuckets[] = ['id' => $topId, 'name' => $tm['name'], 'color' => $tm['color'], 'value' => $info['value'], 'breakdown' => $statusBd($info['bd'] ?? [])];
            }
            foreach ($odBuckets as $topId => $n) {
                $tm               = $statusMeta[$topId] ?? ['name' => "#{$topId}", 'color' => 'slate'];
                $overdueBuckets[] = ['id' => $topId, 'name' => $tm['name'], 'color' => $tm['color'], 'value' => $n];
            }
        }
        usort($pendingBuckets, static fn ($a, $b) => $b['value'] <=> $a['value']);
        usort($overdueBuckets, static fn ($a, $b) => $b['value'] <=> $a['value']);

        // All top-level statuses → the per-bucket columns of the accountability table.
        $topStatuses = [];
        foreach ($statusById as $id => $st) {
            $pid = (int) ($st['parent_id'] ?? 0);
            if (! $pid) {
                $pids = json_decode((string) ($st['parent_ids'] ?? ''), true);
                $pid  = (is_array($pids) && $pids) ? (int) $pids[0] : 0;
            }
            if (! $pid) {
                $topStatuses[] = ['id' => $id, 'name' => $st['name'], 'color' => $st['color'], 'seq' => (int) ($st['sequence'] ?? 0)];
            }
        }
        usort($topStatuses, static fn ($a, $b) => $a['seq'] <=> $b['seq']);
        $topStatuses = array_map(static fn ($s) => ['id' => $s['id'], 'name' => $s['name'], 'color' => $s['color']], $topStatuses);

        $scheduledToday = $tot['due_today'] + $completedToday;

        return $this->respond([
            'date' => $date,
            'from' => $from,
            'to'   => $to,
            'kpis' => [
                'total'      => $tot['total'],
                'upcoming'   => $tot['upcoming'],
                'due_today'  => $tot['due_today'],
                'overdue'    => $tot['overdue'],
                'done'       => $tot['done'],
                'completion' => $pct($tot['done'], $tot['overdue']),
            ],
            'by_flag' => [
                ['key' => 'upcoming', 'label' => 'Upcoming', 'value' => $tot['upcoming'], 'color' => '#f59e0b'],
                ['key' => 'due_today', 'label' => 'Due today', 'value' => $tot['due_today'], 'color' => '#6366f1'],
                ['key' => 'overdue', 'label' => 'Overdue', 'value' => $tot['overdue'], 'color' => '#f43f5e'],
                ['key' => 'done', 'label' => 'Done', 'value' => $tot['done'], 'color' => '#10b981'],
            ],
            'upcoming_days' => array_map(static fn ($d, $n) => ['date' => $d, 'count' => $n], array_keys($upDays), array_values($upDays)),
            'overdue_aging' => [
                ['key' => 'due_today', 'label' => 'Due today', 'count' => $tot['due_today']],
                ['key' => 'd1', 'label' => '1 day overdue', 'count' => $aging['d1']],
                ['key' => 'd2', 'label' => '2 days overdue', 'count' => $aging['d2']],
                ['key' => 'd3', 'label' => '3 days overdue', 'count' => $aging['d3']],
                ['key' => 'd4plus', 'label' => '4+ days overdue', 'count' => $aging['d4plus']],
            ],
            'by_status'     => $byStatus,
            'reps'          => $repList,
            // Top summary cards + overdue alert banner.
            'overview' => [
                'total_due'  => $tot['due_today'],
                'scheduled'  => $scheduledToday,
                'completed'  => $completedToday,
                'completion' => $scheduledToday ? (int) round(100 * $completedToday / $scheduledToday) : 0,
                'target'     => 85,
                'overdue'    => $tot['overdue'],
                'future'     => $tot['upcoming'],
                'ghosted'    => $ghosted,
            ],
            'pending_buckets' => $pendingBuckets,
            'overdue_buckets' => $overdueBuckets,
            'top_statuses'    => $topStatuses,
            'ghosted_leads'   => $ghostedLeads,
        ]);
    }

    /** POST /client/leads/{id}/reminders — schedule a future reminder. */
    public function createReminder(int $id)
    {
        $cid  = $this->clientId();
        $lead = (new LeadModel())->where('client_id', $cid)->find($id);
        if (! $lead) {
            return $this->failNotFound('Lead not found');
        }

        $remindAt = strtotime((string) $this->input('remind_at'));
        if (! $remindAt) {
            return $this->failValidationErrors(['remind_at' => 'Pick a valid date and time.']);
        }
        if ($remindAt <= time()) {
            return $this->failValidationErrors(['remind_at' => 'The reminder time must be in the future.']);
        }

        $model = new LeadReminderModel();
        $rid   = $model->insert([
            'client_id' => $cid,
            'lead_id'   => $id,
            'user_id'   => (int) ($this->currentUser()['id'] ?? 0),
            'remind_at' => date('Y-m-d H:i:s', $remindAt),
            'note'      => trim((string) $this->input('note')) ?: null,
        ]);
        if ($rid === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('created', 'lead', $id, 'Set a reminder for ' . date('d M Y, g:i A', $remindAt));

        return $this->respondCreated(['message' => 'Reminder set', 'id' => $rid]);
    }

    /** POST /client/lead-reminders/{id}/delete — soft-delete a reminder. */
    public function deleteReminder(int $rid)
    {
        $cid   = $this->clientId();
        $model = new LeadReminderModel();
        $row   = $model->where('client_id', $cid)->find($rid);
        if (! $row) {
            return $this->failNotFound('Reminder not found');
        }
        $model->delete($rid);
        $this->logActivity('deleted', 'lead', (int) $row['lead_id'], 'Removed a reminder');

        return $this->respond(['message' => 'Deleted']);
    }

    /** POST /client/leads/{id}/notes — add a note to a lead. */
    public function createNote(int $id)
    {
        $cid  = $this->clientId();
        $lead = (new LeadModel())->where('client_id', $cid)->find($id);
        if (! $lead) {
            return $this->failNotFound('Lead not found');
        }

        $body = trim((string) $this->input('body'));
        if ($body === '') {
            return $this->failValidationErrors(['body' => 'Write something first.']);
        }

        $user  = $this->currentUser();
        $model = new LeadNoteModel();
        $nid   = $model->insert([
            'client_id'   => $cid,
            'lead_id'     => $id,
            'author_id'   => (int) ($user['id'] ?? 0),
            'author_name' => $user['name'] ?? ($user['email'] ?? 'You'),
            'body'        => $body,
        ]);
        if ($nid === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('created', 'lead', $id, 'Added a note');

        return $this->respondCreated(['message' => 'Note added', 'id' => $nid]);
    }

    /** POST /client/lead-notes/{id}/delete — soft-delete a note. */
    public function deleteNote(int $nid)
    {
        $cid   = $this->clientId();
        $model = new LeadNoteModel();
        $row   = $model->where('client_id', $cid)->find($nid);
        if (! $row) {
            return $this->failNotFound('Note not found');
        }
        $model->delete($nid);
        $this->logActivity('deleted', 'lead', (int) $row['lead_id'], 'Removed a note');

        return $this->respond(['message' => 'Deleted']);
    }

    /**
     * GET /client/reminders/poll — materialise any now-due reminders for the
     * signed-in user into app notifications (once each), so the client's
     * notification poll surfaces them. Ungated so every client can call it.
     */
    public function remindersPoll()
    {
        $cid    = $this->clientId();
        $userId = (int) ($this->currentUser()['id'] ?? 0);
        if (! $cid || ! $userId) {
            return $this->respond(['due' => 0]);
        }

        $model = new LeadReminderModel();
        $due   = $model->where('client_id', $cid)->where('user_id', $userId)
            ->where('notified_at', null)->where('done', 0)
            ->where('remind_at <=', date('Y-m-d H:i:s'))
            ->orderBy('remind_at', 'ASC')->findAll(20);

        if (! $due) {
            return $this->respond(['due' => 0]);
        }

        $leadNames = $this->idNameMap((new LeadModel())->where('client_id', $cid)->findAll());
        $notif     = new AppNotificationModel();
        foreach ($due as $r) {
            $lead = $leadNames[(int) $r['lead_id']] ?? ('Lead #' . $r['lead_id']);
            $notif->insert([
                'recipient_type' => 'user',
                'recipient_id'   => $userId,
                'type'           => 'lead_reminder',
                'title'          => 'Lead reminder: ' . ($lead !== '' ? $lead : ('Lead #' . $r['lead_id'])),
                'body'           => $r['note'] ?: 'You set a reminder for this lead.',
                'link'           => '/client/leads',
            ]);
            $model->update($r['id'], ['notified_at' => date('Y-m-d H:i:s')]);
        }

        return $this->respond(['due' => count($due)]);
    }

    // ----------------------------------------------------------- LEADS SETUP
    //
    // Client-scoped lookup tables that configure the leads pipeline. They all
    // share name/color/sequence/enabled and live in the client's tenant DB.
    // Generic helpers below back the per-entity endpoints; statuses, sources
    // and conversions layer on their own extra columns.

    /** GET /client/leads-setup — every lookup list in one payload. */
    public function leadsSetup()
    {
        if ($resp = $this->requirePermission('leads_setup')) {
            return $resp;
        }
        $cid = $this->clientId();

        return $this->respond([
            'lead_statuses'    => $this->decorateStatuses($cid),
            'lead_sources'     => $this->decorateSources($cid),
            'marketing_types'  => $this->lookupRows(MarketingTypeModel::class, $cid),
            'lead_types'       => $this->lookupRows(LeadTypeModel::class, $cid),
            'conversion_types' => $this->decorateConversions($cid),
            'followup_groups'  => $this->decorateFollowupGroups($cid),
        ]);
    }

    // --- Lead statuses ---------------------------------------------------

    public function leadStatuses()
    {
        return $this->respond(['lead_statuses' => $this->decorateStatuses($this->clientId())]);
    }

    public function createLeadStatus()
    {
        return $this->saveLookup(LeadStatusModel::class, 'lead status', fn () => $this->statusExtra());
    }

    public function updateLeadStatus(int $id)
    {
        return $this->saveLookup(LeadStatusModel::class, 'lead status', fn () => $this->statusExtra(), $id);
    }

    public function deleteLeadStatus(int $id)
    {
        return $this->deleteLookup(LeadStatusModel::class, 'lead status', $id);
    }

    public function reorderLeadStatuses()
    {
        return $this->reorderLookup(LeadStatusModel::class);
    }

    private function statusExtra(): array
    {
        // A sub-status can belong to multiple parent statuses. `parent_ids` is the
        // multi-parent source of truth; `parent_id` keeps the first entry so
        // top-vs-sub detection and any legacy single-parent code still work.
        $ids = array_values(array_unique(array_filter(
            array_map('intval', (array) ($this->input('parent_ids') ?? [])),
            static fn ($v) => $v > 0,
        )));

        // Fall back to a single parent_id if only that was sent.
        if (! $ids && $this->input('parent_id')) {
            $ids = [(int) $this->input('parent_id')];
        }

        return [
            'conversion_type' => trim((string) ($this->input('conversion_type') ?? 'open')) ?: 'open',
            'parent_ids'      => json_encode($ids),
            'parent_id'       => $ids ? (int) reset($ids) : null,
        ];
    }

    /** Lead statuses with parent_ids decoded to int[] + resolved parent names. */
    private function decorateStatuses(int $cid): array
    {
        $rows  = $this->lookupRows(LeadStatusModel::class, $cid);
        $names = [];
        foreach ($rows as $s) {
            $names[(int) $s['id']] = $s['name'];
        }
        foreach ($rows as &$r) {
            $ids = json_decode((string) ($r['parent_ids'] ?? ''), true);
            $ids = is_array($ids) ? array_values(array_filter(array_map('intval', $ids))) : [];
            if (! $ids && ! empty($r['parent_id'])) {
                $ids = [(int) $r['parent_id']]; // legacy single-parent fallback
            }
            $r['parent_ids']   = $ids;
            $r['parent_names'] = array_values(array_filter(array_map(static fn ($i) => $names[$i] ?? null, $ids)));
        }
        unset($r);

        return $rows;
    }

    // --- Marketing types -------------------------------------------------

    public function marketingTypes()
    {
        return $this->respond(['marketing_types' => $this->lookupRows(MarketingTypeModel::class, $this->clientId())]);
    }

    public function createMarketingType()
    {
        return $this->saveLookup(MarketingTypeModel::class, 'marketing type', fn () => []);
    }

    public function updateMarketingType(int $id)
    {
        return $this->saveLookup(MarketingTypeModel::class, 'marketing type', fn () => [], $id);
    }

    public function deleteMarketingType(int $id)
    {
        return $this->deleteLookup(MarketingTypeModel::class, 'marketing type', $id);
    }

    public function reorderMarketingTypes()
    {
        return $this->reorderLookup(MarketingTypeModel::class);
    }

    // --- Lead sources ----------------------------------------------------

    public function leadSources()
    {
        return $this->respond(['lead_sources' => $this->decorateSources($this->clientId())]);
    }

    public function createLeadSource()
    {
        return $this->saveLookup(LeadSourceModel::class, 'lead source', fn () => $this->sourceExtra());
    }

    public function updateLeadSource(int $id)
    {
        return $this->saveLookup(LeadSourceModel::class, 'lead source', fn () => $this->sourceExtra(), $id);
    }

    public function deleteLeadSource(int $id)
    {
        return $this->deleteLookup(LeadSourceModel::class, 'lead source', $id);
    }

    public function reorderLeadSources()
    {
        return $this->reorderLookup(LeadSourceModel::class);
    }

    private function sourceExtra(): array
    {
        $mt = $this->input('marketing_type_id');

        return ['marketing_type_id' => $mt ? (int) $mt : null];
    }

    // --- Lead types ------------------------------------------------------

    public function leadTypes()
    {
        return $this->respond(['lead_types' => $this->lookupRows(LeadTypeModel::class, $this->clientId())]);
    }

    public function createLeadType()
    {
        return $this->saveLookup(LeadTypeModel::class, 'lead type', fn () => []);
    }

    public function updateLeadType(int $id)
    {
        return $this->saveLookup(LeadTypeModel::class, 'lead type', fn () => [], $id);
    }

    public function deleteLeadType(int $id)
    {
        return $this->deleteLookup(LeadTypeModel::class, 'lead type', $id);
    }

    public function reorderLeadTypes()
    {
        return $this->reorderLookup(LeadTypeModel::class);
    }

    // --- Conversion types ------------------------------------------------

    public function conversionTypes()
    {
        return $this->respond(['conversion_types' => $this->decorateConversions($this->clientId())]);
    }

    public function createConversionType()
    {
        return $this->saveLookup(ConversionTypeModel::class, 'conversion type', fn () => $this->conversionExtra());
    }

    public function updateConversionType(int $id)
    {
        return $this->saveLookup(ConversionTypeModel::class, 'conversion type', fn () => $this->conversionExtra(), $id);
    }

    public function deleteConversionType(int $id)
    {
        return $this->deleteLookup(ConversionTypeModel::class, 'conversion type', $id);
    }

    public function reorderConversionTypes()
    {
        return $this->reorderLookup(ConversionTypeModel::class);
    }

    // --- Follow-up groups ------------------------------------------------
    // A named bucket grouping several lead statuses (e.g. "Prospect" = Hot +
    // Warm). Drives the Follow Up Tracker's per-group pending/overdue cards.

    public function followupGroups()
    {
        return $this->respond(['followup_groups' => $this->decorateFollowupGroups($this->clientId())]);
    }

    public function createFollowupGroup()
    {
        return $this->saveLookup(FollowupGroupModel::class, 'follow-up group', fn () => $this->followupGroupExtra());
    }

    public function updateFollowupGroup(int $id)
    {
        return $this->saveLookup(FollowupGroupModel::class, 'follow-up group', fn () => $this->followupGroupExtra(), $id);
    }

    public function deleteFollowupGroup(int $id)
    {
        return $this->deleteLookup(FollowupGroupModel::class, 'follow-up group', $id);
    }

    public function reorderFollowupGroups()
    {
        return $this->reorderLookup(FollowupGroupModel::class);
    }

    private function followupGroupExtra(): array
    {
        $ids = array_values(array_unique(array_map('intval', (array) ($this->input('lead_status_ids') ?? []))));

        return ['lead_status_ids' => json_encode($ids)];
    }

    /** Follow-up groups with lead_status_ids decoded and lead_statuses resolved. */
    private function decorateFollowupGroups(int $cid): array
    {
        $rows = $this->lookupRows(FollowupGroupModel::class, $cid);
        $byId = [];
        foreach ($this->lookupRows(LeadStatusModel::class, $cid) as $s) {
            $byId[(int) $s['id']] = ['id' => (int) $s['id'], 'name' => $s['name'], 'color' => $s['color']];
        }
        foreach ($rows as &$r) {
            $ids                  = json_decode((string) ($r['lead_status_ids'] ?? ''), true);
            $ids                  = is_array($ids) ? array_map('intval', $ids) : [];
            $r['lead_status_ids'] = $ids;
            $r['lead_statuses']   = array_values(array_filter(array_map(static fn ($i) => $byId[$i] ?? null, $ids)));
        }
        unset($r);

        return $rows;
    }

    private function conversionExtra(): array
    {
        // A conversion type groups multiple lead statuses and carries a win %.
        // In auto mode the % is computed from live lead counts (see
        // decorateConversions), so the stored percentage is left at 0.
        $ids  = array_values(array_unique(array_map('intval', (array) ($this->input('lead_status_ids') ?? []))));
        $auto = ! empty($this->input('auto_percentage'));
        $pct  = max(0, min(100, (int) ($this->input('percentage') ?? 0)));

        return [
            'lead_status_ids' => json_encode($ids),
            'auto_percentage' => $auto ? 1 : 0,
            'percentage'      => $auto ? 0 : $pct,
        ];
    }

    /**
     * Auto-calculated conversion %: (leads whose status is in $statusIds) ÷
     * (total leads) × 100, rounded. Returns 0 when there are no leads yet.
     */
    private function computeConversionPct(int $cid, array $statusIds): int
    {
        if (! $statusIds) {
            return 0;
        }
        $counts = $this->leadStatusCounts($cid);
        $total  = array_sum($counts);
        if ($total === 0) {
            return 0;
        }
        $hit = 0;
        foreach ($statusIds as $sid) {
            $hit += $counts[(int) $sid] ?? 0;
        }

        return (int) round($hit / $total * 100);
    }

    /**
     * Lead count per status_id for a client, computed once and memoised for the
     * request (conversion decoration calls it per stage).
     *
     * @return array<int,int> status_id => lead count
     */
    private function leadStatusCounts(int $cid): array
    {
        static $cache = [];
        if (isset($cache[$cid])) {
            return $cache[$cid];
        }
        $rows = (new LeadModel())
            ->select('status_id, COUNT(*) AS c')
            ->where('client_id', $cid)
            ->where('status_id IS NOT NULL')
            ->groupBy('status_id')
            ->findAll();

        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['status_id']] = (int) $r['c'];
        }

        return $cache[$cid] = $out;
    }

    // --- Shared lookup helpers -------------------------------------------

    /** Client-scoped rows for a lookup table, ordered by sequence then id. */
    private function lookupRows(string $modelClass, int $cid): array
    {
        return (new $modelClass())
            ->where('client_id', $cid)
            ->orderBy('sequence', 'ASC')
            ->orderBy('id', 'ASC')
            ->findAll();
    }

    /**
     * Create (when $id is null) or update a lookup row. $extra returns any
     * columns beyond the shared name/color, read from the request body.
     */
    private function saveLookup(string $modelClass, string $entity, callable $extra, ?int $id = null)
    {
        $cid   = $this->clientId();
        $model = new $modelClass();

        if ($id !== null && ! $model->where('client_id', $cid)->find($id)) {
            return $this->failNotFound(ucfirst($entity) . ' not found');
        }

        $data = array_merge([
            'client_id' => $cid,
            'name'      => trim((string) $this->input('name')),
            'color'     => trim((string) ($this->input('color') ?? 'indigo')) ?: 'indigo',
        ], $extra());

        if ($id === null) {
            $newId = $model->insert($data);
            if ($newId === false) {
                return $this->failValidationErrors($model->errors());
            }
            $this->logActivity('created', $entity, (int) $newId, 'Added ' . $entity . ' ' . $data['name']);

            return $this->respondCreated(['message' => 'Created', 'id' => $newId]);
        }

        if ($model->update($id, $data) === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('updated', $entity, $id, 'Updated ' . $entity . ' ' . $data['name']);

        return $this->respond(['message' => 'Updated']);
    }

    private function deleteLookup(string $modelClass, string $entity, int $id)
    {
        $cid   = $this->clientId();
        $model = new $modelClass();
        $row   = $model->where('client_id', $cid)->find($id);
        if (! $row) {
            return $this->failNotFound(ucfirst($entity) . ' not found');
        }
        $model->delete($id);
        $this->logActivity('deleted', $entity, $id, 'Deleted ' . $entity . ' ' . ($row['name'] ?? ''));

        return $this->respond(['message' => 'Deleted']);
    }

    /** Persist a new ordering: the request's `order` array is row ids in sequence. */
    private function reorderLookup(string $modelClass)
    {
        $cid   = $this->clientId();
        $order = (array) ($this->input('order') ?? []);
        $model = new $modelClass();
        foreach ($order as $i => $rowId) {
            $model->where('client_id', $cid)->update((int) $rowId, ['sequence' => (int) $i]);
        }

        return $this->respond(['message' => 'Reordered']);
    }

    /** Lead sources decorated with their marketing type's display name. */
    private function decorateSources(int $cid): array
    {
        $sources   = $this->lookupRows(LeadSourceModel::class, $cid);
        $marketing = $this->idNameMap($this->lookupRows(MarketingTypeModel::class, $cid));
        foreach ($sources as &$s) {
            $mtId                = $s['marketing_type_id'] !== null ? (int) $s['marketing_type_id'] : null;
            $s['marketing_type_id'] = $mtId;
            $s['marketing_type']    = $mtId ? ($marketing[$mtId] ?? null) : null;
        }
        unset($s);

        return $sources;
    }

    /** Conversion types with lead_status_ids decoded and lead_statuses resolved. */
    private function decorateConversions(int $cid): array
    {
        $rows = $this->lookupRows(ConversionTypeModel::class, $cid);
        $byId = [];
        foreach ($this->lookupRows(LeadStatusModel::class, $cid) as $s) {
            $byId[(int) $s['id']] = ['id' => (int) $s['id'], 'name' => $s['name'], 'color' => $s['color']];
        }
        foreach ($rows as &$r) {
            $ids                  = json_decode((string) ($r['lead_status_ids'] ?? ''), true);
            $ids                  = is_array($ids) ? array_map('intval', $ids) : [];
            $r['lead_status_ids'] = $ids;
            $r['lead_statuses']   = array_values(array_filter(array_map(static fn ($i) => $byId[$i] ?? null, $ids)));
            $r['auto_percentage'] = ! empty($r['auto_percentage']);
            // Auto types compute their % live from lead counts; manual types use the stored value.
            $r['percentage']      = $r['auto_percentage']
                ? $this->computeConversionPct($cid, $ids)
                : (int) ($r['percentage'] ?? 0);
        }
        unset($r);

        return $rows;
    }

    // ------------------------------------------------------------ DEPARTMENTS
    //
    // Departments are a client-scoped lookup managed from its own section and
    // gated by the Team module permission. Deletes are soft (archive/restore).

    /** GET /client/departments — active list plus the archived (soft-deleted) ones. */
    public function departmentsList()
    {
        if ($resp = $this->requirePermission('team')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new DepartmentModel();

        return $this->respond([
            'departments' => $model->where('client_id', $cid)->orderBy('sequence', 'ASC')->orderBy('name', 'ASC')->findAll(),
            'archived'    => $model->onlyDeleted()->where('client_id', $cid)->orderBy('name', 'ASC')->findAll(),
        ]);
    }

    /** POST /client/departments */
    public function createDepartment()
    {
        $cid   = $this->clientId();
        $model = new DepartmentModel();
        $id    = $model->insert([
            'client_id' => $cid,
            'name'      => trim((string) $this->input('name')),
        ]);
        if ($id === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('created', 'department', (int) $id, 'Added department ' . $this->input('name'));

        return $this->respondCreated(['message' => 'Department added', 'id' => $id]);
    }

    /** POST /client/departments/{id} */
    public function updateDepartment(int $id)
    {
        $cid   = $this->clientId();
        $model = new DepartmentModel();
        if (! $model->where('client_id', $cid)->find($id)) {
            return $this->failNotFound('Department not found');
        }
        if ($model->update($id, ['name' => trim((string) $this->input('name'))]) === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('updated', 'department', $id, 'Updated department');

        return $this->respond(['message' => 'Department updated']);
    }

    /** POST /client/departments/{id}/delete — soft delete (archive). */
    public function deleteDepartment(int $id)
    {
        $cid   = $this->clientId();
        $model = new DepartmentModel();
        $row   = $model->where('client_id', $cid)->find($id);
        if (! $row) {
            return $this->failNotFound('Department not found');
        }
        $model->delete($id); // soft: sets deleted_at, row stays recoverable
        $this->logActivity('deleted', 'department', $id, 'Archived department ' . ($row['name'] ?? ''));

        return $this->respond(['message' => 'Department archived']);
    }

    /** POST /client/departments/{id}/restore — bring an archived department back. */
    public function restoreDepartment(int $id)
    {
        $cid   = $this->clientId();
        $model = new DepartmentModel();
        $row   = $model->onlyDeleted()->where('client_id', $cid)->find($id);
        if (! $row) {
            return $this->failNotFound('Department not found');
        }
        $model->builder()->where('id', $id)->where('client_id', $cid)->update(['deleted_at' => null]);
        $this->logActivity('updated', 'department', $id, 'Restored department ' . ($row['name'] ?? ''));

        return $this->respond(['message' => 'Department restored']);
    }

    // -------------------------------------------------------- OFFICE LOCATIONS
    //
    // Client-scoped offices with full details (address/city/phone), managed from
    // their own section and gated by the Team module. Deletes are soft.

    /** GET /client/office-locations — active list plus archived (soft-deleted). */
    public function officeLocationsList()
    {
        if ($resp = $this->requirePermission('team')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new OfficeLocationModel();

        return $this->respond([
            'office_locations' => $model->where('client_id', $cid)->orderBy('sequence', 'ASC')->orderBy('name', 'ASC')->findAll(),
            'archived'         => $model->onlyDeleted()->where('client_id', $cid)->orderBy('name', 'ASC')->findAll(),
        ]);
    }

    /** POST /client/office-locations */
    public function createOfficeLocation()
    {
        $cid   = $this->clientId();
        $model = new OfficeLocationModel();
        $id    = $model->insert($this->officeData($cid));
        if ($id === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('created', 'office_location', (int) $id, 'Added office ' . $this->input('name'));

        return $this->respondCreated(['message' => 'Office added', 'id' => $id]);
    }

    /** POST /client/office-locations/{id} */
    public function updateOfficeLocation(int $id)
    {
        $cid   = $this->clientId();
        $model = new OfficeLocationModel();
        if (! $model->where('client_id', $cid)->find($id)) {
            return $this->failNotFound('Office not found');
        }
        if ($model->update($id, $this->officeData($cid)) === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('updated', 'office_location', $id, 'Updated office');

        return $this->respond(['message' => 'Office updated']);
    }

    /** POST /client/office-locations/{id}/delete — soft delete (archive). */
    public function deleteOfficeLocation(int $id)
    {
        $cid   = $this->clientId();
        $model = new OfficeLocationModel();
        $row   = $model->where('client_id', $cid)->find($id);
        if (! $row) {
            return $this->failNotFound('Office not found');
        }
        $model->delete($id); // soft: sets deleted_at, row stays recoverable
        $this->logActivity('deleted', 'office_location', $id, 'Archived office ' . ($row['name'] ?? ''));

        return $this->respond(['message' => 'Office archived']);
    }

    /** POST /client/office-locations/{id}/restore — bring an archived office back. */
    public function restoreOfficeLocation(int $id)
    {
        $cid   = $this->clientId();
        $model = new OfficeLocationModel();
        $row   = $model->onlyDeleted()->where('client_id', $cid)->find($id);
        if (! $row) {
            return $this->failNotFound('Office not found');
        }
        $model->builder()->where('id', $id)->where('client_id', $cid)->update(['deleted_at' => null]);
        $this->logActivity('updated', 'office_location', $id, 'Restored office ' . ($row['name'] ?? ''));

        return $this->respond(['message' => 'Office restored']);
    }

    /** Office fields from the request body. */
    private function officeData(int $cid): array
    {
        $lat = $this->input('latitude');
        $lng = $this->input('longitude');

        return [
            'client_id' => $cid,
            'name'      => trim((string) $this->input('name')),
            'address'   => trim((string) ($this->input('address') ?? '')) ?: null,
            'city'      => trim((string) ($this->input('city') ?? '')) ?: null,
            'pincode'   => trim((string) ($this->input('pincode') ?? '')) ?: null,
            'phone'     => trim((string) ($this->input('phone') ?? '')) ?: null,
            'latitude'  => is_numeric($lat) ? (float) $lat : null,
            'longitude' => is_numeric($lng) ? (float) $lng : null,
            'map_url'   => trim((string) ($this->input('map_url') ?? '')) ?: null,
        ];
    }

    /** Active (non-archived) office locations for this client. */
    private function officeLocations(int $cid): array
    {
        return (new OfficeLocationModel())->where('client_id', $cid)
            ->orderBy('sequence', 'ASC')->orderBy('name', 'ASC')->findAll();
    }

    /**
     * GET /client/lookups — option lists for the staff form. Departments and
     * offices come from their own tables; lead types from the lead_types table.
     * Shape: { category: [{id, category, name}] }.
     */
    public function lookups()
    {
        $cid = $this->clientId();

        return $this->respond([
            'lookups' => [
                'department'      => array_map(static fn ($d) => ['id' => (int) $d['id'], 'category' => 'department', 'name' => $d['name']], $this->departments($cid)),
                'office_location' => array_map(static fn ($o) => ['id' => (int) $o['id'], 'category' => 'office_location', 'name' => $o['name']], $this->officeLocations($cid)),
                'lead_type'       => array_map(static fn ($t) => ['id' => (int) $t['id'], 'category' => 'lead_type', 'name' => $t['name']], $this->lookupRows(LeadTypeModel::class, $cid)),
            ],
            'categories' => ['department', 'office_location', 'lead_type'],
        ]);
    }

    // ---------------------------------------------------------------- STAFF

    /** GET /client/staff */
    public function staff()
    {
        if ($resp = $this->requirePermission('team')) {
            return $resp;
        }
        $cid   = $this->clientId();
        // Staff see themselves + everyone reporting up to them; admins see all.
        $scope     = $this->visibleStaffIds();
        $staffQ    = (new ClientStaffModel())->where('client_id', $cid);
        if ($scope !== null) {
            $staffQ->whereIn('id', $scope ?: [0]);
        }
        $staff = $staffQ->orderBy('id', 'DESC')->findAll();
        $roles = $this->idNameMap((new ClientRoleModel())->where('client_id', $cid)->findAll());
        $names = $this->idNameMap((new ClientStaffModel())->where('client_id', $cid)->findAll());
        $depts = $this->idNameMap($this->departments($cid));
        $offices = $this->idNameMap($this->officeLocations($cid));
        $leadTypes = $this->idNameMap($this->lookupRows(LeadTypeModel::class, $cid));

        foreach ($staff as &$s) {
            $s['has_password'] = ! empty($s['password'] ?? null);
            unset($s['password']);
            $s['role_name']         = $s['role_id'] ? ($roles[$s['role_id']] ?? null) : null;
            $s['manager_name']      = $s['reports_to'] ? ($names[$s['reports_to']] ?? null) : null;
            $s['department']        = $s['department_id'] ? ($depts[$s['department_id']] ?? null) : null;
            $s['office_name']       = $s['office_location_id'] ? ($offices[$s['office_location_id']] ?? null) : null;
            $s['lead_type']         = $s['lead_type_id'] ? ($leadTypes[$s['lead_type_id']] ?? null) : null;
            $extra                  = json_decode((string) ($s['extra_permissions'] ?? ''), true);
            $s['extra_permissions'] = is_array($extra) ? $extra : [];
        }

        return $this->respond(['staff' => $staff, 'modules' => self::MODULES]);
    }

    /**
     * GET /client/staff/{id}/leads — a team member's leads from three angles:
     *   - assigned: leads currently assigned to them
     *   - created:  leads they captured (created_by)
     *   - team:     leads assigned to anyone reporting up to them (managers only)
     * Each list is brief (name, phone, status, dates) and capped; counts are full.
     */
    public function staffLeads(int $id)
    {
        if ($resp = $this->requirePermission('team')) {
            return $resp;
        }
        $cid = $this->clientId();

        $staffModel = new ClientStaffModel();
        $member     = $staffModel->where('client_id', $cid)->find($id);
        if (! $member) {
            return $this->failNotFound('Staff not found');
        }

        // Staff may only inspect people within their own visibility scope.
        $scope = $this->visibleStaffIds();
        if ($scope !== null && ! in_array($id, $scope, true)) {
            return $this->failForbidden('You cannot view this team member.');
        }

        // The reports sub-tree (everyone under them, excluding themselves).
        $subtree = $staffModel->subordinateIds($cid, $id);
        $reports = array_values(array_filter($subtree, static fn ($x) => (int) $x !== $id));

        $statusNames = $this->idNameMap($this->lookupRows(LeadStatusModel::class, $cid));
        $staffNames  = $this->idNameMap($staffModel->where('client_id', $cid)->findAll());

        $brief = function (array $rows) use ($statusNames, $staffNames): array {
            $out = [];
            foreach ($rows as $r) {
                $out[] = [
                    'id'            => (int) $r['id'],
                    'name'          => $r['name'] ?: null,
                    'phone'         => $r['phone'] ?? null,
                    'status'        => ! empty($r['status_id']) ? ($statusNames[(int) $r['status_id']] ?? null) : null,
                    'sub_status'    => ! empty($r['sub_status_id']) ? ($statusNames[(int) $r['sub_status_id']] ?? null) : null,
                    'assigned_name' => ! empty($r['assigned_to']) ? ($staffNames[(int) $r['assigned_to']] ?? null) : null,
                    'creator_name'  => ! empty($r['created_by']) ? ($staffNames[(int) $r['created_by']] ?? null) : null,
                    'follow_date'   => $r['follow_date'] ?? null,
                    'created_at'    => $r['created_at'] ?? null,
                ];
            }

            return $out;
        };

        $LIMIT = 100;
        $load  = fn (callable $where) => $brief($where((new LeadModel())->where('client_id', $cid))->orderBy('id', 'DESC')->findAll());
        $count = fn (callable $where) => $where((new LeadModel())->where('client_id', $cid))->countAllResults();

        $assignedW = static fn ($q) => $q->where('assigned_to', $id);
        $createdW  = static fn ($q) => $q->where('created_by', $id);
        $teamW     = static fn ($q) => $q->whereIn('assigned_to', $reports ?: [0]);

        return $this->respond([
            'member'         => ['id' => (int) $member['id'], 'name' => $member['name']],
            'reports_count'  => count($reports),
            'assigned'       => $load(fn ($q) => $assignedW($q)->limit($LIMIT)),
            'created'        => $load(fn ($q) => $createdW($q)->limit($LIMIT)),
            'team'           => $reports ? $load(fn ($q) => $teamW($q)->limit($LIMIT)) : [],
            'counts'         => [
                'assigned' => $count($assignedW),
                'created'  => $count($createdW),
                'team'     => $reports ? $count($teamW) : 0,
            ],
        ]);
    }

    /**
     * Normalise a permissions matrix from the request into clean
     * module => {view,create,update,delete} booleans, dropping empty modules.
     *
     * @return array<string, array{view:bool,create:bool,update:bool,delete:bool}>
     */
    private function cleanPermissions(mixed $perms): array
    {
        $out = [];
        foreach ((array) $perms as $module => $p) {
            if (! in_array($module, self::MODULES, true) || ! is_array($p)) {
                continue;
            }
            $row = [
                'view'   => ! empty($p['view']),
                'create' => ! empty($p['create']),
                'update' => ! empty($p['update']),
                'delete' => ! empty($p['delete']),
            ];
            if ($row['view'] || $row['create'] || $row['update'] || $row['delete']) {
                $out[$module] = $row;
            }
        }

        return $out;
    }

    /** POST /client/staff */
    public function createStaff()
    {
        if ($resp = $this->requirePermission('team', 'create')) {
            return $resp;
        }
        $cid = $this->clientId();

        // Enforce the per-client "team" quota (max staff).
        $count = (new ClientStaffModel())->where('client_id', $cid)->countAllResults();
        if ($over = $this->overLimit('team', $count)) {
            return $over;
        }

        $data  = $this->staffData($cid);
        $model = new ClientStaffModel();
        $id    = $model->insert($data);

        if ($id === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->syncStaffAccount($cid, (int) $id, $data);
        $this->logActivity('created', 'staff', (int) $id, 'Added staff ' . $this->input('name'));

        return $this->respondCreated(['message' => 'Staff added', 'id' => $id]);
    }

    /** POST /client/staff/{id} */
    public function updateStaff(int $id)
    {
        if ($resp = $this->requirePermission('team', 'update')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new ClientStaffModel();
        if (! $model->where('client_id', $cid)->find($id)) {
            return $this->failNotFound('Staff not found');
        }
        $data = $this->staffData($cid, true);
        $model->skipValidation(true)->update($id, $data);
        $this->syncStaffAccount($cid, $id, $data);
        $this->logActivity('updated', 'staff', $id, 'Updated staff');

        return $this->respond(['message' => 'Staff updated']);
    }

    /** POST /client/staff/{id}/delete */
    public function deleteStaff(int $id)
    {
        if ($resp = $this->requirePermission('team', 'delete')) {
            return $resp;
        }
        $cid = $this->clientId();
        if (! (new ClientStaffModel())->where('client_id', $cid)->find($id)) {
            return $this->failNotFound('Staff not found');
        }
        (new ClientStaffModel())->delete($id);
        (new StaffAccountModel())->where('client_id', $cid)->where('staff_id', $id)->delete();
        $this->logActivity('deleted', 'staff', $id, 'Removed staff member');

        return $this->respond(['message' => 'Staff removed']);
    }

    /** Keep the main-DB staff login index in sync with a staff profile. */
    private function syncStaffAccount(int $cid, int $staffId, array $data): void
    {
        $acc = new StaffAccountModel();
        $row = $acc->where('client_id', $cid)->where('staff_id', $staffId)->first();

        $payload = ['client_id' => $cid, 'staff_id' => $staffId];
        if (array_key_exists('email', $data)) {
            $payload['email'] = $data['email'];
        }
        if (array_key_exists('status', $data)) {
            $payload['status'] = $data['status'];
        }
        if (! empty($data['password'])) {
            $payload['password'] = $data['password']; // already hashed by staffData()
        }

        if ($row) {
            $acc->update($row['id'], $payload);
        } else {
            $payload['email'] ??= null;
            $acc->insert($payload);
        }
    }

    private function staffData(int $cid, bool $partial = false): array
    {
        $data = [
            'client_id'          => $cid,
            'name'               => trim((string) $this->input('name')),
            'email'              => trim((string) ($this->input('email') ?? '')) ?: null,
            'phone'              => trim((string) ($this->input('phone') ?? '')) ?: null,
            'avatar'             => trim((string) ($this->input('avatar') ?? '')) ?: null,
            'emp_code'           => trim((string) ($this->input('emp_code') ?? '')) ?: null,
            'designation'        => trim((string) ($this->input('designation') ?? '')) ?: null,
            'alt_phone'          => trim((string) ($this->input('alt_phone') ?? '')) ?: null,
            'role_id'            => (int) $this->input('role_id') ?: null,
            'reports_to'         => (int) $this->input('reports_to') ?: null,
            'lead_type_id'       => (int) $this->input('lead_type_id') ?: null,
            'office_location_id' => (int) $this->input('office_location_id') ?: null,
            'department_id'      => (int) $this->input('department_id') ?: null,
            'facebook'           => trim((string) ($this->input('facebook') ?? '')) ?: null,
            'linkedin'           => trim((string) ($this->input('linkedin') ?? '')) ?: null,
            'skype'              => trim((string) ($this->input('skype') ?? '')) ?: null,
            'email_signature'    => trim((string) ($this->input('email_signature') ?? '')) ?: null,
            'status'             => $this->input('status', 'active'),
        ];

        // Per-staff extra permissions (granted in addition to the role).
        if (($perms = $this->input('permissions')) !== null) {
            $data['extra_permissions'] = json_encode($this->cleanPermissions($perms));
        }

        // Only (re)hash the password when a non-empty one is supplied.
        $password = (string) ($this->input('password') ?? '');
        if ($password !== '') {
            $data['password'] = password_hash($password, PASSWORD_DEFAULT);
        }

        if ($partial) {
            unset($data['client_id']);
        }

        return $data;
    }

    // ----------------------------------------------------------------- TASKS

    /** GET /client/tasks — every task for this client, assignee names + overdue flag. */
    public function tasks()
    {
        if ($resp = $this->requirePermission('tasks')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $this->generateDueTaskAlerts();

        // Staff see tasks assigned to themselves or anyone reporting up to them.
        $scope  = $this->visibleStaffIds();
        $tasksQ = (new ClientTaskModel())->where('client_id', $cid);
        if ($scope !== null) {
            $tasksQ->whereIn('assigned_to', $scope ?: [0]);
        }
        $tasks = $tasksQ->orderBy('id', 'DESC')->findAll();
        $names = $this->idNameMap((new ClientStaffModel())->where('client_id', $cid)->findAll());

        // Comment counts in one grouped query (avoids N+1).
        $counts = [];
        foreach ((new TaskCommentModel())->select('task_id, COUNT(*) AS n')->where('client_id', $cid)->groupBy('task_id')->findAll() as $r) {
            $counts[(int) $r['task_id']] = (int) $r['n'];
        }

        foreach ($tasks as &$t) {
            $t['assignee_name']  = $t['assigned_to'] ? ($names[$t['assigned_to']] ?? null) : null;
            $t['overdue']        = $this->isOverdue($t);
            $t['comment_count']  = $counts[(int) $t['id']] ?? 0;
        }
        unset($t);

        return $this->respond([
            'tasks'    => $tasks,
            'summary'  => $this->taskSummary($tasks),
        ]);
    }

    /** POST /client/tasks */
    public function createTask()
    {
        $cid   = $this->clientId();
        $model = new ClientTaskModel();
        $data  = $this->taskData($cid);
        // Stamp the creator (and seed the updater to the same person).
        $data['created_by']      = $this->actorId();
        $data['created_by_name'] = $this->actorName();
        $data['updated_by']      = $this->actorId();
        $data['updated_by_name'] = $this->actorName();
        $id    = $model->insert($data);

        if ($id === false) {
            return $this->failValidationErrors($model->errors());
        }

        $title = $data['title'];
        $this->logActivity('created', 'task', (int) $id, 'Created task ' . $title);
        $this->notify(
            'task_created',
            'New task created',
            $title . ($data['assigned_to'] ? ' · assigned to ' . $this->staffName((int) $data['assigned_to']) : ''),
            '/client/tasks',
        );

        return $this->respondCreated(['message' => 'Task created', 'id' => $id]);
    }

    /** POST /client/tasks/{id} — update, emitting a notification for what changed. */
    public function updateTask(int $id)
    {
        $cid   = $this->clientId();
        $model = new ClientTaskModel();
        $before = $model->where('client_id', $cid)->find($id);
        if (! $before) {
            return $this->failNotFound('Task not found');
        }

        $data = $this->taskData($cid, true);
        // Record who made this change.
        $data['updated_by']      = $this->actorId();
        $data['updated_by_name'] = $this->actorName();

        // On-time tracking: stamp completion when entering Done, clear when it
        // leaves Done (re-opened).
        if (isset($data['status']) && $data['status'] !== $before['status']) {
            if ($data['status'] === 'done') {
                $data['completed_at'] = date('Y-m-d H:i:s');
            } elseif ($before['status'] === 'done') {
                $data['completed_at'] = null;
            }
        }

        $model->skipValidation(true)->update($id, $data);

        $title = ($data['title'] ?? '') !== '' ? $data['title'] : $before['title'];
        $link  = '/client/tasks?task=' . $id;
        $assignee = (int) ($before['assigned_to'] ?? 0);

        // Log + notify the most relevant single change. Stage moves record the
        // exact from→to transition for the activity timeline, and ping the
        // assignee (a staff member) so other teams are kept in the loop.
        if (isset($data['status']) && $data['status'] !== $before['status']) {
            $from = $this->statusLabel((string) $before['status']);
            $to   = $this->statusLabel((string) $data['status']);
            $this->logActivity('updated', 'task', $id, "Moved \"{$title}\" from {$from} to {$to}");
            $body = "\"{$title}\" · {$from} → {$to}";
            $this->notify('task_moved', "Task moved to {$to}", $body, $link);
            if ($assignee > 0) {
                $this->notifyStaff($assignee, 'task_moved', "Task moved to {$to}", $body, '/staff/tasks');
            }
        } elseif (array_key_exists('assigned_to', $data) && (int) $data['assigned_to'] !== $assignee) {
            $who = $data['assigned_to'] ? $this->staffName((int) $data['assigned_to']) : 'Unassigned';
            $this->logActivity('updated', 'task', $id, "Reassigned \"{$title}\" to {$who}");
            $this->notify('task_assigned', 'Task reassigned', $title . ' · ' . $who, $link);
            if ((int) $data['assigned_to'] > 0) {
                $this->notifyStaff((int) $data['assigned_to'], 'task_assigned', 'You were assigned a task', $title, '/staff/tasks');
            }
        } else {
            $this->logActivity('updated', 'task', $id, 'Updated task ' . $title);
            $this->notify('task_updated', 'Task updated', $title, $link);
            if ($assignee > 0) {
                $this->notifyStaff($assignee, 'task_updated', 'A task you own was updated', $title, '/staff/tasks');
            }
        }

        return $this->respond(['message' => 'Task updated']);
    }

    /** POST /client/tasks/{id}/delete */
    public function deleteTask(int $id)
    {
        if ($resp = $this->denyUnlessPerm('tasks', 'delete')) {
            return $resp;
        }

        $cid  = $this->clientId();
        $task = (new ClientTaskModel())->where('client_id', $cid)->find($id);
        if (! $task) {
            return $this->failNotFound('Task not found');
        }
        // Soft delete: the row (and its comments) is kept for audit; deleted_at
        // is set so it disappears from task lists.
        (new ClientTaskModel())->delete($id);

        $this->logActivity('deleted', 'task', $id, 'Deleted task ' . $task['title']);
        $this->notify('task_deleted', 'Task deleted', $task['title'], '/client/tasks');

        return $this->respond(['message' => 'Task deleted']);
    }

    /** GET /client/tasks/{id} — a single task with its assignee resolved. */
    public function task(int $id)
    {
        $cid = $this->clientId();
        $t   = (new ClientTaskModel())->where('client_id', $cid)->find($id);
        if (! $t) {
            return $this->failNotFound('Task not found');
        }
        $t['assignee_name'] = $t['assigned_to'] ? $this->staffName((int) $t['assigned_to']) : null;
        $t['overdue']       = $this->isOverdue($t);

        return $this->respond(['task' => $t]);
    }

    /** GET /client/tasks/{id}/comments — the discussion thread, oldest first. */
    public function taskComments(int $id)
    {
        $cid = $this->clientId();
        if (! (new ClientTaskModel())->where('client_id', $cid)->find($id)) {
            return $this->failNotFound('Task not found');
        }
        $rows = (new TaskCommentModel())->where('client_id', $cid)->where('task_id', $id)->orderBy('id', 'ASC')->findAll();

        return $this->respond(['comments' => $rows]);
    }

    /** POST /client/tasks/{id}/comments — { body }. Pings the assignee. */
    public function addTaskComment(int $id)
    {
        $cid  = $this->clientId();
        $task = (new ClientTaskModel())->where('client_id', $cid)->find($id);
        if (! $task) {
            return $this->failNotFound('Task not found');
        }
        $body = trim((string) $this->input('body'));
        if ($body === '') {
            return $this->failValidationErrors(['body' => 'Comment cannot be empty.']);
        }
        $user  = $this->currentUser();
        $model = new TaskCommentModel();
        $cmtId = $model->insert([
            'client_id'   => $cid,
            'task_id'     => $id,
            'author_type' => 'user',
            'author_id'   => (int) ($user['id'] ?? 0),
            'author_name' => $user['name'] ?? ($user['email'] ?? 'Admin'),
            'body'        => mb_substr($body, 0, 4000),
        ]);
        if ($cmtId === false) {
            return $this->failValidationErrors($model->errors());
        }

        $this->logActivity('comment', 'task', $id, 'Commented on "' . $task['title'] . '"');
        $assignee = (int) ($task['assigned_to'] ?? 0);
        if ($assignee > 0) {
            $this->notifyStaff($assignee, 'task_comment', 'New comment on a task', $task['title'] . ' · ' . mb_substr($body, 0, 160), '/staff/tasks');
        }

        return $this->respondCreated(['comment' => $model->find($cmtId)]);
    }

    /** POST /client/tasks/{taskId}/comments/{commentId}/delete */
    public function deleteTaskComment(int $taskId, int $commentId)
    {
        $cid   = $this->clientId();
        $model = new TaskCommentModel();
        if (! $model->where('client_id', $cid)->where('task_id', $taskId)->find($commentId)) {
            return $this->failNotFound('Comment not found');
        }
        $model->delete($commentId);

        return $this->respond(['message' => 'Comment deleted']);
    }

    /** GET /client/tasks/{id}/activity — this task's audit timeline, newest first. */
    public function taskActivity(int $id)
    {
        $cid = $this->clientId();
        if (! (new ClientTaskModel())->where('client_id', $cid)->find($id)) {
            return $this->failNotFound('Task not found');
        }
        $rows = $this->activityLogModel('client_admin', $cid)
            ->where('client_id', $cid)->where('entity_type', 'task')->where('entity_id', $id)
            ->orderBy('id', 'DESC')->findAll(100);

        return $this->respond(['activity' => $rows]);
    }

    // --------------------------------------------------------- ANNOUNCEMENTS

    /**
     * GET /client/announcements — every announcement (pinned first, newest
     * next) decorated with audience labels + per-announcement read/ack stats,
     * plus the audience-picker options (departments + staff) the create form
     * needs.
     */
    public function announcements()
    {
        if ($resp = $this->requirePermission('announcements')) {
            return $resp;
        }
        $cid    = $this->clientId();
        $limit  = max(1, min(50, (int) ($this->request->getGet('limit') ?? 15)));
        $offset = max(0, (int) ($this->request->getGet('offset') ?? 0));

        $staff      = (new ClientStaffModel())->where('client_id', $cid)->findAll();
        $staffNames = $this->idNameMap($staff);
        $deptNames  = $this->idNameMap($this->departments($cid));

        // Pinned first, then newest — paginated for infinite scroll.
        $rows = (new AnnouncementModel())->where('client_id', $cid)
            ->orderBy('pinned', 'DESC')->orderBy('id', 'DESC')->findAll($limit, $offset);

        $reads = (new AnnouncementReadModel())->where('client_id', $cid)->findAll();

        $out = array_map(function ($a) use ($staff, $staffNames, $deptNames, $reads) {
            $recipients = $this->announcementRecipientIds($a, $staff);
            $mine       = array_filter($reads, static fn ($r) => (int) $r['announcement_id'] === (int) $a['id']);
            $readCount  = count(array_filter($mine, static fn ($r) => ! empty($r['read_at'])));
            $ackCount   = count(array_filter($mine, static fn ($r) => ! empty($r['acknowledged_at'])));

            return $this->shapeAnnouncement($a, $staffNames, $deptNames) + [
                'recipient_count'  => count($recipients),
                'read_count'       => $readCount,
                'ack_count'        => $ackCount,
            ];
        }, $rows);

        $payload = [
            'announcements' => $out,
            'has_more'      => count($rows) === $limit,
        ];

        // The composer's department/staff pickers only need to load with page 1.
        if ($offset === 0) {
            $payload['departments'] = array_map(static fn ($d) => ['id' => (int) $d['id'], 'name' => $d['name']], $this->departments($cid));
            $payload['staff']       = array_map(static fn ($s) => [
                'id'            => (int) $s['id'],
                'name'          => $s['name'] ?? 'Staff',
                'department_id' => $s['department_id'] !== null ? (int) $s['department_id'] : null,
            ], array_filter($staff, static fn ($s) => ($s['status'] ?? 'active') === 'active'));
        }

        return $this->respond($payload);
    }

    /** POST /client/announcements — create a targeted announcement. */
    public function createAnnouncement()
    {
        $cid = $this->clientId();

        $title = trim((string) $this->input('title'));
        if (mb_strlen($title) < 2) {
            return $this->failValidationErrors(['title' => 'A title is required.']);
        }

        $audience = (string) $this->input('audience', 'all');
        if (! in_array($audience, ['all', 'department', 'staff'], true)) {
            $audience = 'all';
        }

        // target_ids / attachments arrive as JSON-encoded arrays (or real arrays).
        $targets     = $this->normalizeIntList($this->input('target_ids'));
        $attachments = $this->normalizeAttachments($this->input('attachments'));

        if ($audience !== 'all' && ! $targets) {
            return $this->failValidationErrors(['target_ids' => 'Choose at least one ' . ($audience === 'department' ? 'department.' : 'team member.')]);
        }

        $user = $this->currentUser();
        $id   = (new AnnouncementModel())->insert([
            'client_id'   => $cid,
            'title'       => mb_substr($title, 0, 255),
            'body'        => trim((string) $this->input('body')) ?: null,
            'pinned'      => $this->input('pinned') ? 1 : 0,
            'created_by'  => (int) ($user['id'] ?? 0),
            'audience'    => $audience,
            'target_ids'  => $audience === 'all' ? null : json_encode(array_values($targets)),
            'attachments' => $attachments ? json_encode($attachments) : null,
            'require_ack' => $this->input('require_ack') ? 1 : 0,
        ]);

        $ann = (new AnnouncementModel())->find($id);
        $this->notifyAnnouncementRecipients($cid, $ann, $title);
        $this->logActivity('created', 'announcement', $id, 'Posted announcement "' . $title . '"');

        return $this->respondCreated(['message' => 'Announcement posted', 'id' => (int) $id]);
    }

    /** POST /client/announcements/{id}/delete */
    public function deleteAnnouncement(int $id)
    {
        $cid = $this->clientId();
        $ann = (new AnnouncementModel())->where('client_id', $cid)->find($id);
        if (! $ann) {
            return $this->failNotFound('Announcement not found');
        }

        // Soft delete (model flags deleted_at). Read/ack markers are left intact
        // so the announcement can be restored later without losing history.
        (new AnnouncementModel())->delete($id);

        $this->logActivity('deleted', 'announcement', $id, 'Deleted announcement "' . ($ann['title'] ?? '') . '"');

        return $this->respond(['message' => 'Announcement deleted']);
    }

    /**
     * GET /client/announcements/{id}/readers — per-member read/ack status for
     * the "who has seen this" view.
     */
    public function announcementReaders(int $id)
    {
        $cid = $this->clientId();
        $ann = (new AnnouncementModel())->where('client_id', $cid)->find($id);
        if (! $ann) {
            return $this->failNotFound('Announcement not found');
        }

        $staff       = (new ClientStaffModel())->where('client_id', $cid)->findAll();
        $recipients  = $this->announcementRecipientIds($ann, $staff);
        $byId        = [];
        foreach ($staff as $s) {
            $byId[(int) $s['id']] = $s;
        }
        $reads = [];
        foreach ((new AnnouncementReadModel())->where('client_id', $cid)->where('announcement_id', $id)->findAll() as $r) {
            $reads[(int) $r['staff_id']] = $r;
        }

        $readers = [];
        foreach ($recipients as $sid) {
            $r          = $reads[$sid] ?? null;
            $readers[] = [
                'staff_id'        => $sid,
                'name'            => $byId[$sid]['name'] ?? 'Staff',
                'read_at'         => $r['read_at'] ?? null,
                'acknowledged_at' => $r['acknowledged_at'] ?? null,
            ];
        }

        return $this->respond(['readers' => $readers, 'require_ack' => (bool) $ann['require_ack']]);
    }

    /** Active (non-archived) departments for this client. */
    private function departments(int $cid): array
    {
        return (new DepartmentModel())->where('client_id', $cid)
            ->orderBy('sequence', 'ASC')->orderBy('name', 'ASC')->findAll();
    }

    /** Public shape of one announcement (without read stats). */
    private function shapeAnnouncement(array $a, array $staffNames, array $deptNames): array
    {
        $audience = $a['audience'] ?? 'all';
        $targets  = $this->normalizeIntList($a['target_ids'] ?? null);

        $targetNames = [];
        if ($audience === 'department') {
            $targetNames = array_values(array_filter(array_map(static fn ($t) => $deptNames[$t] ?? null, $targets)));
        } elseif ($audience === 'staff') {
            $targetNames = array_values(array_filter(array_map(static fn ($t) => $staffNames[$t] ?? null, $targets)));
        }

        return [
            'id'           => (int) $a['id'],
            'title'        => $a['title'],
            'body'         => $a['body'],
            'pinned'       => (bool) $a['pinned'],
            'audience'     => $audience,
            'target_ids'   => array_values($targets),
            'target_names' => $targetNames,
            'attachments'  => $this->normalizeAttachments($a['attachments'] ?? null),
            'require_ack'  => (bool) ($a['require_ack'] ?? false),
            'created_at'   => $a['created_at'],
        ];
    }

    /** Resolve which active staff ids an announcement targets. */
    private function announcementRecipientIds(array $a, array $allStaff): array
    {
        $audience = $a['audience'] ?? 'all';
        $targets  = $this->normalizeIntList($a['target_ids'] ?? null);

        $ids = [];
        foreach ($allStaff as $s) {
            if (($s['status'] ?? 'active') !== 'active') {
                continue;
            }
            $sid  = (int) $s['id'];
            $dept = $s['department_id'] !== null ? (int) $s['department_id'] : 0;
            if ($audience === 'all'
                || ($audience === 'department' && in_array($dept, $targets, true))
                || ($audience === 'staff' && in_array($sid, $targets, true))
            ) {
                $ids[] = $sid;
            }
        }

        return $ids;
    }

    /** Push an in-app notification to every targeted staff member. */
    private function notifyAnnouncementRecipients(int $cid, array $ann, string $title): void
    {
        try {
            $staff = (new ClientStaffModel())->where('client_id', $cid)->findAll();
            $model = new AppNotificationModel();
            foreach ($this->announcementRecipientIds($ann, $staff) as $sid) {
                $model->insert([
                    'recipient_type' => 'staff',
                    'recipient_id'   => $sid,
                    'type'           => 'announcement',
                    'title'          => 'New announcement',
                    'body'           => mb_substr($title, 0, 140),
                    'link'           => '/staff/announcements',
                ]);
            }
        } catch (\Throwable $e) {
            log_message('error', 'Announcement notify failed: ' . $e->getMessage());
        }
    }

    /**
     * Coerce a JSON string or array of ints into a clean int list.
     *
     * @param mixed $value
     * @return int[]
     */
    private function normalizeIntList($value): array
    {
        if (is_string($value)) {
            $value = json_decode($value, true);
        }
        if (! is_array($value)) {
            return [];
        }

        return array_values(array_unique(array_filter(array_map('intval', $value))));
    }

    /**
     * Coerce a JSON string or array into a clean attachments list, each
     * {url,name,type,size}.
     *
     * @param mixed $value
     * @return array<int,array<string,mixed>>
     */
    private function normalizeAttachments($value): array
    {
        if (is_string($value)) {
            $value = json_decode($value, true);
        }
        if (! is_array($value)) {
            return [];
        }

        $out = [];
        foreach ($value as $a) {
            if (! is_array($a) || empty($a['url'])) {
                continue;
            }
            $out[] = [
                'url'  => (string) $a['url'],
                'name' => mb_substr((string) ($a['name'] ?? 'file'), 0, 200),
                'type' => (string) ($a['type'] ?? ''),
                'size' => isset($a['size']) ? (int) $a['size'] : 0,
            ];
            if (count($out) >= 10) {
                break;
            }
        }

        return $out;
    }

    private function taskData(int $cid, bool $partial = false): array
    {
        $in = (array) $this->input();

        if (! $partial) {
            // Create: a full record with sensible defaults.
            return [
                'client_id'   => $cid,
                'title'       => trim((string) ($in['title'] ?? '')),
                'description' => trim((string) ($in['description'] ?? '')) ?: null,
                'assigned_to' => (int) ($in['assigned_to'] ?? 0) ?: null,
                'due_date'    => trim((string) ($in['due_date'] ?? '')) ?: null,
                'start_date'  => trim((string) ($in['start_date'] ?? '')) ?: null,
                'priority'    => $in['priority'] ?? 'medium',
                'type'        => $in['type'] ?? 'task',
                'status'      => $in['status'] ?? 'open',
            ];
        }

        // Update: only the keys actually sent, so a status-only board move can't
        // wipe the title/dates/assignee of the task it touches.
        $data = [];
        if (array_key_exists('title', $in))       $data['title']       = trim((string) $in['title']);
        if (array_key_exists('description', $in)) $data['description'] = trim((string) $in['description']) ?: null;
        if (array_key_exists('assigned_to', $in)) $data['assigned_to'] = (int) $in['assigned_to'] ?: null;
        if (array_key_exists('due_date', $in))    $data['due_date']    = trim((string) $in['due_date']) ?: null;
        if (array_key_exists('start_date', $in))  $data['start_date']  = trim((string) $in['start_date']) ?: null;
        if (array_key_exists('priority', $in))    $data['priority']    = $in['priority'];
        if (array_key_exists('type', $in))        $data['type']        = $in['type'];
        if (array_key_exists('status', $in))      $data['status']      = $in['status'];

        return $data;
    }

    /** A task is overdue when it has a past due date and isn't done. */
    private function isOverdue(array $task): bool
    {
        if (($task['status'] ?? '') === 'done' || empty($task['due_date'])) {
            return false;
        }

        return substr((string) $task['due_date'], 0, 10) < date('Y-m-d');
    }

    /** Count tasks by bucket for dashboards/headers. */
    private function taskSummary(array $tasks): array
    {
        $s = ['total' => 0, 'open' => 0, 'in_progress' => 0, 'done' => 0, 'overdue' => 0, 'due_today' => 0];
        $today = date('Y-m-d');

        foreach ($tasks as $t) {
            $s['total']++;
            $status = $t['status'] ?? 'open';
            $s[$status] = ($s[$status] ?? 0) + 1;
            if ($this->isOverdue($t)) {
                $s['overdue']++;
            }
            if ($status !== 'done' && ! empty($t['due_date']) && substr((string) $t['due_date'], 0, 10) === $today) {
                $s['due_today']++;
            }
        }

        return $s;
    }

    private function statusLabel(string $status): string
    {
        return [
            'open'        => 'Backlog',
            'in_progress' => 'In Progress',
            'in_review'   => 'In Review',
            'done'        => 'Done',
        ][$status] ?? ucfirst(str_replace('_', ' ', $status));
    }

    private function staffName(int $id): string
    {
        $row = (new ClientStaffModel())->where('client_id', $this->clientId())->find($id);

        return $row['name'] ?? 'someone';
    }

    // --------------------------------------------------------- NOTIFICATIONS

    /**
     * Insert an in-app notification addressed to the signed-in client admin.
     * Never lets a notification failure break the action that triggered it.
     */
    private function notify(string $type, string $title, ?string $body, ?string $link): void
    {
        try {
            $user = $this->currentUser();
            if (! $user) {
                return;
            }
            (new AppNotificationModel())->insert([
                'recipient_type' => 'user',
                'recipient_id'   => (int) $user['id'],
                'type'           => $type,
                'title'          => mb_substr($title, 0, 255),
                'body'           => $body !== null ? mb_substr($body, 0, 500) : null,
                'link'           => $link,
            ]);
        } catch (\Throwable $e) {
            log_message('error', 'Notification write failed: ' . $e->getMessage());
        }
    }

    /** In-app notification addressed to a staff member (e.g. a task assignee). */
    private function notifyStaff(int $staffId, string $type, string $title, ?string $body, ?string $link): void
    {
        if ($staffId <= 0) {
            return;
        }
        try {
            (new AppNotificationModel())->insert([
                'recipient_type' => 'staff',
                'recipient_id'   => $staffId,
                'type'           => $type,
                'title'          => mb_substr($title, 0, 255),
                'body'           => $body !== null ? mb_substr($body, 0, 500) : null,
                'link'           => $link,
            ]);
        } catch (\Throwable $e) {
            log_message('error', 'Staff notification write failed: ' . $e->getMessage());
        }
    }

    /**
     * Ensure each overdue / due-today task has exactly one open (unread) alert.
     * Called from dashboard()/tasks() so reminders appear during normal use
     * without a background worker. Alerts surface in the shared in-app feed
     * served by ChatController::notifications. Idempotent: one open alert/task.
     */
    private function generateDueTaskAlerts(): void
    {
        try {
            $user  = $this->currentUser();
            $cid   = $this->clientId();
            $today = date('Y-m-d');

            $tasks = (new ClientTaskModel())
                ->where('client_id', $cid)
                ->where('status !=', 'done')
                ->where('due_date IS NOT NULL')
                ->where('due_date <=', $today . ' 23:59:59')
                ->findAll();

            if (! $tasks) {
                return;
            }

            $model = new AppNotificationModel();
            foreach ($tasks as $t) {
                $link   = '/client/tasks?task=' . $t['id'];
                $exists = $model
                    ->where('recipient_type', 'user')->where('recipient_id', (int) $user['id'])
                    ->where('type', 'task_due')->where('link', $link)->where('read_at', null)
                    ->countAllResults();
                if ($exists) {
                    continue;
                }

                $overdue = substr((string) $t['due_date'], 0, 10) < $today;
                $model->insert([
                    'recipient_type' => 'user',
                    'recipient_id'   => (int) $user['id'],
                    'type'           => 'task_due',
                    'title'          => $overdue ? 'Task overdue' : 'Task due today',
                    'body'           => mb_substr((string) $t['title'], 0, 500),
                    'link'           => $link,
                ]);
            }
        } catch (\Throwable $e) {
            log_message('error', 'Due-task alert generation failed: ' . $e->getMessage());
        }
    }

    // -------------------------------------------------------------- ACTIVITY

    /**
     * GET /client/activity — this client's audit trail (from its own DB), newest
     * first. Mirrors the super-admin feed: paginated (?limit, ?offset), optional
     * ?action filter, has_more flag, and headline stats on the first page.
     */
    public function activity()
    {
        $limit    = max(1, min(50, (int) ($this->request->getGet('limit') ?? 20)));
        $offset   = max(0, (int) ($this->request->getGet('offset') ?? 0));
        $action   = trim((string) ($this->request->getGet('action') ?? ''));
        $clientId = $this->clientId();

        // Staff see only their own activity; admins see the whole client.
        $scope = $this->visibleStaffIds();

        $model = $this->activityLogModel('client_admin', $clientId)->where('client_id', $clientId);
        if ($scope !== null) {
            $model->whereIn('actor_id', $scope ?: [0]);
        }
        if ($action !== '') {
            $model->where('action', $action);
        }
        $rows = $model->orderBy('created_at', 'DESC')->orderBy('id', 'DESC')->findAll($limit, $offset);

        $payload = [
            'activity' => $rows,
            'count'    => count($rows),
            'has_more' => count($rows) === $limit,
        ];

        // Headline KPIs + per-action tab counts ride along with the first page.
        if ($offset === 0) {
            $payload['stats'] = $this->clientActivityStats($clientId, $scope);
        }

        return $this->respond($payload);
    }

    /**
     * Audit-log KPIs for this client, scoped to its own DB. Day/week windows are
     * measured in IST even though timestamps are stored in UTC.
     *
     * @return array{total:int,today:int,active:int,created_week:int,deleted_week:int,by_action:array<string,int>}
     */
    private function clientActivityStats(int $clientId, ?array $scope = null): array
    {
        $ist           = new \DateTimeZone('Asia/Kolkata');
        $utc           = new \DateTimeZone('UTC');
        $todayStartUtc = (new \DateTime('now', $ist))->setTime(0, 0, 0)->setTimezone($utc)->format('Y-m-d H:i:s');
        $weekAgoUtc    = (new \DateTime('now', $utc))->modify('-7 days')->format('Y-m-d H:i:s');

        // Same staff scoping as the activity list, so a staff member's KPIs only
        // reflect their own actions.
        $base = function () use ($clientId, $scope) {
            $m = $this->activityLogModel('client_admin', $clientId)->where('client_id', $clientId);
            if ($scope !== null) {
                $m->whereIn('actor_id', $scope ?: [0]);
            }

            return $m;
        };

        $byAction = [];
        foreach ($base()->select('action, COUNT(*) AS n')->groupBy('action')->get()->getResultArray() as $r) {
            $byAction[$r['action']] = (int) $r['n'];
        }

        return [
            'total'        => array_sum($byAction),
            'today'        => $base()->where('created_at >=', $todayStartUtc)->countAllResults(),
            'active'       => (int) ($base()->select('COUNT(DISTINCT actor_id) AS n')->get()->getRow('n') ?? 0),
            'created_week' => $base()->where('action', 'created')->where('created_at >=', $weekAgoUtc)->countAllResults(),
            'deleted_week' => $base()->where('action', 'deleted')->where('created_at >=', $weekAgoUtc)->countAllResults(),
            'by_action'    => $byAction,
        ];
    }

    /** @param array<int,array<string,mixed>> $rows */
    private function idNameMap(array $rows): array
    {
        $map = [];
        foreach ($rows as $r) {
            $map[(int) $r['id']] = $r['name'] ?? null;
        }

        return $map;
    }

    // --------------------------------------------------------------- ASSETS

    /** GET /client/assets — assets with their current allocation. */
    public function assets()
    {
        if ($resp = $this->requirePermission('assets')) {
            return $resp;
        }
        $cid    = $this->clientId();
        $assets = (new AssetModel())->where('client_id', $cid)->orderBy('id', 'DESC')->findAll();
        $staff  = $this->idNameMap((new ClientStaffModel())->where('client_id', $cid)->findAll());

        // Current (active) allocation per asset.
        $current = [];
        foreach ((new AssetAllocationModel())->where(['client_id' => $cid, 'status' => 'allocated'])->findAll() as $a) {
            $current[(int) $a['asset_id']] = $a;
        }

        foreach ($assets as &$as) {
            $as['managed_by_name'] = $as['managed_by'] ? ($staff[$as['managed_by']] ?? null) : null;
            $alloc                 = $current[(int) $as['id']] ?? null;
            $as['allocated_to']    = $alloc ? ($staff[(int) $alloc['staff_id']] ?? null) : null;
            $as['allocated_to_id'] = $alloc ? (int) $alloc['staff_id'] : null;
        }

        return $this->respond(['assets' => $assets]);
    }

    /** POST /client/assets — create. */
    public function createAsset()
    {
        $cid   = $this->clientId();
        $model = new AssetModel();
        $code  = trim((string) ($this->input('asset_code') ?? '')) ?: $this->nextAssetCode($cid);

        $id = $model->insert($this->assetData($cid) + ['asset_code' => $code]);
        if ($id === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logAsset($cid, (int) $id, 'created', 'Added asset ' . $this->input('name'));

        return $this->respondCreated(['message' => 'Asset created', 'id' => $id]);
    }

    /** POST /client/assets/{id} — update. */
    public function updateAsset(int $id)
    {
        $cid   = $this->clientId();
        $model = new AssetModel();
        if (! $model->where('client_id', $cid)->find($id)) {
            return $this->failNotFound('Asset not found');
        }
        $data = $this->assetData($cid, true);
        if (($code = trim((string) ($this->input('asset_code') ?? ''))) !== '') {
            $data['asset_code'] = $code;
        }
        $model->skipValidation(true)->update($id, $data);
        $this->logAsset($cid, $id, 'updated', 'Updated asset details');

        return $this->respond(['message' => 'Asset updated']);
    }

    /** POST /client/assets/{id}/delete */
    public function deleteAsset(int $id)
    {
        if ($resp = $this->denyUnlessPerm('assets', 'delete')) {
            return $resp;
        }

        $cid   = $this->clientId();
        $model = new AssetModel();
        if (! $model->where('client_id', $cid)->find($id)) {
            return $this->failNotFound('Asset not found');
        }

        // The device must have come back to company assets before it can be
        // removed. If it's still allocated to a staff member, refuse — it has to
        // be revoked (returned) first, so we never delete a device that's still out.
        $holder = $this->currentAllocStaff($cid, $id);
        if ($holder !== null) {
            $names = $this->idNameMap((new ClientStaffModel())->where('client_id', $cid)->findAll());
            $who   = $names[$holder] ?? 'a staff member';

            return $this->fail("This asset is still allocated to {$who}. Revoke it (return to company) before deleting.", 409);
        }

        // Soft delete: the row (and its allocation history + tracker log) is kept
        // for audit; deleted_at is set so it disappears from listings.
        $model->delete($id);
        $this->logAsset($cid, $id, 'deleted', 'Deleted asset');

        return $this->respond(['message' => 'Asset deleted']);
    }

    /** POST /client/assets/{id}/allocate — { staff_id, notes? } */
    public function allocateAsset(int $id)
    {
        $cid   = $this->clientId();
        $asset = (new AssetModel())->where('client_id', $cid)->find($id);
        if (! $asset) {
            return $this->failNotFound('Asset not found');
        }
        $staffId = (int) $this->input('staff_id');
        if (! (new ClientStaffModel())->where('client_id', $cid)->find($staffId)) {
            return $this->failValidationErrors(['staff_id' => 'Select a staff member.']);
        }
        $note = trim((string) ($this->input('notes') ?? '')) ?: null;
        $prev = $this->currentAllocStaff($cid, $id);

        $this->closeAllocation($cid, $id);
        $this->openAllocation($cid, $id, $staffId, $note);
        (new AssetModel())->skipValidation(true)->update($id, ['status' => 'allocated']);
        $this->logAsset($cid, $id, 'allocated', $note, $prev, $staffId);

        return $this->respond(['message' => 'Asset allocated']);
    }

    /** POST /client/assets/{id}/transfer — move from current holder to another staff. */
    public function transferAsset(int $id)
    {
        $cid   = $this->clientId();
        $asset = (new AssetModel())->where('client_id', $cid)->find($id);
        if (! $asset) {
            return $this->failNotFound('Asset not found');
        }
        $toStaff = (int) $this->input('staff_id');
        if (! (new ClientStaffModel())->where('client_id', $cid)->find($toStaff)) {
            return $this->failValidationErrors(['staff_id' => 'Select a staff member.']);
        }
        $from = $this->currentAllocStaff($cid, $id);
        if ($from === $toStaff) {
            return $this->failValidationErrors(['staff_id' => 'Asset is already with that staff member.']);
        }
        $note = trim((string) ($this->input('notes') ?? '')) ?: null;

        $this->closeAllocation($cid, $id);
        $this->openAllocation($cid, $id, $toStaff, $note);
        (new AssetModel())->skipValidation(true)->update($id, ['status' => 'allocated']);
        $this->logAsset($cid, $id, 'transferred', $note, $from, $toStaff);

        return $this->respond(['message' => 'Asset transferred']);
    }

    /** POST /client/assets/{id}/revoke — { notes? } */
    public function revokeAsset(int $id)
    {
        $cid = $this->clientId();
        if (! (new AssetModel())->where('client_id', $cid)->find($id)) {
            return $this->failNotFound('Asset not found');
        }
        $from = $this->currentAllocStaff($cid, $id);
        $note = trim((string) ($this->input('notes') ?? '')) ?: null;

        $this->closeAllocation($cid, $id);
        (new AssetModel())->skipValidation(true)->update($id, ['status' => 'available']);
        $this->logAsset($cid, $id, 'revoked', $note, $from, null);

        return $this->respond(['message' => 'Asset revoked']);
    }

    /** POST /client/assets/{id}/note — attach a free-text note to the tracker. */
    public function addAssetNote(int $id)
    {
        $cid = $this->clientId();
        if (! (new AssetModel())->where('client_id', $cid)->find($id)) {
            return $this->failNotFound('Asset not found');
        }
        $note = trim((string) ($this->input('note') ?? ''));
        if ($note === '') {
            return $this->failValidationErrors(['note' => 'Note cannot be empty.']);
        }
        $this->logAsset($cid, $id, 'note', $note, $this->currentAllocStaff($cid, $id), null);

        return $this->respondCreated(['message' => 'Note added']);
    }

    /**
     * GET /client/assets/{id}/history — the full tracker timeline for an asset
     * (created, updated, allocated, transferred, revoked, notes), newest first.
     */
    public function assetHistory(int $id)
    {
        $cid   = $this->clientId();
        $staff = $this->idNameMap((new ClientStaffModel())->where('client_id', $cid)->findAll());
        $rows  = (new AssetLogModel())
            ->where(['client_id' => $cid, 'asset_id' => $id])
            ->orderBy('id', 'DESC')->findAll();

        foreach ($rows as &$r) {
            $r['from_name'] = $r['from_staff_id'] ? ($staff[(int) $r['from_staff_id']] ?? null) : null;
            $r['to_name']   = $r['to_staff_id'] ? ($staff[(int) $r['to_staff_id']] ?? null) : null;
        }

        return $this->respond(['history' => $rows]);
    }

    /** Current active allocation's staff id, or null. */
    private function currentAllocStaff(int $cid, int $assetId): ?int
    {
        $a = (new AssetAllocationModel())
            ->where(['client_id' => $cid, 'asset_id' => $assetId, 'status' => 'allocated'])->first();

        return $a ? (int) $a['staff_id'] : null;
    }

    /** Mark any active allocation of an asset as revoked. */
    private function closeAllocation(int $cid, int $assetId): void
    {
        (new AssetAllocationModel())
            ->where(['client_id' => $cid, 'asset_id' => $assetId, 'status' => 'allocated'])
            ->set(['status' => 'revoked', 'revoked_at' => date('Y-m-d H:i:s')])->update();
    }

    /** Open a fresh active allocation. */
    private function openAllocation(int $cid, int $assetId, int $staffId, ?string $note): void
    {
        (new AssetAllocationModel())->insert([
            'client_id'    => $cid,
            'asset_id'     => $assetId,
            'staff_id'     => $staffId,
            'allocated_at' => date('Y-m-d H:i:s'),
            'status'       => 'allocated',
            'notes'        => $note,
        ]);
    }

    /** Write an asset tracker-log row + mirror it to the global activity log. */
    private function logAsset(int $cid, int $assetId, string $action, ?string $note = null, ?int $from = null, ?int $to = null): void
    {
        $user = $this->currentUser();
        (new AssetLogModel())->insert([
            'client_id'     => $cid,
            'asset_id'      => $assetId,
            'action'        => $action,
            'from_staff_id' => $from,
            'to_staff_id'   => $to,
            'note'          => $note !== null ? mb_substr($note, 0, 1000) : null,
            'actor_id'      => $user['id'] ?? null,
            'actor_name'    => $user['name'] ?? ($user['email'] ?? null),
        ]);
        $this->logActivity($action, 'asset', $assetId, ucfirst($action) . ' asset #' . $assetId, $cid);
    }

    private function assetData(int $cid, bool $partial = false): array
    {
        $num = static fn ($v) => ($v === null || trim((string) $v) === '') ? null : $v;
        $data = [
            'client_id'           => $cid,
            'name'                => trim((string) $this->input('name')),
            'quantity'            => (int) ($this->input('quantity') ?? 1) ?: 1,
            'unit'                => trim((string) ($this->input('unit') ?? '')) ?: null,
            'series_model'        => trim((string) ($this->input('series_model') ?? '')) ?: null,
            'asset_group'         => trim((string) ($this->input('asset_group') ?? '')) ?: null,
            'managed_by'          => (int) $this->input('managed_by') ?: null,
            'asset_location'      => trim((string) ($this->input('asset_location') ?? '')) ?: null,
            'purchase_date'       => $num($this->input('purchase_date')),
            'warranty_months'     => $num($this->input('warranty_months')),
            'unit_price'          => $num($this->input('unit_price')),
            'depreciation_months' => $num($this->input('depreciation_months')),
            'supplier_name'       => trim((string) ($this->input('supplier_name') ?? '')) ?: null,
            'supplier_phone'      => trim((string) ($this->input('supplier_phone') ?? '')) ?: null,
            'supplier_address'    => trim((string) ($this->input('supplier_address') ?? '')) ?: null,
            'description'         => trim((string) ($this->input('description') ?? '')) ?: null,
        ];
        if (($att = trim((string) ($this->input('attachment') ?? ''))) !== '') {
            $data['attachment'] = $att;
        }
        if ($partial) {
            unset($data['client_id']);
        }

        return $data;
    }

    /** Next sequential asset code, e.g. AST-1, AST-2. */
    private function nextAssetCode(int $cid): string
    {
        // Count deleted assets too, so a code is never reused after a soft delete.
        $count = (new AssetModel())->withDeleted()->where('client_id', $cid)->countAllResults();

        return 'AST-' . ($count + 1);
    }

    /**
     * POST /client/upload — multipart image/file upload (field "file").
     * Used for staff photos and asset attachments. Returns the stored URL.
     */
    public function upload()
    {
        $file = $this->request->getFile('file');
        if (! $file || ! $file->isValid()) {
            return $this->failValidationErrors('Please choose a valid file.');
        }
        if ($file->getSize() > 5 * 1024 * 1024) {
            return $this->failValidationErrors('File must be 5MB or smaller.');
        }

        $uploadDir = FCPATH . 'uploads';
        if (! is_dir($uploadDir)) {
            mkdir($uploadDir, 0775, true);
        }
        $newName = $file->getRandomName();
        $file->move($uploadDir, $newName);

        return $this->respond(['message' => 'Uploaded', 'url' => '/uploads/' . $newName]);
    }
}
