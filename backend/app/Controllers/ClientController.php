<?php

namespace App\Controllers;

use App\Libraries\CallIngestService;
use App\Libraries\GmailService;
use App\Libraries\GoogleCalendarService;
use App\Libraries\HtmlSanitizer;
use App\Libraries\MailerService;
use App\Libraries\PasswordPolicy;
use App\Libraries\PushService;
use App\Libraries\TenantManager;
use App\Models\ActivityLogModel;
use App\Models\AnnouncementModel;
use App\Models\AnnouncementReadModel;
use App\Models\AppNotificationModel;
use App\Models\AssetAllocationModel;
use App\Models\AssetLogModel;
use App\Models\AssetModel;
use App\Models\CallLogModel;
use App\Models\CityModel;
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
use App\Models\LeadReferenceModel;
use App\Models\LeadReminderModel;
use App\Models\LeadSourceModel;
use App\Models\LeadStatusModel;
use App\Models\LeadTransferModel;
use App\Models\LeadTypeModel;
use App\Models\MarketingTypeModel;
use App\Models\OfficeLocationModel;
use App\Models\PushSubscriptionModel;
use App\Models\SettingsModel;
use App\Models\StaffAccountModel;
use App\Models\StateModel;
use App\Models\TaskCommentModel;
use App\Models\TaskStageModel;
use App\Models\UserModel;
use App\Models\UserTablePrefModel;
use App\Models\VisitorModel;
use App\Models\VisitorStatusModel;
use App\Models\VisitorTypeModel;

/**
 * Client-admin endpoints. The whole group is protected by the
 * `auth:client_admin` filter, so a session user (with client_id) always exists.
 * Every query is scoped to the signed-in admin's client_id.
 */
class ClientController extends ApiController
{
    /** Modules that roles can be granted CRUD permissions on. */
    public const MODULES = [
        'dashboard', 'leads', 'leads_setup', 'followups', 'lead_transfer', 'visitors', 'team', 'roles', 'tasks', 'assets',
        'calls', 'reports', 'chat', 'notifications', 'announcements', 'email_config', 'settings',
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
        'favicon_url'   => '',             // browser tab icon (separate from logo)
        'logo_width'    => '40',           // sidebar logo box width in px
        'logo_height'   => '40',           // sidebar logo box height in px
        'theme_mode'    => 'light',        // light | dark | system
        'density'       => 'comfortable',  // comfortable | compact
        'sidebar_style' => 'subtle',       // subtle | solid
        'menu_order'    => '',             // JSON array of nav keys
        'menu_labels'   => '',             // JSON map navKey => custom label
        'menu_icons'    => '',             // JSON map navKey => icon name
        'default_page_size' => '15',       // default rows-per-page for every table
        'font_family'   => 'inter',        // inter | poppins | slab | mono | system
        'font_size'     => 'base',         // sm | base | lg
        'loader_style'  => 'spinner',      // loading animation: see LOADER_STYLES
    ];

    /** Allowed loading-animation styles for the loader_style setting. */
    public const LOADER_STYLES = ['spinner', 'ring', 'dots', 'bars', 'pulse', 'grid'];

    /**
     * Branding keys that may be saved blank on purpose. For these, an empty saved
     * value is kept (not replaced by the default) — the default only applies when
     * the client has never set the key at all.
     */
    public const BRANDING_BLANK_ALLOWED = ['app_name', 'app_tagline'];

    /** Allowed "rows per page" values for the default_page_size setting. */
    public const PAGE_SIZE_OPTIONS = [10, 15, 25, 50, 100];

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

    /** Memoised per-request reference scope (false = not resolved yet). */
    private string|false|null $refScope = false;

    /** Memoised id of the current agent's reference (0 = resolved to none). */
    private ?int $refIdScope = null;

    /**
     * The reference NAME the current user's lead view is locked to, or null when
     * reference-scoping doesn't apply (admins, and staff without a reference).
     * A staff member with `reference_id` set is an "agent": they see only leads
     * whose `reference_name` matches their reference. If their reference was
     * deleted we return a sentinel that matches no lead (fail closed).
     */
    private function currentReferenceName(): ?string
    {
        if ($this->refScope !== false) {
            return $this->refScope; // memoised (null or a name)
        }
        $this->refScope = null;

        if ($this->isAdmin()) {
            return null;
        }
        $sid = $this->staffId();
        if (! $sid) {
            return null;
        }
        $staff = (new ClientStaffModel())->where('client_id', $this->clientId())->find($sid);
        $refId = $staff['reference_id'] ?? null;
        if (! $refId) {
            return null;
        }
        $this->refIdScope = (int) $refId;
        $ref              = (new LeadReferenceModel())->where('client_id', $this->clientId())->find((int) $refId);
        $this->refScope   = $ref['name'] ?? "\x00__deleted_reference__";

        return $this->refScope;
    }

    /** The current agent's reference id, or null when reference-scoping doesn't apply. */
    private function currentReferenceId(): ?int
    {
        // currentReferenceName() populates $refIdScope as a side effect.
        $this->currentReferenceName();

        return $this->refIdScope;
    }

    /**
     * Apply the current user's lead-visibility scope to a leads query/builder:
     *   - admin            → no restriction
     *   - reference "agent" → only leads with the matching reference_name
     *   - everyone else     → only leads assigned to them or their reports
     *
     * @param object $q a LeadModel query or its builder (supports where/whereIn)
     */
    private function applyLeadScope($q): void
    {
        if ($this->isAdmin()) {
            return;
        }
        $refName = $this->currentReferenceName();
        if ($refName !== null) {
            // Match on the stable id, but also on the (live) name so legacy leads
            // that predate reference_id — or imports tagged by free-text name —
            // stay visible to their agent.
            $refId = $this->currentReferenceId();
            $q->groupStart();
            if ($refId) {
                $q->where('reference_id', $refId)->orWhere('reference_name', $refName);
            } else {
                $q->where('reference_name', $refName);
            }
            $q->groupEnd();

            return;
        }
        $sid   = $this->staffId();
        $scope = $sid ? (new ClientStaffModel())->subordinateIds($this->clientId(), $sid) : [0];
        $q->whereIn('assigned_to', $scope ?: [0]);
    }

    /** Whether the current user is allowed to see one specific lead row. */
    private function canSeeLead(array $lead): bool
    {
        if ($this->isAdmin()) {
            return true;
        }
        $refName = $this->currentReferenceName();
        if ($refName !== null) {
            $refId = $this->currentReferenceId();
            if ($refId && (int) ($lead['reference_id'] ?? 0) === $refId) {
                return true;
            }

            return trim((string) ($lead['reference_name'] ?? '')) === $refName;
        }
        $sid   = $this->staffId();
        $scope = $sid ? (new ClientStaffModel())->subordinateIds($this->clientId(), $sid) : [0];

        return in_array((int) ($lead['assigned_to'] ?? 0), $scope, true);
    }

    /** GET /client/me — current user, whether they're an admin, and their permissions. */
    public function me()
    {
        $u = $this->currentUser();

        return $this->respond([
            'user'        => $u,
            'is_admin'    => $this->isAdmin(),
            // An "agent" is a staff member locked to a reference: their lead view
            // is scoped by reference (not assignment), so the UI hides assignment.
            'is_agent'    => ! $this->isAdmin() && $this->currentReferenceName() !== null,
            'role'        => $this->role(),
            'permissions' => $this->effectivePermissions(),
            'modules'     => self::MODULES,
            // Super-admin "login as client" banner: surface the impersonation state.
            'impersonating'    => ! empty($u['impersonated_by']),
            'impersonator_name' => $u['impersonated_by'] ?? null,
            'client_name'      => $u['client_name'] ?? null,
        ]);
    }

    /** Allowed backup frequencies for the client schedule. */
    private const BACKUP_FREQUENCIES = ['daily', 'weekly', 'monthly'];

    /** This client's auto-backup schedule (from their settings, with defaults). */
    private function backupScheduleData(): array
    {
        $m    = $this->settingsMap();
        $freq = $m['backup_frequency'] ?? 'daily';

        return [
            'enabled'        => ($m['backup_enabled'] ?? '0') === '1',
            'frequency'      => in_array($freq, self::BACKUP_FREQUENCIES, true) ? $freq : 'daily',
            'hour'           => max(0, min(23, (int) ($m['backup_hour'] ?? 2))),
            'retention_days' => max(1, (int) ($m['backup_retention_days'] ?? 14)),
            'last_run'       => $m['backup_last_run'] ?? null,
            'last_status'    => $m['backup_last_status'] ?? null,
        ];
    }

    /**
     * GET /client/backup-schedule — the workspace's automatic-backup schedule.
     * Clients can set when their database is backed up (the backups themselves
     * run on the server and are managed by the platform admin — no client download).
     */
    public function backupSchedule()
    {
        if (! $this->isAdmin()) {
            return $this->failForbidden('Only the workspace admin can manage backups.');
        }

        return $this->respond([
            'schedule'    => $this->backupScheduleData(),
            'frequencies' => self::BACKUP_FREQUENCIES,
        ]);
    }

    /** POST /client/backup-schedule — save the schedule (frequency, time, retention). */
    public function saveBackupSchedule()
    {
        if (! $this->isAdmin()) {
            return $this->failForbidden('Only the workspace admin can manage backups.');
        }
        $in   = (array) $this->input();
        $freq = $in['frequency'] ?? '';

        $this->setSetting('backup_enabled', ! empty($in['enabled']) && $in['enabled'] !== '0' ? '1' : '0');
        $this->setSetting('backup_frequency', in_array($freq, self::BACKUP_FREQUENCIES, true) ? $freq : 'daily');
        $this->setSetting('backup_hour', (string) max(0, min(23, (int) ($in['hour'] ?? 2))));
        $this->setSetting('backup_retention_days', (string) max(1, min(365, (int) ($in['retention_days'] ?? 14))));

        $this->logActivity('updated', 'settings', null, 'Updated database backup schedule', $this->clientId());

        return $this->respond(['schedule' => $this->backupScheduleData()]);
    }

    /**
     * GET /client/search?q=... — global search across the modules the current
     * user can reach. Returns a few best matches per entity type, each with a
     * link into the relevant section. Respects feature gating, per-module
     * permissions and row visibility (staff see only their own / their reports').
     */
    public function search()
    {
        $q = trim((string) ($this->request->getGet('q') ?? ''));
        if (mb_strlen($q) < 2) {
            return $this->respond(['query' => $q, 'groups' => []]);
        }

        $cid    = $this->clientId();
        $scope  = $this->visibleStaffIds(); // null = admin (sees everything)
        $feat   = new \App\Libraries\FeatureService();
        $limit  = 6;
        $groups = [];

        // ---- Leads (name / phone / alt phone / email) ----
        if ($feat->isEnabled($cid, 'leads') && $this->can('leads', 'view')) {
            $b = (new LeadModel())->where('client_id', $cid)
                ->groupStart()
                    ->like('name', $q)->orLike('phone', $q)->orLike('alt_phone', $q)->orLike('email', $q)
                ->groupEnd();
            if ($scope !== null) {
                $b->whereIn('assigned_to', $scope ?: [0]);
            }
            $items = [];
            foreach ($b->orderBy('id', 'DESC')->findAll($limit) as $r) {
                $sub = $r['phone'] ?? '';
                if (! empty($r['email'])) {
                    $sub = $sub !== '' ? $sub . ' · ' . $r['email'] : $r['email'];
                }
                $items[] = [
                    'id'       => (int) $r['id'],
                    'title'    => $r['name'] ?: ($r['phone'] ?? 'Lead'),
                    'subtitle' => $sub,
                    'href'     => '/client/leads?q=' . rawurlencode((string) ($r['phone'] ?: $r['name'] ?: '')),
                ];
            }
            if ($items) {
                $groups[] = ['key' => 'leads', 'label' => 'Leads', 'items' => $items];
            }
        }

        // ---- Team (name / email / phone) ----
        if ($feat->isEnabled($cid, 'team') && $this->can('team', 'view')) {
            $b = (new ClientStaffModel())->where('client_id', $cid)
                ->groupStart()
                    ->like('name', $q)->orLike('email', $q)->orLike('phone', $q)
                ->groupEnd();
            if ($scope !== null) {
                $b->whereIn('id', $scope ?: [0]);
            }
            $items = [];
            foreach ($b->orderBy('name', 'ASC')->findAll($limit) as $r) {
                $items[] = [
                    'id'       => (int) $r['id'],
                    'title'    => $r['name'],
                    'subtitle' => trim((string) ($r['designation'] ?? '')) ?: (string) ($r['email'] ?? ''),
                    'href'     => '/client/team?q=' . rawurlencode((string) ($r['name'] ?? '')),
                ];
            }
            if ($items) {
                $groups[] = ['key' => 'team', 'label' => 'Team', 'items' => $items];
            }
        }

        // ---- Tasks (title) ----
        if ($feat->isEnabled($cid, 'tasks') && $this->can('tasks', 'view')) {
            $b = (new ClientTaskModel())->where('client_id', $cid)->like('title', $q);
            if ($scope !== null) {
                $b->whereIn('assigned_to', $scope ?: [0]);
            }
            $items = [];
            foreach ($b->orderBy('id', 'DESC')->findAll($limit) as $r) {
                $items[] = [
                    'id'       => (int) $r['id'],
                    'title'    => $r['title'],
                    'subtitle' => ucfirst(str_replace('_', ' ', (string) ($r['status'] ?? ''))),
                    'href'     => '/client/tasks?q=' . rawurlencode((string) ($r['title'] ?? '')),
                ];
            }
            if ($items) {
                $groups[] = ['key' => 'tasks', 'label' => 'Tasks', 'items' => $items];
            }
        }

        // ---- Assets (name / code) — admins & staff with the module ----
        if ($feat->isEnabled($cid, 'assets') && $this->can('assets', 'view')) {
            $rows = (new AssetModel())->where('client_id', $cid)
                ->groupStart()->like('name', $q)->orLike('asset_code', $q)->groupEnd()
                ->orderBy('id', 'DESC')->findAll($limit);
            $items = [];
            foreach ($rows as $r) {
                $items[] = [
                    'id'       => (int) $r['id'],
                    'title'    => $r['name'],
                    'subtitle' => trim((string) ($r['asset_code'] ?? '')),
                    'href'     => '/client/assets?q=' . rawurlencode((string) ($r['name'] ?? '')),
                ];
            }
            if ($items) {
                $groups[] = ['key' => 'assets', 'label' => 'Assets', 'items' => $items];
            }
        }

        return $this->respond(['query' => $q, 'groups' => $groups]);
    }

    // ------------------------------------------------------------- MY PROFILE
    //
    // The signed-in user's own account. The client panel serves two kinds of
    // users, so each profile action branches on who's acting:
    //   - client admin: their record lives in the main-DB `users` table.
    //   - staff: their profile lives in the client's `client_staff` table; their
    //     login (email + password) lives in the main-DB `staff_accounts` index.

    /** GET /client/profile — the signed-in user's own profile. */
    public function profile()
    {
        if ($this->isAdmin()) {
            $user = (new UserModel())->find($this->userId());
            if (! $user) {
                return $this->failNotFound('Profile not found');
            }

            return $this->respond(['profile' => [
                'name'        => $user['name'] ?? '',
                'email'       => $user['email'] ?? '',
                'avatar'      => $user['avatar'] ?? '',
                'phone'       => '',
                'designation' => '',
                'is_admin'    => true,
            ]]);
        }

        $staff = (new ClientStaffModel())->where('client_id', $this->clientId())->find($this->staffId());
        if (! $staff) {
            return $this->failNotFound('Profile not found');
        }

        return $this->respond(['profile' => [
            'name'        => $staff['name'] ?? '',
            'email'       => $staff['email'] ?? '',
            'avatar'      => $staff['avatar'] ?? '',
            'phone'       => $staff['phone'] ?? '',
            'designation' => $staff['designation'] ?? '',
            'is_admin'    => false,
        ]]);
    }

    /**
     * POST /client/profile — update the signed-in user's own details.
     * Body (all optional): { name, email, phone, avatar }. Staff may also edit
     * their phone; designation is admin-managed and not editable here.
     */
    public function updateProfile()
    {
        $name   = $this->input('name');
        $email  = $this->input('email');
        $phone  = $this->input('phone');
        $avatar = $this->input('avatar');

        // ----- Client admin (main-DB users row) -----
        if ($this->isAdmin()) {
            $userModel = new UserModel();
            $id        = $this->userId();
            $data      = [];

            if ($name !== null) {
                $data['name'] = trim((string) $name);
            }
            if ($avatar !== null) {
                $data['avatar'] = trim((string) $avatar) ?: null;
            }
            if ($email !== null) {
                $email = trim((string) $email);
                if ($email === '' || ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
                    return $this->failValidationErrors(['email' => 'Please enter a valid email address.']);
                }
                if ($userModel->where('email', $email)->where('id !=', $id)->first()) {
                    return $this->failValidationErrors(['email' => 'That email address is already registered.']);
                }
                $data['email'] = $email;
            }

            if (! $data) {
                return $this->failValidationErrors('Nothing to update');
            }
            if (! $userModel->skipValidation(true)->update($id, $data)) {
                return $this->failValidationErrors($userModel->errors());
            }

            $this->syncSessionUser($data);
            $this->logActivity('updated', 'profile', $id, 'Updated their profile (' . implode(', ', array_keys($data)) . ')');

            return $this->profile();
        }

        // ----- Staff (client_staff profile + staff_accounts login index) -----
        $cid        = $this->clientId();
        $sid        = $this->staffId();
        $staffModel = new ClientStaffModel();
        if (! $staffModel->where('client_id', $cid)->find($sid)) {
            return $this->failNotFound('Profile not found');
        }

        $data = [];
        if ($name !== null) {
            $data['name'] = trim((string) $name);
        }
        if ($phone !== null) {
            $data['phone'] = trim((string) $phone) ?: null;
        }
        if ($avatar !== null) {
            $data['avatar'] = trim((string) $avatar) ?: null;
        }
        if ($email !== null) {
            $email = trim((string) $email);
            if ($email === '' || ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
                return $this->failValidationErrors(['email' => 'Please enter a valid email address.']);
            }
            if ($this->staffEmailTaken($email, $cid, $sid)) {
                return $this->failValidationErrors(['email' => 'That email address is already registered.']);
            }
            $data['email'] = $email;
        }

        if (! $data) {
            return $this->failValidationErrors('Nothing to update');
        }

        $staffModel->skipValidation(true)->update($sid, $data);
        // Keep the main-DB login index in step with any email change.
        if (array_key_exists('email', $data)) {
            $this->syncStaffAccount($cid, $sid, ['email' => $data['email']]);
        }

        $this->syncSessionUser($data);
        $this->logActivity('updated', 'profile', $sid, 'Updated their profile (' . implode(', ', array_keys($data)) . ')');

        return $this->profile();
    }

    /**
     * POST /client/password — change the signed-in user's password. The stored
     * hash lives in `users` for admins and in `staff_accounts` for staff.
     * Body: { current_password, new_password }.
     */
    public function changePassword()
    {
        $current = (string) $this->input('current_password');
        $next    = (string) $this->input('new_password');

        if ($current === '' || $next === '') {
            return $this->failValidationErrors('Current and new password are required');
        }
        $email = (string) ($this->currentUser()['email'] ?? '');
        if ($problems = PasswordPolicy::problems($next, $email)) {
            return $this->failValidationErrors(['new_password' => 'Password must: ' . implode('; ', $problems) . '.']);
        }

        // ----- Client admin -----
        if ($this->isAdmin()) {
            $userModel = new UserModel();
            $id        = $this->userId();
            $user      = $userModel->find($id);

            if (! $user || ! password_verify($current, (string) $user['password'])) {
                return $this->failValidationErrors(['current_password' => 'Current password is incorrect.']);
            }
            // UserModel::hashPassword() hashes this automatically on update.
            if (! $userModel->skipValidation(true)->update($id, ['password' => $next])) {
                return $this->failValidationErrors($userModel->errors());
            }
            $this->clearMustChangePassword();
            $this->logActivity('updated', 'profile', $id, 'Changed their password');

            return $this->respond(['message' => 'Password changed']);
        }

        // ----- Staff (login lives in staff_accounts; client_staff keeps a copy) -----
        $cid = $this->clientId();
        $sid = $this->staffId();
        $acc = new StaffAccountModel();
        $row = $acc->where('client_id', $cid)->where('staff_id', $sid)->first();

        if (! $row || empty($row['password']) || ! password_verify($current, (string) $row['password'])) {
            return $this->failValidationErrors(['current_password' => 'Current password is incorrect.']);
        }

        $hash = password_hash($next, PASSWORD_DEFAULT);
        $acc->update($row['id'], ['password' => $hash]);
        (new ClientStaffModel())->skipValidation(true)->update($sid, ['password' => $hash]);
        $this->clearMustChangePassword();
        $this->logActivity('updated', 'profile', $sid, 'Changed their password');

        return $this->respond(['message' => 'Password changed']);
    }

    /** Clear the "weak password — must change" session flag after a strong reset. */
    private function clearMustChangePassword(): void
    {
        $u = $this->currentUser();
        if (is_array($u)) {
            $u['must_change_password'] = false;
            $this->session->set('user', $u);
        }
    }

    /** Whether $email is used by another staff account or platform user. */
    private function staffEmailTaken(string $email, int $cid, int $sid): bool
    {
        foreach ((new StaffAccountModel())->where('email', $email)->findAll() as $r) {
            if (! ((int) $r['client_id'] === $cid && (int) $r['staff_id'] === $sid)) {
                return true;
            }
        }

        return (new UserModel())->where('email', $email)->first() !== null;
    }

    /** Mirror just-saved name/email onto the session user (drives the greeting/avatar). */
    private function syncSessionUser(array $data): void
    {
        $u = $this->currentUser();
        if (isset($data['name'])) {
            $u['name'] = $data['name'];
        }
        if (isset($data['email'])) {
            $u['email'] = $data['email'];
        }
        $this->session->set('user', $u);
    }

    // ------------------------------------------------------------- WEB PUSH
    //
    // Browser Web Push subscriptions for the signed-in user (client admin or
    // staff). Gated by the per-client `web_push` feature (super-admin toggle).

    /** The push recipient for the current session: ['staff'|'user', id]. */
    private function pushRecipient(): array
    {
        if ($this->role() === 'staff') {
            return ['staff', $this->staffId()];
        }

        return ['user', (int) ($this->currentUser()['id'] ?? 0)];
    }

    /** GET /client/push/public-key — VAPID public key + whether push is on. */
    public function pushPublicKey()
    {
        $cid = $this->clientId();

        return $this->respond([
            'key'     => PushService::publicKey(),
            'enabled' => PushService::enabledFor($cid),
        ]);
    }

    /** POST /client/push/subscribe — save this browser's push subscription. */
    public function pushSubscribe()
    {
        $cid = $this->clientId();
        if (! PushService::enabledFor($cid)) {
            return $this->failForbidden('Web push is not enabled for this account.');
        }

        $sub      = $this->input('subscription');
        $endpoint = is_array($sub) ? (string) ($sub['endpoint'] ?? '') : '';
        $keys     = is_array($sub) && isset($sub['keys']) && is_array($sub['keys']) ? $sub['keys'] : [];
        $p256dh   = (string) ($keys['p256dh'] ?? '');
        $auth     = (string) ($keys['auth'] ?? '');

        if ($endpoint === '' || $p256dh === '' || $auth === '') {
            return $this->failValidationErrors('A valid push subscription is required.');
        }

        [$type, $id] = $this->pushRecipient();
        (new PushSubscriptionModel())->upsertByEndpoint([
            'client_id'      => $cid,
            'recipient_type' => $type,
            'recipient_id'   => $id,
            'endpoint'       => $endpoint,
            'p256dh'         => $p256dh,
            'auth'           => $auth,
            'user_agent'     => mb_substr($this->request->getHeaderLine('User-Agent'), 0, 255),
        ]);

        return $this->respond(['message' => 'Push notifications enabled.']);
    }

    /** POST /client/push/unsubscribe — forget this browser's subscription. */
    public function pushUnsubscribe()
    {
        $endpoint = (string) $this->input('endpoint');
        if ($endpoint !== '') {
            (new PushSubscriptionModel())->where('endpoint_hash', hash('sha256', $endpoint))->delete();
        }

        return $this->respond(['message' => 'Push notifications disabled.']);
    }

    /** Logical tables a user may save a layout for. Guards the table_key param. */
    private const TABLE_PREF_KEYS = [
        'leads', 'leads_filters', 'calls',
        'team', 'office_locations', 'assets', 'followups', 'billing',
    ];

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

    /** GET /client/table-sort/(:segment) — client-wide admin sort config for a table. */
    public function tableSort(string $key)
    {
        if (! in_array($key, self::TABLE_PREF_KEYS, true)) {
            return $this->failNotFound('Unknown table.');
        }

        return $this->respond(['sort' => $this->tableSortFor($this->clientId(), $key)]);
    }

    /**
     * POST /client/table-sort/(:segment) — the client admin sets which columns
     * are sortable and the default sort for a table (applies to everyone; staff
     * see it read-only but can still re-sort their own view).
     * Body: { sortable: string[], key: string|null, dir: 'asc'|'desc' }.
     */
    public function saveTableSort(string $key)
    {
        if (! in_array($key, self::TABLE_PREF_KEYS, true)) {
            return $this->failNotFound('Unknown table.');
        }
        if (! $this->isAdmin()) {
            return $this->failForbidden('Only the client admin can configure sorting.');
        }

        $sortable = $this->input('sortable');
        $sortable = is_array($sortable)
            ? array_values(array_unique(array_filter(array_map(static fn ($c) => is_string($c) ? $c : '', $sortable))))
            : [];
        $sortKey = (string) ($this->input('key') ?? '');
        $sortKey = ($sortKey !== '' && in_array($sortKey, $sortable, true)) ? $sortKey : '';
        $dir     = strtolower((string) ($this->input('dir') ?? 'asc')) === 'desc' ? 'desc' : 'asc';

        $clean = ['sortable' => $sortable, 'key' => $sortKey, 'dir' => $dir];
        $cid   = $this->clientId();
        $this->upsertSetting(new SettingsModel(), $cid, 'table_sort.' . $key, (string) json_encode($clean));
        $this->logActivity('updated', 'settings', null, 'Updated column sorting on the ' . $key . ' table', $cid);

        return $this->respond(['message' => 'Sorting saved', 'sort' => $clean]);
    }

    /** Client-wide sort config for a table: { sortable[], key, dir }. */
    private function tableSortFor(int $cid, string $key): array
    {
        $row = (new SettingsModel())->where(['client_id' => $cid, 'setting_key' => 'table_sort.' . $key])->first();
        $val = $row ? json_decode((string) $row['setting_value'], true) : null;
        if (! is_array($val)) {
            return ['sortable' => [], 'key' => '', 'dir' => 'asc'];
        }

        return [
            'sortable' => is_array($val['sortable'] ?? null) ? array_values(array_filter($val['sortable'], 'is_string')) : [],
            'key'      => (string) ($val['key'] ?? ''),
            'dir'      => ($val['dir'] ?? 'asc') === 'desc' ? 'desc' : 'asc',
        ];
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

        // Per-staff extra grants, when present, REPLACE the role entirely — the
        // same precedence effectivePermissions()/can() (and the UI) use. This
        // keeps write-guards (denyUnlessPerm) consistent with what the UI shows,
        // so an action revoked via extra_permissions is actually blocked.
        if (! empty($user['staff_id'])) {
            $staff = (new ClientStaffModel())->find((int) $user['staff_id']);
            $extra = json_decode((string) ($staff['extra_permissions'] ?? ''), true);
            if (is_array($extra) && $extra) {
                return ! empty($extra[$module][$action]);
            }
        }

        if (! empty($user['role_id'])) {
            $p = (new ClientRolePermissionModel())
                ->where(['role_id' => $user['role_id'], 'module' => $module])->first();
            if ($p && ! empty($p['can_' . $action])) {
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
        $doneKeys = $this->doneTaskStageKeys($cid);
        $upcoming = array_values(array_filter($allTasks, static fn ($t) => ! in_array($t['status'], $doneKeys, true) && ! empty($t['due_date'])));
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
            } elseif ($key === 'menu_labels' || $key === 'menu_icons') {
                // JSON map of navKey => string (custom label / icon name).
                $clean = [];
                if (is_array($value)) {
                    foreach ($value as $k => $v) {
                        $k = preg_replace('/[^a-z0-9_-]/i', '', (string) $k);
                        $v = mb_substr(trim((string) $v), 0, 40);
                        if ($k !== '' && $v !== '') {
                            $clean[$k] = $v;
                        }
                    }
                }
                $value = json_encode($clean);
            } elseif ($key === 'brand_color') {
                $value = $this->sanitizeHexColor((string) $value);
            } elseif ($key === 'default_page_size') {
                $n     = (int) $value;
                $value = (string) (in_array($n, self::PAGE_SIZE_OPTIONS, true) ? $n : self::BRANDING_DEFAULTS['default_page_size']);
            } elseif ($key === 'loader_style') {
                $value = in_array($value, self::LOADER_STYLES, true) ? (string) $value : self::BRANDING_DEFAULTS['loader_style'];
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
            if (in_array($key, self::BRANDING_BLANK_ALLOWED, true)) {
                // These may be intentionally left blank — only fall back to the
                // default when the client has never set them (no saved row), not
                // when they've explicitly cleared the field to "".
                $out[$key] = array_key_exists($key, $saved) ? $saved[$key] : $default;
            } else {
                $out[$key] = ($saved[$key] ?? '') !== '' ? $saved[$key] : $default;
            }
        }

        // menu_order is stored as JSON; hand it back as an array.
        $order             = json_decode((string) ($saved['menu_order'] ?? ''), true);
        $out['menu_order'] = is_array($order) ? array_values($order) : [];

        // menu_labels / menu_icons are stored as JSON maps; hand back as objects
        // ((object) so an empty map serialises as {} rather than []).
        foreach (['menu_labels', 'menu_icons'] as $jsonKey) {
            $decoded       = json_decode((string) ($saved[$jsonKey] ?? ''), true);
            $out[$jsonKey] = (object) (is_array($decoded) ? $decoded : []);
        }

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
        if ($resp = $this->requirePermission('email_config', 'update')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('settings', 'update')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('roles', 'create')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('roles', 'update')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('roles', 'delete')) {
            return $resp;
        }
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

    /**
     * Resolve a client-supplied sort key + direction into a safe [column, dir]
     * for the leads ORDER BY. Only whitelisted columns are allowed; name-based
     * columns (status/source/type/assignee) sort by their underlying id, and
     * computed columns (last call, follow flag) fall back to id. Anything
     * unknown → newest-first (id DESC).
     */
    private function leadSortColumn($sort, $dir): array
    {
        $map = [
            'name'           => 'name',
            'phone'          => 'phone',
            'alt_phone'      => 'alt_phone',
            'email'          => 'email',
            'city'           => 'city',
            'state'          => 'state',
            'assigned_date'  => 'assigned_date',
            'created_date'   => 'created_at',
            'follow_date'    => 'follow_date',
            'updated_at'     => 'updated_at',
            'status'         => 'status_id',
            'sub_status'     => 'sub_status_id',
            'source'         => 'source_id',
            'lead_type'      => 'lead_type_id',
            'assigned'       => 'assigned_to',
            'reference_name' => 'reference_name',
        ];
        $col = $map[(string) $sort] ?? 'id';
        $dir = strtolower((string) $dir) === 'asc' ? 'ASC' : 'DESC';

        return [$col, $dir];
    }

    /** GET /client/leads — this client's leads, ordered per the request, name-decorated. */
    public function leads()
    {
        if ($resp = $this->requirePermission('leads')) {
            return $resp;
        }
        $cid = $this->clientId();
        $q   = (new LeadModel())->where('client_id', $cid);

        // Hide leads that are mid-transfer awaiting admin approval (from everyone).
        $q->where('(pending_transfer IS NULL OR pending_transfer = 0)');

        // Staff see only the leads in their visibility scope — reference "agents"
        // see only their reference's leads; everyone else, their assigned leads.
        $this->applyLeadScope($q);

        // Server-side ordering — driven by the admin's whole-team default sort
        // and per-column asc/desc header toggles (sort=<column>&dir=asc|desc).
        [$col, $dir] = $this->leadSortColumn($this->request->getGet('sort'), $this->request->getGet('dir'));
        $q->orderBy($col, $dir);
        if ($col !== 'id') {
            $q->orderBy('id', 'DESC'); // stable tiebreak so equal keys keep a fixed order
        }
        $rows = $q->findAll();

        $statusNames = $this->idNameMap($this->lookupRows(LeadStatusModel::class, $cid));
        $staffNames  = $this->idNameMap((new ClientStaffModel())->where('client_id', $cid)->findAll());
        $sourceNames = $this->idNameMap($this->lookupRows(LeadSourceModel::class, $cid));
        $typeNames   = $this->idNameMap($this->lookupRows(LeadTypeModel::class, $cid));
        $refNames    = $this->idNameMap($this->lookupRows(LeadReferenceModel::class, $cid));

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
            // Reference name resolved live from the id, so renames reflect without
            // rewriting leads; fall back to the stored snapshot for legacy rows.
            $r['reference_id']     = $r['reference_id'] !== null ? (int) $r['reference_id'] : null;
            if ($r['reference_id']) {
                $r['reference_name'] = $refNames[$r['reference_id']] ?? $r['reference_name'];
            }

            $rem = $remindersByLead[(int) $r['id']] ?? [];
            $r['last_reminder_at'] = $rem ? max($rem) : null;
            $r['follow_flag']      = $this->followFlag($r['follow_date'], $rem, $notesByLead[(int) $r['id']] ?? [], $today);
            $r['last_call_at']     = $callByPhone[(string) ($r['phone'] ?? '')]
                ?? (($r['alt_phone'] ?? '') !== '' ? ($callByPhone[(string) $r['alt_phone']] ?? null) : null);
            $r['custom_fields']    = $this->decodeCustom($r['custom_fields'] ?? null);
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

        // Counts are scoped to match the leads the user can actually see, so the
        // figures line up with the leads table (reference agents → their
        // reference's leads; others → their assigned leads; admins → everything).
        // One grouped query per dimension.
        $statusCounts = $this->leadCountsBy($model, $cid, 'status_id');
        $subCounts    = $this->leadCountsBy($model, $cid, 'sub_status_id');
        $typeCounts   = $this->leadCountsBy($model, $cid, 'lead_type_id');
        $srcCounts    = $this->leadCountsBy($model, $cid, 'source_id');
        $totalQ       = (new LeadModel())->where('client_id', $cid);
        $this->applyLeadScope($totalQ);
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
     * Lead counts grouped by a column (ignoring null/zero keys), limited to the
     * leads the current user can see (so the figures match the leads table).
     *
     * @return array<int,int> column value => lead count
     */
    private function leadCountsBy(LeadModel $model, int $cid, string $column): array
    {
        $b = $model->builder()
            ->select("{$column} AS k, COUNT(*) AS c")
            ->where('client_id', $cid)
            ->where("{$column} IS NOT NULL")
            ->where("{$column} >", 0)
            ->where('deleted_at', null);
        $this->applyLeadScope($b);
        $rows = $b->groupBy($column)->get()->getResultArray();

        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['k']] = (int) $r['c'];
        }

        return $out;
    }

    // ============================================================ REPORTS
    //
    // The Reports hub aggregates the tenant data into exportable tables. Every
    // report is permission-gated on the `reports` module and staff-scoped via
    // visibleStaffIds, so a staff member only ever sees their own data.

    /**
     * Base leads query for reports: client + soft-delete + staff visibility +
     * the shared report filters (created-date range, status/source/type/assign).
     * Returns a fresh query builder each call.
     */
    private function reportLeadQuery(int $cid)
    {
        $b = (new LeadModel())->builder()
            ->where('client_id', $cid)
            ->where('deleted_at', null);

        $this->applyLeadScope($b);

        $from = trim((string) $this->request->getGet('from'));
        $to   = trim((string) $this->request->getGet('to'));
        if ($from !== '') {
            $b->where('created_date >=', $from);
        }
        if ($to !== '') {
            $b->where('created_date <=', $to);
        }

        $ids = fn (string $k) => array_values(array_filter(array_map('intval', explode(',', (string) $this->request->getGet($k)))));
        if ($s = $ids('lead_status')) {
            $b->whereIn('status_id', $s);
        }
        if ($s = $ids('lead_source')) {
            $b->whereIn('source_id', $s);
        }
        if ($s = $ids('lead_type')) {
            $b->whereIn('lead_type_id', $s);
        }
        if ($s = $ids('assign')) {
            $b->whereIn('assigned_to', $s);
        }

        return $b;
    }

    /**
     * GET /client/reports/leads-by?group=source|status|type|assigned|month
     * Lead counts grouped by one dimension, with each row's share of the total.
     */
    public function reportLeadsBy()
    {
        if ($resp = $this->requirePermission('reports')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $group = (string) ($this->request->getGet('group') ?: 'source');

        // Label + colour lookup for the chosen dimension.
        $meta = [];
        if ($group === 'source') {
            foreach ($this->decorateSources($cid) as $s) {
                $meta[(int) $s['id']] = ['label' => $s['marketing_type'] ? "{$s['name']} · {$s['marketing_type']}" : $s['name'], 'color' => $s['color']];
            }
        } elseif ($group === 'status') {
            foreach ($this->lookupRows(LeadStatusModel::class, $cid) as $s) {
                $meta[(int) $s['id']] = ['label' => $s['name'], 'color' => $s['color']];
            }
        } elseif ($group === 'type') {
            foreach ($this->lookupRows(LeadTypeModel::class, $cid) as $t) {
                $meta[(int) $t['id']] = ['label' => $t['name'], 'color' => $t['color']];
            }
        } elseif ($group === 'assigned') {
            foreach ((new ClientStaffModel())->where('client_id', $cid)->findAll() as $st) {
                $meta[(int) $st['id']] = ['label' => $st['name'], 'color' => 'slate'];
            }
        }

        $rows  = [];
        $total = 0;

        if ($group === 'month') {
            $res = $this->reportLeadQuery($cid)
                ->select("DATE_FORMAT(created_date, '%Y-%m') AS k, COUNT(*) AS c")
                ->where('created_date IS NOT NULL')
                ->groupBy('k')->orderBy('k', 'ASC')->get()->getResultArray();
            foreach ($res as $r) {
                $total += (int) $r['c'];
                $rows[] = ['id' => $r['k'], 'label' => $r['k'], 'color' => 'indigo', 'count' => (int) $r['c']];
            }
        } else {
            $col = ['source' => 'source_id', 'status' => 'status_id', 'type' => 'lead_type_id', 'assigned' => 'assigned_to'][$group] ?? 'source_id';
            $res = $this->reportLeadQuery($cid)->select("{$col} AS k, COUNT(*) AS c")->groupBy($col)->get()->getResultArray();
            foreach ($res as $r) {
                $count = (int) $r['c'];
                $total += $count;
                if ($r['k'] === null || (int) $r['k'] === 0) {
                    $rows[] = ['id' => 0, 'label' => $group === 'assigned' ? 'Unassigned' : 'Unspecified', 'color' => 'slate', 'count' => $count];
                } else {
                    $m      = $meta[(int) $r['k']] ?? null;
                    $rows[] = ['id' => (int) $r['k'], 'label' => $m['label'] ?? "#{$r['k']}", 'color' => $m['color'] ?? 'slate', 'count' => $count];
                }
            }
        }

        foreach ($rows as &$r) {
            $r['pct'] = $total > 0 ? round($r['count'] / $total * 100, 1) : 0;
        }
        unset($r);
        if ($group !== 'month') {
            usort($rows, static fn ($a, $b) => $b['count'] <=> $a['count']);
        }

        return $this->respond(['group' => $group, 'total' => $total, 'rows' => $rows]);
    }

    /**
     * GET /client/reports/pipeline — leads per conversion stage, each stage's
     * share of the total, its win % and the weighted (count × win%) value.
     */
    public function reportPipeline()
    {
        if ($resp = $this->requirePermission('reports')) {
            return $resp;
        }
        $cid = $this->clientId();

        $res          = $this->reportLeadQuery($cid)
            ->select('status_id AS k, COUNT(*) AS c')
            ->where('status_id IS NOT NULL')->where('status_id >', 0)
            ->groupBy('status_id')->get()->getResultArray();
        $statusCounts = [];
        $total        = 0;
        foreach ($res as $r) {
            $statusCounts[(int) $r['k']] = (int) $r['c'];
            $total += (int) $r['c'];
        }

        $rows          = [];
        $weightedTotal = 0.0;
        foreach ($this->decorateConversions($cid) as $stage) {
            $count = 0;
            foreach ($stage['lead_status_ids'] as $sid) {
                $count += $statusCounts[$sid] ?? 0;
            }
            $win           = (int) $stage['percentage'];
            $weighted      = round($count * $win / 100, 1);
            $weightedTotal += $weighted;
            $rows[]        = [
                'id'       => (int) $stage['id'],
                'label'    => $stage['name'],
                'color'    => $stage['color'] ?: 'slate',
                'statuses' => implode(', ', array_map(static fn ($s) => $s['name'], $stage['lead_statuses'])),
                'count'    => $count,
                'pct'      => $total > 0 ? round($count / $total * 100, 1) : 0,
                'win_pct'  => $win,
                'weighted' => $weighted,
            ];
        }

        return $this->respond(['total' => $total, 'weighted_total' => round($weightedTotal, 1), 'rows' => $rows]);
    }

    /**
     * GET /client/reports/rep-performance — per-rep total leads, "won" leads
     * (statuses in the highest win-% conversion stage) and the conversion rate.
     */
    public function reportRepPerformance()
    {
        if ($resp = $this->requirePermission('reports')) {
            return $resp;
        }
        $cid = $this->clientId();

        // "Won" = statuses belonging to the highest win-% conversion stage(s).
        $stages = $this->decorateConversions($cid);
        $maxPct = 0;
        foreach ($stages as $stage) {
            $maxPct = max($maxPct, (int) $stage['percentage']);
        }
        $wonIds = [];
        if ($maxPct > 0) {
            foreach ($stages as $stage) {
                if ((int) $stage['percentage'] === $maxPct) {
                    $wonIds = array_merge($wonIds, $stage['lead_status_ids']);
                }
            }
        }
        $wonIds = array_values(array_unique(array_map('intval', $wonIds)));

        $totals = [];
        foreach ($this->reportLeadQuery($cid)->select('assigned_to AS k, COUNT(*) AS c')->groupBy('assigned_to')->get()->getResultArray() as $r) {
            $totals[(int) $r['k']] = (int) $r['c'];
        }
        $wons = [];
        if ($wonIds) {
            foreach ($this->reportLeadQuery($cid)->select('assigned_to AS k, COUNT(*) AS c')->whereIn('status_id', $wonIds)->groupBy('assigned_to')->get()->getResultArray() as $r) {
                $wons[(int) $r['k']] = (int) $r['c'];
            }
        }

        // Reference "agents" see the per-rep breakdown of their reference's leads
        // (counts already scoped via reportLeadQuery), so show the full staff list
        // for them; other staff are limited to themselves + their reports.
        $scope  = $this->currentReferenceName() !== null ? null : $this->visibleStaffIds();
        $staffQ = (new ClientStaffModel())->where('client_id', $cid);
        if ($scope !== null) {
            $staffQ->whereIn('id', $scope ?: [0]);
        }
        $rows = [];
        foreach ($staffQ->orderBy('name', 'ASC')->findAll() as $st) {
            $sid     = (int) $st['id'];
            $total   = $totals[$sid] ?? 0;
            $won     = $wons[$sid] ?? 0;
            $rows[]  = ['id' => $sid, 'name' => $st['name'], 'total' => $total, 'won' => $won, 'won_pct' => $total > 0 ? round($won / $total * 100, 1) : 0];
        }
        if (($totals[0] ?? 0) > 0) {
            $rows[] = ['id' => 0, 'name' => 'Unassigned', 'total' => $totals[0], 'won' => $wons[0] ?? 0, 'won_pct' => 0];
        }
        usort($rows, static fn ($a, $b) => $b['total'] <=> $a['total']);

        return $this->respond(['win_pct' => $maxPct, 'rows' => $rows]);
    }

    // ============================================================ LEAD TRANSFER
    //
    // A rep hands a lead to another rep. The client's `lead_transfer_mode` setting
    // decides the flow: 'direct' reassigns immediately (logged); 'approval' parks
    // the lead (hidden from every list via leads.pending_transfer) until an admin
    // approves or rejects. Every step is logged + notified (in-app + push).

    /** The client's transfer flow: 'approval' (default) or 'direct'. */
    private function leadTransferMode(): string
    {
        $m = $this->settingsMap()['lead_transfer_mode'] ?? 'approval';

        return in_array($m, ['direct', 'approval'], true) ? $m : 'approval';
    }

    /** Display label (name or phone) for a lead, for notifications/logs. */
    private function leadLabel(int $cid, int $leadId): string
    {
        $l = (new LeadModel())->select('name, phone')->where('client_id', $cid)->find($leadId);
        if (! $l) {
            return "Lead #{$leadId}";
        }

        return ($l['name'] ?? '') !== '' ? $l['name'] : ($l['phone'] ?? "Lead #{$leadId}");
    }

    /** In-app + push notification to every client-admin of this client. */
    private function notifyClientAdmins(string $type, string $title, ?string $body, ?string $link): void
    {
        try {
            foreach ((new UserModel())->where('client_id', $this->clientId())->where('role', 'client_admin')->findAll() as $a) {
                (new AppNotificationModel())->insert([
                    'recipient_type' => 'user',
                    'recipient_id'   => (int) $a['id'],
                    'type'           => $type,
                    'title'          => mb_substr($title, 0, 255),
                    'body'           => $body !== null ? mb_substr($body, 0, 500) : null,
                    'link'           => $link,
                ]);
                PushService::sendToRecipient($this->clientId(), 'user', (int) $a['id'], $title, $body, $link);
            }
        } catch (\Throwable $e) {
            log_message('error', 'Admin notification failed: ' . $e->getMessage());
        }
    }

    /** GET /client/lead-transfers — transfer requests + the current mode. */
    public function leadTransfers()
    {
        if ($resp = $this->requirePermission('lead_transfer')) {
            return $resp;
        }
        $cid = $this->clientId();
        $q   = (new LeadTransferModel())->where('client_id', $cid);

        // Staff see transfers they requested, that target them, or that move one of
        // their (or their reports') leads. Admins see everything.
        $scope = $this->visibleStaffIds();
        if ($scope !== null) {
            $ids = $scope ?: [0];
            $q->groupStart()
              ->whereIn('to_staff_id', $ids)
              ->orWhereIn('from_staff_id', $ids)
              ->orWhereIn('requested_by', $ids)
              ->groupEnd();
        }
        $rows = $q->orderBy('id', 'DESC')->findAll();

        $staffNames = $this->idNameMap((new ClientStaffModel())->where('client_id', $cid)->findAll());
        $leadNames  = [];
        foreach ((new LeadModel())->select('id, name, phone')->where('client_id', $cid)->findAll() as $l) {
            $leadNames[(int) $l['id']] = ($l['name'] ?? '') !== '' ? $l['name'] : $l['phone'];
        }
        foreach ($rows as &$r) {
            $r['lead_name']      = $leadNames[(int) $r['lead_id']] ?? null;
            $r['from_name']      = $r['from_staff_id'] ? ($staffNames[(int) $r['from_staff_id']] ?? null) : 'Unassigned';
            $r['to_name']        = $staffNames[(int) $r['to_staff_id']] ?? null;
            $r['requested_name'] = $r['requested_by'] ? ($staffNames[(int) $r['requested_by']] ?? null) : 'Admin';
        }
        unset($r);

        return $this->respond([
            'transfers'   => $rows,
            'mode'        => $this->leadTransferMode(),
            'can_decide'  => $this->isAdmin(),
            'my_staff_id' => $this->staffId(),
        ]);
    }

    /** POST /client/lead-transfers — request (or, in direct mode, perform) a transfer. */
    public function createLeadTransfer()
    {
        if ($resp = $this->denyUnlessPerm('lead_transfer', 'create')) {
            return $resp;
        }
        $cid    = $this->clientId();
        $leadId = (int) $this->input('lead_id');
        $toId   = (int) $this->input('to_staff_id');
        $reason = trim((string) $this->input('reason')) ?: null;

        $lead = (new LeadModel())->where('client_id', $cid)->find($leadId);
        if (! $lead) {
            return $this->failNotFound('Lead not found');
        }
        if (! $this->canSeeLead($lead)) {
            return $this->failForbidden('You can only transfer your own leads.');
        }
        if ($toId <= 0) {
            return $this->failValidationErrors(['to_staff_id' => 'Choose a team member to transfer to.']);
        }
        if ($toId === (int) $lead['assigned_to']) {
            return $this->failValidationErrors(['to_staff_id' => 'This lead is already assigned to that member.']);
        }
        $target = (new ClientStaffModel())->where('client_id', $cid)->find($toId);
        if (! $target) {
            return $this->failValidationErrors(['to_staff_id' => 'Unknown team member.']);
        }
        if (! empty($lead['pending_transfer'])) {
            return $this->failValidationErrors(['lead_id' => 'This lead already has a transfer pending approval.']);
        }

        $model    = new LeadTransferModel();
        $mode     = $this->leadTransferMode();
        $leadName = ($lead['name'] ?? '') !== '' ? $lead['name'] : $lead['phone'];
        $toName   = $target['name'];
        $row      = [
            'client_id'     => $cid,
            'lead_id'       => $leadId,
            'from_staff_id' => (int) $lead['assigned_to'] ?: null,
            'to_staff_id'   => $toId,
            'requested_by'  => $this->staffId() ?: null,
            'reason'        => $reason,
        ];

        if ($mode === 'direct') {
            $row['status']     = 'approved';
            $row['decided_by'] = $this->actorId() ?: null;
            $row['decided_at'] = date('Y-m-d H:i:s');
            $id                = $model->insert($row);

            (new LeadModel())->update($leadId, ['assigned_to' => $toId, 'assigned_date' => date('Y-m-d H:i:s')]);
            $this->logActivity('transferred', 'lead', $leadId, "Lead transferred to {$toName}");
            $this->notifyStaff($toId, 'lead_transfer', 'Lead assigned to you', "{$leadName} was transferred to you.", '/client/leads');

            return $this->respondCreated(['message' => 'Lead transferred', 'id' => $id, 'status' => 'approved']);
        }

        // Approval mode — park the lead (hidden) until an admin decides.
        $row['status'] = 'pending';
        $id            = $model->insert($row);
        (new LeadModel())->update($leadId, ['pending_transfer' => 1]);
        $this->logActivity('transfer_requested', 'lead', $leadId, "Transfer requested → {$toName}");
        $this->notifyClientAdmins('lead_transfer', 'Lead transfer needs approval', "{$leadName} → {$toName}.", '/client/leads?tab=transfers');
        $this->notifyStaff($toId, 'lead_transfer', 'Incoming lead (pending approval)', "{$leadName} is being transferred to you, pending admin approval.", '/client/leads?tab=transfers');

        return $this->respondCreated(['message' => 'Transfer request submitted for approval', 'id' => $id, 'status' => 'pending']);
    }

    /** POST /client/lead-transfers/{id}/approve — admin approves a pending transfer. */
    public function approveLeadTransfer(int $id)
    {
        if (! $this->isAdmin()) {
            return $this->failForbidden('Only an admin can approve transfers.');
        }
        $cid   = $this->clientId();
        $model = new LeadTransferModel();
        $t     = $model->where('client_id', $cid)->find($id);
        if (! $t || $t['status'] !== 'pending') {
            return $this->failNotFound('Pending transfer not found');
        }
        $model->update($id, ['status' => 'approved', 'decided_by' => $this->actorId() ?: null, 'decided_at' => date('Y-m-d H:i:s'), 'decision_note' => trim((string) $this->input('note')) ?: null]);
        (new LeadModel())->update((int) $t['lead_id'], ['assigned_to' => (int) $t['to_staff_id'], 'assigned_date' => date('Y-m-d H:i:s'), 'pending_transfer' => 0]);

        $leadName = $this->leadLabel($cid, (int) $t['lead_id']);
        $this->logActivity('transfer_approved', 'lead', (int) $t['lead_id'], 'Transfer approved');
        $this->notifyStaff((int) $t['to_staff_id'], 'lead_transfer', 'Lead assigned to you', "{$leadName}'s transfer was approved.", '/client/leads');
        if ($t['requested_by']) {
            $this->notifyStaff((int) $t['requested_by'], 'lead_transfer', 'Transfer approved', "Your transfer of {$leadName} was approved.", '/client/leads');
        }

        return $this->respond(['message' => 'Transfer approved']);
    }

    /** POST /client/lead-transfers/{id}/reject — admin rejects a pending transfer. */
    public function rejectLeadTransfer(int $id)
    {
        if (! $this->isAdmin()) {
            return $this->failForbidden('Only an admin can reject transfers.');
        }
        $cid   = $this->clientId();
        $model = new LeadTransferModel();
        $t     = $model->where('client_id', $cid)->find($id);
        if (! $t || $t['status'] !== 'pending') {
            return $this->failNotFound('Pending transfer not found');
        }
        $model->update($id, ['status' => 'rejected', 'decided_by' => $this->actorId() ?: null, 'decided_at' => date('Y-m-d H:i:s'), 'decision_note' => trim((string) $this->input('note')) ?: null]);
        (new LeadModel())->update((int) $t['lead_id'], ['pending_transfer' => 0]); // lead stays with its owner

        $leadName = $this->leadLabel($cid, (int) $t['lead_id']);
        $this->logActivity('transfer_rejected', 'lead', (int) $t['lead_id'], 'Transfer rejected');
        if ($t['requested_by']) {
            $this->notifyStaff((int) $t['requested_by'], 'lead_transfer', 'Transfer rejected', "Your transfer of {$leadName} was rejected.", '/client/leads?tab=transfers');
        }

        return $this->respond(['message' => 'Transfer rejected']);
    }

    /** POST /client/lead-transfers/{id}/cancel — requester (or admin) cancels a pending request. */
    public function cancelLeadTransfer(int $id)
    {
        if ($resp = $this->denyUnlessPerm('lead_transfer', 'create')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new LeadTransferModel();
        $t     = $model->where('client_id', $cid)->find($id);
        if (! $t || $t['status'] !== 'pending') {
            return $this->failNotFound('Pending transfer not found');
        }
        if (! $this->isAdmin() && (int) $t['requested_by'] !== $this->staffId()) {
            return $this->failForbidden('You can only cancel your own request.');
        }
        $model->update($id, ['status' => 'cancelled', 'decided_by' => $this->actorId() ?: null, 'decided_at' => date('Y-m-d H:i:s')]);
        (new LeadModel())->update((int) $t['lead_id'], ['pending_transfer' => 0]);
        $this->logActivity('transfer_cancelled', 'lead', (int) $t['lead_id'], 'Transfer cancelled');

        return $this->respond(['message' => 'Transfer cancelled']);
    }

    /** POST /client/lead-transfer-mode — admin sets 'direct' | 'approval'. */
    public function saveLeadTransferMode()
    {
        if (! $this->isAdmin()) {
            return $this->failForbidden('Only an admin can change the transfer mode.');
        }
        $mode = (string) $this->input('mode');
        if (! in_array($mode, ['direct', 'approval'], true)) {
            return $this->failValidationErrors(['mode' => 'Mode must be direct or approval.']);
        }
        $this->setSetting('lead_transfer_mode', $mode);
        $this->logActivity('updated', 'settings', null, "Lead transfer mode set to {$mode}");

        return $this->respond(['message' => 'Saved', 'mode' => $mode]);
    }

    // ============================================================ VISITORS
    //
    // A log of people who visit (office / seminar / other). Type & status are
    // admin-defined lookups; a status flagged `is_final` (e.g. Completed) can only
    // be changed away from by an admin. Visitors are standalone but may link a lead.

    /** Seed sensible default types/statuses the first time a client opens Visitors. */
    private function seedVisitorDefaults(int $cid): void
    {
        $tm = new VisitorTypeModel();
        if ($tm->where('client_id', $cid)->countAllResults() === 0) {
            $i = 0;
            foreach ([['Office', 'indigo'], ['Seminar', 'violet'], ['Other', 'slate']] as [$n, $c]) {
                $tm->insert(['client_id' => $cid, 'name' => $n, 'color' => $c, 'sequence' => $i++]);
            }
        }
        $sm = new VisitorStatusModel();
        if ($sm->where('client_id', $cid)->countAllResults() === 0) {
            $i = 0;
            foreach ([['Pending', 'amber', 0], ['Rescheduled', 'sky', 0], ['Completed', 'emerald', 1], ['Cancelled', 'rose', 1]] as [$n, $c, $f]) {
                $sm->insert(['client_id' => $cid, 'name' => $n, 'color' => $c, 'is_final' => $f, 'sequence' => $i++]);
            }
        }
    }

    /** GET /client/visitor-setup — the admin-defined types & statuses (auto-seeded). */
    public function visitorSetup()
    {
        if ($resp = $this->requirePermission('visitors')) {
            return $resp;
        }
        $cid = $this->clientId();
        $this->seedVisitorDefaults($cid);

        return $this->respond([
            'types'      => $this->lookupRows(VisitorTypeModel::class, $cid),
            'statuses'   => $this->lookupRows(VisitorStatusModel::class, $cid),
            'can_manage' => $this->isAdmin() || $this->can('visitors', 'create'),
        ]);
    }

    /** Build a visitor row from the request body. */
    private function visitorData(int $cid): array
    {
        $vd = trim((string) $this->input('visit_date'));

        return [
            'client_id'   => $cid,
            'name'        => trim((string) $this->input('name')),
            'phone'       => trim((string) $this->input('phone')) ?: null,
            'email'       => trim((string) $this->input('email')) ?: null,
            'type_id'     => (int) $this->input('type_id') ?: null,
            'status_id'   => (int) $this->input('status_id') ?: null,
            'lead_id'     => (int) $this->input('lead_id') ?: null,
            'assigned_to' => (int) $this->input('assigned_to') ?: null,
            'purpose'     => trim((string) $this->input('purpose')) ?: null,
            'visit_date'  => $vd !== '' ? date('Y-m-d H:i:s', strtotime($vd)) : null,
            'notes'       => trim((string) $this->input('notes')) ?: null,
        ];
    }

    /** GET /client/visitors — this client's visitor log, decorated. */
    public function visitors()
    {
        if ($resp = $this->requirePermission('visitors')) {
            return $resp;
        }
        $cid = $this->clientId();
        $q   = (new VisitorModel())->where('client_id', $cid);

        // Staff see visitors they created or are assigned to; admins see all.
        $scope = $this->visibleStaffIds();
        if ($scope !== null) {
            $ids = $scope ?: [0];
            $q->groupStart()->whereIn('assigned_to', $ids)->orWhereIn('created_by', $ids)->groupEnd();
        }
        $rows = $q->orderBy('id', 'DESC')->findAll();

        $typeMap = [];
        foreach ($this->lookupRows(VisitorTypeModel::class, $cid) as $t) {
            $typeMap[(int) $t['id']] = $t;
        }
        $statusMap = [];
        foreach ($this->lookupRows(VisitorStatusModel::class, $cid) as $s) {
            $statusMap[(int) $s['id']] = $s;
        }
        $staffNames = $this->idNameMap((new ClientStaffModel())->where('client_id', $cid)->findAll());
        $leadNames  = [];
        foreach ((new LeadModel())->select('id, name, phone')->where('client_id', $cid)->findAll() as $l) {
            $leadNames[(int) $l['id']] = ($l['name'] ?? '') !== '' ? $l['name'] : $l['phone'];
        }
        foreach ($rows as &$r) {
            $t                  = $typeMap[(int) $r['type_id']] ?? null;
            $s                  = $statusMap[(int) $r['status_id']] ?? null;
            $r['type_name']     = $t['name'] ?? null;
            $r['type_color']    = $t['color'] ?? 'slate';
            $r['status_name']   = $s['name'] ?? null;
            $r['status_color']  = $s['color'] ?? 'slate';
            $r['status_final']  = (bool) ($s['is_final'] ?? false);
            $r['assigned_name'] = $r['assigned_to'] ? ($staffNames[(int) $r['assigned_to']] ?? null) : null;
            $r['lead_name']     = $r['lead_id'] ? ($leadNames[(int) $r['lead_id']] ?? null) : null;
            $r['custom_fields'] = $this->decodeCustom($r['custom_fields'] ?? null);
        }
        unset($r);

        return $this->respond(['visitors' => $rows, 'can_manage' => $this->isAdmin() || $this->can('visitors', 'create')]);
    }

    /** POST /client/visitors — log a visitor. */
    public function createVisitor()
    {
        if ($resp = $this->denyUnlessPerm('visitors', 'create')) {
            return $resp;
        }
        $cid    = $this->clientId();
        $data   = $this->visitorData($cid);
        $custom = $this->formCustomValues('visitor', (array) $this->input());
        if ($errs = $this->formFieldErrors('visitor', $data, $custom)) {
            return $this->failValidationErrors($errs);
        }
        $data['custom_fields'] = json_encode($custom);
        $data['created_by']    = $this->actorId() ?: null;
        if (! $data['assigned_to'] && $this->staffId()) {
            $data['assigned_to'] = $this->staffId(); // staff default to themselves
        }
        $model = new VisitorModel();
        $id    = $model->insert($data);
        if ($id === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('created', 'visitor', (int) $id, 'Logged visitor ' . $data['name']);

        return $this->respondCreated(['message' => 'Visitor logged', 'id' => $id]);
    }

    /** POST /client/visitors/{id} — update a visitor (with the finalised-status lock). */
    public function updateVisitor(int $id)
    {
        if ($resp = $this->denyUnlessPerm('visitors', 'update')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new VisitorModel();
        $old   = $model->where('client_id', $cid)->find($id);
        if (! $old) {
            return $this->failNotFound('Visitor not found');
        }
        $data   = $this->visitorData($cid);
        $custom = $this->formCustomValues('visitor', (array) $this->input());
        if ($errs = $this->formFieldErrors('visitor', $data, $custom)) {
            return $this->failValidationErrors($errs);
        }
        $data['custom_fields'] = json_encode($custom);

        // Once the current status is final (e.g. Completed), only an admin may
        // change the status. Staff can still edit other details.
        if (! $this->isAdmin() && (int) $data['status_id'] !== (int) $old['status_id']) {
            $cur = $old['status_id'] ? (new VisitorStatusModel())->where('client_id', $cid)->find((int) $old['status_id']) : null;
            if ($cur && ! empty($cur['is_final'])) {
                return $this->failForbidden('This visit is finalised — only an admin can change its status.');
            }
        }
        unset($data['created_by']);
        if ($model->update($id, $data) === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('updated', 'visitor', $id, 'Updated visitor ' . $data['name']);

        return $this->respond(['message' => 'Updated']);
    }

    /** POST /client/visitors/{id}/delete — soft-delete a visitor. */
    public function deleteVisitor(int $id)
    {
        if ($resp = $this->denyUnlessPerm('visitors', 'delete')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new VisitorModel();
        if (! $model->where('client_id', $cid)->find($id)) {
            return $this->failNotFound('Visitor not found');
        }
        $model->delete($id);
        $this->logActivity('deleted', 'visitor', $id, 'Deleted visitor');

        return $this->respond(['message' => 'Deleted']);
    }

    // --- Visitor types & statuses (admin-defined lookups) ---------------

    public function createVisitorType()
    {
        return $this->isAdmin() ? $this->saveLookup(VisitorTypeModel::class, 'visitor type', fn () => []) : $this->failForbidden('Admins only.');
    }

    public function updateVisitorType(int $id)
    {
        return $this->isAdmin() ? $this->saveLookup(VisitorTypeModel::class, 'visitor type', fn () => [], $id) : $this->failForbidden('Admins only.');
    }

    public function deleteVisitorType(int $id)
    {
        return $this->isAdmin() ? $this->deleteLookup(VisitorTypeModel::class, 'visitor type', $id) : $this->failForbidden('Admins only.');
    }

    public function createVisitorStatus()
    {
        return $this->isAdmin() ? $this->saveLookup(VisitorStatusModel::class, 'visitor status', fn () => ['is_final' => (int) ! empty($this->input('is_final'))]) : $this->failForbidden('Admins only.');
    }

    public function updateVisitorStatus(int $id)
    {
        return $this->isAdmin() ? $this->saveLookup(VisitorStatusModel::class, 'visitor status', fn () => ['is_final' => (int) ! empty($this->input('is_final'))], $id) : $this->failForbidden('Admins only.');
    }

    public function deleteVisitorStatus(int $id)
    {
        return $this->isAdmin() ? $this->deleteLookup(VisitorStatusModel::class, 'visitor status', $id) : $this->failForbidden('Admins only.');
    }

    /** POST /client/leads — create one lead. */
    public function createLead()
    {
        if ($resp = $this->requirePermission('leads', 'create')) {
            return $resp;
        }
        $cid    = $this->clientId();
        $model  = new LeadModel();
        $data   = $this->leadData($cid);
        $custom = $this->formCustomValues('lead', (array) $this->input());
        if ($errs = $this->formFieldErrors('lead', $data, $custom)) {
            return $this->failValidationErrors($errs);
        }
        $rules = $this->leadPhoneRules();
        if ($perr = $this->phoneRuleErrors(LeadModel::class, $cid, (string) $data['phone'], $data['alt_phone'] ?? null, null, $rules['unique_phone'], $rules['unique_alt'], 'lead')) {
            return $this->failValidationErrors($perr);
        }
        $data['custom_fields'] = json_encode($custom);
        // Stamp who captured the lead (used by the team-member leads view).
        $data['created_by'] = $this->actorId() ?: null;

        // On create, a staff member captures their own lead: force-assign it to the
        // creator (the assignee picker is masked in the UI for them). Admins have no
        // staff id, so they still assign explicitly via the form.
        if (! $this->isAdmin() && $this->staffId()) {
            $data['assigned_to'] = $this->staffId();
        }

        // System-managed dates — not editable from the lead form. Created date is
        // stamped today; assigned date is stamped with the exact date+time when the
        // lead is assigned; the follow-up date is driven by the reminders flow.
        $data['created_date']  = date('Y-m-d');
        $data['assigned_date'] = ! empty($data['assigned_to']) ? date('Y-m-d H:i:s') : null;
        $data['follow_date']   = null;

        $id = $model->insert($data);
        if ($id === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('created', 'lead', (int) $id, 'Added lead ' . ($data['name'] ?: $data['phone']));

        // Notify the assignee (in-app + web push) when a lead is created already
        // assigned to someone other than the person creating it.
        $assignedId = (int) ($data['assigned_to'] ?? 0);
        if ($assignedId > 0 && $assignedId !== $this->staffId()) {
            $who = (string) ($data['name'] ?: $data['phone']);
            $this->notifyStaff($assignedId, 'lead_assigned', 'New lead assigned to you', $who, '/client/leads');
        }

        return $this->respondCreated(['message' => 'Created', 'id' => $id]);
    }

    /** POST /client/leads/{id} — update one lead. */
    public function updateLead(int $id)
    {
        if ($resp = $this->requirePermission('leads', 'update')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new LeadModel();
        $old   = $model->where('client_id', $cid)->find($id);
        if (! $old || ! $this->canSeeLead($old)) {
            return $this->failNotFound('Lead not found');
        }

        $data   = $this->leadData($cid);
        $custom = $this->formCustomValues('lead', (array) $this->input());
        if ($errs = $this->formFieldErrors('lead', $data, $custom)) {
            return $this->failValidationErrors($errs);
        }
        // Only re-check uniqueness for a phone the user actually changed, so
        // editing a lead that predates the rule (legacy duplicate) isn't blocked.
        $rules      = $this->leadPhoneRules();
        $checkPhone = $rules['unique_phone'] && (string) ($data['phone'] ?? '') !== (string) ($old['phone'] ?? '');
        $checkAlt   = $rules['unique_alt'] && (string) ($data['alt_phone'] ?? '') !== (string) ($old['alt_phone'] ?? '');
        if ($perr = $this->phoneRuleErrors(LeadModel::class, $cid, (string) $data['phone'], $data['alt_phone'] ?? null, $id, $checkPhone, $checkAlt, 'lead')) {
            return $this->failValidationErrors($perr);
        }
        $data['custom_fields'] = json_encode($custom);

        // System-managed dates — not editable from the lead form. Preserve the
        // stored created/follow-up dates, and re-stamp the assigned date only
        // when the lead's assignee actually changes (cleared when unassigned).
        unset($data['created_date'], $data['follow_date']);
        $oldAssigned = (int) ($old['assigned_to'] ?? 0);
        $newAssigned = (int) ($data['assigned_to'] ?? 0);
        if ($newAssigned === 0) {
            $data['assigned_date'] = null;
        } elseif ($newAssigned !== $oldAssigned) {
            $data['assigned_date'] = date('Y-m-d H:i:s');
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

            // Notify the new assignee (in-app + web push), unless they assigned
            // the lead to themselves.
            $newAssignedId = (int) ($data['assigned_to'] ?? 0);
            if ($newAssignedId > 0 && $newAssignedId !== $this->staffId()) {
                $who = (string) ($data['name'] ?: ($data['phone'] ?? $old['phone'] ?? ''));
                $this->notifyStaff($newAssignedId, 'lead_assigned', 'Lead assigned to you', $who, '/client/leads');
            }
        }

        if ((int) ($old['source_id'] ?? 0) !== (int) ($data['source_id'] ?? 0)) {
            $names = $this->idNameMap($this->lookupRows(LeadSourceModel::class, $cid));
            $from  = $old['source_id'] ? ($names[(int) $old['source_id']] ?? '—') : 'None';
            $to    = $data['source_id'] ? ($names[(int) $data['source_id']] ?? '—') : 'None';
            $this->logActivity('updated', 'lead', $id, "Source changed: {$from} → {$to}");
            $logged = true;
        }

        // Sub-status (lives in the lead_statuses table, same as statuses).
        if ((int) ($old['sub_status_id'] ?? 0) !== (int) ($data['sub_status_id'] ?? 0)) {
            $names = $this->idNameMap($this->lookupRows(LeadStatusModel::class, $cid));
            $from  = $old['sub_status_id'] ? ($names[(int) $old['sub_status_id']] ?? '—') : 'None';
            $to    = $data['sub_status_id'] ? ($names[(int) $data['sub_status_id']] ?? '—') : 'None';
            $this->logActivity('updated', 'lead', $id, "Sub status changed: {$from} → {$to}");
            $logged = true;
        }

        if ((int) ($old['lead_type_id'] ?? 0) !== (int) ($data['lead_type_id'] ?? 0)) {
            $names = $this->idNameMap($this->lookupRows(LeadTypeModel::class, $cid));
            $from  = $old['lead_type_id'] ? ($names[(int) $old['lead_type_id']] ?? '—') : 'None';
            $to    = $data['lead_type_id'] ? ($names[(int) $data['lead_type_id']] ?? '—') : 'None';
            $this->logActivity('updated', 'lead', $id, "Lead type changed: {$from} → {$to}");
            $logged = true;
        }

        if (trim((string) ($old['reference_name'] ?? '')) !== trim((string) ($data['reference_name'] ?? ''))) {
            $from = trim((string) ($old['reference_name'] ?? '')) ?: 'None';
            $to   = trim((string) ($data['reference_name'] ?? '')) ?: 'None';
            $this->logActivity('updated', 'lead', $id, "Reference name changed: {$from} → {$to}");
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
        if ($resp = $this->requirePermission('leads', 'delete')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new LeadModel();
        $row   = $model->where('client_id', $cid)->find($id);
        if (! $row || ! $this->canSeeLead($row)) {
            return $this->failNotFound('Lead not found');
        }
        $model->delete($id);
        $this->logActivity('deleted', 'lead', $id, 'Deleted lead ' . ($row['name'] ?? $row['phone'] ?? ''));

        return $this->respond(['message' => 'Deleted']);
    }

    /**
     * POST /client/leads/bulk — bulk-update the selected leads. Each `change_*`
     * flag enables one field: status / sub-status / source / type / created date /
     * assignee. Assignment is single (everyone → one member) or round-robin
     * (split evenly across the chosen members, in order). Optionally notifies the
     * newly-assigned members (in-app + web-push).
     */
    public function bulkUpdateLeads()
    {
        if ($resp = $this->requirePermission('leads', 'update')) {
            return $resp;
        }
        $cid = $this->clientId();
        $in  = (array) $this->input();
        $ids = array_values(array_unique(array_filter(array_map('intval', (array) ($in['ids'] ?? [])), static fn ($v) => $v > 0)));
        if (! $ids) {
            return $this->fail('No leads selected.', 422);
        }

        $model = new LeadModel();
        $q     = $model->where('client_id', $cid)->whereIn('id', $ids);
        // Staff can only bulk-edit leads they can see.
        $this->applyLeadScope($q);
        $leads = $q->orderBy('id', 'ASC')->findAll();
        if (! $leads) {
            return $this->fail('No matching leads.', 404);
        }

        // Field changes — only the boxes the admin ticked.
        $common = [];
        if (! empty($in['change_status']) && (int) ($in['status_id'] ?? 0) > 0) {
            $common['status_id'] = (int) $in['status_id'];
        }
        if (! empty($in['change_sub_status'])) {
            $common['sub_status_id'] = (int) ($in['sub_status_id'] ?? 0) ?: null;
        }
        if (! empty($in['change_source'])) {
            $common['source_id'] = (int) ($in['source_id'] ?? 0) ?: null;
        }
        if (! empty($in['change_type'])) {
            $common['lead_type_id'] = (int) ($in['lead_type_id'] ?? 0) ?: null;
        }
        if (! empty($in['change_created']) && trim((string) ($in['created_date'] ?? '')) !== '') {
            $common['created_date'] = substr(trim((string) $in['created_date']), 0, 10);
        }

        // Assignment: single (one member) or round-robin across many.
        $changeAssign = ! empty($in['change_assignee']);
        $mode         = ($in['assign_mode'] ?? 'single') === 'robin' ? 'robin' : 'single';
        $assignees    = array_values(array_unique(array_filter(array_map('intval', (array) ($in['assignees'] ?? [])), static fn ($v) => $v > 0)));
        if ($assignees) {
            $valid = [];
            foreach ((new ClientStaffModel())->where('client_id', $cid)->findAll() as $st) {
                $valid[(int) $st['id']] = true;
            }
            $assignees = array_values(array_filter($assignees, static fn ($id) => isset($valid[$id])));
        }
        if ($mode === 'single') {
            $assignees = array_slice($assignees, 0, 1);
        }

        if (! $common && ! $changeAssign) {
            return $this->fail('Choose at least one field to change.', 422);
        }

        $notify      = ! empty($in['notify']);
        $now         = date('Y-m-d H:i:s');
        $updated     = 0;
        $cursor      = 0; // round-robin position
        $perAssignee = [];

        foreach ($leads as $lead) {
            $data = $common;
            if ($changeAssign) {
                $assignTo = $assignees ? $assignees[$cursor % count($assignees)] : null;
                $cursor++;
                $data['assigned_to']   = $assignTo;
                $data['assigned_date'] = $assignTo ? $now : null;
                if ($assignTo && $assignTo !== (int) ($lead['assigned_to'] ?? 0)) {
                    $perAssignee[$assignTo] = ($perAssignee[$assignTo] ?? 0) + 1;
                }
            }
            $model->skipValidation(true)->update((int) $lead['id'], $data);
            $updated++;
        }

        if ($notify && $perAssignee) {
            foreach ($perAssignee as $sid => $cnt) {
                $this->notifyStaff((int) $sid, 'lead_assigned', 'New leads assigned', "{$cnt} lead(s) assigned to you", '/client/leads');
            }
        }

        $this->logActivity('updated', 'leads', null, "Bulk-updated {$updated} lead(s)", $cid);

        return $this->respond(['message' => "Updated {$updated} lead(s)", 'updated' => $updated, 'assigned' => $perAssignee]);
    }

    /**
     * POST /client/leads/import — bulk-create leads from parsed CSV rows.
     * Body: { rows: [{ name, phone, status, ... }] }. Each row is validated
     * independently (phone 10 digits, status resolvable, email valid); valid
     * rows are inserted and the rest reported back by line number.
     */
    public function importLeads()
    {
        if ($resp = $this->requirePermission('leads', 'create')) {
            return $resp;
        }
        $cid  = $this->clientId();
        $rows = $this->input('rows');
        if (! is_array($rows) || $rows === []) {
            return $this->failValidationErrors(['rows' => 'No rows to import.']);
        }

        // ---- Batch selections (chosen once at upload, applied to every row) ----
        $opt      = (array) ($this->input('options') ?? []);
        $statusId = (int) ($opt['status_id'] ?? 0);
        $status   = $statusId ? (new LeadStatusModel())->where('client_id', $cid)->find($statusId) : null;
        if (! $status) {
            return $this->failValidationErrors(['status_id' => 'Pick a status to apply to the imported leads.']);
        }
        $validId  = function (string $modelClass, int $id) use ($cid): ?int {
            return $id > 0 && (new $modelClass())->where('client_id', $cid)->find($id) ? $id : null;
        };
        $subId    = $validId(LeadStatusModel::class, (int) ($opt['sub_status_id'] ?? 0));
        $sourceId = $validId(LeadSourceModel::class, (int) ($opt['source_id'] ?? 0));
        $typeId   = $validId(LeadTypeModel::class, (int) ($opt['lead_type_id'] ?? 0));

        // Assignees: 'single' uses one, 'robin' round-robins across many. Keep
        // only real staff of this client.
        $mode      = ($opt['assign_mode'] ?? 'single') === 'robin' ? 'robin' : 'single';
        $assignees = array_values(array_unique(array_filter(array_map('intval', (array) ($opt['assignees'] ?? [])), static fn ($v) => $v > 0)));
        if ($assignees) {
            $valid = [];
            foreach ((new ClientStaffModel())->where('client_id', $cid)->findAll() as $st) {
                $valid[(int) $st['id']] = true;
            }
            $assignees = array_values(array_filter($assignees, static fn ($id) => isset($valid[$id])));
        }
        if ($mode === 'single') {
            $assignees = array_slice($assignees, 0, 1);
        }
        $notify = ! empty($opt['notify']);

        // Admin-configured mandatory columns + the lead's custom-field defs.
        $mandatory  = array_values(array_filter($this->leadImportColumns(), static fn ($c) => ! empty($c['required']) && $c['key'] !== 'phone'));
        $customDefs = $this->formCustomFields('lead');

        $model       = new LeadModel();
        $inserted    = 0;
        $errors      = [];
        $perAssignee = [];
        $n           = 0; // round-robin cursor (advances per inserted lead)
        $now         = date('Y-m-d H:i:s'); // assignment stamp (date+time, IST)

        foreach ($rows as $i => $row) {
            $line  = (int) $i + 2; // +1 header, +1 to be 1-based
            $row   = is_array($row) ? $row : [];
            $phone = preg_replace('/\D/', '', (string) ($row['phone'] ?? ''));
            if ($phone === '') {
                $errors[] = ['row' => $line, 'message' => 'Contact (phone) is required.'];
                continue;
            }
            if (strlen((string) $phone) !== 10) {
                $errors[] = ['row' => $line, 'message' => 'Phone must be exactly 10 digits.'];
                continue;
            }
            $email = trim((string) ($row['email'] ?? ''));
            if ($email !== '' && ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $errors[] = ['row' => $line, 'message' => 'Invalid email address.'];
                continue;
            }

            // Enforce the admin's mandatory columns (built-in + custom).
            $missing = [];
            foreach ($mandatory as $c) {
                if (trim((string) ($row[$c['key']] ?? '')) === '') {
                    $missing[] = $c['label'];
                }
            }
            if ($missing) {
                $errors[] = ['row' => $line, 'message' => implode(', ', $missing) . (count($missing) > 1 ? ' are required.' : ' is required.')];
                continue;
            }

            $altPhone = preg_replace('/\D/', '', (string) ($row['alt_phone'] ?? ''));
            $custom   = [];
            foreach ($customDefs as $f) {
                if (array_key_exists($f['key'], $row)) {
                    $v                 = $row[$f['key']];
                    $custom[$f['key']] = $f['type'] === 'number'
                        ? (($v === '' || $v === null) ? '' : (string) (0 + $v))
                        : trim((string) $v);
                }
            }

            $assignTo = $assignees ? $assignees[$n % count($assignees)] : null;

            $data = [
                'client_id'      => $cid,
                'name'           => trim((string) ($row['name'] ?? '')),
                'phone'          => $phone,
                'alt_phone'      => $altPhone !== '' ? $altPhone : null,
                'status_id'      => $statusId,
                'sub_status_id'  => $subId,
                'lead_type_id'   => $typeId,
                'source_id'      => $sourceId,
                'reference_name' => trim((string) ($row['reference_name'] ?? '')) ?: null,
                'email'          => $email !== '' ? $email : null,
                'assigned_to'    => $assignTo,
                'assigned_date'  => $assignTo ? $now : null,
                'city'           => trim((string) ($row['city'] ?? '')) ?: null,
                'state'          => trim((string) ($row['state'] ?? '')) ?: null,
                'created_by'     => $this->actorId() ?: null,
                'custom_fields'  => json_encode($custom),
            ];

            if ($model->insert($data) === false) {
                $first    = $model->errors();
                $errors[] = ['row' => $line, 'message' => $first ? reset($first) : 'Could not save row.'];
                continue;
            }
            $inserted++;
            $n++;
            if ($assignTo) {
                $perAssignee[$assignTo] = ($perAssignee[$assignTo] ?? 0) + 1;
            }
        }

        // Notify each assignee (in-app + web-push) about their new leads, if asked.
        if ($notify && $perAssignee) {
            foreach ($perAssignee as $sid => $cnt) {
                $this->notifyStaff((int) $sid, 'lead_assigned', 'New leads assigned', "{$cnt} new lead(s) assigned to you", '/client/leads');
            }
        }

        $this->logActivity('created', 'lead', null,
            "Imported {$inserted} lead(s)"
            . ($errors ? ', ' . count($errors) . ' skipped' : '')
            . ($perAssignee ? '; assigned across ' . count($perAssignee) . ' member(s)' . ($mode === 'robin' ? ' (round-robin)' : '') : '')
            . ($notify && $perAssignee ? '; notified' : ''));

        return $this->respond([
            'inserted' => $inserted,
            'failed'   => count($errors),
            'errors'   => array_slice($errors, 0, 50),
            'assigned' => $perAssignee,
        ]);
    }

    /** Importable lead data columns merged with the admin's saved include/mandatory config. */
    private const LEAD_IMPORT_COLUMNS = [
        'name'           => 'Name',
        'alt_phone'      => 'Alternative phone',
        'email'          => 'Email',
        'reference_name' => 'Reference name',
        'city'           => 'City',
        'state'          => 'State',
    ];

    /**
     * The lead import template columns: phone (always on/required) + the fixed
     * data columns + the lead custom fields, each carrying the client's saved
     * include/required flags (settings key `lead_import_fields`).
     */
    private function leadImportColumns(): array
    {
        $cfg   = [];
        $saved = json_decode((string) ($this->settingsMap()['lead_import_fields'] ?? '[]'), true);
        if (is_array($saved)) {
            foreach ($saved as $c) {
                if (is_array($c) && isset($c['key'])) {
                    $cfg[(string) $c['key']] = ['include' => ! empty($c['include']), 'required' => ! empty($c['required'])];
                }
            }
        }

        $cols = [['key' => 'phone', 'label' => 'Phone (contact)', 'include' => true, 'required' => true, 'custom' => false, 'locked' => true]];
        foreach (self::LEAD_IMPORT_COLUMNS as $k => $label) {
            $cols[] = ['key' => $k, 'label' => $label, 'include' => $cfg[$k]['include'] ?? true, 'required' => $cfg[$k]['required'] ?? false, 'custom' => false, 'locked' => false];
        }
        foreach ($this->formCustomFields('lead') as $f) {
            $k      = $f['key'];
            $cols[] = ['key' => $k, 'label' => $f['label'], 'include' => $cfg[$k]['include'] ?? true, 'required' => $cfg[$k]['required'] ?? ! empty($f['required']), 'custom' => true, 'locked' => false];
        }

        return $cols;
    }

    /** GET /client/lead-import-setup — template columns + flags (readable for leads or leads_setup). */
    public function leadImportSetup()
    {
        if (! $this->can('leads') && ! $this->can('leads_setup')) {
            return $this->failForbidden('You do not have permission to view the import setup.');
        }

        return $this->respond([
            'columns'    => $this->leadImportColumns(),
            'can_manage' => $this->isAdmin() || $this->can('leads_setup', 'update'),
        ]);
    }

    /** POST /client/lead-import-setup — save which columns appear + are mandatory (admin). */
    public function saveLeadImportSetup()
    {
        if ($resp = $this->denyUnlessPerm('leads_setup', 'update')) {
            return $resp;
        }
        $cols  = $this->input('columns');
        $clean = [];
        if (is_array($cols)) {
            foreach ($cols as $c) {
                if (! is_array($c) || ! isset($c['key'])) {
                    continue;
                }
                $k = (string) $c['key'];
                if ($k === 'phone') {
                    continue; // phone is locked on + required
                }
                $clean[] = ['key' => $k, 'include' => ! empty($c['include']), 'required' => ! empty($c['required'])];
            }
        }
        $this->setSetting('lead_import_fields', json_encode($clean));
        $this->logActivity('updated', 'settings', null, 'Updated lead import columns', $this->clientId());

        return $this->respond(['message' => 'Saved', 'columns' => $this->leadImportColumns()]);
    }

    /** Build a lead row from the request body, sanitising phones and dates. */
    /** Admin-configured lead phone rules (client setting; both default off). */
    private function leadPhoneRules(): array
    {
        $map = $this->settingsMap();

        return [
            'unique_phone' => ($map['lead_phone_unique'] ?? '0') === '1',
            'unique_alt'   => ($map['lead_alt_phone_unique'] ?? '0') === '1',
        ];
    }

    /**
     * Phone-rule validation shared by leads and staff → field => message.
     * A value is a duplicate when it already appears as another row's phone OR
     * alt_phone (same client, excluding $ignoreId, soft-deleted rows skipped by
     * the model). $checkPhone/$checkAlt gate the primary/alternative uniqueness
     * checks; primary-vs-alternative sameness is always rejected.
     */
    private function phoneRuleErrors(string $modelClass, int $cid, string $phone, ?string $alt, ?int $ignoreId, bool $checkPhone, bool $checkAlt, string $noun): array
    {
        $phone  = trim($phone);
        $alt    = trim((string) $alt);
        $errors = [];

        if ($phone !== '' && $alt !== '' && $phone === $alt) {
            $errors['alt_phone'] = 'Alternative phone must be different from the primary phone.';
        }

        $dup = function (string $value) use ($modelClass, $cid, $ignoreId): bool {
            if ($value === '') {
                return false;
            }
            $q = (new $modelClass())->where('client_id', $cid)
                ->groupStart()->where('phone', $value)->orWhere('alt_phone', $value)->groupEnd();
            if ($ignoreId) {
                $q->where('id !=', $ignoreId);
            }

            return $q->countAllResults() > 0;
        };

        if ($checkPhone && $phone !== '' && $dup($phone)) {
            $errors['phone'] = "This phone number is already used by another {$noun}.";
        }
        if ($checkAlt && $alt !== '' && ! isset($errors['alt_phone']) && $dup($alt)) {
            $errors['alt_phone'] = "This alternative phone is already used by another {$noun}.";
        }

        return $errors;
    }

    private function leadData(int $cid): array
    {
        $phone    = preg_replace('/\D/', '', (string) $this->input('phone'));
        $altPhone = preg_replace('/\D/', '', (string) $this->input('alt_phone'));
        $statusId = $this->input('status_id');
        $subId    = $this->input('sub_status_id');
        $typeId   = $this->input('lead_type_id');
        $srcId    = $this->input('source_id');
        $assigned = $this->input('assigned_to');

        // Reference: the id is the stable source of truth. When a real reference
        // is chosen we store its id + a snapshot of its current name; otherwise we
        // keep whatever free-text name was given (legacy / import that maps to no
        // reference) with a null id.
        $refId   = (int) $this->input('reference_id') ?: null;
        $refName = trim((string) $this->input('reference_name')) ?: null;
        if ($refId !== null) {
            $ref     = (new LeadReferenceModel())->where('client_id', $cid)->find($refId);
            $refId   = $ref ? (int) $ref['id'] : null;
            $refName = $ref ? $ref['name'] : $refName;
        }

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
            'reference_id'   => $refId,
            'reference_name' => $refName,
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
        if ($resp = $this->requirePermission('leads')) {
            return $resp;
        }
        $cid  = $this->clientId();
        $lead = (new LeadModel())->where('client_id', $cid)->find($id);
        if (! $lead) {
            return $this->failNotFound('Lead not found');
        }

        // Staff may only open leads inside their visibility scope (assigned, or —
        // for reference "agents" — matching their reference).
        if (! $this->canSeeLead($lead)) {
            return $this->failNotFound('Lead not found');
        }

        $statusNames = $this->idNameMap($this->lookupRows(LeadStatusModel::class, $cid));
        $staffNames  = $this->idNameMap((new ClientStaffModel())->where('client_id', $cid)->findAll());
        $sourceNames = $this->idNameMap($this->lookupRows(LeadSourceModel::class, $cid));
        $typeNames   = $this->idNameMap($this->lookupRows(LeadTypeModel::class, $cid));
        $lead['status']           = $lead['status_id'] ? ($statusNames[(int) $lead['status_id']] ?? null) : null;
        $lead['sub_status']       = $lead['sub_status_id'] ? ($statusNames[(int) $lead['sub_status_id']] ?? null) : null;
        $lead['source']           = $lead['source_id'] ? ($sourceNames[(int) $lead['source_id']] ?? null) : null;
        $lead['lead_type']        = $lead['lead_type_id'] ? ($typeNames[(int) $lead['lead_type_id']] ?? null) : null;
        $lead['assigned_to_name'] = $lead['assigned_to'] ? ($staffNames[(int) $lead['assigned_to']] ?? null) : null;
        // Reference name resolved live from the stable id (renames reflect at read).
        $lead['reference_id']     = $lead['reference_id'] !== null ? (int) $lead['reference_id'] : null;
        if ($lead['reference_id']) {
            $refNames = $this->idNameMap($this->lookupRows(LeadReferenceModel::class, $cid));
            $lead['reference_name'] = $refNames[$lead['reference_id']] ?? $lead['reference_name'];
        }

        $now       = date('Y-m-d H:i:s');
        $reminders = (new LeadReminderModel())->where('client_id', $cid)->where('lead_id', $id)
            ->orderBy('remind_at', 'ASC')->findAll();
        foreach ($reminders as &$r) {
            $r['due']      = $r['remind_at'] <= $now;
            $r['can_edit'] = $this->canManageReminder($r);
        }
        unset($r);

        $notes = (new LeadNoteModel())->where('client_id', $cid)->where('lead_id', $id)
            ->orderBy('id', 'DESC')->findAll();
        // Flag which notes this user may edit/delete (author, team leader or admin).
        foreach ($notes as &$n) {
            $n['can_edit'] = $this->canManageNote($n);
        }
        unset($n);

        $activity = $this->activityLogModel('client_admin', $cid)
            ->where('client_id', $cid)->where('entity_type', 'lead')->where('entity_id', $id)
            ->orderBy('id', 'DESC')->findAll(100);

        // Call logs matched to this lead, newest first — only for users granted the
        // call-tracking permission (others get an empty list and no Calls tab).
        $calls = [];
        if ($this->can('calls')) {
            $calls = (new CallLogModel())->where('client_id', $cid)->where('lead_id', $id)
                ->orderBy('call_start', 'DESC')->orderBy('id', 'DESC')->findAll();
            foreach ($calls as &$c) {
                $c['staff_name'] = $c['staff_id'] ? ($staffNames[(int) $c['staff_id']] ?? null) : null;
                $c['connected']  = (bool) $c['connected'];
            }
            unset($c);
        }

        return $this->respond([
            'lead'      => $lead,
            'reminders' => $reminders,
            'notes'     => $notes,
            'activity'  => $activity,
            'calls'     => $calls,
        ]);
    }

    // ------------------------------------------------------------ CALL TRACKING
    //
    // Parsing + lead/staff matching + insert live in App\Libraries\CallIngestService
    // so the session endpoint here and the public API-key endpoint
    // (App\Controllers\CallIngest) store calls identically.

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

        $rows = CallIngestService::parse((array) $this->input(), $this->request->getPost('call_data'));
        if ($rows === null) {
            return $this->failValidationErrors('No call data provided.');
        }
        if (! $rows) {
            return $this->respond(['status' => 1, 'message' => 'No calls to import.', 'inserted' => 0]);
        }

        $db     = (new TenantManager())->forClient($cid);
        $result = CallIngestService::ingest($cid, $db, $rows, $staffId ?: null);

        $this->logActivity('created', 'calls', null, "Synced {$result['inserted']} call log(s)", $cid);

        return $this->respond([
            'status'   => 1,
            'message'  => 'Call data saved.',
            'inserted' => $result['inserted'],
            'skipped'  => $result['skipped'], // duplicates rejected
        ]);
    }

    /**
     * GET /client/call-api-key — the API key the external calling app uses to post
     * to /calls/ingest (admin only; it's a workspace-wide credential). Generated
     * lazily if somehow missing. Returns the key + the public endpoint path.
     */
    public function callApiKey()
    {
        if (! $this->isAdmin()) {
            return $this->failForbidden('Only admins can view the call API key.');
        }
        $cid    = $this->clientId();
        $model  = new ClientModel();
        $client = $model->find($cid);
        $key    = $client['call_api_key'] ?? null;
        if (! $key) {
            $key = bin2hex(random_bytes(24));
            $model->skipValidation(true)->update($cid, ['call_api_key' => $key]);
        }

        return $this->respond(['api_key' => $key, 'endpoint' => '/calls/ingest']);
    }

    /**
     * POST /client/call-api-key/rotate — issue a new key and invalidate the old
     * one (admin only). The calling app must be updated with the new key.
     */
    public function rotateCallApiKey()
    {
        if (! $this->isAdmin()) {
            return $this->failForbidden('Only admins can rotate the call API key.');
        }
        $cid = $this->clientId();
        $key = bin2hex(random_bytes(24));
        (new ClientModel())->skipValidation(true)->update($cid, ['call_api_key' => $key]);
        $this->logActivity('updated', 'calls', null, 'Rotated the call-ingest API key', $cid);

        return $this->respond(['api_key' => $key, 'endpoint' => '/calls/ingest']);
    }

    /**
     * GET /client/calls — all active calls for the client (most recent first),
     * enriched with lead and staff names for the Calls activity page.
     */
    public function calls()
    {
        if ($resp = $this->requirePermission('calls')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('calls')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('followups')) {
            return $resp;
        }
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
        // NOTE: `follow_date` is a DATE column — never compare it to '' (MySQL in
        // strict mode rejects "Incorrect DATE value: ''"). IS NOT NULL is enough.
        $q = (new LeadModel())->where('client_id', $cid)->where('follow_date IS NOT NULL');
        $this->applyLeadScope($q);
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

    /**
     * Mirror a lead's follow_date onto its latest reminder date (max remind_at),
     * or null when it has no reminders left. The follow-up date is therefore
     * always driven by reminders — shown across the lead table, form and the
     * Follow Up Tracker. (Stored as DATE; the full date+time lives in the
     * reminder / last_reminder_at.)
     */
    private function syncFollowDate(int $cid, int $leadId): void
    {
        $row   = (new LeadReminderModel())
            ->selectMax('remind_at', 'max_at')
            ->where('client_id', $cid)
            ->where('lead_id', $leadId)
            ->first();
        $maxAt = $row['max_at'] ?? null;
        (new LeadModel())->update($leadId, [
            'follow_date' => $maxAt ? date('Y-m-d', strtotime((string) $maxAt)) : null,
        ]);
    }

    /** POST /client/leads/{id}/reminders — schedule a future reminder. */
    public function createReminder(int $id)
    {
        if ($resp = $this->requirePermission('leads', 'update')) {
            return $resp;
        }
        $cid  = $this->clientId();
        $lead = (new LeadModel())->where('client_id', $cid)->find($id);
        if (! $lead || ! $this->canSeeLead($lead)) {
            return $this->failNotFound('Lead not found');
        }

        $remindAt = strtotime((string) $this->input('remind_at'));
        if (! $remindAt) {
            return $this->failValidationErrors(['remind_at' => 'Pick a valid date and time.']);
        }
        if ($remindAt <= time()) {
            return $this->failValidationErrors(['remind_at' => 'The reminder time must be in the future.']);
        }

        // A note is required for every reminder (strip tags to reject empty rich text).
        $note = trim((string) $this->input('note'));
        if (trim(strip_tags($note)) === '') {
            return $this->failValidationErrors(['note' => 'Add a note for this reminder.']);
        }

        $model = new LeadReminderModel();
        $rid   = $model->insert([
            'client_id'       => $cid,
            'lead_id'         => $id,
            'user_id'         => (int) ($this->currentUser()['id'] ?? 0),
            'author_staff_id' => $this->staffId() ?: null,
            'remind_at'       => date('Y-m-d H:i:s', $remindAt),
            'note'            => $note,
        ]);
        if ($rid === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->syncFollowDate($cid, $id);
        $this->logActivity('created', 'lead', $id, 'Set a reminder for ' . date('d M Y, g:i A', $remindAt));

        return $this->respondCreated(['message' => 'Reminder set', 'id' => $rid]);
    }

    /** POST /client/lead-reminders/{id} — edit a reminder (creator, team leader or admin). */
    public function updateReminder(int $rid)
    {
        if ($resp = $this->requirePermission('leads', 'update')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new LeadReminderModel();
        $row   = $model->where('client_id', $cid)->find($rid);
        if (! $row) {
            return $this->failNotFound('Reminder not found');
        }
        if (! $this->canManageReminder($row)) {
            return $this->failForbidden('You can only edit your own reminders (or your team\'s).');
        }

        $remindAt = strtotime((string) $this->input('remind_at'));
        if (! $remindAt) {
            return $this->failValidationErrors(['remind_at' => 'Pick a valid date and time.']);
        }
        $newAt = date('Y-m-d H:i:s', $remindAt);
        // Only enforce "must be in the future" when the time actually changes, so a
        // note-only edit on an already-passed reminder still saves.
        if ($newAt !== (string) $row['remind_at'] && $remindAt <= time()) {
            return $this->failValidationErrors(['remind_at' => 'The reminder time must be in the future.']);
        }

        $data = ['remind_at' => $newAt, 'note' => trim((string) $this->input('note')) ?: null];
        // Re-arm a rescheduled reminder so it fires again at the new time.
        if ($newAt !== (string) $row['remind_at']) {
            $data['notified_at'] = null;
            $data['done']        = 0;
        }
        if ($model->update($rid, $data) === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->syncFollowDate($cid, (int) $row['lead_id']);
        $this->logActivity('updated', 'lead', (int) $row['lead_id'], 'Edited a reminder');

        return $this->respond(['message' => 'Reminder updated']);
    }

    /** POST /client/lead-reminders/{id}/delete — soft-delete a reminder (creator, team leader or admin). */
    public function deleteReminder(int $rid)
    {
        if ($resp = $this->requirePermission('leads', 'update')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new LeadReminderModel();
        $row   = $model->where('client_id', $cid)->find($rid);
        if (! $row) {
            return $this->failNotFound('Reminder not found');
        }
        if (! $this->canManageReminder($row)) {
            return $this->failForbidden('You can only delete your own reminders (or your team\'s).');
        }
        $model->delete($rid);
        $this->syncFollowDate($cid, (int) $row['lead_id']);
        $this->logActivity('deleted', 'lead', (int) $row['lead_id'], 'Removed a reminder');

        return $this->respond(['message' => 'Deleted']);
    }

    /** POST /client/leads/{id}/notes — add a note to a lead. */
    public function createNote(int $id)
    {
        if ($resp = $this->requirePermission('leads', 'update')) {
            return $resp;
        }
        $cid  = $this->clientId();
        $lead = (new LeadModel())->where('client_id', $cid)->find($id);
        if (! $lead || ! $this->canSeeLead($lead)) {
            return $this->failNotFound('Lead not found');
        }

        $body = trim((string) $this->input('body'));
        if ($body === '') {
            return $this->failValidationErrors(['body' => 'Write something first.']);
        }

        $user  = $this->currentUser();
        $model = new LeadNoteModel();
        $nid   = $model->insert([
            'client_id'       => $cid,
            'lead_id'         => $id,
            'author_id'       => (int) ($user['id'] ?? 0),
            'author_staff_id' => $this->staffId() ?: null,
            'author_name'     => $user['name'] ?? ($user['email'] ?? 'You'),
            'body'            => $body,
        ]);
        if ($nid === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('created', 'lead', $id, 'Added a note');

        return $this->respondCreated(['message' => 'Note added', 'id' => $nid]);
    }

    /**
     * Whether the current user may edit/delete an authored row (note/reminder):
     * its author, a team leader above the author in the reporting tree, or an
     * admin. `$authorUserId` is the users-table id; `$authorStaffId` the staff id.
     */
    private function canManageAuthored(int $authorUserId, int $authorStaffId): bool
    {
        if ($this->isAdmin()) {
            return true;
        }
        $uid = (int) ($this->currentUser()['id'] ?? 0);
        if ($uid && $authorUserId === $uid) {
            return true; // the author
        }
        $mySid = $this->staffId();
        if ($mySid && $authorStaffId) {
            // subordinateIds($me) = me + everyone below me, so an author who reports
            // up to me (at any depth) is covered — i.e. I'm their team leader.
            return in_array($authorStaffId, (new ClientStaffModel())->subordinateIds($this->clientId(), $mySid), true);
        }

        return false;
    }

    /** Note edit/delete gate: author, team leader or admin. */
    private function canManageNote(array $note): bool
    {
        return $this->canManageAuthored((int) ($note['author_id'] ?? 0), (int) ($note['author_staff_id'] ?? 0));
    }

    /** Reminder edit/delete gate: creator, team leader or admin. */
    private function canManageReminder(array $reminder): bool
    {
        return $this->canManageAuthored((int) ($reminder['user_id'] ?? 0), (int) ($reminder['author_staff_id'] ?? 0));
    }

    /** POST /client/lead-notes/{id} — edit a note (author, team leader or admin). */
    public function updateNote(int $nid)
    {
        if ($resp = $this->requirePermission('leads', 'update')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new LeadNoteModel();
        $row   = $model->where('client_id', $cid)->find($nid);
        if (! $row) {
            return $this->failNotFound('Note not found');
        }
        if (! $this->canManageNote($row)) {
            return $this->failForbidden('You can only edit your own notes (or your team\'s).');
        }
        $body = trim((string) $this->input('body'));
        if ($body === '') {
            return $this->failValidationErrors(['body' => 'Write something first.']);
        }
        if ($model->update($nid, ['body' => $body]) === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('updated', 'lead', (int) $row['lead_id'], 'Edited a note');

        return $this->respond(['message' => 'Note updated']);
    }

    /** POST /client/lead-notes/{id}/delete — soft-delete a note (author, team leader or admin). */
    public function deleteNote(int $nid)
    {
        if ($resp = $this->requirePermission('leads', 'update')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new LeadNoteModel();
        $row   = $model->where('client_id', $cid)->find($nid);
        if (! $row) {
            return $this->failNotFound('Note not found');
        }
        if (! $this->canManageNote($row)) {
            return $this->failForbidden('You can only delete your own notes (or your team\'s).');
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
            $lead  = $leadNames[(int) $r['lead_id']] ?? ('Lead #' . $r['lead_id']);
            $title = 'Lead reminder: ' . ($lead !== '' ? $lead : ('Lead #' . $r['lead_id']));
            $body  = $r['note'] ?: 'You set a reminder for this lead.';
            $notif->insert([
                'recipient_type' => 'user',
                'recipient_id'   => $userId,
                'type'           => 'lead_reminder',
                'title'          => $title,
                'body'           => $body,
                'link'           => '/client/leads',
            ]);
            PushService::sendToRecipient($cid, 'user', $userId, $title, $body, '/client/leads');
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
        // Read-only reference data: anyone who can view leads needs it to render
        // the leads list, filters and form — not just the Leads Setup editors.
        if (! $this->can('leads') && ! $this->can('leads_setup')) {
            return $this->failForbidden('You do not have permission to view leads setup.');
        }
        $cid = $this->clientId();

        return $this->respond([
            'lead_statuses'    => $this->decorateStatuses($cid),
            'lead_sources'     => $this->decorateSources($cid),
            'marketing_types'  => $this->lookupRows(MarketingTypeModel::class, $cid),
            'lead_types'       => $this->lookupRows(LeadTypeModel::class, $cid),
            'references'       => $this->lookupRows(LeadReferenceModel::class, $cid),
            'conversion_types' => $this->decorateConversions($cid),
            'followup_groups'  => $this->decorateFollowupGroups($cid),
            'states'           => $this->lookupRows(StateModel::class, $cid),
            'cities'           => $this->decorateCities($cid),
            'required_fields'  => $this->requiredLeadFields(),
            'sub_status_rules' => $this->subStatusRules(),
            'phone_rules'      => $this->leadPhoneRules(),
        ]);
    }

    /** POST /client/lead-phone-rules — set whether lead phone / alt phone must be unique. */
    public function saveLeadPhoneRules()
    {
        if ($resp = $this->denyUnlessPerm('leads_setup', 'update')) {
            return $resp;
        }
        $this->setSetting('lead_phone_unique', $this->input('unique_phone') ? '1' : '0');
        $this->setSetting('lead_alt_phone_unique', $this->input('unique_alt') ? '1' : '0');
        $this->logActivity('updated', 'settings', null, 'Updated lead phone rules', $this->clientId());

        return $this->respond(['message' => 'Saved', 'phone_rules' => $this->leadPhoneRules()]);
    }

    /**
     * Admin-set rules for the "add sub-status" form: whether a parent status
     * and/or a lead type must be chosen. Parent defaults required (legacy
     * behaviour), type defaults optional.
     */
    private function subStatusRules(): array
    {
        $map = $this->settingsMap();

        return [
            'require_parent' => ($map['sub_status_require_parent'] ?? '1') === '1',
            'require_type'   => ($map['sub_status_require_type'] ?? '0') === '1',
        ];
    }

    /** POST /client/sub-status-rules — set whether parent status / lead type are required for new sub-statuses. */
    public function saveSubStatusRules()
    {
        if ($resp = $this->denyUnlessPerm('leads_setup', 'update')) {
            return $resp;
        }
        $this->setSetting('sub_status_require_parent', $this->input('require_parent') ? '1' : '0');
        $this->setSetting('sub_status_require_type', $this->input('require_type') ? '1' : '0');
        $this->logActivity('updated', 'settings', null, 'Updated sub-status required fields', $this->clientId());

        return $this->respond(['message' => 'Saved', 'sub_status_rules' => $this->subStatusRules()]);
    }

    // --- Mandatory lead-form fields -------------------------------------

    /**
     * Lead-form fields an admin may mark mandatory. `phone` and `status_id` are
     * always required (enforced by LeadModel) so they aren't configurable here.
     */
    private const CONFIGURABLE_REQUIRED_FIELDS = [
        'name', 'reference_name', 'alt_phone', 'sub_status_id', 'source_id',
        'lead_type_id', 'email', 'assigned_to', 'city', 'state',
    ];

    /** Human labels for the configurable fields, used in validation messages. */
    private const REQUIRED_FIELD_LABELS = [
        'name'           => 'Name',
        'reference_name' => 'Reference name',
        'alt_phone'      => 'Alternative phone',
        'sub_status_id'  => 'Sub status',
        'source_id'      => 'Lead source',
        'lead_type_id'   => 'Lead type',
        'email'          => 'Email',
        'assigned_to'    => 'Assigned to',
        'city'           => 'City',
        'state'          => 'State',
    ];

    /** Field keys this client has marked mandatory on the lead form. */
    private function requiredLeadFields(): array
    {
        $keys = json_decode((string) ($this->settingsMap()['lead_required_fields'] ?? '[]'), true);

        return is_array($keys)
            ? array_values(array_intersect($keys, self::CONFIGURABLE_REQUIRED_FIELDS))
            : [];
    }

    /** Validate the configured-mandatory fields against a built lead row; key => message. */
    private function requiredFieldErrors(array $data): array
    {
        $errors = [];
        foreach ($this->requiredLeadFields() as $key) {
            $val = $data[$key] ?? null;
            if ($val === null || $val === '' || $val === 0) {
                $errors[$key] = (self::REQUIRED_FIELD_LABELS[$key] ?? $key) . ' is required.';
            }
        }

        return $errors;
    }

    /** POST /client/lead-field-settings — set which lead-form fields are mandatory. */
    public function saveLeadRequiredFields()
    {
        if ($resp = $this->denyUnlessPerm('leads_setup', 'update')) {
            return $resp;
        }
        $fields = $this->input('fields');
        $clean  = is_array($fields)
            ? array_values(array_intersect(array_map('strval', $fields), self::CONFIGURABLE_REQUIRED_FIELDS))
            : [];

        $this->setSetting('lead_required_fields', json_encode($clean));
        $this->logActivity('updated', 'settings', null, 'Updated mandatory lead fields', $this->clientId());

        return $this->respond(['message' => 'Saved', 'required_fields' => $clean]);
    }

    // ===================================================== GENERIC FORM FIELDS
    //
    // A unified "form setup": per form, which built-in fields are mandatory + any
    // admin-defined custom fields. Definitions live in the per-client `settings`
    // table as `<form>_required_fields` / `<form>_custom_fields` JSON; custom
    // *values* live in each record's `custom_fields` JSON column. Powers the
    // central Form Setup hub and per-form rendering for every entity.

    private const CUSTOM_FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select'];

    /** Built-in fields each form may mark mandatory (the always-required key is omitted). */
    private const FORM_REQUIRABLE = [
        'lead'    => ['name', 'reference_name', 'alt_phone', 'sub_status_id', 'source_id', 'lead_type_id', 'email', 'assigned_to', 'city', 'state'],
        'task'    => ['description', 'assigned_to', 'due_date', 'start_date', 'priority', 'type'],
        'asset'   => ['series_model', 'asset_group', 'managed_by', 'asset_location', 'purchase_date', 'warranty_months', 'unit_price', 'supplier_name'],
        'visitor' => ['phone', 'email', 'type_id', 'status_id', 'assigned_to', 'purpose', 'visit_date'],
        'staff'   => ['phone', 'alt_phone', 'designation', 'role_id', 'reports_to', 'department_id', 'office_location_id'],
    ];

    /** Human labels for each form's requirable fields. */
    private const FORM_LABELS = [
        'lead'    => ['name' => 'Name', 'reference_name' => 'Reference name', 'alt_phone' => 'Alternative phone', 'sub_status_id' => 'Sub status', 'source_id' => 'Lead source', 'lead_type_id' => 'Lead type', 'email' => 'Email', 'assigned_to' => 'Assigned to', 'city' => 'City', 'state' => 'State'],
        'task'    => ['description' => 'Description', 'assigned_to' => 'Assignee', 'due_date' => 'Due date', 'start_date' => 'Start date', 'priority' => 'Priority', 'type' => 'Type'],
        'asset'   => ['series_model' => 'Series / model', 'asset_group' => 'Asset group', 'managed_by' => 'Managed by', 'asset_location' => 'Location', 'purchase_date' => 'Purchase date', 'warranty_months' => 'Warranty (months)', 'unit_price' => 'Unit price', 'supplier_name' => 'Supplier name'],
        'visitor' => ['phone' => 'Phone', 'email' => 'Email', 'type_id' => 'Type', 'status_id' => 'Status', 'assigned_to' => 'Assigned to', 'purpose' => 'Purpose', 'visit_date' => 'Visit date'],
        'staff'   => ['phone' => 'Phone', 'alt_phone' => 'Alternative phone', 'designation' => 'Designation', 'role_id' => 'Role', 'reports_to' => 'Reports to', 'department_id' => 'Department', 'office_location_id' => 'Office'],
    ];

    /** Built-in fields the client has marked mandatory on $form. */
    private function formRequiredFields(string $form): array
    {
        $allowed = self::FORM_REQUIRABLE[$form] ?? [];
        $keys    = json_decode((string) ($this->settingsMap()[$form . '_required_fields'] ?? '[]'), true);

        return is_array($keys) ? array_values(array_intersect(array_map('strval', $keys), $allowed)) : [];
    }

    /** The client's admin-defined custom fields for $form (sanitized definitions). */
    private function formCustomFields(string $form): array
    {
        $defs = json_decode((string) ($this->settingsMap()[$form . '_custom_fields'] ?? '[]'), true);
        if (! is_array($defs)) {
            return [];
        }
        $out = [];
        foreach ($defs as $d) {
            if (! is_array($d) || trim((string) ($d['label'] ?? '')) === '') {
                continue;
            }
            $type = in_array($d['type'] ?? 'text', self::CUSTOM_FIELD_TYPES, true) ? $d['type'] : 'text';
            $key  = preg_replace('/[^a-z0-9_]/', '', strtolower((string) ($d['key'] ?? '')));
            if ($key === '') {
                continue;
            }
            $out[] = [
                'key'      => $key,
                'label'    => (string) $d['label'],
                'type'     => $type,
                'required' => ! empty($d['required']),
                'options'  => ($type === 'select' && is_array($d['options'] ?? null))
                    ? array_values(array_filter(array_map(static fn ($o) => trim((string) $o), $d['options']), static fn ($o) => $o !== ''))
                    : [],
            ];
        }

        return $out;
    }

    /** Pull + sanitize custom-field values from request input, keyed by field key. */
    private function formCustomValues(string $form, array $in): array
    {
        $raw = $in['custom_fields'] ?? [];
        if (is_string($raw)) {
            $raw = json_decode($raw, true) ?: [];
        }
        if (! is_array($raw)) {
            $raw = [];
        }
        $out = [];
        foreach ($this->formCustomFields($form) as $f) {
            if (! array_key_exists($f['key'], $raw)) {
                continue;
            }
            $v              = $raw[$f['key']];
            $out[$f['key']] = $f['type'] === 'number'
                ? (($v === '' || $v === null) ? '' : (string) (0 + $v))
                : trim((string) $v);
        }

        return $out;
    }

    /** Validation errors for $form's mandatory built-in + custom fields. */
    private function formFieldErrors(string $form, array $data, array $customValues): array
    {
        $errors = [];
        $labels = self::FORM_LABELS[$form] ?? [];
        foreach ($this->formRequiredFields($form) as $key) {
            $val = $data[$key] ?? null;
            if ($val === null || $val === '' || $val === 0) {
                $errors[$key] = ($labels[$key] ?? $key) . ' is required.';
            }
        }
        foreach ($this->formCustomFields($form) as $f) {
            if (! empty($f['required'])) {
                $v = $customValues[$f['key']] ?? null;
                if ($v === null || $v === '') {
                    $errors['custom_' . $f['key']] = $f['label'] . ' is required.';
                }
            }
        }

        return $errors;
    }

    /** Decode a stored custom_fields JSON column to an object (for list/detail responses). */
    private function decodeCustom($raw): object
    {
        $v = json_decode((string) ($raw ?? ''), true);

        return (object) (is_array($v) ? $v : []);
    }

    /** GET /client/form-setup/{form} — requirable fields + current required + custom defs. */
    public function formSetup(string $form)
    {
        if (! isset(self::FORM_REQUIRABLE[$form])) {
            return $this->failNotFound('Unknown form');
        }

        return $this->respond([
            'form'            => $form,
            'requirable'      => array_map(fn ($k) => ['key' => $k, 'label' => self::FORM_LABELS[$form][$k] ?? $k], self::FORM_REQUIRABLE[$form]),
            'required_fields' => $this->formRequiredFields($form),
            'custom_fields'   => $this->formCustomFields($form),
            'can_manage'      => $this->isAdmin(),
        ]);
    }

    /** POST /client/form-field-settings/{form} — save mandatory flags + custom defs (admin). */
    public function saveFormFieldSettings(string $form)
    {
        if (! isset(self::FORM_REQUIRABLE[$form])) {
            return $this->failNotFound('Unknown form');
        }
        if (! $this->isAdmin()) {
            return $this->failForbidden('Only an admin can change form fields.');
        }
        $in       = (array) $this->input();
        $allowed  = self::FORM_REQUIRABLE[$form];
        $required = is_array($in['required_fields'] ?? null)
            ? array_values(array_intersect(array_map('strval', $in['required_fields']), $allowed))
            : [];

        $custom = [];
        $seen   = [];
        foreach ((array) ($in['custom_fields'] ?? []) as $d) {
            if (! is_array($d)) {
                continue;
            }
            $label = trim((string) ($d['label'] ?? ''));
            if ($label === '') {
                continue;
            }
            $base = preg_replace('/[^a-z0-9_]/', '', strtolower(str_replace([' ', '-'], '_', (string) (($d['key'] ?? '') ?: $label))));
            $key  = $base !== '' ? $base : 'field';
            while (isset($seen[$key])) {
                $key .= '_';
            }
            $seen[$key] = true;
            $type       = in_array($d['type'] ?? 'text', self::CUSTOM_FIELD_TYPES, true) ? $d['type'] : 'text';
            $custom[]   = [
                'key'      => $key,
                'label'    => $label,
                'type'     => $type,
                'required' => ! empty($d['required']),
                'options'  => ($type === 'select' && is_array($d['options'] ?? null))
                    ? array_values(array_filter(array_map(static fn ($o) => trim((string) $o), $d['options']), static fn ($o) => $o !== ''))
                    : [],
            ];
        }

        $this->setSetting($form . '_required_fields', json_encode($required));
        $this->setSetting($form . '_custom_fields', json_encode($custom));
        $this->logActivity('updated', 'settings', null, "Updated {$form} form fields");

        return $this->respond(['message' => 'Saved', 'required_fields' => $required, 'custom_fields' => $custom]);
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

        // A (top) status can belong to one or more lead types; empty = "global"
        // (shows under any type). Sub-statuses simply don't send type_ids.
        $typeIds = array_values(array_unique(array_filter(
            array_map('intval', (array) ($this->input('type_ids') ?? [])),
            static fn ($v) => $v > 0,
        )));

        return [
            'conversion_type' => trim((string) ($this->input('conversion_type') ?? 'open')) ?: 'open',
            'parent_ids'      => json_encode($ids),
            'parent_id'       => $ids ? (int) reset($ids) : null,
            'type_ids'        => json_encode($typeIds),
        ];
    }

    /** Lead statuses with parent_ids + type_ids decoded to int[] and names resolved. */
    private function decorateStatuses(int $cid): array
    {
        $rows  = $this->lookupRows(LeadStatusModel::class, $cid);
        $names = [];
        foreach ($rows as $s) {
            $names[(int) $s['id']] = $s['name'];
        }
        $typeNames = $this->idNameMap($this->lookupRows(LeadTypeModel::class, $cid));
        foreach ($rows as &$r) {
            $ids = json_decode((string) ($r['parent_ids'] ?? ''), true);
            $ids = is_array($ids) ? array_values(array_filter(array_map('intval', $ids))) : [];
            if (! $ids && ! empty($r['parent_id'])) {
                $ids = [(int) $r['parent_id']]; // legacy single-parent fallback
            }
            $r['parent_ids']   = $ids;
            $r['parent_names'] = array_values(array_filter(array_map(static fn ($i) => $names[$i] ?? null, $ids)));

            $tids            = json_decode((string) ($r['type_ids'] ?? ''), true);
            $tids            = is_array($tids) ? array_values(array_filter(array_map('intval', $tids))) : [];
            $r['type_ids']   = $tids;
            $r['type_names'] = array_values(array_filter(array_map(static fn ($i) => $typeNames[$i] ?? null, $tids)));
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

    // --- References ------------------------------------------------------
    //
    // Admin-managed reference names. A staff member can be tied to one
    // reference; they then see ONLY leads whose `reference_name` matches it
    // (see applyLeadScope). Leads store the reference's *name* (free text), so
    // matching is by name and existing values keep working.

    public function references()
    {
        return $this->respond(['references' => $this->lookupRows(LeadReferenceModel::class, $this->clientId())]);
    }

    public function createReference()
    {
        return $this->saveLookup(LeadReferenceModel::class, 'reference', fn () => []);
    }

    public function updateReference(int $id)
    {
        $cid = $this->clientId();
        $old = (new LeadReferenceModel())->where('client_id', $cid)->find($id);

        $resp = $this->saveLookup(LeadReferenceModel::class, 'reference', fn () => [], $id);

        // Reference id is the source of truth, so a rename normally needs no lead
        // rewrite. But legacy leads tagged only by the old free-text name have no
        // id yet — link them to this id now (so they stay stable through future
        // renames) and refresh their stored name snapshot for exports/search.
        if ($old && $resp->getStatusCode() === 200) {
            $newName = trim((string) $this->input('name'));
            $oldName = (string) ($old['name'] ?? '');
            if ($newName !== '' && $newName !== $oldName) {
                (new LeadModel())->builder()
                    ->where('client_id', $cid)
                    ->where('deleted_at', null) // don't rewrite archived leads (raw builder skips the model's soft-delete scope)
                    ->where('reference_name', $oldName)
                    ->groupStart()->where('reference_id', null)->orWhere('reference_id', $id)->groupEnd()
                    ->update(['reference_id' => $id, 'reference_name' => $newName]);
            }
        }

        return $resp;
    }

    public function deleteReference(int $id)
    {
        $cid  = $this->clientId();
        $resp = $this->deleteLookup(LeadReferenceModel::class, 'reference', $id);

        // Detach the reference from any staff who had it, so they fall back to the
        // normal assigned-to visibility instead of scoping to a deleted reference.
        // Leads keep their free-text `reference_name` snapshot (now unlinked).
        if ($resp->getStatusCode() === 200) {
            (new ClientStaffModel())->builder()
                ->where('client_id', $cid)
                ->where('reference_id', $id)
                ->update(['reference_id' => null]);
            (new LeadModel())->builder()
                ->where('client_id', $cid)
                ->where('reference_id', $id)
                ->update(['reference_id' => null]);
        }

        return $resp;
    }

    public function reorderReferences()
    {
        return $this->reorderLookup(LeadReferenceModel::class);
    }

    // --- States ----------------------------------------------------------

    public function states()
    {
        return $this->respond(['states' => $this->lookupRows(StateModel::class, $this->clientId())]);
    }

    public function createState()
    {
        return $this->saveLookup(StateModel::class, 'state', fn () => []);
    }

    public function updateState(int $id)
    {
        return $this->saveLookup(StateModel::class, 'state', fn () => [], $id);
    }

    public function deleteState(int $id)
    {
        return $this->deleteLookup(StateModel::class, 'state', $id);
    }

    public function reorderStates()
    {
        return $this->reorderLookup(StateModel::class);
    }

    // --- Cities (each belongs to a state) --------------------------------

    public function cities()
    {
        return $this->respond(['cities' => $this->decorateCities($this->clientId())]);
    }

    public function createCity()
    {
        return $this->saveLookup(CityModel::class, 'city', fn () => $this->cityExtra());
    }

    public function updateCity(int $id)
    {
        return $this->saveLookup(CityModel::class, 'city', fn () => $this->cityExtra(), $id);
    }

    public function deleteCity(int $id)
    {
        return $this->deleteLookup(CityModel::class, 'city', $id);
    }

    public function reorderCities()
    {
        return $this->reorderLookup(CityModel::class);
    }

    private function cityExtra(): array
    {
        $st = $this->input('state_id');

        return ['state_id' => $st ? (int) $st : null];
    }

    /** Cities with their parent state name resolved (for the setup UI). */
    private function decorateCities(int $cid): array
    {
        $cities = $this->lookupRows(CityModel::class, $cid);
        $states = $this->idNameMap($this->lookupRows(StateModel::class, $cid));
        foreach ($cities as &$c) {
            $stId          = $c['state_id'] !== null ? (int) $c['state_id'] : null;
            $c['state_id'] = $stId;
            $c['state']    = $stId ? ($states[$stId] ?? null) : null;
        }
        unset($c);

        return $cities;
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
    /**
     * Whether saving this lookup row would duplicate an existing name for the
     * client. Names compare case-insensitively (soft-deleted rows excluded). Two
     * lookups use scoped rather than global uniqueness:
     *   - cities are unique per state (the same city name may exist elsewhere);
     *   - lead statuses share a table with sub-statuses — a top status is unique
     *     among top statuses, a sub-status is unique within a shared parent
     *     status (and, when the "require type" rule is on, a shared lead type).
     */
    private function lookupNameTaken(string $modelClass, int $cid, array $data, ?int $excludeId): bool
    {
        $name = mb_strtolower(trim((string) ($data['name'] ?? '')));
        if ($name === '') {
            return false;
        }

        $rows = array_filter(
            (new $modelClass())->where('client_id', $cid)->findAll(),
            static fn ($r) => (int) $r['id'] !== (int) ($excludeId ?? 0)
                && mb_strtolower(trim((string) ($r['name'] ?? ''))) === $name,
        );
        if (! $rows) {
            return false;
        }

        if ($modelClass === CityModel::class) {
            $state = (int) ($data['state_id'] ?? 0);
            foreach ($rows as $r) {
                if ((int) ($r['state_id'] ?? 0) === $state) {
                    return true;
                }
            }

            return false;
        }

        if ($modelClass !== LeadStatusModel::class) {
            return true; // simple lookup: any same-name row for this client clashes
        }

        $decodeIds = static fn ($v) => array_map('intval', is_array($d = json_decode((string) $v, true)) ? $d : []);
        $parentIds = $decodeIds($data['parent_ids'] ?? '[]');
        $isSub     = ! empty($parentIds);
        $reqType   = ! empty($this->subStatusRules()['require_type']);

        foreach ($rows as $r) {
            $rp = $decodeIds($r['parent_ids'] ?? '[]');
            if (! $rp && ! empty($r['parent_id'])) {
                $rp = [(int) $r['parent_id']];
            }
            $rIsSub = ! empty($rp);

            if (! $isSub) {
                if (! $rIsSub) {
                    return true; // top-vs-top name clash
                }
                continue;
            }
            // Sub-status: clashes only with a sub-status sharing a parent status
            // (and a lead type too when types are mandatory).
            if (! $rIsSub || ! array_intersect($parentIds, $rp)) {
                continue;
            }
            if ($reqType && ! array_intersect($decodeIds($data['type_ids'] ?? '[]'), $decodeIds($r['type_ids'] ?? '[]'))) {
                continue;
            }

            return true;
        }

        return false;
    }

    private function saveLookup(string $modelClass, string $entity, callable $extra, ?int $id = null)
    {
        if ($resp = $this->requirePermission('leads_setup', $id === null ? 'create' : 'update')) {
            return $resp;
        }
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

        if ($this->lookupNameTaken($modelClass, $cid, $data, $id)) {
            return $this->failValidationErrors(['name' => 'A ' . $entity . ' with this name already exists.']);
        }

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
        if ($resp = $this->requirePermission('leads_setup', 'delete')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('leads_setup', 'update')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('team', 'create')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('team', 'update')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('team', 'delete')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('team', 'update')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('team', 'create')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('team', 'update')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('team', 'delete')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('team', 'update')) {
            return $resp;
        }
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
                'reference'       => array_map(static fn ($r) => ['id' => (int) $r['id'], 'category' => 'reference', 'name' => $r['name']], $this->lookupRows(LeadReferenceModel::class, $cid)),
            ],
            'categories' => ['department', 'office_location', 'lead_type', 'reference'],
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
        $references = $this->idNameMap($this->lookupRows(LeadReferenceModel::class, $cid));

        foreach ($staff as &$s) {
            $s['has_password'] = ! empty($s['password'] ?? null);
            unset($s['password']);
            $s['role_name']         = $s['role_id'] ? ($roles[$s['role_id']] ?? null) : null;
            $s['manager_name']      = $s['reports_to'] ? ($names[$s['reports_to']] ?? null) : null;
            $s['department']        = $s['department_id'] ? ($depts[$s['department_id']] ?? null) : null;
            $s['office_name']       = $s['office_location_id'] ? ($offices[$s['office_location_id']] ?? null) : null;
            $s['lead_type']         = $s['lead_type_id'] ? ($leadTypes[$s['lead_type_id']] ?? null) : null;
            $s['reference_name']    = $s['reference_id'] ? ($references[$s['reference_id']] ?? null) : null;
            $extra                  = json_decode((string) ($s['extra_permissions'] ?? ''), true);
            $s['extra_permissions'] = is_array($extra) ? $extra : [];
            $s['custom_fields']     = $this->decodeCustom($s['custom_fields'] ?? null);
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

        $data   = $this->staffData($cid);
        $custom = $this->formCustomValues('staff', (array) $this->input());
        if ($errs = $this->formFieldErrors('staff', $data, $custom)) {
            return $this->failValidationErrors($errs);
        }
        // Team phone rules are always enforced (unique primary + alternative,
        // primary != alternative) — internal users, so duplicates are errors.
        if ($perr = $this->phoneRuleErrors(ClientStaffModel::class, $cid, (string) ($data['phone'] ?? ''), $data['alt_phone'] ?? null, null, true, true, 'team member')) {
            return $this->failValidationErrors($perr);
        }
        $data['emp_code']      = $this->nextEmpCode($cid); // auto-generated, not editable
        $data['custom_fields'] = json_encode($custom);
        $model                 = new ClientStaffModel();
        $id                    = $model->insert($data);

        if ($id === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->syncStaffAccount($cid, (int) $id, $data);
        $this->logActivity('created', 'staff', (int) $id, 'Added staff ' . $this->input('name'));

        // Optionally email the new member their credentials, from the CLIENT's own
        // Gmail (Email Setup). Skipped (not fatal) when the client hasn't set it up.
        $emailSent  = false;
        $emailError = null;
        $plainPw    = (string) ($this->input('password') ?? '');
        if ($this->input('email_credentials') && $plainPw !== '') {
            $r          = \App\Libraries\CredentialMailer::send($this->gmailOverride(), (string) $data['name'], (string) ($data['email'] ?? ''), $plainPw, $this->loginUrl());
            $emailSent  = $r['sent'];
            $emailError = $r['error'];
        }

        return $this->respondCreated(['message' => 'Staff added', 'id' => $id, 'email_sent' => $emailSent, 'email_error' => $emailError]);
    }

    /** The app's login page URL — from the request origin, falling back to config. */
    private function loginUrl(): string
    {
        $origin = $this->request->getHeaderLine('Origin');
        $base   = $origin !== '' ? $origin : rtrim((string) (env('app.baseURL') ?: site_url()), '/');

        return rtrim($base, '/') . '/login';
    }

    /** POST /client/staff/{id} */
    public function updateStaff(int $id)
    {
        if ($resp = $this->requirePermission('team', 'update')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new ClientStaffModel();
        $old   = $model->where('client_id', $cid)->find($id);
        if (! $old) {
            return $this->failNotFound('Staff not found');
        }
        $data   = $this->staffData($cid, true);
        $custom = $this->formCustomValues('staff', (array) $this->input());
        if ($errs = $this->formFieldErrors('staff', $data, $custom)) {
            return $this->failValidationErrors($errs);
        }
        // Team phone rules (always on) — only re-check a phone that changed so an
        // existing member with a legacy duplicate can still be edited.
        $checkPhone = (string) ($data['phone'] ?? '') !== (string) ($old['phone'] ?? '');
        $checkAlt   = (string) ($data['alt_phone'] ?? '') !== (string) ($old['alt_phone'] ?? '');
        if ($perr = $this->phoneRuleErrors(ClientStaffModel::class, $cid, (string) ($data['phone'] ?? ''), $data['alt_phone'] ?? null, $id, $checkPhone, $checkAlt, 'team member')) {
            return $this->failValidationErrors($perr);
        }
        $data['custom_fields'] = json_encode($custom);
        $model->skipValidation(true)->update($id, $data);
        $this->syncStaffAccount($cid, $id, $data);
        $this->logActivity('updated', 'staff', $id, 'Updated staff');

        return $this->respond(['message' => 'Staff updated']);
    }

    /** POST /client/staff/{id}/delete */
    /**
     * GET /client/staff/{id}/lead-load — how many active leads are assigned to
     * this member. Drives the delete guard: a member holding leads can't be
     * deleted until those leads are reassigned to someone else.
     */
    public function staffLeadLoad(int $id)
    {
        if ($resp = $this->requirePermission('team')) {
            return $resp;
        }
        $cid = $this->clientId();

        return $this->respond([
            'assigned_leads' => (new LeadModel())->where('client_id', $cid)->where('assigned_to', $id)->countAllResults(),
        ]);
    }

    public function deleteStaff(int $id)
    {
        if ($resp = $this->requirePermission('team', 'delete')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $staff = (new ClientStaffModel())->where('client_id', $cid)->find($id);
        if (! $staff) {
            return $this->failNotFound('Staff not found');
        }

        // Real-time guard: never orphan leads. If this member still holds leads,
        // require an explicit reassignment to another member before deleting.
        $leadModel = new LeadModel();
        $assigned  = $leadModel->where('client_id', $cid)->where('assigned_to', $id)->countAllResults();
        if ($assigned > 0) {
            $reassignTo = (int) ($this->input('reassign_to') ?? 0);
            if ($reassignTo <= 0) {
                return $this->respond([
                    'message'        => "Cannot delete: {$staff['name']} still has {$assigned} lead(s) assigned. Reassign them to another member first.",
                    'assigned_leads' => $assigned,
                ], 409);
            }
            if ($reassignTo === $id) {
                return $this->failValidationErrors(['reassign_to' => 'Choose a different member to reassign the leads to.']);
            }
            $target = (new ClientStaffModel())->where('client_id', $cid)->find($reassignTo);
            if (! $target) {
                return $this->failValidationErrors(['reassign_to' => 'The member to reassign leads to was not found.']);
            }
            // Move every lead off the departing member onto the chosen one.
            $leadModel->where('client_id', $cid)->where('assigned_to', $id)
                ->set(['assigned_to' => $reassignTo, 'assigned_date' => date('Y-m-d H:i:s')])->update();
            $this->logActivity('updated', 'lead', null, "Reassigned {$assigned} lead(s) from {$staff['name']} to {$target['name']} before deleting the member", $cid);
        }

        (new ClientStaffModel())->delete($id);
        (new StaffAccountModel())->where('client_id', $cid)->where('staff_id', $id)->delete();
        $this->logActivity('deleted', 'staff', $id, 'Removed staff member' . ($assigned > 0 ? " (reassigned {$assigned} lead(s))" : ''));

        return $this->respond(['message' => $assigned > 0 ? "Staff removed; {$assigned} lead(s) reassigned." : 'Staff removed']);
    }

    /**
     * POST /client/staff/{id}/reassign-leads — hand a member's leads to one or
     * more members before deleting them. Round-robins across `targets` (one id =
     * single transfer). Optionally re-stamps the assigned date and changes the
     * status / lead type / source. Each lead gets its own activity-log entry; each
     * receiving member gets a summary notification.
     */
    public function reassignStaffLeads(int $id)
    {
        if ($resp = $this->denyUnlessPerm('team', 'update')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $staff = (new ClientStaffModel())->where('client_id', $cid)->find($id);
        if (! $staff) {
            return $this->failNotFound('Staff not found');
        }

        // Validate the chosen targets (each must belong to this client, not be the
        // departing member). Round-robin assigns leads across them in order.
        $wanted  = array_values(array_unique(array_filter(array_map('intval', (array) $this->input('targets')), static fn ($t) => $t > 0)));
        $wanted  = array_values(array_filter($wanted, static fn ($t) => $t !== $id));
        $names   = $this->idNameMap((new ClientStaffModel())->where('client_id', $cid)->whereIn('id', $wanted ?: [0])->findAll());
        $targets = array_values(array_filter($wanted, static fn ($t) => isset($names[$t])));
        if (! $targets) {
            return $this->failValidationErrors(['targets' => 'Choose at least one valid member to transfer the leads to.']);
        }

        $updateDate = ! empty($this->input('update_assigned_date'));
        $notify     = ! empty($this->input('notify')); // in-app + web push to receivers
        $statusId   = (int) $this->input('status_id') ?: null;
        $typeId     = (int) $this->input('lead_type_id') ?: null;
        $sourceId   = (int) $this->input('source_id') ?: null;

        $statusNames = $statusId ? $this->idNameMap($this->lookupRows(LeadStatusModel::class, $cid)) : [];
        $typeNames   = $typeId ? $this->idNameMap($this->lookupRows(LeadTypeModel::class, $cid)) : [];
        $sourceNames = $sourceId ? $this->idNameMap($this->lookupRows(LeadSourceModel::class, $cid)) : [];

        $leadModel = new LeadModel();
        $leads     = $leadModel->where('client_id', $cid)->where('assigned_to', $id)->orderBy('id', 'ASC')->findAll();

        $perTarget = array_fill_keys($targets, 0);
        $count     = count($targets);
        foreach ($leads as $i => $lead) {
            $to  = $targets[$i % $count];
            $upd = ['assigned_to' => $to];
            if ($updateDate) {
                $upd['assigned_date'] = date('Y-m-d H:i:s');
            }
            if ($statusId) {
                $upd['status_id'] = $statusId;
            }
            if ($typeId) {
                $upd['lead_type_id'] = $typeId;
            }
            if ($sourceId) {
                $upd['source_id'] = $sourceId;
            }
            $leadModel->update((int) $lead['id'], $upd);
            $perTarget[$to]++;

            // One readable audit entry per lead, summarising every applied change.
            $parts = ["Reassigned: {$staff['name']} → {$names[$to]}"];
            if ($updateDate) {
                $parts[] = 'assigned date updated';
            }
            if ($statusId) {
                $parts[] = 'status → ' . ($statusNames[$statusId] ?? '—');
            }
            if ($typeId) {
                $parts[] = 'type → ' . ($typeNames[$typeId] ?? '—');
            }
            if ($sourceId) {
                $parts[] = 'source → ' . ($sourceNames[$sourceId] ?? '—');
            }
            $this->logActivity('updated', 'lead', (int) $lead['id'], implode('; ', $parts));
        }

        // A summary notification (in-app + web push) per receiver — only if asked.
        if ($notify) {
            foreach ($perTarget as $to => $n) {
                if ($n > 0) {
                    $this->notifyStaff((int) $to, 'lead_assigned', "{$n} lead" . ($n === 1 ? '' : 's') . ' assigned to you', "Transferred from {$staff['name']}.", '/client/leads');
                }
            }
        }
        $this->logActivity('updated', 'staff', $id, 'Transferred ' . count($leads) . ' lead(s) from ' . $staff['name'] . ' to ' . $count . ' member(s)');

        return $this->respond(['message' => 'Leads transferred', 'moved' => count($leads), 'per_target' => $perTarget]);
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

    /**
     * Next auto Employee Code for a client — "EMP0001", "EMP0002", … The number
     * is one past the highest existing EMP#### (including archived staff, so a
     * code is never reused), with a collision guard for any manual codes.
     */
    private function nextEmpCode(int $cid): string
    {
        $model = new ClientStaffModel();
        $max   = 0;
        foreach ($model->withDeleted()->where('client_id', $cid)->findAll() as $r) {
            if (preg_match('/^EMP(\d+)$/', (string) ($r['emp_code'] ?? ''), $m)) {
                $max = max($max, (int) $m[1]);
            }
        }
        $n = $max + 1;
        do {
            $code = 'EMP' . str_pad((string) $n, 4, '0', STR_PAD_LEFT);
            $n++;
        } while ($model->withDeleted()->where('client_id', $cid)->where('emp_code', $code)->countAllResults() > 0);

        return $code;
    }

    private function staffData(int $cid, bool $partial = false): array
    {
        $data = [
            'client_id'          => $cid,
            'name'               => trim((string) $this->input('name')),
            'email'              => trim((string) ($this->input('email') ?? '')) ?: null,
            'phone'              => trim((string) ($this->input('phone') ?? '')) ?: null,
            'avatar'             => trim((string) ($this->input('avatar') ?? '')) ?: null,
            // emp_code is auto-generated on create (nextEmpCode) and never editable,
            // so it's intentionally NOT read from the request here.
            'designation'        => trim((string) ($this->input('designation') ?? '')) ?: null,
            'alt_phone'          => trim((string) ($this->input('alt_phone') ?? '')) ?: null,
            'role_id'            => (int) $this->input('role_id') ?: null,
            'reports_to'         => (int) $this->input('reports_to') ?: null,
            'lead_type_id'       => (int) $this->input('lead_type_id') ?: null,
            'reference_id'       => (int) $this->input('reference_id') ?: null,
            'office_location_id' => (int) $this->input('office_location_id') ?: null,
            'department_id'      => (int) $this->input('department_id') ?: null,
            'facebook'           => trim((string) ($this->input('facebook') ?? '')) ?: null,
            'linkedin'           => trim((string) ($this->input('linkedin') ?? '')) ?: null,
            'skype'              => trim((string) ($this->input('skype') ?? '')) ?: null,
            'email_signature'    => HtmlSanitizer::clean(trim((string) ($this->input('email_signature') ?? ''))) ?: null,
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

    /** Built-in task-form fields the admin can mark mandatory (title is always required). */
    private const TASK_CONFIGURABLE_REQUIRED_FIELDS = ['description', 'assigned_to', 'due_date', 'start_date', 'priority', 'type'];

    /** Human labels for the configurable task fields, used in validation messages. */
    private const TASK_REQUIRED_FIELD_LABELS = [
        'description' => 'Description',
        'assigned_to' => 'Assignee',
        'due_date'    => 'Due date',
        'start_date'  => 'Start date',
        'priority'    => 'Priority',
        'type'        => 'Type',
    ];

    /** Allowed custom-field input types. */
    private const TASK_CUSTOM_FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select'];

    /** Built-in task fields this client has marked mandatory on the task form. */
    private function taskRequiredFields(): array
    {
        $keys = json_decode((string) ($this->settingsMap()['task_required_fields'] ?? '[]'), true);

        return is_array($keys)
            ? array_values(array_intersect(array_map('strval', $keys), self::TASK_CONFIGURABLE_REQUIRED_FIELDS))
            : [];
    }

    /** The client's admin-defined custom task fields (sanitized definitions). */
    private function taskCustomFields(): array
    {
        $defs = json_decode((string) ($this->settingsMap()['task_custom_fields'] ?? '[]'), true);
        if (! is_array($defs)) {
            return [];
        }
        $out = [];
        foreach ($defs as $d) {
            if (! is_array($d) || trim((string) ($d['label'] ?? '')) === '') {
                continue;
            }
            $type = in_array($d['type'] ?? 'text', self::TASK_CUSTOM_FIELD_TYPES, true) ? $d['type'] : 'text';
            $key  = preg_replace('/[^a-z0-9_]/', '', strtolower((string) ($d['key'] ?? '')));
            if ($key === '') {
                continue;
            }
            $out[] = [
                'key'      => $key,
                'label'    => (string) $d['label'],
                'type'     => $type,
                'required' => ! empty($d['required']),
                'options'  => ($type === 'select' && is_array($d['options'] ?? null))
                    ? array_values(array_filter(array_map(static fn ($o) => trim((string) $o), $d['options']), static fn ($o) => $o !== ''))
                    : [],
            ];
        }

        return $out;
    }

    /** Pull + sanitize the custom-field values from request input, keyed by field key. */
    private function taskCustomValues(array $in): array
    {
        $raw = $in['custom_fields'] ?? [];
        if (is_string($raw)) {
            $raw = json_decode($raw, true) ?: [];
        }
        if (! is_array($raw)) {
            $raw = [];
        }
        $out = [];
        foreach ($this->taskCustomFields() as $f) {
            if (! array_key_exists($f['key'], $raw)) {
                continue;
            }
            $v = $raw[$f['key']];
            $out[$f['key']] = $f['type'] === 'number'
                ? (($v === '' || $v === null) ? '' : (string) (0 + $v))
                : trim((string) $v);
        }

        return $out;
    }

    /** Validation errors for the configured-mandatory built-in + custom task fields. */
    private function taskFieldErrors(array $data, array $customValues): array
    {
        $errors = [];
        foreach ($this->taskRequiredFields() as $key) {
            $val = $data[$key] ?? null;
            if ($val === null || $val === '' || $val === 0) {
                $errors[$key] = (self::TASK_REQUIRED_FIELD_LABELS[$key] ?? $key) . ' is required.';
            }
        }
        foreach ($this->taskCustomFields() as $f) {
            if (! empty($f['required'])) {
                $v = $customValues[$f['key']] ?? null;
                if ($v === null || $v === '') {
                    $errors['custom_' . $f['key']] = $f['label'] . ' is required.';
                }
            }
        }

        return $errors;
    }

    /** GET /client/task-setup — required-field flags + custom-field definitions. */
    public function taskSetup()
    {
        if ($resp = $this->requirePermission('tasks')) {
            return $resp;
        }

        return $this->respond([
            'required_fields' => $this->taskRequiredFields(),
            'custom_fields'   => $this->taskCustomFields(),
        ]);
    }

    /** POST /client/task-field-settings — save mandatory flags + custom-field definitions (admin). */
    public function saveTaskFieldSettings()
    {
        if ($resp = $this->denyUnlessPerm('tasks', 'update')) {
            return $resp;
        }
        $in = (array) $this->input();

        $required = is_array($in['required_fields'] ?? null)
            ? array_values(array_intersect(array_map('strval', $in['required_fields']), self::TASK_CONFIGURABLE_REQUIRED_FIELDS))
            : [];

        $custom = [];
        $seen   = [];
        foreach ((array) ($in['custom_fields'] ?? []) as $d) {
            if (! is_array($d)) {
                continue;
            }
            $label = trim((string) ($d['label'] ?? ''));
            if ($label === '') {
                continue;
            }
            $base = preg_replace('/[^a-z0-9_]/', '', strtolower(str_replace([' ', '-'], '_', (string) (($d['key'] ?? '') ?: $label))));
            $key  = $base !== '' ? $base : 'field';
            while (isset($seen[$key])) {
                $key .= '_';
            }
            $seen[$key] = true;
            $type = in_array($d['type'] ?? 'text', self::TASK_CUSTOM_FIELD_TYPES, true) ? $d['type'] : 'text';
            $custom[] = [
                'key'      => $key,
                'label'    => $label,
                'type'     => $type,
                'required' => ! empty($d['required']),
                'options'  => ($type === 'select' && is_array($d['options'] ?? null))
                    ? array_values(array_filter(array_map(static fn ($o) => trim((string) $o), $d['options']), static fn ($o) => $o !== ''))
                    : [],
            ];
        }

        $this->setSetting('task_required_fields', json_encode($required));
        $this->setSetting('task_custom_fields', json_encode($custom));
        $this->logActivity('updated', 'settings', null, 'Updated task form fields', $this->clientId());

        return $this->respond([
            'message'         => 'Saved',
            'required_fields' => $required,
            'custom_fields'   => $this->taskCustomFields(),
        ]);
    }

    // --- Task stages (kanban columns) ------------------------------------

    /** The default board columns provisioned for a client on first use. */
    private const DEFAULT_TASK_STAGES = [
        ['key' => 'open',        'name' => 'Backlog',     'color' => 'slate',   'is_done' => 0, 'is_system' => 1],
        ['key' => 'in_progress', 'name' => 'In Progress', 'color' => 'indigo',  'is_done' => 0, 'is_system' => 0],
        ['key' => 'in_review',   'name' => 'In Review',   'color' => 'amber',   'is_done' => 0, 'is_system' => 0],
        ['key' => 'done',        'name' => 'Done',        'color' => 'emerald', 'is_done' => 1, 'is_system' => 1],
    ];

    /**
     * This client's kanban stages, ordered. Seeds the defaults the first time a
     * client opens the board so existing tenants gain stages without a data
     * migration. Returns rows with ints/bools normalised for the API.
     */
    private function taskStages(int $cid): array
    {
        $model = new TaskStageModel();
        $rows  = $model->where('client_id', $cid)->orderBy('sequence', 'ASC')->orderBy('id', 'ASC')->findAll();

        if (! $rows) {
            foreach (self::DEFAULT_TASK_STAGES as $i => $s) {
                $model->insert($s + ['client_id' => $cid, 'sequence' => $i]);
            }
            $rows = $model->where('client_id', $cid)->orderBy('sequence', 'ASC')->orderBy('id', 'ASC')->findAll();
        }

        foreach ($rows as &$r) {
            $r['id']        = (int) $r['id'];
            $r['sequence']  = (int) $r['sequence'];
            $r['is_done']   = ! empty($r['is_done']);
            $r['is_system'] = ! empty($r['is_system']);
        }
        unset($r);

        return $rows;
    }

    /** GET /client/task-stages */
    public function taskStagesList()
    {
        if ($resp = $this->requirePermission('tasks')) {
            return $resp;
        }

        return $this->respond(['stages' => $this->taskStages($this->clientId())]);
    }

    /** Build a unique slug key for a new stage from its name. */
    private function taskStageKey(int $cid, string $name): string
    {
        $base = preg_replace('/[^a-z0-9_]/', '', strtolower(str_replace([' ', '-'], '_', $name)));
        $base = trim((string) $base, '_') ?: 'stage';
        $model = new TaskStageModel();
        $key   = $base;
        $n     = 1;
        while ($model->where('client_id', $cid)->where('key', $key)->first()) {
            $key = $base . '_' . (++$n);
        }

        return $key;
    }

    /** POST /client/task-stages — create a board column. */
    public function createTaskStage()
    {
        if ($resp = $this->requirePermission('tasks', 'update')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new TaskStageModel();
        $this->taskStages($cid); // ensure defaults exist before adding

        $name = trim((string) $this->input('name'));
        if ($name === '') {
            return $this->failValidationErrors(['name' => 'A stage name is required.']);
        }
        $max = (int) ($model->where('client_id', $cid)->selectMax('sequence')->first()['sequence'] ?? 0);

        $data = [
            'client_id' => $cid,
            'name'      => $name,
            'key'       => $this->taskStageKey($cid, $name),
            'color'     => trim((string) ($this->input('color') ?? 'slate')) ?: 'slate',
            'is_done'   => $this->input('is_done') ? 1 : 0,
            'is_system' => 0,
            'sequence'  => $max + 1,
        ];
        $id = $model->insert($data);
        if ($id === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('created', 'task_stage', (int) $id, 'Added task stage ' . $name);

        return $this->respondCreated(['message' => 'Created', 'id' => $id]);
    }

    /** POST /client/task-stages/{id} — rename / recolour / toggle done. Key is immutable. */
    public function updateTaskStage(int $id)
    {
        if ($resp = $this->requirePermission('tasks', 'update')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new TaskStageModel();
        $row   = $model->where('client_id', $cid)->find($id);
        if (! $row) {
            return $this->failNotFound('Stage not found');
        }

        $name = trim((string) $this->input('name'));
        if ($name === '') {
            return $this->failValidationErrors(['name' => 'A stage name is required.']);
        }
        $data = [
            'name'  => $name,
            'color' => trim((string) ($this->input('color') ?? 'slate')) ?: 'slate',
        ];
        // System stages (entry/terminal) keep their done semantics fixed.
        if (empty($row['is_system'])) {
            $data['is_done'] = $this->input('is_done') ? 1 : 0;
        }
        if ($model->update($id, $data) === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('updated', 'task_stage', $id, 'Updated task stage ' . $name);

        return $this->respond(['message' => 'Updated']);
    }

    /** POST /client/task-stages/{id}/delete — blocked for system stages or while in use. */
    public function deleteTaskStage(int $id)
    {
        if ($resp = $this->requirePermission('tasks', 'update')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new TaskStageModel();
        $row   = $model->where('client_id', $cid)->find($id);
        if (! $row) {
            return $this->failNotFound('Stage not found');
        }
        if (! empty($row['is_system'])) {
            return $this->failValidationErrors(['stage' => 'The entry and Done stages cannot be deleted.']);
        }
        $inUse = (new ClientTaskModel())->where('client_id', $cid)->where('status', $row['key'])->countAllResults();
        if ($inUse > 0) {
            return $this->failValidationErrors(['stage' => "Move the {$inUse} task(s) in this stage before deleting it."]);
        }
        $model->delete($id);
        $this->logActivity('deleted', 'task_stage', $id, 'Deleted task stage ' . ($row['name'] ?? ''));

        return $this->respond(['message' => 'Deleted']);
    }

    /** POST /client/task-stages/reorder — `order` is stage ids in their new order. */
    public function reorderTaskStages()
    {
        if ($resp = $this->requirePermission('tasks', 'update')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $order = (array) ($this->input('order') ?? []);
        $model = new TaskStageModel();
        foreach ($order as $i => $rowId) {
            $model->where('client_id', $cid)->update((int) $rowId, ['sequence' => (int) $i]);
        }

        return $this->respond(['message' => 'Reordered']);
    }

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
            $t['custom_fields']  = is_array($cf = json_decode((string) ($t['custom_fields'] ?? ''), true)) ? $cf : [];
        }
        unset($t);

        return $this->respond([
            'tasks'    => $tasks,
            'summary'  => $this->taskSummary($tasks),
            'stages'   => $this->taskStages($cid),
        ]);
    }

    /** POST /client/tasks */
    public function createTask()
    {
        if ($resp = $this->requirePermission('tasks', 'create')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new ClientTaskModel();
        $data  = $this->taskData($cid);

        // Custom fields + mandatory-field enforcement (built-in + custom).
        $customValues          = $this->taskCustomValues((array) $this->input());
        $data['custom_fields'] = json_encode($customValues);
        if ($errs = $this->taskFieldErrors($data, $customValues)) {
            return $this->failValidationErrors($errs);
        }

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
        if ($resp = $this->requirePermission('tasks', 'update')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new ClientTaskModel();
        $before = $model->where('client_id', $cid)->find($id);
        if (! $before) {
            return $this->failNotFound('Task not found');
        }

        $in   = (array) $this->input();
        $data = $this->taskData($cid, true);

        // Custom fields — only touched when the form sends them (board moves don't).
        if (array_key_exists('custom_fields', $in)) {
            $customValues          = $this->taskCustomValues($in);
            $data['custom_fields'] = json_encode($customValues);
        } else {
            $customValues = is_array($cf = json_decode((string) ($before['custom_fields'] ?? ''), true)) ? $cf : [];
        }

        // Enforce mandatory fields only on a full form edit (title present), so a
        // status-only board move never trips the required-field validation.
        if (array_key_exists('title', $in)) {
            if ($errs = $this->taskFieldErrors(array_merge($before, $data), $customValues)) {
                return $this->failValidationErrors($errs);
            }
        }

        // Record who made this change.
        $data['updated_by']      = $this->actorId();
        $data['updated_by_name'] = $this->actorName();

        // On-time tracking: stamp completion when entering a done stage, clear
        // when it leaves one (re-opened).
        if (isset($data['status']) && $data['status'] !== $before['status']) {
            $done    = $this->doneTaskStageKeys($cid);
            $nowDone = in_array($data['status'], $done, true);
            $wasDone = in_array((string) $before['status'], $done, true);
            if ($nowDone && ! $wasDone) {
                $data['completed_at'] = date('Y-m-d H:i:s');
            } elseif ($wasDone && ! $nowDone) {
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
        if ($resp = $this->requirePermission('tasks')) {
            return $resp;
        }
        $cid = $this->clientId();
        $t   = (new ClientTaskModel())->where('client_id', $cid)->find($id);
        if (! $t) {
            return $this->failNotFound('Task not found');
        }
        $t['assignee_name'] = $t['assigned_to'] ? $this->staffName((int) $t['assigned_to']) : null;
        $t['overdue']       = $this->isOverdue($t);
        $t['custom_fields'] = is_array($cf = json_decode((string) ($t['custom_fields'] ?? ''), true)) ? $cf : [];

        return $this->respond(['task' => $t]);
    }

    /** GET /client/tasks/{id}/comments — the discussion thread, oldest first. */
    public function taskComments(int $id)
    {
        if ($resp = $this->requirePermission('tasks')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('tasks', 'update')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('tasks', 'update')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('tasks')) {
            return $resp;
        }
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

        // Optional filters (mirror the Leads filter drawer): text search, audience,
        // pinned / acknowledgement flags and a created-date range. All AND together.
        $q        = trim((string) ($this->request->getGet('q') ?? ''));
        $audience = array_values(array_intersect(
            array_filter(array_map('trim', explode(',', (string) ($this->request->getGet('audience') ?? '')))),
            ['all', 'department', 'staff'],
        ));
        $from = trim((string) ($this->request->getGet('from') ?? ''));
        $to   = trim((string) ($this->request->getGet('to') ?? ''));

        $builder = (new AnnouncementModel())->where('client_id', $cid);
        if ($q !== '') {
            $builder->groupStart()->like('title', $q)->orLike('body', $q)->groupEnd();
        }
        if ($audience) {
            $builder->whereIn('audience', $audience);
        }
        if ($this->request->getGet('pinned') === '1') {
            $builder->where('pinned', 1);
        }
        if ($this->request->getGet('require_ack') === '1') {
            $builder->where('require_ack', 1);
        }
        if ($from !== '') {
            $builder->where('created_at >=', $from . ' 00:00:00');
        }
        if ($to !== '') {
            $builder->where('created_at <=', $to . ' 23:59:59');
        }

        // Pinned first, then newest — paginated for infinite scroll.
        $rows = $builder->orderBy('pinned', 'DESC')->orderBy('id', 'DESC')->findAll($limit, $offset);

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
        if ($resp = $this->requirePermission('announcements', 'create')) {
            return $resp;
        }
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
            'body'        => HtmlSanitizer::clean(trim((string) $this->input('body'))) ?: null,
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
        if ($resp = $this->requirePermission('announcements', 'delete')) {
            return $resp;
        }
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
    /**
     * The id used to track who has read an announcement in the client panel:
     * a staff member's own id, or 0 for the client admin (account owner), who
     * sees every announcement.
     */
    private function announcementViewerId(): int
    {
        return $this->role() === 'staff' ? $this->staffId() : 0;
    }

    /**
     * GET /client/announcements/unread-count — how many announcements the current
     * user can see but hasn't read yet (drives the navbar badge, like the bell).
     */
    public function announcementsUnreadCount()
    {
        if ($resp = $this->requirePermission('announcements')) {
            return $resp;
        }
        $cid    = $this->clientId();
        $viewer = $this->announcementViewerId();
        $staff  = (new ClientStaffModel())->where('client_id', $cid)->findAll();

        $readIds = [];
        foreach ((new AnnouncementReadModel())->where('client_id', $cid)->where('staff_id', $viewer)->findAll() as $r) {
            if (! empty($r['read_at'])) {
                $readIds[(int) $r['announcement_id']] = true;
            }
        }

        $unread = 0;
        foreach ((new AnnouncementModel())->where('client_id', $cid)->findAll() as $a) {
            // Staff only count announcements addressed to them; the admin sees all.
            if ($viewer !== 0 && ! in_array($viewer, $this->announcementRecipientIds($a, $staff), true)) {
                continue;
            }
            if (empty($readIds[(int) $a['id']])) {
                $unread++;
            }
        }

        return $this->respond(['unread' => $unread]);
    }

    /**
     * POST /client/announcements/read-all — mark every announcement the current
     * user can see as read (clears the navbar badge, like "mark all read").
     */
    public function markAllAnnouncementsRead()
    {
        if ($resp = $this->requirePermission('announcements')) {
            return $resp;
        }
        $cid    = $this->clientId();
        $viewer = $this->announcementViewerId();
        $staff  = (new ClientStaffModel())->where('client_id', $cid)->findAll();
        $model  = new AnnouncementReadModel();

        $existing = [];
        foreach ($model->where('client_id', $cid)->where('staff_id', $viewer)->findAll() as $r) {
            $existing[(int) $r['announcement_id']] = $r;
        }

        $now = date('Y-m-d H:i:s');
        foreach ((new AnnouncementModel())->where('client_id', $cid)->findAll() as $a) {
            if ($viewer !== 0 && ! in_array($viewer, $this->announcementRecipientIds($a, $staff), true)) {
                continue;
            }
            $aid = (int) $a['id'];
            $row = $existing[$aid] ?? null;
            if ($row) {
                if (empty($row['read_at'])) {
                    $model->update($row['id'], ['read_at' => $now]);
                }
            } else {
                $model->insert(['client_id' => $cid, 'announcement_id' => $aid, 'staff_id' => $viewer, 'read_at' => $now]);
            }
        }

        return $this->respond(['message' => 'Marked all read']);
    }

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
            $body = mb_substr($title, 0, 140);
            foreach ($this->announcementRecipientIds($ann, $staff) as $sid) {
                $model->insert([
                    'recipient_type' => 'staff',
                    'recipient_id'   => $sid,
                    'type'           => 'announcement',
                    'title'          => 'New announcement',
                    'body'           => $body,
                    'link'           => '/staff/announcements',
                ]);
                PushService::sendToRecipient($cid, 'staff', (int) $sid, 'New announcement', $body, '/staff/announcements');
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
                'description' => HtmlSanitizer::clean(trim((string) ($in['description'] ?? ''))) ?: null,
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
        if (array_key_exists('description', $in)) $data['description'] = HtmlSanitizer::clean(trim((string) $in['description'])) ?: null;
        if (array_key_exists('assigned_to', $in)) $data['assigned_to'] = (int) $in['assigned_to'] ?: null;
        if (array_key_exists('due_date', $in))    $data['due_date']    = trim((string) $in['due_date']) ?: null;
        if (array_key_exists('start_date', $in))  $data['start_date']  = trim((string) $in['start_date']) ?: null;
        if (array_key_exists('priority', $in))    $data['priority']    = $in['priority'];
        if (array_key_exists('type', $in))        $data['type']        = $in['type'];
        if (array_key_exists('status', $in))      $data['status']      = $in['status'];

        return $data;
    }

    /** A task is overdue when it has a past due date and isn't in a done stage. */
    private function isOverdue(array $task): bool
    {
        if (in_array($task['status'] ?? '', $this->doneTaskStageKeys($this->clientId()), true) || empty($task['due_date'])) {
            return false;
        }

        return substr((string) $task['due_date'], 0, 10) < date('Y-m-d');
    }

    /** Count tasks by bucket for dashboards/headers. */
    private function taskSummary(array $tasks): array
    {
        $s = ['total' => 0, 'open' => 0, 'in_progress' => 0, 'done' => 0, 'overdue' => 0, 'due_today' => 0];
        $today = date('Y-m-d');
        $done  = $this->doneTaskStageKeys($this->clientId());

        foreach ($tasks as $t) {
            $s['total']++;
            $status = $t['status'] ?? 'open';
            $s[$status] = ($s[$status] ?? 0) + 1;
            if ($this->isOverdue($t)) {
                $s['overdue']++;
            }
            if (! in_array($status, $done, true) && ! empty($t['due_date']) && substr((string) $t['due_date'], 0, 10) === $today) {
                $s['due_today']++;
            }
        }

        return $s;
    }

    /** Per-request cache of this client's stage key => display name. */
    private ?array $taskStageLabelCache = null;

    /** Per-request cache of this client's stage keys flagged as "done". */
    private ?array $doneStageKeysCache = null;

    /** The stage keys that count a task as completed (is_done). */
    private function doneTaskStageKeys(int $cid): array
    {
        if ($this->doneStageKeysCache === null) {
            $this->doneStageKeysCache = [];
            foreach ($this->taskStages($cid) as $s) {
                if (! empty($s['is_done'])) {
                    $this->doneStageKeysCache[] = $s['key'];
                }
            }
        }

        return $this->doneStageKeysCache;
    }

    private function statusLabel(string $status): string
    {
        if ($this->taskStageLabelCache === null) {
            $this->taskStageLabelCache = [];
            foreach ($this->taskStages($this->clientId()) as $s) {
                $this->taskStageLabelCache[$s['key']] = $s['name'];
            }
        }

        return $this->taskStageLabelCache[$status] ?? ucfirst(str_replace('_', ' ', $status));
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
            PushService::sendToRecipient($this->clientId(), 'user', (int) $user['id'], $title, $body, $link);
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
            PushService::sendToRecipient($this->clientId(), 'staff', $staffId, $title, $body, $link);
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
                ->whereNotIn('status', $this->doneTaskStageKeys($cid) ?: ['done'])
                ->where('due_date IS NOT NULL')
                ->where('due_date <=', $today . ' 23:59:59')
                ->findAll();

            if (! $tasks) {
                return;
            }

            $model = new AppNotificationModel();
            foreach ($tasks as $t) {
                $link   = '/client/tasks?task=' . $t['id'];
                // Only one due/overdue alert per task per day — checked regardless
                // of read state, so dismissing it doesn't make it regenerate on the
                // next page load. A fresh reminder can still appear the next day.
                $exists = $model
                    ->where('recipient_type', 'user')->where('recipient_id', (int) $user['id'])
                    ->where('type', 'task_due')->where('link', $link)
                    ->where('created_at >=', $today . ' 00:00:00')
                    ->countAllResults();
                if ($exists) {
                    continue;
                }

                $overdue = substr((string) $t['due_date'], 0, 10) < $today;
                $title   = $overdue ? 'Task overdue' : 'Task due today';
                $body    = mb_substr((string) $t['title'], 0, 500);
                $model->insert([
                    'recipient_type' => 'user',
                    'recipient_id'   => (int) $user['id'],
                    'type'           => 'task_due',
                    'title'          => $title,
                    'body'           => $body,
                    'link'           => $link,
                ]);
                PushService::sendToRecipient($cid, 'user', (int) $user['id'], $title, $body, $link);
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

    /** Built-in asset-form fields the admin can mark mandatory (name is always required). */
    private const ASSET_CONFIGURABLE_REQUIRED_FIELDS = ['series_model', 'asset_group', 'managed_by', 'asset_location', 'purchase_date', 'warranty_months', 'unit_price', 'supplier_name'];

    /** Human labels for the configurable asset fields, used in validation messages. */
    private const ASSET_REQUIRED_FIELD_LABELS = [
        'series_model'    => 'Series / model',
        'asset_group'     => 'Asset group',
        'managed_by'      => 'Managed by',
        'asset_location'  => 'Location',
        'purchase_date'   => 'Purchase date',
        'warranty_months' => 'Warranty (months)',
        'unit_price'      => 'Unit price',
        'supplier_name'   => 'Supplier name',
    ];

    /** Built-in asset fields this client has marked mandatory on the asset form. */
    private function assetRequiredFields(): array
    {
        $keys = json_decode((string) ($this->settingsMap()['asset_required_fields'] ?? '[]'), true);

        return is_array($keys)
            ? array_values(array_intersect(array_map('strval', $keys), self::ASSET_CONFIGURABLE_REQUIRED_FIELDS))
            : [];
    }

    /** The client's admin-defined custom asset fields (sanitized definitions). */
    private function assetCustomFields(): array
    {
        $defs = json_decode((string) ($this->settingsMap()['asset_custom_fields'] ?? '[]'), true);
        if (! is_array($defs)) {
            return [];
        }
        $out = [];
        foreach ($defs as $d) {
            if (! is_array($d) || trim((string) ($d['label'] ?? '')) === '') {
                continue;
            }
            $type = in_array($d['type'] ?? 'text', self::TASK_CUSTOM_FIELD_TYPES, true) ? $d['type'] : 'text';
            $key  = preg_replace('/[^a-z0-9_]/', '', strtolower((string) ($d['key'] ?? '')));
            if ($key === '') {
                continue;
            }
            $out[] = [
                'key'      => $key,
                'label'    => (string) $d['label'],
                'type'     => $type,
                'required' => ! empty($d['required']),
                'options'  => ($type === 'select' && is_array($d['options'] ?? null))
                    ? array_values(array_filter(array_map(static fn ($o) => trim((string) $o), $d['options']), static fn ($o) => $o !== ''))
                    : [],
            ];
        }

        return $out;
    }

    /** Pull + sanitize custom asset-field values from request input, keyed by field key. */
    private function assetCustomValues(array $in): array
    {
        $raw = $in['custom_fields'] ?? [];
        if (is_string($raw)) {
            $raw = json_decode($raw, true) ?: [];
        }
        if (! is_array($raw)) {
            $raw = [];
        }
        $out = [];
        foreach ($this->assetCustomFields() as $f) {
            if (! array_key_exists($f['key'], $raw)) {
                continue;
            }
            $v = $raw[$f['key']];
            $out[$f['key']] = $f['type'] === 'number'
                ? (($v === '' || $v === null) ? '' : (string) (0 + $v))
                : trim((string) $v);
        }

        return $out;
    }

    /** Validation errors for the configured-mandatory built-in + custom asset fields. */
    private function assetFieldErrors(array $data, array $customValues): array
    {
        $errors = [];
        foreach ($this->assetRequiredFields() as $key) {
            $val = $data[$key] ?? null;
            if ($val === null || $val === '' || $val === 0) {
                $errors[$key] = (self::ASSET_REQUIRED_FIELD_LABELS[$key] ?? $key) . ' is required.';
            }
        }
        foreach ($this->assetCustomFields() as $f) {
            if (! empty($f['required'])) {
                $v = $customValues[$f['key']] ?? null;
                if ($v === null || $v === '') {
                    $errors['custom_' . $f['key']] = $f['label'] . ' is required.';
                }
            }
        }

        return $errors;
    }

    /** GET /client/asset-setup — required-field flags + custom-field definitions. */
    public function assetSetup()
    {
        if ($resp = $this->requirePermission('assets')) {
            return $resp;
        }

        return $this->respond([
            'required_fields' => $this->assetRequiredFields(),
            'custom_fields'   => $this->assetCustomFields(),
        ]);
    }

    /** POST /client/asset-field-settings — save mandatory flags + custom-field defs (admin). */
    public function saveAssetFieldSettings()
    {
        if ($resp = $this->denyUnlessPerm('assets', 'update')) {
            return $resp;
        }
        $in = (array) $this->input();

        $required = is_array($in['required_fields'] ?? null)
            ? array_values(array_intersect(array_map('strval', $in['required_fields']), self::ASSET_CONFIGURABLE_REQUIRED_FIELDS))
            : [];

        $custom = [];
        $seen   = [];
        foreach ((array) ($in['custom_fields'] ?? []) as $d) {
            if (! is_array($d)) {
                continue;
            }
            $label = trim((string) ($d['label'] ?? ''));
            if ($label === '') {
                continue;
            }
            $base = preg_replace('/[^a-z0-9_]/', '', strtolower(str_replace([' ', '-'], '_', (string) (($d['key'] ?? '') ?: $label))));
            $key  = $base !== '' ? $base : 'field';
            while (isset($seen[$key])) {
                $key .= '_';
            }
            $seen[$key] = true;
            $type = in_array($d['type'] ?? 'text', self::TASK_CUSTOM_FIELD_TYPES, true) ? $d['type'] : 'text';
            $custom[] = [
                'key'      => $key,
                'label'    => $label,
                'type'     => $type,
                'required' => ! empty($d['required']),
                'options'  => ($type === 'select' && is_array($d['options'] ?? null))
                    ? array_values(array_filter(array_map(static fn ($o) => trim((string) $o), $d['options']), static fn ($o) => $o !== ''))
                    : [],
            ];
        }

        $this->setSetting('asset_required_fields', json_encode($required));
        $this->setSetting('asset_custom_fields', json_encode($custom));
        $this->logActivity('updated', 'settings', null, 'Updated asset form fields', $this->clientId());

        return $this->respond([
            'message'         => 'Saved',
            'required_fields' => $required,
            'custom_fields'   => $this->assetCustomFields(),
        ]);
    }

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
            $as['custom_fields']   = is_array($cf = json_decode((string) ($as['custom_fields'] ?? ''), true)) ? $cf : [];
        }

        return $this->respond(['assets' => $assets]);
    }

    /** POST /client/assets — create. */
    public function createAsset()
    {
        if ($resp = $this->requirePermission('assets', 'create')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new AssetModel();
        $code  = trim((string) ($this->input('asset_code') ?? '')) ?: $this->nextAssetCode($cid);

        $data         = $this->assetData($cid) + ['asset_code' => $code];
        $customValues = $this->assetCustomValues((array) $this->input());
        $data['custom_fields'] = json_encode($customValues);
        if ($errs = $this->assetFieldErrors($data, $customValues)) {
            return $this->failValidationErrors($errs);
        }

        $id = $model->insert($data);
        if ($id === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logAsset($cid, (int) $id, 'created', 'Added asset ' . $this->input('name'));

        return $this->respondCreated(['message' => 'Asset created', 'id' => $id]);
    }

    /** POST /client/assets/{id} — update. */
    public function updateAsset(int $id)
    {
        if ($resp = $this->requirePermission('assets', 'update')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new AssetModel();
        $before = $model->where('client_id', $cid)->find($id);
        if (! $before) {
            return $this->failNotFound('Asset not found');
        }
        $in   = (array) $this->input();
        $data = $this->assetData($cid, true);
        if (($code = trim((string) ($this->input('asset_code') ?? ''))) !== '') {
            $data['asset_code'] = $code;
        }

        if (array_key_exists('custom_fields', $in)) {
            $customValues          = $this->assetCustomValues($in);
            $data['custom_fields'] = json_encode($customValues);
        } else {
            $customValues = is_array($cf = json_decode((string) ($before['custom_fields'] ?? ''), true)) ? $cf : [];
        }
        // The asset form always sends `name`; enforce mandatory fields then.
        if (array_key_exists('name', $in)) {
            if ($errs = $this->assetFieldErrors(array_merge($before, $data), $customValues)) {
                return $this->failValidationErrors($errs);
            }
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
        if ($resp = $this->requirePermission('assets', 'update')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('assets', 'update')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('assets', 'update')) {
            return $resp;
        }
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
        if ($resp = $this->requirePermission('assets', 'update')) {
            return $resp;
        }
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
    /** Extensions allowed for client uploads (staff photos, attachments, avatars).
     *  Strictly allow-listed: never executable/script types (.php, .phtml, .svg,
     *  .html, .js, …) so a file dropped in the web-served uploads dir can't run. */
    private const UPLOAD_ALLOWED_EXT = [
        'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp',
        'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'rtf', 'odt', 'ods', 'zip',
    ];

    public function upload()
    {
        $file = $this->request->getFile('file');
        if (! $file || ! $file->isValid()) {
            return $this->failValidationErrors('Please choose a valid file.');
        }
        if ($file->getSize() > 5 * 1024 * 1024) {
            return $this->failValidationErrors('File must be 5MB or smaller.');
        }

        // Whitelist the extension — the saved filename is built from it, so an
        // executable type can never land in the web-served uploads directory.
        $ext = strtolower((string) $file->getClientExtension());
        if ($ext === '' || ! in_array($ext, self::UPLOAD_ALLOWED_EXT, true)) {
            return $this->failValidationErrors('That file type is not allowed. Upload an image or document (PDF, DOC, XLS, CSV, ZIP, …).');
        }

        $uploadDir = FCPATH . 'uploads';
        if (! is_dir($uploadDir)) {
            mkdir($uploadDir, 0775, true);
        }
        $this->protectUploadDir($uploadDir);

        // Deterministic random name with the validated extension (never trust the
        // client-supplied name or a guessed extension).
        $newName = bin2hex(random_bytes(16)) . '.' . $ext;
        $file->move($uploadDir, $newName);

        return $this->respond(['message' => 'Uploaded', 'url' => '/uploads/' . $newName]);
    }

    /** Defense-in-depth: drop an .htaccess that disables script execution in the
     *  uploads dir, so even a misnamed file can never be run by Apache. */
    private function protectUploadDir(string $dir): void
    {
        $htaccess = $dir . DIRECTORY_SEPARATOR . '.htaccess';
        if (is_file($htaccess)) {
            return;
        }
        $rules = "php_flag engine off\n"
            . "AddType text/plain .php .phtml .php3 .php4 .php5 .php7 .phps .pht .phar .cgi .pl .py .sh .asp .aspx .jsp\n"
            . "<IfModule mod_rewrite.c>\nRewriteEngine Off\n</IfModule>\n";
        @file_put_contents($htaccess, $rules);
    }
}
