<?php

namespace App\Controllers;

use App\Libraries\CallIngestService;
use App\Libraries\GmailService;
use App\Libraries\GoogleCalendarService;
use App\Libraries\HtmlSanitizer;
use App\Libraries\MailerService;
use App\Libraries\PasswordPolicy;
use App\Libraries\PushService;
use App\Libraries\SecondaryDb;
use App\Libraries\TenantManager;
use App\Models\ActivityLogModel;
use App\Models\AnnouncementModel;
use App\Models\ApplicantModel;
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
use App\Models\HolidayModel;
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
use App\Models\ShiftModel;
use App\Models\StateModel;
use App\Models\TaskCommentModel;
use App\Models\TaskStageModel;
use App\Models\UserModel;
use App\Models\UserTablePrefModel;
use App\Models\VisitorModel;
use App\Models\VisitorStatusModel;
use App\Models\VisitorTypeModel;
use App\Models\WebFormIndexModel;
use App\Models\WebFormModel;

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
        // Surface & table colours (light mode) — hex, validated as colours below.
        'panel_bg'        => '#f8fafc',    // page background behind the cards
        'surface_bg'      => '#ffffff',    // cards / topbar / table / filter panel
        'sidebar_bg'      => '#ffffff',    // left navigation menu background
        'sidebar_text'    => '#475569',    // inactive sidebar item text
        'sidebar_icon'    => '#94a3b8',    // sidebar menu icon colour (inactive)
        'table_header_bg' => '#f8fafc',    // data-table header row
        'table_accent'    => '#6366f1',    // table hover / selection / sort / links
    ];

    /** Allowed loading-animation styles for the loader_style setting. */
    public const LOADER_STYLES = ['spinner', 'ring', 'dots', 'bars', 'pulse', 'grid'];

    /** Branding keys validated as hex colours (run through sanitizeHexColor). */
    public const BRANDING_COLOR_KEYS = ['brand_color', 'panel_bg', 'surface_bg', 'sidebar_bg', 'sidebar_text', 'sidebar_icon', 'table_header_bg', 'table_accent'];

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

    /**
     * The normalized phone numbers of every lead the current user can see (reference
     * or assignment scope). Used to scope call stats to "my leads' calls". Returns
     * an empty array when the user can see no leads (→ zero calls).
     */
    private function visibleLeadPhones(): array
    {
        $lq = (new LeadModel())->select('phone, alt_phone')->where('client_id', $this->clientId());
        $this->applyLeadScope($lq);
        $out = [];
        foreach ($lq->findAll() as $l) {
            foreach ([$l['phone'] ?? '', $l['alt_phone'] ?? ''] as $p) {
                $k = CallIngestService::normalizePhone((string) $p);
                if ($k !== '') {
                    $out[$k] = true;
                }
            }
        }

        return array_keys($out);
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
     *   - admin             → no restriction
     *   - reference "agent" → leads with the matching reference_name OR assigned to them
     *   - everyone else      → only leads assigned to them or their reports
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
            // stay visible to their agent. An agent ALSO sees leads assigned to
            // them directly (assignation), not only their reference leads.
            $refId = $this->currentReferenceId();
            $sid   = $this->staffId();
            $q->groupStart();
            if ($refId) {
                $q->where('reference_id', $refId)->orWhere('reference_name', $refName);
            } else {
                $q->where('reference_name', $refName);
            }
            if ($sid) {
                $q->orWhere('assigned_to', $sid);
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
            if (trim((string) ($lead['reference_name'] ?? '')) === $refName) {
                return true;
            }
            // An agent also owns leads assigned directly to them.
            $sid = $this->staffId();

            return $sid > 0 && (int) ($lead['assigned_to'] ?? 0) === $sid;
        }
        $sid   = $this->staffId();
        $scope = $sid ? (new ClientStaffModel())->subordinateIds($this->clientId(), $sid) : [0];

        return in_array((int) ($lead['assigned_to'] ?? 0), $scope, true);
    }

    /**
     * Whether the current user may run a lead-linked action (log a visitor,
     * start a transfer) on this lead. Same as canSeeLead EXCEPT that a
     * reference "agent" is limited to their REFERENCE leads only — leads merely
     * assigned to them (which they can see in the list) are NOT actionable here.
     */
    private function canActOnReferenceLead(array $lead): bool
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

        // Non-agent staff: fall back to normal visibility (assignment/reports).
        return $this->canSeeLead($lead);
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
            // The agent's own reference, so the UI can tell reference leads (which
            // an agent may transfer / log a visitor for) apart from leads merely
            // assigned to them (visible, but not actionable for those features).
            'reference_id'   => $this->currentReferenceId(),
            'reference_name' => $this->currentReferenceName(),
            'role'        => $this->role(),
            'permissions' => $this->effectivePermissions(),
            'modules'     => self::MODULES,
            // Impersonation banner: surface both the super-admin "login as client"
            // state and a client admin "view as team member" state. The kind lets
            // the frontend show the right message and exit to the right place.
            'impersonating'     => ! empty($u['impersonated_by']),
            'impersonator_name' => $u['impersonated_by'] ?? null,
            'client_name'       => $u['client_name'] ?? null,
            'impersonation_kind' => ! empty($u['impersonated_by']) ? ($this->role() === 'staff' ? 'staff' : 'client') : null,
        ]);
    }

    /**
     * POST /client/staff/{id}/login-as — a client admin steps into one of their
     * team member's shoes to see the dashboard exactly as that staff user does
     * (their permissions, their scoped data). The admin's own session is stashed
     * under `impersonator` and restored via POST /auth/stop-impersonation.
     *
     * Guards: only a real client admin may do this (not staff, not agents), only
     * for a staff member of their own workspace, and never while already
     * impersonating — nesting would strand the outer session.
     */
    public function loginAsStaff(int $staffId)
    {
        if ($this->role() !== 'client_admin') {
            return $this->failForbidden('Only an administrator can view a team member\'s profile.');
        }
        if ($this->session->get('impersonator')) {
            return $this->fail('You are already viewing as another user. Exit first.', 409);
        }

        $clientId = $this->clientId();
        $staff    = (new ClientStaffModel())->where('client_id', $clientId)->find($staffId);
        if (! $staff) {
            return $this->failNotFound('Team member not found.');
        }
        if (($staff['status'] ?? 'active') !== 'active') {
            return $this->fail('This team member is inactive and cannot be viewed.', 422);
        }

        // Resolve their login email from the main-DB account index (a member may
        // exist without a login), falling back to the profile email.
        $account = (new StaffAccountModel())->where('client_id', $clientId)->where('staff_id', $staffId)->first();
        $email   = $account['email'] ?? ($staff['email'] ?? null);

        $admin = $this->currentUser();
        $this->session->set('impersonator', $admin);
        $this->session->set('user', [
            'id'              => $staffId,
            'email'           => $email,
            'role'            => 'staff',
            'client_id'       => $clientId,
            'staff_id'        => $staffId,
            'role_id'         => isset($staff['role_id']) && $staff['role_id'] !== null ? (int) $staff['role_id'] : null,
            'name'            => $staff['name'] ?? $email,
            'impersonated_by' => $admin['name'] ?? 'Administrator',
            'client_name'     => $admin['client_name'] ?? null,
        ]);
        $this->logActivity('login', 'session', $staffId, 'Admin viewed team member "' . ($staff['name'] ?? $staffId) . '" profile', $clientId);

        return $this->respond(['ok' => true]);
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
        'applicant-tracker',
        // Per-section filter-layout keys (shared bucket = admin's client-wide
        // filter order/placement; per-user bucket = that user's show/hide).
        'followups_filters', 'calls_filters', 'calls_log_filters', 'tasks_filters', 'team_filters',
        'assets_filters', 'reports_filters', 'announcements_filters',
        'visitors_filters', 'transfers_filters', 'applicant_filters',
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

        // shared=1 → the CLIENT-WIDE layout (stored under user 0), so the admin's
        // arrangement applies to everyone; otherwise the caller's own layout.
        $uid    = $this->request->getGet('shared') === '1' ? 0 : $this->userId();
        $row    = (new UserTablePrefModel())->forUser($this->clientId(), $uid, $key);
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

        // A client-wide (shared) layout may only be changed by the client admin.
        $shared = $this->request->getGet('shared') === '1';
        if ($shared && ! $this->isAdmin()) {
            return $this->fail('Only the client admin can change the shared layout.', 403);
        }

        $model = new UserTablePrefModel();
        $cid   = $this->clientId();
        $uid   = $shared ? 0 : $this->userId();
        $json  = json_encode($config);

        $existing = $model->forUser($cid, $uid, $key);
        if ($existing) {
            $model->skipValidation(true)->update($existing['id'], ['config' => $json]);
        } else {
            // skipValidation so the shared bucket (user_id 0) is allowed.
            $model->skipValidation(true)->insert(['client_id' => $cid, 'user_id' => $uid, 'table_key' => $key, 'config' => $json]);
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
            } elseif (in_array($key, self::BRANDING_COLOR_KEYS, true)) {
                // Each colour key falls back to its own default (not the brand green).
                $value = $this->sanitizeHexColor((string) $value, (string) $_default);
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

    /** Validate a #rrggbb colour, falling back to $fallback (default: brand colour). */
    private function sanitizeHexColor(string $hex, ?string $fallback = null): string
    {
        $hex = trim($hex);

        return preg_match('/^#[0-9a-fA-F]{6}$/', $hex) === 1
            ? strtolower($hex)
            : ($fallback ?? self::BRANDING_DEFAULTS['brand_color']);
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

    /**
     * GET /client/leads — one page of this client's leads (server-side paginated,
     * filtered, sorted). Scales to lakhs of rows: SQL does WHERE/ORDER BY/LIMIT and
     * returns the total count; only the page's rows are name-decorated. Query
     * params: page, per_page, sort, dir, q, and the filters (status, sub, source,
     * lead_type, reference, assigned, follow_status, created/assigned/follow ranges).
     */
    public function leads()
    {
        if ($resp = $this->requirePermission('leads')) {
            return $resp;
        }
        $cid = $this->clientId();
        $q   = (new LeadModel())->where('client_id', $cid);

        // Hide leads that are mid-transfer awaiting admin approval (from everyone).
        $q->where('(pending_transfer IS NULL OR pending_transfer = 0)');

        // Staff visibility scope + the request's filters (all applied in SQL).
        $this->applyLeadScope($q);
        $this->applyLeadFilters($q);

        // Total matching count (before paging) — drives the page bar.
        $total = $q->countAllResults(false);

        // Ordering (admin whole-team default + column asc/desc header toggle).
        [$col, $dir] = $this->leadSortColumn($this->request->getGet('sort'), $this->request->getGet('dir'));
        $q->orderBy($col, $dir);
        if ($col !== 'id') {
            $q->orderBy('id', 'DESC'); // stable tiebreak
        }

        // Page window.
        $perPage = max(1, min(200, (int) ($this->request->getGet('per_page') ?: 50)));
        $page    = max(1, (int) ($this->request->getGet('page') ?: 1));
        $rows    = $q->findAll($perPage, ($page - 1) * $perPage);

        $statusNames = $this->idNameMap($this->lookupRows(LeadStatusModel::class, $cid));
        $staffNames  = $this->idNameMap((new ClientStaffModel())->where('client_id', $cid)->findAll());
        $sourceNames = $this->idNameMap($this->lookupRows(LeadSourceModel::class, $cid));
        $typeNames   = $this->idNameMap($this->lookupRows(LeadTypeModel::class, $cid));
        $refNames    = $this->idNameMap($this->lookupRows(LeadReferenceModel::class, $cid));

        // Only load the reminders/notes/calls for THIS page's leads/phones (keeps
        // decoration cheap regardless of table size).
        $pageIds    = array_values(array_filter(array_map(static fn ($r) => (int) $r['id'], $rows)));
        $pagePhones = [];
        foreach ($rows as $r) {
            foreach ([(string) ($r['phone'] ?? ''), (string) ($r['alt_phone'] ?? '')] as $p) {
                if ($p !== '') {
                    $pagePhones[$p] = true;
                }
            }
        }
        $pagePhones = array_keys($pagePhones);

        $remindersByLead = [];
        if ($pageIds) {
            foreach ((new LeadReminderModel())->select('lead_id, remind_at')->where('client_id', $cid)->whereIn('lead_id', $pageIds)->findAll() as $row) {
                $remindersByLead[(int) $row['lead_id']][] = $row['remind_at'];
            }
        }
        $notesByLead = [];
        if ($pageIds) {
            foreach ((new LeadNoteModel())->select('lead_id, created_at')->where('client_id', $cid)->whereIn('lead_id', $pageIds)->findAll() as $row) {
                $notesByLead[(int) $row['lead_id']][] = $row['created_at'];
            }
        }
        // Calls per phone (matched by contact): latest of any status → "Last call";
        // latest connected → "Last connected"; connected times → follow-up flag.
        $lastCallByPhone = [];
        $lastConnByPhone = [];
        $connTimesByPhone = [];
        $callCountByPhone = [];      // total calls per number (any staff, any status)
        $callCountByPhoneStaff = []; // calls per number, per calling staff id
        $durByPhone       = [];      // total talk seconds per number (any staff)
        $durByPhoneStaff  = [];      // talk seconds per number, per calling staff id
        if ($pagePhones) {
            foreach ((new CallLogModel())->select('contact, call_start, connected, staff_id, duration')->where('client_id', $cid)->whereIn('contact', $pagePhones)->findAll() as $row) {
                $k = (string) ($row['contact'] ?? '');
                if ($k === '') {
                    continue;
                }
                // Total call count is by phone number only — independent of the
                // lead link or who the lead is assigned to.
                $callCountByPhone[$k] = ($callCountByPhone[$k] ?? 0) + 1;
                $dur = (int) ($row['duration'] ?? 0);
                $durByPhone[$k] = ($durByPhone[$k] ?? 0) + $dur;
                $sid = (int) ($row['staff_id'] ?? 0);
                if ($sid > 0) {
                    $callCountByPhoneStaff[$k][$sid] = ($callCountByPhoneStaff[$k][$sid] ?? 0) + 1;
                    $durByPhoneStaff[$k][$sid]       = ($durByPhoneStaff[$k][$sid] ?? 0) + $dur;
                }
                if ($row['call_start'] === null) {
                    continue;
                }
                if (! isset($lastCallByPhone[$k]) || $row['call_start'] > $lastCallByPhone[$k]) {
                    $lastCallByPhone[$k] = $row['call_start'];
                }
                if ((int) $row['connected']) {
                    $connTimesByPhone[$k][] = $row['call_start'];
                    if (! isset($lastConnByPhone[$k]) || $row['call_start'] > $lastConnByPhone[$k]) {
                        $lastConnByPhone[$k] = $row['call_start'];
                    }
                }
            }
        }
        $today = date('Y-m-d'); // IST (app timezone)
        // Optional "Reporting Person": when a staff id is passed, the per-lead
        // person call-count/duration columns reflect THAT person's own calls
        // instead of the lead's assigned rep. It does NOT filter which leads show.
        $reportPerson = (int) ($this->request->getGet('report_person') ?: 0);

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
            $ph  = (string) ($r['phone'] ?? '');
            $alt = (string) ($r['alt_phone'] ?? '');
            $connCalls = array_merge(
                $connTimesByPhone[$ph] ?? [],
                $alt !== '' ? ($connTimesByPhone[$alt] ?? []) : [],
            );
            $r['follow_flag']      = $this->followFlag($r['follow_date'], $rem, $notesByLead[(int) $r['id']] ?? [], $connCalls, $today);
            // "Last call" = latest call of any status; "Last connected" = latest answered call.
            $r['last_call_at']      = $this->laterOf($lastCallByPhone[$ph] ?? null, $alt !== '' ? ($lastCallByPhone[$alt] ?? null) : null);
            $r['last_connected_at'] = $this->laterOf($lastConnByPhone[$ph] ?? null, $alt !== '' ? ($lastConnByPhone[$alt] ?? null) : null);
            // Call counts on this lead's number(s): total = all calls (any staff);
            // assigned = only calls made by the lead's assigned staff.
            $nums       = array_values(array_unique(array_filter([$ph, $alt !== '' && $alt !== $ph ? $alt : null])));
            $assignedTo = (int) ($r['assigned_to'] ?? 0);
            // Local call-count accumulators — must NOT reuse $total, which holds the
            // page-bar lead count set above and is returned in the response.
            $callTotal    = 0;
            $callAssigned = 0;
            $durTotal     = 0;
            // The "contribution" person for the dynamic columns: the selected
            // reporting person if one is chosen, else this lead's assigned rep.
            $person       = $reportPerson > 0 ? $reportPerson : $assignedTo;
            $personCalls  = 0;
            $personDur    = 0;
            foreach ($nums as $n) {
                $callTotal    += $callCountByPhone[$n] ?? 0;
                $durTotal     += $durByPhone[$n] ?? 0;
                $callAssigned += $assignedTo > 0 ? ($callCountByPhoneStaff[$n][$assignedTo] ?? 0) : 0;
                if ($person > 0) {
                    $personCalls += $callCountByPhoneStaff[$n][$person] ?? 0;
                    $personDur   += $durByPhoneStaff[$n][$person] ?? 0;
                }
            }
            $r['call_count']           = $callTotal;         // Total Calls (all callers)
            $r['assigned_call_count']  = $callAssigned;      // legacy "Assigned calls" column
            $r['total_duration']       = $durTotal;          // Total Duration seconds (all callers)
            $r['person_call_count']    = $personCalls;       // Call Count (reporting person, else assigned)
            $r['person_call_duration'] = $personDur;         // Duration seconds (reporting person, else assigned)
            $r['custom_fields']    = $this->decodeCustom($r['custom_fields'] ?? null);
        }
        unset($r);

        return $this->respond([
            'leads'    => $rows,
            'total'    => $total,
            'page'     => $page,
            'per_page' => $perPage,
        ]);
    }

    /**
     * Apply the request's lead filters to a query/builder (used by the paged list
     * AND the analytics summary, so both reflect the same filtered set). All
     * comma-separated params. The follow-up-status filter is derived in SQL via
     * EXISTS on notes/calls so it works under server-side paging.
     */
    private function applyLeadFilters($q): void
    {
        $get  = fn (string $k): string => trim((string) ($this->request->getGet($k) ?? ''));
        $ids  = fn (string $k): array => array_values(array_filter(array_map('intval', explode(',', $get($k))), static fn ($v) => $v > 0));
        $strs = fn (string $k): array => array_values(array_filter(array_map('trim', explode(',', $get($k))), static fn ($v) => $v !== ''));

        if (($search = $get('q')) !== '') {
            $q->groupStart()
                ->like('name', $search)->orLike('phone', $search)->orLike('email', $search)
                ->orLike('city', $search)->orLike('state', $search)
                ->groupEnd();
        }
        if ($v = $ids('status')) {
            $q->whereIn('status_id', $v);
        }
        if ($v = $ids('sub')) {
            $q->whereIn('sub_status_id', $v);
        }
        if ($v = $ids('source')) {
            $q->whereIn('source_id', $v);
        }
        if ($v = $ids('lead_type')) {
            $q->whereIn('lead_type_id', $v);
        }
        if ($v = $strs('reference')) {
            $q->whereIn('reference_name', $v);
        }
        // Assignee: staff ids plus the literal "unassigned".
        $assigned = $strs('assigned');
        if ($assigned) {
            $staffIds = array_values(array_filter(array_map('intval', $assigned), static fn ($x) => $x > 0));
            $q->groupStart();
            if ($staffIds) {
                $q->whereIn('assigned_to', $staffIds);
            }
            if (in_array('unassigned', $assigned, true)) {
                $q->orWhere('assigned_to IS NULL', null, false);
            }
            $q->groupEnd();
        }
        // Date ranges (from/to). created_at + assigned_date are DATETIME; follow_date DATE.
        if (($f = $get('created_from')) !== '') {
            $q->where('created_at >=', $f . ' 00:00:00');
        }
        if (($f = $get('created_to')) !== '') {
            $q->where('created_at <=', $f . ' 23:59:59');
        }
        if (($f = $get('assigned_from')) !== '') {
            $q->where('assigned_date >=', $f . ' 00:00:00');
        }
        if (($f = $get('assigned_to_date')) !== '') {
            $q->where('assigned_date <=', $f . ' 23:59:59');
        }
        if (($f = $get('follow_from')) !== '') {
            $q->where('follow_date >=', $f);
        }
        if (($f = $get('follow_to')) !== '') {
            $q->where('follow_date <=', $f);
        }
        // "Updated date" = by CALL date: keep leads that have at least one call
        // (matched by contact = phone/alt_phone) whose call_start is in range.
        $isDate = static fn (string $s): bool => (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $s);
        $uFrom  = $get('updated_from');
        $uTo    = $get('updated_to');
        if (($uFrom !== '' && $isDate($uFrom)) || ($uTo !== '' && $isDate($uTo))) {
            $cw = 'c.deleted_at IS NULL AND (c.contact = leads.phone OR c.contact = leads.alt_phone)';
            if ($uFrom !== '' && $isDate($uFrom)) {
                $cw .= " AND c.call_start >= '{$uFrom} 00:00:00'";
            }
            if ($uTo !== '' && $isDate($uTo)) {
                $cw .= " AND c.call_start <= '{$uTo} 23:59:59'";
            }
            $q->where("EXISTS(SELECT 1 FROM calls c WHERE {$cw})", null, false);
        }

        // "Connected date" range: keep leads that have at least one CONNECTED call
        // (matched by contact = phone/alt_phone) whose call_start is in range.
        $cFrom = $get('connected_from');
        $cTo   = $get('connected_to');
        if (($cFrom !== '' && $isDate($cFrom)) || ($cTo !== '' && $isDate($cTo))) {
            $cc = 'c.deleted_at IS NULL AND c.connected = 1 AND (c.contact = leads.phone OR c.contact = leads.alt_phone)';
            if ($cFrom !== '' && $isDate($cFrom)) {
                $cc .= " AND c.call_start >= '{$cFrom} 00:00:00'";
            }
            if ($cTo !== '' && $isDate($cTo)) {
                $cc .= " AND c.call_start <= '{$cTo} 23:59:59'";
            }
            $q->where("EXISTS(SELECT 1 FROM calls c WHERE {$cc})", null, false);
        }

        // "Ghosted leads": duration since the last CONNECTED call, as a Hours+Mins
        // window (sent as total minutes). Op "gt" (≥) = ghosted (not connected for
        // at least that long, incl. never connected); "lt" (≤) = connected within.
        // NOW() is IST (the session timezone), matching how call_start is stored.
        $ghostMin = (int) $get('ghost_minutes');
        if ($ghostMin > 0) {
            $recent = "EXISTS(SELECT 1 FROM calls c WHERE c.deleted_at IS NULL AND c.connected = 1 "
                    . "AND (c.contact = leads.phone OR c.contact = leads.alt_phone) "
                    . "AND c.call_start >= (NOW() - INTERVAL {$ghostMin} MINUTE))";
            $q->where(($get('ghost_op') === 'lt' ? '' : 'NOT ') . $recent, null, false);
        }

        // Number of calls the lead's ASSIGNED user made to it (by contact), within
        // a [min, max] range — e.g. select 1–3 to see leads their rep called 1–3 times.
        $aMin = $get('acalls_min');
        $aMax = $get('acalls_max');
        if (ctype_digit($aMin) || ctype_digit($aMax)) {
            $cnt = '(SELECT COUNT(*) FROM calls c WHERE c.deleted_at IS NULL AND c.staff_id = leads.assigned_to '
                 . 'AND (c.contact = leads.phone OR c.contact = leads.alt_phone))';
            if (ctype_digit($aMin)) {
                $q->where("{$cnt} >= " . (int) $aMin, null, false);
            }
            if (ctype_digit($aMax)) {
                $q->where("{$cnt} <= " . (int) $aMax, null, false);
            }
        }

        // Total call talk-time (SUM of duration in seconds across the lead's calls,
        // matched by contact) within a [min, max] range. Sent from the "Call talk
        // time" filter as hours+mins collapsed to seconds.
        $tMin = $get('talk_min');
        $tMax = $get('talk_max');
        if (ctype_digit($tMin) || ctype_digit($tMax)) {
            $talk = '(SELECT COALESCE(SUM(c.duration), 0) FROM calls c WHERE c.deleted_at IS NULL '
                  . 'AND (c.contact = leads.phone OR c.contact = leads.alt_phone))';
            if (ctype_digit($tMin)) {
                $q->where("{$talk} >= " . (int) $tMin, null, false);
            }
            if (ctype_digit($tMax)) {
                $q->where("{$talk} <= " . (int) $tMax, null, false);
            }
        }

        // "Last connect date": leads NOT connected after this date — i.e. no
        // CONNECTED call (matched by contact) later than the given day. Finds
        // stale leads with no recent successful contact.
        if (($nca = $get('no_connect_after')) !== '' && $isDate($nca)) {
            $q->where("NOT EXISTS(SELECT 1 FROM calls c WHERE c.deleted_at IS NULL AND c.connected = 1 AND (c.contact = leads.phone OR c.contact = leads.alt_phone) AND c.call_start > '{$nca} 23:59:59')", null, false);
        }
        // "Last update date": leads NOT updated after this date (the lead row
        // itself hasn't changed since then, or was never updated).
        if (($nua = $get('no_update_after')) !== '' && $isDate($nua)) {
            $q->where("(leads.updated_at <= '{$nua} 23:59:59' OR leads.updated_at IS NULL)", null, false);
        }

        // Follow-up status (upcoming / overdue / done) via EXISTS — a lead is
        // "done" when a note or connected call landed on/after its follow-up date.
        $fs = $strs('follow_status');
        if ($fs) {
            $today = date('Y-m-d');
            $done  = "(EXISTS(SELECT 1 FROM lead_notes n WHERE n.lead_id = leads.id AND n.deleted_at IS NULL AND n.created_at >= leads.follow_date)"
                . " OR EXISTS(SELECT 1 FROM calls c WHERE c.contact = leads.phone AND c.connected = 1 AND c.deleted_at IS NULL AND c.call_start >= leads.follow_date))";
            $conds = [];
            foreach ($fs as $f) {
                if ($f === 'upcoming') {
                    $conds[] = "(leads.follow_date IS NOT NULL AND leads.follow_date > '{$today}')";
                } elseif ($f === 'done') {
                    $conds[] = "(leads.follow_date IS NOT NULL AND leads.follow_date <= '{$today}' AND {$done})";
                } elseif ($f === 'overdue') {
                    $conds[] = "(leads.follow_date IS NOT NULL AND leads.follow_date <= '{$today}' AND NOT {$done})";
                }
            }
            if ($conds) {
                $q->where('(' . implode(' OR ', $conds) . ')', null, false);
            }
        }
    }

    /**
     * Follow-up status flag for the leads table:
     *   - 'upcoming' (orange): the follow-up date is still in the future.
     *   - 'done'     (green):  the follow-up is due/past AND the lead was actioned
     *                          at/after the follow-up reminder — a note logged or a
     *                          call connected on the follow-up day OR any day after.
     *   - 'overdue'  (red):    the follow-up is due/past with no such note/call.
     * Returns null when the lead has no follow-up date. `$calls` = the lead's
     * connected call_start times (matched by phone).
     */
    private function followFlag(?string $followDate, array $reminders, array $notes, array $calls, string $today): ?string
    {
        if (empty($followDate)) {
            return null;
        }
        $fd = substr($followDate, 0, 10);
        if ($fd > $today) {
            return 'upcoming';
        }

        // Threshold = the follow-up reminder's fire time (latest reminder on fd),
        // else the start of the follow-up day. Any note or connected call at/after
        // it — that day or later — is evidence the lead was followed up → 'done'
        // (so a lead actioned a day late reads 'done', not 'overdue').
        $reminderAt = null;
        foreach ($reminders as $ra) {
            if (substr((string) $ra, 0, 10) === $fd && ($reminderAt === null || $ra > $reminderAt)) {
                $reminderAt = $ra;
            }
        }
        $threshold = $reminderAt ?? ($fd . ' 00:00:00');
        foreach ($notes as $na) {
            if ((string) $na >= $threshold) {
                return 'done';
            }
        }
        foreach ($calls as $ca) {
            if ((string) $ca >= $threshold) {
                return 'done';
            }
        }

        return 'overdue';
    }

    /** The later of two nullable datetime strings (null-safe). */
    private function laterOf(?string $a, ?string $b): ?string
    {
        if ($a === null) {
            return $b;
        }
        if ($b === null) {
            return $a;
        }

        return $a >= $b ? $a : $b;
    }

    /**
     * GET /client/lead-analytics — lead volume broken down by each pipeline
     * dimension, ready for bar charts: by status, sub-status, lead type,
     * marketing channel (the source's marketing type) and conversion stage.
     * Each series is a list of { label, value, color }, sorted high→low.
     */
    /**
     * GET /client/lead-call-summary — call KPIs + charts for the CURRENT lead
     * filter. Only counts calls whose contact number belongs to a lead in the
     * filtered set (matched by contact, so unmatched-lead_id calls still count).
     * "Unique calls" = distinct contact numbers. Same filter params as the leads
     * list. Returns KPIs, hourly distribution, and duration/leads by lead status.
     */
    public function leadCallSummary()
    {
        if ($resp = $this->requirePermission('leads')) {
            return $resp;
        }
        $cid = $this->clientId();

        // The filtered lead set (same scope + filters as the leads table).
        $lq = (new LeadModel())->select('phone, alt_phone, status_id')->where('client_id', $cid);
        $this->applyLeadScope($lq);
        $this->applyLeadFilters($lq);

        // Map each filtered lead's number(s) → its lead status, and collect the
        // phone set used to match calls by contact.
        $statusByPhone = [];
        foreach ($lq->findAll() as $l) {
            $sid = (int) ($l['status_id'] ?? 0);
            foreach ([$l['phone'] ?? '', $l['alt_phone'] ?? ''] as $p) {
                $k = CallIngestService::normalizePhone($p);
                if ($k !== '') {
                    $statusByPhone[$k] = $sid;
                }
            }
        }
        $phoneList = array_keys($statusByPhone);

        $statusMeta = [];
        foreach ($this->lookupRows(LeadStatusModel::class, $cid) as $i => $st) {
            $statusMeta[(int) $st['id']] = ['name' => $st['name'], 'color' => $st['color'], 'seq' => $i];
        }

        // Call-date window: only count calls whose call_start is in range. Uses the
        // "Updated date" (call date) filter, else the Created-date filter, else
        // defaults to TODAY — so the summary opens on today's call activity.
        $isDate = static fn (string $s): bool => (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $s);
        $today  = date('Y-m-d');
        $uFrom  = trim((string) ($this->request->getGet('updated_from') ?? ''));
        $uTo    = trim((string) ($this->request->getGet('updated_to') ?? ''));
        if (! $isDate($uFrom)) {
            $uFrom = trim((string) ($this->request->getGet('created_from') ?? ''));
        }
        if (! $isDate($uTo)) {
            $uTo = trim((string) ($this->request->getGet('created_to') ?? ''));
        }
        if (! $isDate($uFrom)) {
            $uFrom = $today;
        }
        if (! $isDate($uTo)) {
            $uTo = $today;
        }

        $scope = $this->visibleStaffIds();
        $total = 0;
        $connected = 0;
        $talk = 0;
        $uniq = [];
        $hourly = [];        // hour => calls
        $stAgg  = [];        // status_id => ['talk'=>, 'calls'=>, 'leads'=>[contact=>1]]
        foreach (array_chunk($phoneList, 500) as $chunk) {
            $cq = (new CallLogModel())->select('contact, call_start, connected, duration')
                ->where('client_id', $cid)->whereIn('contact', $chunk);
            if ($scope !== null) {
                $cq->whereIn('staff_id', $scope ?: [0]);
            }
            $cq->where('call_start >=', $uFrom . ' 00:00:00')
                ->where('call_start <=', $uTo . ' 23:59:59');
            foreach ($cq->findAll() as $c) {
                $ct = (string) ($c['contact'] ?? '');
                $dur = (int) ($c['duration'] ?? 0);
                $total++;
                $uniq[$ct] = 1;
                if ((int) $c['connected']) {
                    $connected++;
                }
                $talk += $dur;
                $st = (string) ($c['call_start'] ?? '');
                if ($st !== '') {
                    $h = (int) substr($st, 11, 2);
                    $hourly[$h] = ($hourly[$h] ?? 0) + 1;
                }
                $sid = $statusByPhone[$ct] ?? 0;
                if ($sid > 0) {
                    $stAgg[$sid]['talk']         = ($stAgg[$sid]['talk'] ?? 0) + $dur;
                    $stAgg[$sid]['calls']        = ($stAgg[$sid]['calls'] ?? 0) + 1;
                    $stAgg[$sid]['leads'][$ct]   = 1;
                }
            }
        }

        ksort($hourly);
        $hourlyOut = [];
        foreach ($hourly as $h => $n) {
            $hourlyOut[] = ['hour' => $h, 'calls' => $n];
        }

        $byStatus = [];
        foreach ($stAgg as $sid => $a) {
            $m          = $statusMeta[$sid] ?? ['name' => "#{$sid}", 'color' => 'slate', 'seq' => 999];
            $byStatus[] = [
                'label'    => $m['name'],
                'color'    => $m['color'],
                'leads'    => count($a['leads'] ?? []),
                'calls'    => $a['calls'] ?? 0,
                'talk_sec' => $a['talk'] ?? 0,
                'seq'      => $m['seq'],
            ];
        }
        usort($byStatus, static fn ($x, $y) => $x['seq'] <=> $y['seq']);
        $byStatus = array_map(static function ($r) {
            unset($r['seq']);

            return $r;
        }, $byStatus);

        return $this->respond([
            'kpis' => [
                'total_calls'  => $total,
                'unique_calls' => count($uniq),
                'avg_sec'      => $total ? (int) round($talk / $total) : 0,
                'connected'    => $connected,
                'connect_rate' => $total ? (int) round(100 * $connected / $total) : 0,
                'talk_sec'     => $talk,
            ],
            'hourly'    => $hourlyOut,
            'by_status' => $byStatus,
        ]);
    }

    public function leadAnalytics()
    {
        if ($resp = $this->requirePermission('leads')) {
            return $resp;
        }
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
        $totalQ->where('(pending_transfer IS NULL OR pending_transfer = 0)'); // match the table (hides mid-transfer leads)
        $this->applyLeadScope($totalQ);
        $this->applyLeadFilters($totalQ);
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
     * GET /client/external-clients — read-only view of the SECONDARY database:
     * tblclients LEFT JOIN tblbasic_details ON userid, surfacing the applicant's
     * basic details (name, contact, university, etc.). Server-paginated + search
     * (page, per_page, q). Admin-only, since it exposes an external data source.
     */
    public function externalClients()
    {
        if (! $this->isAdmin()) {
            return $this->fail('Only the client admin can view external clients.', 403);
        }

        $sdb = $this->resolvedSecondaryDb();
        if (! $sdb->isConfigured()) {
            return $this->fail('No applicant database is configured. Add your secondary DB credentials in the Applicant section settings.', 503);
        }

        $perPage = max(1, min(200, (int) ($this->request->getGet('per_page') ?: 50)));
        $page    = max(1, (int) ($this->request->getGet('page') ?: 1));
        $offset  = ($page - 1) * $perPage;
        $q       = trim((string) ($this->request->getGet('q') ?? ''));

        // Shared WHERE + binds for both the count and the page query. Search spans
        // the basic-details name/contact fields and the client company.
        $where = '';
        $binds = [];
        if ($q !== '') {
            $like  = '%' . $q . '%';
            $where = 'WHERE (b.first_name LIKE ? OR b.last_name LIKE ? OR b.email LIKE ? OR b.mobile LIKE ? '
                   . 'OR b.university_name LIKE ? OR b.country LIKE ? OR c.company LIKE ? OR c.phonenumber LIKE ?)';
            $binds = [$like, $like, $like, $like, $like, $like, $like, $like];
        }

        try {
            $countRow = $sdb->selectRow(
                "SELECT COUNT(*) AS n FROM tblclients c LEFT JOIN tblbasic_details b ON b.userid = c.userid {$where}",
                $binds,
            );
            $total = (int) ($countRow['n'] ?? 0);

            // LIMIT/OFFSET are validated ints (not user strings), so they're inlined.
            $rows = $sdb->select(
                "SELECT c.userid, c.company, c.phonenumber, c.city, c.state, c.datecreated,
                        b.title, b.first_name, b.last_name, b.email, b.mobile, b.dob, b.gender,
                        b.father_name, b.mother_name, b.university_name, b.country AS applicant_country
                 FROM tblclients c
                 LEFT JOIN tblbasic_details b ON b.userid = c.userid
                 {$where}
                 ORDER BY c.userid DESC
                 LIMIT {$perPage} OFFSET {$offset}",
                $binds,
            );
        } catch (\Throwable $e) {
            log_message('error', 'externalClients query failed: ' . $e->getMessage());

            return $this->fail('Could not read the secondary database.', 502);
        }

        // Trim stray whitespace the source data carries in name fields.
        foreach ($rows as &$r) {
            $r['first_name'] = trim((string) ($r['first_name'] ?? ''));
            $r['last_name']  = trim((string) ($r['last_name'] ?? ''));
            $r['full_name']  = trim($r['first_name'] . ' ' . $r['last_name']);
        }
        unset($r);

        return $this->respond([
            'rows'     => $rows,
            'total'    => $total,
            'page'     => $page,
            'per_page' => $perPage,
        ]);
    }

    /**
     * The fixed JOIN block for the Applicant Tracker (secondary/Perfex DB),
     * ported from the legacy datatable. Admin view: staff/partner scoping is
     * dropped (the whole tracker is visible), so the counsellor/partner joins
     * simplify to a direct key match. The derived apostille + ticket subqueries
     * mirror the legacy ones so config columns referencing those aliases resolve.
     */
    private const APPLICANT_TRACKER_FROM = <<<'SQL'
        FROM tblclients
        LEFT JOIN tblbasic_details ON tblbasic_details.userid = tblclients.userid
        LEFT JOIN tblapplicant_status ON tblapplicant_status.id = tblclients.active
        LEFT JOIN tblleads ON tblleads.id = tblclients.leadid
        LEFT JOIN tblstaff ON tblleads.assigned = tblstaff.staffid
        LEFT JOIN tblleads_status ON tblleads_status.id = tblleads.status
        LEFT JOIN tblleads_type ON tblleads_type.id = tblleads.type
        LEFT JOIN tblleads_sources ON tblleads_sources.id = tblleads.source
        LEFT JOIN tblapplicant_tracker ON tblapplicant_tracker.id = (tblclients.applicant_status + 1)
        LEFT JOIN tbladmission_preferences ON tbladmission_preferences.userid = tblclients.userid
        LEFT JOIN tblclient_university_shortlisting ON tblclient_university_shortlisting.client_id = tblclients.userid AND tblclient_university_shortlisting.university_name = tbladmission_preferences.primary_university
        LEFT JOIN tblorignal_document_status ON tblorignal_document_status.id = tblclients.orignal_document_status
        LEFT JOIN tblorignal_documents_received ON tblorignal_documents_received.userid = tblclients.userid
        LEFT JOIN tbloffice_location ON tbloffice_location.id = tblorignal_documents_received.location_id
        LEFT JOIN tblorignal_documents ON tblorignal_documents.id = tblorignal_documents_received.doc_id
        LEFT JOIN tblapplicant_stages stage_category ON stage_category.id = tblclients.applicant_stage
        LEFT JOIN tblapplication_sub_category_mbbs stage_sub_category ON stage_sub_category.id = tblclients.applicant_sub_status
        LEFT JOIN tblclient_passport_details ON tblclient_passport_details.client_id = tblclients.userid
        LEFT JOIN tblpassport_stages ON tblpassport_stages.id = tblclient_passport_details.passport_status
        LEFT JOIN tblacademic_details ON tblacademic_details.userid = tblclients.userid
        LEFT JOIN tblneet_status ON tblneet_status.id = tblacademic_details.neet_status
        LEFT JOIN tblvisa_details ON tblvisa_details.userid = tblclients.userid
        LEFT JOIN tblvisa_status ON tblvisa_status.id = tblvisa_details.status
        LEFT JOIN tblvendor_list visa_vendor ON visa_vendor.id = tblvisa_details.vendor_id
        LEFT JOIN tblpayment_mode visa_p_mode ON visa_p_mode.id = tblvisa_details.payment_mode
        LEFT JOIN tblev_partner ev_partner ON ev_partner.id = tblclients.agent_id
        LEFT JOIN (
            SELECT userid, SUM(apostille_cost) AS Total_cost, MAX(courier_date) AS courier_date,
                   MAX(payment_date) AS payment_date, GROUP_CONCAT(vendor_id) AS vendor_id,
                   GROUP_CONCAT(doc_id) AS doc_id, MAX(apostille_received) AS apostille_received,
                   CASE WHEN COUNT(*) = 0 THEN 'Pending'
                        WHEN SUM(received_status = 0) > 0 THEN 'Sent'
                        WHEN SUM(received_status = 1) = COUNT(*) THEN 'Received'
                        ELSE 'Pending' END AS apostille_status
            FROM tblclient_apostille_data GROUP BY userid
        ) AS apostille_summary ON apostille_summary.userid = tblclients.userid
        LEFT JOIN (
            SELECT td1.*, td2.total_cost FROM tblticket_data td1
            INNER JOIN (
                SELECT MAX(IF(ticket_status != 6, id, NULL)) AS max_id, client_id,
                       SUM(IF(ticket_status != 6, ticket_cost, -ticket_cost)) AS total_cost
                FROM tblticket_data GROUP BY client_id
            ) td2 ON td1.id = td2.max_id
        ) td ON td.client_id = tblclients.userid
        LEFT JOIN tblticket_status ts ON ts.id = td.ticket_status
        LEFT JOIN tblvendor_list tc ON tc.id = td.vendor_id
        LEFT JOIN tblpayment_mode tm ON tm.id = td.payment_mode
        LEFT JOIN tbldeparture_location dl ON dl.id = td.departure_location
        LEFT JOIN tblticket_batch tb ON tb.id = td.batch_id
        LEFT JOIN tbluniversity_partner u_p ON u_p.id = tblclient_university_shortlisting.partner
        SQL;

    /**
     * LEAN join set for counting + selecting the page's applicant ids — only the
     * tables the filters touch (no display-only / one-to-many aggregation joins).
     * Every WHERE column the tracker supports lives here, so it returns the exact
     * same filtered set as the full FROM but far cheaper. The page's heavy display
     * columns are then hydrated for just those ids via {@see self::APPLICANT_TRACKER_FROM}.
     */
    private const APPLICANT_TRACKER_LEAN_FROM = <<<'SQL'
        FROM tblclients
        LEFT JOIN tblbasic_details ON tblbasic_details.userid = tblclients.userid
        LEFT JOIN tblleads ON tblleads.id = tblclients.leadid
        LEFT JOIN tbladmission_preferences ON tbladmission_preferences.userid = tblclients.userid
        LEFT JOIN tblacademic_details ON tblacademic_details.userid = tblclients.userid
        LEFT JOIN tblclient_passport_details ON tblclient_passport_details.client_id = tblclients.userid
        LEFT JOIN tblclient_university_shortlisting ON tblclient_university_shortlisting.client_id = tblclients.userid AND tblclient_university_shortlisting.university_name = tbladmission_preferences.primary_university
        LEFT JOIN tblvisa_details ON tblvisa_details.userid = tblclients.userid
        LEFT JOIN (
            SELECT userid, MAX(courier_date) AS courier_date, MAX(payment_date) AS payment_date,
                   GROUP_CONCAT(vendor_id) AS vendor_id, MAX(apostille_received) AS apostille_received,
                   CASE WHEN COUNT(*) = 0 THEN 'Pending'
                        WHEN SUM(received_status = 0) > 0 THEN 'Sent'
                        WHEN SUM(received_status = 1) = COUNT(*) THEN 'Received'
                        ELSE 'Pending' END AS apostille_status
            FROM tblclient_apostille_data GROUP BY userid
        ) AS apostille_summary ON apostille_summary.userid = tblclients.userid
        LEFT JOIN (
            SELECT td1.*, td2.total_cost FROM tblticket_data td1
            INNER JOIN (
                SELECT MAX(IF(ticket_status != 6, id, NULL)) AS max_id, client_id,
                       SUM(IF(ticket_status != 6, ticket_cost, -ticket_cost)) AS total_cost
                FROM tblticket_data GROUP BY client_id
            ) td2 ON td1.id = td2.max_id
        ) td ON td.client_id = tblclients.userid
        LEFT JOIN tblticket_batch tb ON tb.id = td.batch_id
        SQL;

    /**
     * Config column_names that expand into MANY sub-columns via legacy helper
     * functions (per-currency fees, per-document YES/NO). Skipped in this
     * data-driven v1 — they need the original helper logic to reproduce.
     */
    private const APPLICANT_TRACKER_SKIP = [
        'fees', 'original_documents', 'original_documents_rest', 'original_documents_georgia',
        'apostille_documents', 'orignal_document_visa_rest', 'orignal_document_visa_georgia',
    ];

    /**
     * Source lists for the dynamic-expansion columns (secondary DB, cached 1h):
     * the MBBS fee heads and the document master lists per document-set type.
     * These drive the per-fee and per-document YES/NO columns.
     *
     * @return array<string, array<int, array<string, mixed>>>
     */
    private function applicantTrackerExpansions(SecondaryDb $sdb): array
    {
        $exp = cache('applicant_tracker_expansions');
        if (is_array($exp)) {
            return $exp;
        }
        $docs = static fn (string $where): array => $sdb->select("SELECT id, short_name FROM tblorignal_documents WHERE {$where} ORDER BY id");
        $exp  = [
            'fees'                          => $sdb->select('SELECT id, name FROM tblapplicant_fees WHERE lead_type = 2 AND status = 1 ORDER BY sequence'),
            'original_documents'            => $docs('status = 1'),
            'original_documents_rest'       => $docs('rest = 1'),
            'original_documents_georgia'    => $docs('georgia = 1'),
            'apostille_documents'           => $docs('apostile_status = 1 OR (visa_apostile = 1 AND status = 0)'),
            'orignal_document_visa_rest'    => $docs('visa_rest = 1'),
            'orignal_document_visa_georgia' => $docs('visa_georgia = 1'),
        ];
        cache()->save('applicant_tracker_expansions', $exp, 3600);

        return $exp;
    }

    /**
     * Build the Applicant Tracker's SELECT column list from the secondary-DB
     * config table (tblma_applicant_tracker). Each enabled column contributes
     * `<expr> AS <alias>` (its sql_condition or a safe tbl.column); the special
     * "fees" and document-set columns expand into one column per fee / document.
     * Returns [selectSql[], meta[{key,label,selected}]].
     *
     * @return array{0: array<int,string>, 1: array<int,array{key:string,label:string,selected:bool}>}
     */
    private function applicantTrackerColumns(SecondaryDb $sdb): array
    {
        $cfg = $sdb->select(
            "SELECT tbl, column_name, label_name, sql_condition, selected
             FROM tblma_applicant_tracker
             WHERE status = 1 AND show_column = 1
             ORDER BY IF(sequence = 0, 999999, sequence), tbl_sequence, id",
        );

        $exp = $this->applicantTrackerExpansions($sdb);

        // Each document set gets its OWN full set of columns, grouped by this
        // prefix (so "Original Doc" shows all original docs, "AP Doc" all
        // apostille docs, etc. — even where the same document appears in more
        // than one set).
        $docSetLabel = [
            'original_documents'            => 'Doc',
            'original_documents_rest'       => 'Doc (Rest)',
            'original_documents_georgia'    => 'Doc (Georgia)',
            'apostille_documents'           => 'AP Doc',
            'orignal_document_visa_rest'    => 'Visa Doc (Rest)',
            'orignal_document_visa_georgia' => 'Visa Doc (Georgia)',
        ];

        $cands    = [];   // normal columns, in config order
        $docCands = [];   // document columns — appended AFTER everything else
        $used     = [];
        $expUsed  = [];   // fee ids already added
        $setDone  = [];   // document sets already expanded
        // Build a candidate with a unique key; caller pushes it to the right list.
        $mk = function (string $expr, string $label, bool $sel) use (&$used): array {
            $key  = preg_replace('/[^a-z0-9]+/', '_', strtolower($label)) ?: 'col';
            $key  = trim($key, '_') ?: 'col';
            $base = $key;
            $i    = 2;
            while (isset($used[$key])) {
                $key = $base . '_' . $i++;
            }
            $used[$key] = true;

            return ['sql' => "({$expr}) AS `{$key}`", 'key' => $key, 'label' => $label, 'sel' => $sel];
        };
        $add = function (string $expr, string $label, bool $sel) use (&$cands, $mk): void {
            $cands[] = $mk($expr, $label, $sel);
        };

        foreach ($cfg as $c) {
            $colName = trim((string) ($c['column_name'] ?? ''));
            $sel     = ((int) ($c['selected'] ?? 0) === 1);

            // Fees → one column per fee (Registration Amount, One time Charge, …),
            // as a correlated lookup of this client's amount + currency symbol.
            if ($colName === 'fees') {
                foreach ($exp['fees'] as $f) {
                    if (isset($expUsed['fee:' . $f['id']])) {
                        continue;
                    }
                    $expUsed['fee:' . $f['id']] = true;
                    $id   = (int) $f['id'];
                    $expr = "SELECT CONCAT(COALESCE(cur.symbol,''), IFNULL(fd.amount,0)) FROM tblapplicant_fees_details fd "
                          . "LEFT JOIN tblcurrencies cur ON cur.id = fd.currency_id "
                          . "WHERE fd.fees_id = {$id} AND fd.client_id = tblclients.userid ORDER BY fd.id DESC LIMIT 1";
                    $add($expr, (string) $f['name'], $sel);
                }
                continue;
            }
            // Document sets → a YES/NO column per document in THAT set (Passport,
            // 12th MS, …), grouped by the set's label so every set is complete.
            // Reuses the orignal_documents joins already in FROM.
            if (in_array($colName, self::APPLICANT_TRACKER_SKIP, true)) {
                if (isset($setDone[$colName])) {
                    continue; // this set was already expanded (config lists it twice)
                }
                $setDone[$colName] = true;
                $prefix            = $docSetLabel[$colName] ?? 'Doc';
                foreach (($exp[$colName] ?? []) as $d) {
                    $sn = trim((string) $d['short_name']);
                    if ($sn === '') {
                        continue;
                    }
                    $lit  = $sdb->db()->escape($sn); // safe-quoted literal
                    $expr = "MAX(CASE WHEN tblorignal_documents.short_name = {$lit} THEN 'YES' ELSE 'NO' END)";
                    // Document columns are collected separately so they all sit at
                    // the END of the table, after every other column.
                    $docCands[] = $mk($expr, "{$prefix} - {$sn}", $sel);
                }
                continue;
            }

            // Plain config column: use its sql_condition, else a safe tbl.column.
            $expr = trim((string) ($c['sql_condition'] ?? ''));
            if ($expr === '') {
                $tbl = trim((string) ($c['tbl'] ?? ''));
                if (! preg_match('/^[a-z0-9_]+$/i', $tbl) || ! preg_match('/^[a-z_][a-z0-9_]*$/i', $colName)) {
                    continue;
                }
                $expr = "{$tbl}.{$colName}";
            }
            // Show date + time on date columns: extend the config's date-only
            // format token so the underlying datetime's time is displayed too.
            $expr = str_replace("'%d-%m-%Y'", "'%d-%m-%Y %h:%i %p'", $expr);
            $add($expr, trim((string) ($c['label_name'] ?? '')) ?: $colName, $sel);
        }

        // All document columns go last, after every other column.
        $cands = array_merge($cands, $docCands);

        // Some stored sql_condition values have typos (e.g. a missing space) that
        // would break the whole query. Validate the set once (dropping any that
        // fail to parse) and cache it — the admin column config is near-static.
        // Probe under the SAME session mode as the real query so validation is
        // deterministic and doesn't drop otherwise-valid columns.
        $cacheKey = 'appl_tracker_cols_v5_' . md5(json_encode(array_column($cands, 'sql')));
        $good     = cache($cacheKey);
        if (! is_array($good)) {
            // The read session (sql_mode='' for GROUP BY) is configured by
            // SecondaryDb on connect, so probing matches the real query.
            $good = $this->validColumns($sdb, $cands);
            cache()->save($cacheKey, $good, 86400);
        }

        return [array_column($good, 'sql'), array_map(static fn ($c) => ['key' => $c['key'], 'label' => $c['label'], 'selected' => ! empty($c['sel'])], $good)];
    }

    /** True when every column expression parses against the tracker join set. */
    private function probeColumns(SecondaryDb $sdb, array $sqlExprs): bool
    {
        if (empty($sqlExprs)) {
            return true;
        }
        try {
            // Match the real query shape (GROUP BY) so a column valid at run time
            // validates here too — LIMIT 0 keeps it a plan-only, no-row check.
            // Goes through the read-only guard like every other query.
            $sdb->select('SELECT ' . implode(', ', $sqlExprs) . ' ' . self::APPLICANT_TRACKER_FROM . ' GROUP BY tblclients.userid LIMIT 0');

            return true;
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * Return only the candidate columns whose SQL parses, found by bisecting the
     * set (so a couple of bad expressions cost a handful of probes, not one each).
     *
     * @param array<int,array{sql:string,key:string,label:string}> $cands
     *
     * @return array<int,array{sql:string,key:string,label:string}>
     */
    private function validColumns(SecondaryDb $sdb, array $cands): array
    {
        if ($this->probeColumns($sdb, array_column($cands, 'sql'))) {
            return $cands; // whole batch is fine
        }
        if (count($cands) <= 1) {
            return []; // the lone column is the bad one
        }
        $mid = intdiv(count($cands), 2);

        return array_merge(
            $this->validColumns($sdb, array_slice($cands, 0, $mid)),
            $this->validColumns($sdb, array_slice($cands, $mid)),
        );
    }

    /**
     * GET /client/applicant-tracker — the config-driven Applicant Tracker from
     * the secondary (Perfex) DB: tblclients + the full tracker join set, with the
     * visible columns read live from tblma_applicant_tracker. Admin-only,
     * read-only, server-paginated (page, per_page, q). Mirrors the legacy
     * datatable's listing (write actions — status change / delete / download —
     * are intentionally excluded).
     */
    /**
     * Applicant userids (secondary DB) whose phone matches a lead in THIS tenant's
     * leads table — matched by normalized phone (last 10 digits) across the
     * applicant's mobile/phonenumber and the lead's phone/alt_phone. The two live
     * on different servers, so the match is computed in PHP and reduced to a
     * bounded userid list (≤ the applicant count). Cached briefly.
     *
     * @return array<int,int>
     */
    private function localLeadApplicantIds(SecondaryDb $sdb): array
    {
        $cached = cache('applicant_local_lead_ids_' . $this->clientId());
        if (is_array($cached)) {
            return $cached;
        }

        $norm = static function ($v): string {
            $d = preg_replace('/\D+/', '', (string) $v);

            return strlen($d) >= 10 ? substr($d, -10) : '';
        };

        // Local lead phones (tenant DB) → set of normalized numbers.
        $leadPhones = [];
        foreach ((new LeadModel())->select('phone, alt_phone')->where('client_id', $this->clientId())->findAll() as $l) {
            foreach ([$l['phone'] ?? '', $l['alt_phone'] ?? ''] as $p) {
                $n = $norm($p);
                if ($n !== '') {
                    $leadPhones[$n] = true;
                }
            }
        }
        if (! $leadPhones) {
            cache()->save('applicant_local_lead_ids_' . $this->clientId(), [], 120);

            return [];
        }

        // Applicant phones (secondary DB) → keep userids matching a local lead.
        $ids = [];
        foreach ($sdb->select('SELECT tblclients.userid AS uid, tblbasic_details.mobile AS m, tblclients.phonenumber AS p FROM tblclients LEFT JOIN tblbasic_details ON tblbasic_details.userid = tblclients.userid') as $r) {
            foreach ([$r['m'] ?? '', $r['p'] ?? ''] as $ph) {
                $n = $norm($ph);
                if ($n !== '' && isset($leadPhones[$n])) {
                    $ids[] = (int) $r['uid'];
                    break;
                }
            }
        }
        $ids = array_values(array_unique($ids));
        cache()->save('applicant_local_lead_ids_' . $this->clientId(), $ids, 120);

        return $ids;
    }

    /**
     * Normalize the Secondary university column in-place. When a lead has no
     * university_priority, the SQL falls back to the raw admission_preferences
     * .university value — a {"Country":"Uni1,Uni2"} JSON map that also contains
     * the primary. Decode it, split on commas, drop the primary, and join the
     * rest (matching the legacy datatable's PHP post-processing). Values that are
     * already a clean name (from the priority path) are left untouched.
     *
     * @param array<int,array<string,mixed>> $rows
     */
    private function cleanSecondaryUniversity(array &$rows): void
    {
        foreach ($rows as &$row) {
            if (! array_key_exists('secondary_university', $row)) {
                continue;
            }
            $sec = trim((string) ($row['secondary_university'] ?? ''));
            if ($sec === '' || $sec[0] !== '{') {
                continue; // already a clean name (or blank)
            }
            $decoded = json_decode($sec, true);
            if (! is_array($decoded)) {
                $row['secondary_university'] = '';
                continue;
            }
            $primary = trim((string) ($row['primary_university'] ?? ''));
            $unis    = [];
            foreach ($decoded as $value) {
                foreach (explode(',', (string) $value) as $u) {
                    $u = trim($u);
                    if ($u !== '' && strcasecmp($u, $primary) !== 0) {
                        $unis[$u] = true; // dedupe, drop the primary
                    }
                }
            }
            $row['secondary_university'] = implode(', ', array_keys($unis));
        }
        unset($row);
    }

    public function applicantTracker()
    {
        if (! $this->isAdmin()) {
            return $this->fail('Only the client admin can view the applicant tracker.', 403);
        }
        $sdb = $this->resolvedSecondaryDb();
        if (! $sdb->isConfigured()) {
            return $this->fail('No applicant database is configured. Add your secondary DB credentials in the Applicant section settings.', 503);
        }

        $perPage = max(1, min(200, (int) ($this->request->getGet('per_page') ?: 50)));
        $page    = max(1, (int) ($this->request->getGet('page') ?: 1));
        $offset  = ($page - 1) * $perPage;
        $q       = trim((string) ($this->request->getGet('q') ?? ''));

        // Build the WHERE from search + the leads-style filters. Numeric IN-lists
        // are cast to ints (safe to inline); free-text values go through binds.
        $conds = [];
        $binds = [];
        if ($q !== '') {
            $like    = '%' . $q . '%';
            $conds[] = "(CONCAT(tblbasic_details.first_name,' ',tblbasic_details.last_name) LIKE ? "
                     . "OR tblbasic_details.email LIKE ? OR tblbasic_details.mobile LIKE ?)";
            array_push($binds, $like, $like, $like);
        }

        // Helper: read a GET param as an array (accepts array or comma string).
        $arr = function (string $param): array {
            $raw = $this->request->getGet($param);

            return is_array($raw) ? $raw : ($raw !== null && $raw !== '' ? explode(',', (string) $raw) : []);
        };
        $intIn = static function (array $vals): array {
            return array_values(array_filter(array_map('intval', $vals), static fn ($n) => $n > 0));
        };
        $strIn = static function (array $vals): array {
            return array_values(array_filter(array_map('trim', $vals), static fn ($v) => $v !== ''));
        };

        // Multi-select id filters → column IN (ints).
        foreach ([
            'status'         => 'tblclients.active',
            'stage'          => 'tblclients.applicant_stage',
            'sub_stage'      => 'tblclients.applicant_sub_status',
            'lead_type'      => 'tblleads.type',
            'source'         => 'tblleads.source',
            'client_type'    => 'tblclients.client_type',
            'neet_status'    => 'tblacademic_details.neet_status',
            'pcc_status'     => 'tblclients.pcc_status',
            'passport_status' => 'tblclient_passport_details.passport_status',
            'doc_status'     => 'tblclients.orignal_document_status',
            'ev_partner'     => 'tblclients.agent_id',
            'counsellor'     => 'tblleads.assigned',
            'fly_departure'  => 'td.departure_location',
            'fly_vendors'    => 'td.vendor_id',
        ] as $param => $col) {
            $ids = $intIn($arr($param));
            if ($ids) {
                $conds[] = "{$col} IN (" . implode(',', $ids) . ')';
            }
        }

        // Multi-select free-text filters → column IN (?, …).
        foreach ([
            'university' => 'tbladmission_preferences.primary_university',
            'country'    => 'tbladmission_preferences.primary_country',
            'fly_batch'  => 'tb.name',
        ] as $param => $col) {
            $vals = $strIn($arr($param));
            if ($vals) {
                $conds[] = "{$col} IN (" . implode(',', array_fill(0, count($vals), '?')) . ')';
                array_push($binds, ...$vals);
            }
        }

        // Apostille status (Pending / Sent / Received) → COALESCE default Pending.
        $apo = $strIn($arr('apostille_status'));
        if ($apo) {
            $conds[] = "COALESCE(apostille_summary.apostille_status,'Pending') IN (" . implode(',', array_fill(0, count($apo), '?')) . ')';
            array_push($binds, ...$apo);
        }

        // Vendor filters stored as comma lists → match any id via REGEXP.
        foreach ([
            'apostille_vendors' => 'apostille_summary.vendor_id',
            'visa_vendors'      => 'tblvisa_details.vendor_id',
        ] as $param => $col) {
            $ids = $intIn($arr($param));
            if ($ids) {
                $pattern = implode('|', array_map(static fn ($v) => '(^|,)' . $v . '(,|$)', $ids));
                $conds[] = "({$col} IS NOT NULL AND {$col} REGEXP ?)";
                $binds[] = $pattern;
            }
        }

        // Yes/No flags.
        $minor = trim((string) ($this->request->getGet('minor') ?? ''));
        if ($minor === 'Yes' || $minor === 'No') {
            $op      = $minor === 'Yes' ? '<' : '>=';
            $conds[] = "TIMESTAMPDIFF(YEAR, tblbasic_details.dob, CURDATE()) {$op} 18";
        }
        $tf = trim((string) ($this->request->getGet('tf_status') ?? ''));
        if ($tf === 'Yes') {
            $conds[] = "tblclient_university_shortlisting.fees_deposite_slip <> ''";
        } elseif ($tf === 'No') {
            $conds[] = "(tblclient_university_shortlisting.fees_deposite_slip IS NULL OR tblclient_university_shortlisting.fees_deposite_slip = '')";
        }

        // Academic year → the two session intakes (YYYY-09 and (YYYY+1)-02).
        $year = (int) ($this->request->getGet('academic_year') ?: 0);
        if ($year > 2000) {
            $conds[] = "(tbladmission_preferences.session_intake IN (?, ?) OR tbladmission_preferences.session_intake IS NULL)";
            array_push($binds, $year . '-09', ($year + 1) . '-02');
        }

        // Single-date equals filters.
        $isDate = static fn (string $s): bool => (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $s);
        foreach ([
            'courier_date'      => 'apostille_summary.courier_date',
            'apostille_received' => 'apostille_summary.apostille_received',
            'visa_payment_date' => 'tblvisa_details.payment_date',
            'fly_date'          => 'td.fly_date',
        ] as $param => $col) {
            $d = trim((string) ($this->request->getGet($param) ?? ''));
            if ($isDate($d)) {
                $conds[] = "DATE({$col}) = ?";
                $binds[] = $d;
            }
        }

        // Date-range filters (from/to pairs).
        foreach ([
            'from'      => ['to', 'tblclients.datecreated'],       // Applicant date
            'last_from' => ['last_to', 'tblclients.last_update'],  // Last update
        ] as $fromParam => [$toParam, $col]) {
            $f = trim((string) ($this->request->getGet($fromParam) ?? ''));
            $t = trim((string) ($this->request->getGet($toParam) ?? ''));
            if ($isDate($f) && $isDate($t)) {
                $conds[] = "DATE({$col}) BETWEEN ? AND ?";
                array_push($binds, $f, $t);
            }
        }

        // Only applicants whose phone matches a lead in THIS tenant's leads table
        // (on by default; pass all=1 to see every applicant). Cross-DB, so the
        // match is resolved to a bounded userid list in PHP.
        // Show ALL applicants by default (the original tracker behaviour). Only scope
        // to applicants linked to this client's leads when explicitly asked (mine=1).
        // `all=1` (legacy param) is also honoured as "show everything".
        $wantMine = trim((string) ($this->request->getGet('mine') ?? '')) === '1'
            && trim((string) ($this->request->getGet('all') ?? '')) !== '1';
        if ($wantMine) {
            $ids     = $this->localLeadApplicantIds($sdb);
            $conds[] = 'tblclients.userid IN (' . ($ids ? implode(',', $ids) : '0') . ')';
        }

        $where = $conds ? 'WHERE ' . implode(' AND ', $conds) : '';

        try {
            [$select, $meta] = $this->applicantTrackerColumns($sdb);

            // 1) Count + this page's applicant ids over the LEAN join set (only
            //    filter tables) — cheap, no heavy per-column aggregation.
            $leanFrom = self::APPLICANT_TRACKER_LEAN_FROM . "\n{$where}";
            $countRow = $sdb->selectRow("SELECT COUNT(DISTINCT tblclients.userid) AS n {$leanFrom}", $binds);
            $total    = (int) ($countRow['n'] ?? 0);

            $idRows = $sdb->select(
                "SELECT DISTINCT tblclients.userid AS uid {$leanFrom} ORDER BY tblclients.userid DESC LIMIT {$perPage} OFFSET {$offset}",
                $binds,
            );
            $ids = array_map(static fn ($r) => (int) $r['uid'], $idRows);

            // 2) Hydrate ONLY the page's applicants with the full (heavy) column
            //    set — the ~87 columns + one-to-many joins now aggregate over just
            //    this page's rows, not the whole table. No binds (ids inlined,
            //    filters already applied, column exprs are literals). ORDER BY
            //    keeps the page order stable.
            $rows = [];
            if ($ids) {
                // __status_color drives the Status badge colour on the frontend
                // (not shown as its own column — it's not in the column meta).
                $cols = array_merge(['tblclients.userid AS `userid`', 'tblapplicant_status.color AS `__status_color`'], $select);
                $rows = $sdb->select(
                    'SELECT ' . implode(', ', $cols) . ' ' . self::APPLICANT_TRACKER_FROM
                    . ' WHERE tblclients.userid IN (' . implode(',', $ids) . ')'
                    . ' GROUP BY tblclients.userid ORDER BY tblclients.userid DESC',
                );
                $this->cleanSecondaryUniversity($rows);
            }
        } catch (\Throwable $e) {
            log_message('error', 'applicantTracker query failed: ' . $e->getMessage());

            return $this->fail('Could not read the applicant tracker: ' . $e->getMessage(), 502);
        }

        return $this->respond([
            'columns'  => $meta,
            'rows'     => $rows,
            'total'    => $total,
            'page'     => $page,
            'per_page' => $perPage,
        ]);
    }

    /**
     * GET /client/applicant-tracker-filters — dropdown options for the Applicant
     * Tracker filters (status, stage, sub-stage, lead type, university), read from
     * the secondary DB. Admin-only. Cached 1h (near-static lookups).
     */
    public function applicantTrackerFilters()
    {
        if (! $this->isAdmin()) {
            return $this->fail('Only the client admin can view this.', 403);
        }
        $sdb = $this->resolvedSecondaryDb();
        if (! $sdb->isConfigured()) {
            return $this->fail('No applicant database is configured. Add your secondary DB credentials in the Applicant section settings.', 503);
        }

        $cached = cache('applicant_tracker_filters_v2');
        if (is_array($cached)) {
            return $this->respond($cached);
        }

        try {
            $opts = static fn (array $rows): array => array_map(
                static fn ($r) => ['id' => (int) $r['id'], 'name' => (string) $r['name']],
                $rows,
            );
            $distinct = static fn (array $rows): array => array_values(array_filter(array_map(
                static fn ($r) => (string) $r['v'],
                $rows,
            ), static fn ($v) => $v !== ''));

            $data = [
                'status'          => $opts($sdb->select('SELECT id, name FROM tblapplicant_status ORDER BY name')),
                'stage'           => $opts($sdb->select('SELECT id, name FROM tblapplicant_stages ORDER BY name')),
                'sub_stage'       => $opts($sdb->select('SELECT id, name FROM tblapplication_sub_category_mbbs ORDER BY name')),
                'lead_type'       => $opts($sdb->select('SELECT id, name FROM tblleads_type ORDER BY name')),
                'source'          => $opts($sdb->select('SELECT id, name FROM tblleads_sources ORDER BY name')),
                'neet_status'     => $opts($sdb->select('SELECT id, name FROM tblneet_status ORDER BY name')),
                'passport_status' => $opts($sdb->select('SELECT id, name FROM tblpassport_stages ORDER BY name')),
                'doc_status'      => $opts($sdb->select('SELECT id, name FROM tblorignal_document_status ORDER BY name')),
                'ev_partner'      => $opts($sdb->select('SELECT id, name FROM tblev_partner ORDER BY name')),
                'fly_departure'   => $opts($sdb->select('SELECT id, name FROM tbldeparture_location ORDER BY name')),
                'vendors'         => $opts($sdb->select('SELECT id, name FROM tblvendor_list ORDER BY name')),
                'counsellor'      => $opts($sdb->select("SELECT staffid AS id, CONCAT(firstname,' ',lastname) AS name FROM tblstaff WHERE active = 1 ORDER BY firstname")),
                'university'      => $distinct($sdb->select("SELECT DISTINCT primary_university AS v FROM tbladmission_preferences WHERE primary_university IS NOT NULL AND primary_university <> '' ORDER BY primary_university")),
                'country'         => $distinct($sdb->select("SELECT DISTINCT primary_country AS v FROM tbladmission_preferences WHERE primary_country IS NOT NULL AND primary_country <> '' ORDER BY primary_country")),
                'fly_batch'       => $distinct($sdb->select("SELECT DISTINCT name AS v FROM tblticket_batch WHERE name <> '' ORDER BY name")),
                // Static option sets.
                'apostille_status' => ['Pending', 'Sent', 'Received'],
                'client_type'      => [['id' => 1, 'name' => 'Client'], ['id' => 2, 'name' => 'EV Partner'], ['id' => 3, 'name' => 'Other']],
                'minor'            => ['Yes', 'No'],
                'tf_status'        => ['Yes', 'No'],
            ];
        } catch (\Throwable $e) {
            log_message('error', 'applicantTrackerFilters failed: ' . $e->getMessage());

            return $this->fail('Could not read filter options.', 502);
        }

        cache()->save('applicant_tracker_filters_v2', $data, 3600);

        return $this->respond($data);
    }

    /** Default label + URL slug for the Applicant section (before admin edits). */
    private const APPLICANT_DEFAULTS = ['label' => 'Applicant', 'slug' => 'applicant'];

    /**
     * Client-panel URL slugs that already belong to built-in sections — the
     * Applicant slug can't collide with any of these.
     */
    private const RESERVED_SLUGS = [
        'me', 'leads', 'calls', 'followups', 'team', 'org-chart', 'assets', 'tasks',
        'reports', 'announcements', 'chat', 'notifications', 'activity', 'docs',
        'billing', 'roles', 'departments', 'office-locations', 'leads-setup',
        'form-setup', 'email-config', 'appearance', 'settings', 'profile',
        'external-clients', 'visitors', 'transfers', 'dashboard',
    ];

    /**
     * The Applicant section's MODE + the tracker's DB credentials:
     *   'shared' — the read-only Perfex tracker. Reads the client's OWN secondary DB
     *              (`applicant_db` = host/port/db/user/pass) when set, else the global
     *              .env `database.secondary.*` server.
     *   'own'    — the client's OWN applicant table, whose columns THEY define.
     */
    private function applicantSourceMap(): array
    {
        $map  = $this->settingsMap();
        $mode = in_array($map['applicant_source'] ?? '', ['shared', 'own'], true) ? $map['applicant_source'] : 'shared';
        $db   = json_decode((string) ($map['applicant_db'] ?? ''), true);

        return ['mode' => $mode, 'db' => is_array($db) ? $db : []];
    }

    /** A SELECT-only connection config from the client's tracker-DB credentials. */
    private function ownSecondaryConfig(array $db): array
    {
        return [
            'hostname' => trim((string) ($db['host'] ?? '')),
            'port'     => (int) ($db['port'] ?? 3306) ?: 3306,
            'database' => trim((string) ($db['database'] ?? '')),
            'username' => trim((string) ($db['username'] ?? '')),
            'password' => (string) ($db['password'] ?? ''),
            'DBDriver' => 'MySQLi',
        ];
    }

    /** The DB the tracker reads: THIS project's own creds only. No shared/.env
     *  fallback — a project without its own applicant DB is "not configured". */
    private function resolvedSecondaryDb(): SecondaryDb
    {
        $db = $this->applicantSourceMap()['db'];
        if (trim((string) ($db['host'] ?? '')) !== '' && trim((string) ($db['database'] ?? '')) !== '') {
            return new SecondaryDb($this->ownSecondaryConfig($db), false);
        }

        return new SecondaryDb(null, false); // per-project only — not configured
    }

    /** The client-defined applicant table columns (sanitized): key,label,type,required,options. */
    private function applicantColumnDefs(): array
    {
        $defs = json_decode((string) ($this->settingsMap()['applicant_columns'] ?? '[]'), true);
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

    /** GET /client/applicant-source — mode + tracker DB creds (no password) + own column defs. */
    public function applicantSource()
    {
        $src = $this->applicantSourceMap();
        $db  = $src['db'];

        return $this->respond([
            'mode'              => $src['mode'],
            'global_configured' => false, // shared/.env applicant DB removed — each project uses its own
            'db'                => [
                'host'         => (string) ($db['host'] ?? ''),
                'port'         => (int) ($db['port'] ?? 3306) ?: 3306,
                'database'     => (string) ($db['database'] ?? ''),
                'username'     => (string) ($db['username'] ?? ''),
                'has_password' => ($db['password'] ?? '') !== '',
            ],
            'columns'           => $this->applicantColumnDefs(),
            'can_manage'        => $this->isAdmin(),
        ]);
    }

    /** POST /client/applicant-source — set mode ('shared'|'own') + the tracker DB creds (admin). */
    public function saveApplicantSource()
    {
        if (! $this->isAdmin()) {
            return $this->fail('Only the client admin can edit this.', 403);
        }
        $mode = in_array($this->input('mode'), ['shared', 'own'], true) ? $this->input('mode') : 'shared';
        $prev = $this->applicantSourceMap()['db'];
        $in   = (array) ($this->input('db') ?? []);
        $pass = (string) ($in['password'] ?? '');
        $db   = [
            'host'     => trim((string) ($in['host'] ?? '')),
            'port'     => (int) ($in['port'] ?? 3306) ?: 3306,
            'database' => trim((string) ($in['database'] ?? '')),
            'username' => trim((string) ($in['username'] ?? '')),
            // A blank password field keeps the stored one (so it isn't wiped on edit).
            'password' => $pass !== '' ? $pass : (string) ($prev['password'] ?? ''),
        ];
        $this->setSetting('applicant_source', $mode);
        $this->setSetting('applicant_db', json_encode($db));
        $this->logActivity('updated', 'settings', null, 'Set applicant section source: ' . $mode);

        return $this->respond(['message' => 'Saved', 'mode' => $mode]);
    }

    /** POST /client/applicant-source/test — try connecting to posted tracker DB creds (admin). */
    public function testApplicantSource()
    {
        if (! $this->isAdmin()) {
            return $this->fail('Only the client admin can test this.', 403);
        }
        $in   = (array) ($this->input('db') ?? []);
        $pass = (string) ($in['password'] ?? '');
        if ($pass === '') {
            $pass = (string) ($this->applicantSourceMap()['db']['password'] ?? ''); // reuse saved on blank
        }
        $db = new SecondaryDb($this->ownSecondaryConfig([
            'host' => $in['host'] ?? '', 'port' => $in['port'] ?? 3306,
            'database' => $in['database'] ?? '', 'username' => $in['username'] ?? '', 'password' => $pass,
        ]));
        if (! $db->isConfigured()) {
            return $this->respond(['ok' => false, 'message' => 'Enter at least a host and database name.']);
        }
        try {
            $db->selectRow('SELECT 1 AS ok');
            $has = false;
            try {
                $db->selectRow('SELECT COUNT(*) AS n FROM tblclients');
                $has = true;
            } catch (\Throwable $e) {
                // connected, but not a matching applicant (Perfex) schema
            }

            return $this->respond([
                'ok'      => true,
                'message' => $has ? 'Connected — applicant tables found.' : 'Connected, but no "tblclients" table — the tracker needs a Perfex-style applicant DB.',
                'schema'  => $has,
            ]);
        } catch (\Throwable $e) {
            return $this->respond(['ok' => false, 'message' => $e->getMessage()]);
        }
    }

    /** POST /client/applicant-columns — save the client's own applicant table columns (admin). */
    public function saveApplicantColumns()
    {
        if (! $this->isAdmin()) {
            return $this->fail('Only the client admin can edit columns.', 403);
        }
        $cols = [];
        $seen = [];
        foreach ((array) ($this->input('columns') ?? []) as $d) {
            if (! is_array($d)) {
                continue;
            }
            $label = trim((string) ($d['label'] ?? ''));
            if ($label === '') {
                continue;
            }
            $base = preg_replace('/[^a-z0-9_]/', '', strtolower(str_replace([' ', '-'], '_', (string) (($d['key'] ?? '') ?: $label))));
            $key  = $base !== '' ? $base : 'col';
            while (isset($seen[$key])) {
                $key .= '_';
            }
            $seen[$key] = true;
            $type       = in_array($d['type'] ?? 'text', self::CUSTOM_FIELD_TYPES, true) ? $d['type'] : 'text';
            $cols[]     = [
                'key'      => $key,
                'label'    => $label,
                'type'     => $type,
                'required' => ! empty($d['required']),
                'options'  => ($type === 'select' && is_array($d['options'] ?? null))
                    ? array_values(array_filter(array_map(static fn ($o) => trim((string) $o), $d['options']), static fn ($o) => $o !== ''))
                    : [],
            ];
        }
        $this->setSetting('applicant_columns', json_encode($cols));
        $this->logActivity('updated', 'settings', null, 'Updated applicant table columns');

        return $this->respond(['message' => 'Saved', 'columns' => $cols]);
    }

    /** A short, searchable text blob from a record's values (for LIKE search). */
    private function applicantSearchBlob(array $data): string
    {
        return mb_substr(trim(implode(' ', array_map('strval', array_values($data)))), 0, 2000);
    }

    /** Pull + type-coerce a record's values from input, keyed by the defined columns. */
    private function applicantRecordData(array $cols): array
    {
        $in   = (array) ($this->input('data') ?? []);
        $data = [];
        foreach ($cols as $c) {
            if (! array_key_exists($c['key'], $in)) {
                continue;
            }
            $v                = $in[$c['key']];
            $data[$c['key']]  = $c['type'] === 'number'
                ? (($v === '' || $v === null) ? '' : (string) (0 + $v))
                : trim((string) $v);
        }

        return $data;
    }

    /** Required-column validation for an applicant record. */
    private function applicantRecordErrors(array $cols, array $data): array
    {
        $e = [];
        foreach ($cols as $c) {
            if (! empty($c['required']) && trim((string) ($data[$c['key']] ?? '')) === '') {
                $e[$c['key']] = $c['label'] . ' is required.';
            }
        }

        return $e;
    }

    /** GET /client/applicant-records — the client's own applicant rows (paginated + searchable). */
    public function applicantRecords()
    {
        if (! $this->isAdmin()) {
            return $this->fail('Only the client admin can view applicants.', 403);
        }
        $cols    = $this->applicantColumnDefs();
        $perPage = max(1, min(200, (int) ($this->request->getGet('per_page') ?: 50)));
        $page    = max(1, (int) ($this->request->getGet('page') ?: 1));
        $q       = trim((string) ($this->request->getGet('q') ?? ''));

        $b = (new ApplicantModel())->where('client_id', $this->clientId());
        if ($q !== '') {
            $b->like('search_blob', $q);
        }
        $total = $b->countAllResults(false);
        $rows  = $b->orderBy('id', 'DESC')->findAll($perPage, ($page - 1) * $perPage);

        $out = [];
        foreach ($rows as $r) {
            $out[] = [
                'id'         => (int) $r['id'],
                'data'       => (object) (json_decode((string) ($r['data'] ?? '{}'), true) ?: []),
                'created_at' => $r['created_at'] ?? null,
                'updated_at' => $r['updated_at'] ?? null,
            ];
        }

        return $this->respond(['rows' => $out, 'total' => $total, 'page' => $page, 'per_page' => $perPage, 'columns' => $cols]);
    }

    /** POST /client/applicant-records — add an applicant to the client's own table (admin). */
    public function createApplicantRecord()
    {
        if (! $this->isAdmin()) {
            return $this->fail('Only the client admin can add applicants.', 403);
        }
        $cols = $this->applicantColumnDefs();
        $data = $this->applicantRecordData($cols);
        if ($errs = $this->applicantRecordErrors($cols, $data)) {
            return $this->failValidationErrors($errs);
        }
        $id = (new ApplicantModel())->insert([
            'client_id'   => $this->clientId(),
            'data'        => json_encode((object) $data),
            'search_blob' => $this->applicantSearchBlob($data),
        ]);
        $this->logActivity('created', 'applicant', (int) $id, 'Added applicant');

        return $this->respondCreated(['message' => 'Added', 'id' => (int) $id]);
    }

    /** POST /client/applicant-records/{id} — edit one applicant record (admin). */
    public function updateApplicantRecord(int $id)
    {
        if (! $this->isAdmin()) {
            return $this->fail('Only the client admin can edit applicants.', 403);
        }
        $model = new ApplicantModel();
        if (! $model->where('client_id', $this->clientId())->find($id)) {
            return $this->failNotFound('Applicant not found');
        }
        $cols = $this->applicantColumnDefs();
        $data = $this->applicantRecordData($cols);
        if ($errs = $this->applicantRecordErrors($cols, $data)) {
            return $this->failValidationErrors($errs);
        }
        $model->update($id, ['data' => json_encode((object) $data), 'search_blob' => $this->applicantSearchBlob($data)]);
        $this->logActivity('updated', 'applicant', $id, 'Updated applicant');

        return $this->respond(['message' => 'Saved']);
    }

    /** POST /client/applicant-records/{id}/delete — soft-delete one applicant record (admin). */
    public function deleteApplicantRecord(int $id)
    {
        if (! $this->isAdmin()) {
            return $this->fail('Only the client admin can delete applicants.', 403);
        }
        $model = new ApplicantModel();
        if (! $model->where('client_id', $this->clientId())->find($id)) {
            return $this->failNotFound('Applicant not found');
        }
        $model->delete($id); // soft delete
        $this->logActivity('deleted', 'applicant', $id, 'Deleted applicant');

        return $this->respond(['message' => 'Deleted']);
    }

    /** The Applicant section's configured label + slug (with defaults applied). */
    private function applicantConfigMap(): array
    {
        $map    = $this->settingsMap();
        $label  = trim((string) ($map['applicant_label'] ?? ''));
        $slug   = trim((string) ($map['applicant_slug'] ?? ''));
        $colors = json_decode((string) ($map['applicant_colors'] ?? ''), true);

        return [
            'label'  => $label !== '' ? $label : self::APPLICANT_DEFAULTS['label'],
            'slug'   => $slug !== '' ? $slug : self::APPLICANT_DEFAULTS['slug'],
            // Admin-defined value → hex colour map (e.g. {"YES":"#16a34a"}). The
            // frontend colours a cell whose value matches (case-insensitive).
            'colors' => is_array($colors) ? $colors : (object) [],
            // How many leading columns stay frozen (pinned) while scrolling (0–5).
            // Defaults to 1 so the Name column is pinned out of the box.
            'frozen' => max(0, min(5, (int) ($map['applicant_frozen'] ?? 1))),
        ];
    }

    /**
     * GET /client/applicant-config — the Applicant section's label + URL slug.
     * Readable by any signed-in client user (the sidebar needs it to build the
     * nav link + route).
     */
    public function applicantConfig()
    {
        return $this->respond($this->applicantConfigMap());
    }

    /**
     * POST /client/applicant-config — rename the Applicant section and/or change
     * its URL slug. Admin-only. Slug must be url-safe and not collide with a
     * built-in section.
     */
    public function saveApplicantConfig()
    {
        if (! $this->isAdmin()) {
            return $this->fail('Only the client admin can edit this section.', 403);
        }

        $label = trim((string) $this->input('label'));
        $slug  = strtolower(trim((string) $this->input('slug')));

        if ($label === '' || mb_strlen($label) > 40) {
            return $this->failValidationErrors('The section name must be 1–40 characters.');
        }
        // A tidy, url-safe slug: starts with a letter, then letters/digits/hyphens.
        if (! preg_match('/^[a-z][a-z0-9-]{0,30}$/', $slug)) {
            return $this->failValidationErrors('The URL must be lowercase letters, numbers and hyphens (e.g. "applicant" or "customer").');
        }
        if (in_array($slug, self::RESERVED_SLUGS, true)) {
            return $this->failValidationErrors("The URL \"{$slug}\" is already used by another section — pick a different one.");
        }

        // Value → colour map: keys are cell values (max 60 chars), values are
        // #rgb/#rrggbb hex. Anything malformed is dropped.
        $colorsIn  = $this->input('colors');
        $colorsOut = [];
        if (is_array($colorsIn)) {
            foreach ($colorsIn as $k => $v) {
                $k = trim((string) $k);
                $v = trim((string) $v);
                if ($k !== '' && mb_strlen($k) <= 60 && preg_match('/^#([0-9a-f]{3}|[0-9a-f]{6})$/i', $v)) {
                    $colorsOut[$k] = strtolower($v);
                    if (count($colorsOut) >= 100) {
                        break; // sane cap
                    }
                }
            }
        }

        $frozen = max(0, min(5, (int) $this->input('frozen')));

        $this->setSetting('applicant_label', $label);
        $this->setSetting('applicant_slug', $slug);
        $this->setSetting('applicant_colors', json_encode($colorsOut));
        $this->setSetting('applicant_frozen', (string) $frozen);
        $this->logActivity('updated', 'settings', null, 'Updated the Applicant section', $this->clientId());

        return $this->respond($this->applicantConfigMap());
    }

    // ========================================================= LEAD → APPLICANT
    //
    // Admin-configurable "Convert to Applicant" action on a lead: an admin sets
    // the button label, the form fields, the external API endpoint to POST them
    // to (the applicant system's own API), and the lead status to move to on
    // success. Clicking the button opens that form; submitting forwards it to
    // the API and flips the lead's status.

    /** The convert-to-applicant config (parsed). $full includes the API settings. */
    private function convertConfigMap(bool $full = false): array
    {
        $map    = $this->settingsMap();
        $fields = json_decode((string) ($map['convert_fields'] ?? ''), true);
        $fields = is_array($fields) ? array_values($fields) : [];

        // Convert target is decided by whether an API URL is set:
        //   • URL set        → POST the admin-defined `fields` to that URL (any section mode);
        //   • URL blank + own → create a record in the client's own applicant table,
        //                       using its columns as the form.
        $mode  = $this->applicantSourceMap()['mode'];
        $apiUrl = trim((string) ($map['convert_api_url'] ?? ''));
        if ($mode === 'own' && $apiUrl === '') {
            $fields = $this->applicantColumnDefs();
        }

        $out = [
            'enabled'        => (string) ($map['convert_enabled'] ?? '0') === '1',
            'label'          => trim((string) ($map['convert_label'] ?? '')) ?: 'Convert to Applicant',
            'status_id'      => (int) ($map['convert_status_id'] ?? 0),
            'applicant_mode' => $mode,
            'fields'         => $fields,
        ];
        if ($full) {
            $headers = json_decode((string) ($map['convert_api_headers'] ?? ''), true);
            $out['api_url']        = (string) ($map['convert_api_url'] ?? '');
            $out['api_method']     = strtoupper((string) ($map['convert_api_method'] ?? 'POST')) === 'PUT' ? 'PUT' : 'POST';
            $out['api_type']       = (string) ($map['convert_api_type'] ?? 'json') === 'form' ? 'form' : 'json';
            $out['api_headers']    = is_array($headers) ? $headers : (object) [];
            // API key: sent as a header to authenticate the endpoint. The secret is
            // never returned — only the header name + whether one is stored.
            $out['api_key_header'] = trim((string) ($map['convert_api_key_header'] ?? '')) ?: 'X-Api-Key';
            $out['has_api_key']    = trim((string) ($map['convert_api_key'] ?? '')) !== '';
            // Static extra POST-body fields sent with every convert (e.g. a CSRF
            // token: csrf_token_name => <value>). Merged into the request body.
            $extra              = json_decode((string) ($map['convert_extra_fields'] ?? ''), true);
            $out['extra_fields'] = is_array($extra) ? (object) $extra : (object) [];
        }

        return $out;
    }

    /**
     * GET /client/convert-config — the convert-to-applicant config. Any leads
     * user gets the button label + form fields; the admin also gets the API
     * settings (url/method/headers) for editing.
     */
    public function convertConfig()
    {
        if ($resp = $this->requirePermission('leads')) {
            return $resp;
        }

        return $this->respond($this->convertConfigMap($this->isAdmin()));
    }

    /** POST /client/convert-config — save the convert-to-applicant config (admin). */
    public function saveConvertConfig()
    {
        if (! $this->isAdmin()) {
            return $this->fail('Only the client admin can configure this.', 403);
        }

        // Form fields: [{key,label,type,required}] — key is a safe slug.
        $fieldsIn  = $this->input('fields');
        $fieldsOut = [];
        if (is_array($fieldsIn)) {
            foreach ($fieldsIn as $f) {
                $key = preg_replace('/[^a-z0-9_]/i', '', (string) ($f['key'] ?? ''));
                if ($key === '') {
                    continue;
                }
                $type = in_array(($f['type'] ?? 'text'), ['text', 'email', 'number', 'date', 'textarea', 'tel'], true) ? $f['type'] : 'text';
                $fieldsOut[] = [
                    'key'      => $key,
                    'label'    => mb_substr(trim((string) ($f['label'] ?? $key)), 0, 60) ?: $key,
                    'type'     => $type,
                    'required' => ! empty($f['required']),
                ];
                if (count($fieldsOut) >= 60) {
                    break;
                }
            }
        }

        // Headers: string→string map.
        $headersIn  = $this->input('api_headers');
        $headersOut = [];
        if (is_array($headersIn)) {
            foreach ($headersIn as $k => $v) {
                $k = trim((string) $k);
                if ($k !== '') {
                    $headersOut[$k] = (string) $v;
                }
            }
        }

        $url = trim((string) $this->input('api_url'));
        if ($url !== '' && ! preg_match('#^https?://#i', $url)) {
            return $this->failValidationErrors('The API URL must start with http:// or https://.');
        }

        $this->setSetting('convert_enabled', ! empty($this->input('enabled')) ? '1' : '0');
        $this->setSetting('convert_label', mb_substr(trim((string) $this->input('label')), 0, 40));
        $this->setSetting('convert_status_id', (string) (int) $this->input('status_id'));
        $this->setSetting('convert_api_url', $url);
        $this->setSetting('convert_api_method', strtoupper((string) $this->input('api_method')) === 'PUT' ? 'PUT' : 'POST');
        $this->setSetting('convert_api_type', (string) $this->input('api_type') === 'form' ? 'form' : 'json');
        $this->setSetting('convert_api_headers', json_encode($headersOut));
        $this->setSetting('convert_fields', json_encode($fieldsOut));

        // API key auth: header NAME always saved; the secret only changes when a new
        // one is typed (blank keeps the stored key), or is wiped when 'api_key_clear'.
        $this->setSetting('convert_api_key_header', mb_substr(trim((string) $this->input('api_key_header')), 0, 60) ?: 'X-Api-Key');
        $keyIn = (string) $this->input('api_key');
        if ($keyIn !== '') {
            $this->setSetting('convert_api_key', mb_substr($keyIn, 0, 255));
        } elseif ($this->input('api_key_clear')) {
            $this->setSetting('convert_api_key', '');
        }

        // Static extra POST-body fields (name → value), e.g. a CSRF token field.
        $extraIn  = $this->input('extra_fields');
        $extraOut = [];
        if (is_array($extraIn)) {
            foreach ($extraIn as $k => $v) {
                $k = trim((string) $k);
                if ($k !== '') {
                    $extraOut[$k] = mb_substr((string) $v, 0, 500);
                }
            }
        }
        $this->setSetting('convert_extra_fields', json_encode((object) $extraOut));
        $this->logActivity('updated', 'settings', null, 'Updated the lead-conversion config', $this->clientId());

        return $this->respond($this->convertConfigMap(true));
    }

    /**
     * POST /client/leads/{id}/convert — submit the convert form for a lead:
     * forward the values to the configured external API, and on success move the
     * lead to the configured status. Body: { values: {key:value,...} }.
     */
    public function convertLead(int $id)
    {
        if ($resp = $this->requirePermission('leads', 'update')) {
            return $resp;
        }
        $cid  = $this->clientId();
        $lead = (new LeadModel())->where('client_id', $cid)->find($id);
        if (! $lead || ! $this->canSeeLead($lead)) {
            return $this->failNotFound('Lead not found');
        }

        $cfg = $this->convertConfigMap(true);
        if (! $cfg['enabled']) {
            return $this->fail('Lead conversion is not enabled.', 400);
        }

        $valuesIn = $this->input('values');
        $values   = is_array($valuesIn) ? $valuesIn : [];

        // Validate the required fields (own columns or admin fields, per mode).
        $missing = [];
        foreach ($cfg['fields'] as $f) {
            if (! empty($f['required']) && trim((string) ($values[$f['key']] ?? '')) === '') {
                $missing[] = $f['label'] ?? $f['key'];
            }
        }
        if ($missing) {
            return $this->failValidationErrors('Please fill: ' . implode(', ', $missing) . '.');
        }

        // A configured API URL ALWAYS wins — POST to it regardless of section mode.
        // Only when there's NO URL do we fall back to writing the own applicant table.
        if (trim((string) ($cfg['api_url'] ?? '')) === '') {
            if (($cfg['applicant_mode'] ?? 'shared') === 'own') {
                $cols = $this->applicantColumnDefs();
                $data = [];
                foreach ($cols as $c) {
                    $v               = $values[$c['key']] ?? '';
                    $data[$c['key']] = $c['type'] === 'number'
                        ? (($v === '' || $v === null) ? '' : (string) (0 + $v))
                        : trim((string) $v);
                }
                (new ApplicantModel())->insert([
                    'client_id'   => $cid,
                    'data'        => json_encode((object) $data),
                    'search_blob' => $this->applicantSearchBlob($data),
                ]);
                // Lock the lead: mark converted (+ move status if configured).
                $upd = ['converted_at' => date('Y-m-d H:i:s')];
                if ($cfg['status_id'] > 0) {
                    $upd['status_id'] = $cfg['status_id'];
                }
                (new LeadModel())->update($id, $upd);
                $this->logActivity('converted', 'lead', $id, 'Converted lead to applicant (own table)');

                return $this->respond(['ok' => true, 'message' => 'Lead converted — applicant added to your table.']);
            }

            return $this->fail('No conversion API URL is set. Add it in Convert-to-Applicant setup (or use "My own table" mode to save into your table).', 400);
        }

        // Only forward the configured fields (+ the lead id for reference).
        $payload = ['lead_id' => $id];
        foreach ($cfg['fields'] as $f) {
            $payload[$f['key']] = (string) ($values[$f['key']] ?? '');
        }
        // Admin-set static body fields (e.g. a CSRF token: csrf_token_name => value).
        $extra = json_decode((string) ($map['convert_extra_fields'] ?? ''), true);
        if (is_array($extra)) {
            foreach ($extra as $k => $v) {
                if (trim((string) $k) !== '') {
                    $payload[$k] = (string) $v;
                }
            }
        }

        // Forward to the external API. Merge, in order: Accept, admin headers, and
        // the API key header (authenticates the endpoint — e.g. a CSRF-excluded cron).
        $map       = $this->settingsMap();
        $headers   = array_merge(['Accept' => 'application/json'], (array) $cfg['api_headers']);
        $apiKey    = trim((string) ($map['convert_api_key'] ?? ''));
        if ($apiKey !== '') {
            $keyHeader           = trim((string) ($map['convert_api_key_header'] ?? '')) ?: 'X-Api-Key';
            $headers[$keyHeader] = $apiKey;
        }
        try {
            $client  = \Config\Services::curlrequest(['timeout' => 20, 'http_errors' => false]);
            $options = ['headers' => $headers];
            if ($cfg['api_type'] === 'form') {
                $options['form_params'] = $payload;
            } else {
                $options['json'] = $payload;
            }
            $res    = $client->request($cfg['api_method'], $cfg['api_url'], $options);
            $status = $res->getStatusCode();
            $body   = (string) $res->getBody();
        } catch (\Throwable $e) {
            $raw = $e->getMessage();
            log_message('error', 'convertLead API call to ' . $cfg['api_url'] . ' failed: ' . $raw);

            // Translate the common cURL failures into a plain, actionable message.
            $hint = 'Check the URL is correct and reachable.';
            if (stripos($raw, 'wrong version number') !== false || stripos($raw, 'SSL routines') !== false) {
                $scheme = str_starts_with(strtolower($cfg['api_url']), 'https') ? 'https://' : 'http://';
                $other  = $scheme === 'https://' ? 'http://' : 'https://';
                $hint   = "The server answered plain HTTP to an {$scheme} request (SSL mismatch). Change the API URL scheme from {$scheme} to {$other}.";
            } elseif (stripos($raw, 'resolve host') !== false || stripos($raw, "couldn't resolve") !== false) {
                $hint = 'The domain could not be resolved — check the hostname / DNS.';
            } elseif (stripos($raw, 'timed out') !== false || stripos($raw, 'timeout') !== false) {
                $hint = 'The server did not respond in time (timeout).';
            } elseif (stripos($raw, 'refused') !== false) {
                $hint = 'Connection refused — the host or port isn\'t accepting requests.';
            } elseif (stripos($raw, 'certificate') !== false) {
                $hint = 'The server\'s SSL certificate could not be verified.';
            }

            return $this->fail("Couldn't reach the conversion API ({$cfg['api_method']} {$cfg['api_url']}). {$hint}", 502);
        }

        if ($status < 200 || $status >= 300) {
            $snippet = trim(mb_substr(strip_tags($body), 0, 200));

            return $this->fail("The conversion API ({$cfg['api_url']}) returned HTTP {$status}."
                . ($snippet !== '' ? ' Response: ' . $snippet : ''), 502);
        }

        // Success → lock the lead (converted) + move to the configured status.
        $upd = ['converted_at' => date('Y-m-d H:i:s')];
        if ($cfg['status_id'] > 0) {
            $upd['status_id'] = $cfg['status_id'];
        }
        (new LeadModel())->update($id, $upd);
        $this->logActivity('converted', 'lead', $id, 'Converted lead to applicant');

        return $this->respond([
            'ok'         => true,
            'message'    => 'Lead converted.',
            'api_status' => $status,
            'api_body'   => json_decode($body, true) ?? $body,
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
            ->where('deleted_at', null)
            ->where('(pending_transfer IS NULL OR pending_transfer = 0)'); // match the table
        $this->applyLeadScope($b);
        $this->applyLeadFilters($b);
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
        if (! $this->canActOnReferenceLead($lead)) {
            return $this->failForbidden('You can only transfer your own reference leads.');
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
        // When the visitor is logged against a lead, an agent may only do so for
        // their own reference leads (not leads merely assigned to them).
        if (! empty($data['lead_id'])) {
            $lead = (new LeadModel())->where('client_id', $cid)->find((int) $data['lead_id']);
            if (! $lead || ! $this->canActOnReferenceLead($lead)) {
                return $this->failForbidden('You can only log a visitor for your own reference leads.');
            }
        }
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
        $scope  = $this->leadFormScope((int) ($data['lead_type_id'] ?? 0));
        $custom = $this->formCustomValues('lead', (array) $this->input(), $scope);
        if ($errs = $this->formFieldErrors('lead', $data, $custom, $scope)) {
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
        // Attach any calls already made to this number (ingested before the lead
        // existed, so lead_id was null) to the new lead.
        $this->linkCallsToLead($cid, (int) $id, (string) $data['phone'], $data['alt_phone'] ?? null);
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
        // A converted lead is locked — it can no longer be edited.
        if (! empty($old['converted_at'])) {
            return $this->fail('This lead has been converted to an applicant and is locked — it can no longer be edited.', 409);
        }

        $data   = $this->leadData($cid);
        $scope  = $this->leadFormScope((int) ($data['lead_type_id'] ?? 0));
        $custom = $this->formCustomValues('lead', (array) $this->input(), $scope);
        if ($errs = $this->formFieldErrors('lead', $data, $custom, $scope)) {
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
        // If the phone number changed, attach any existing calls for the new
        // number to this lead (calls for the old number keep their link).
        if ((string) ($data['phone'] ?? '') !== (string) ($old['phone'] ?? '') || (string) ($data['alt_phone'] ?? '') !== (string) ($old['alt_phone'] ?? '')) {
            $this->linkCallsToLead($cid, $id, (string) $data['phone'], $data['alt_phone'] ?? null);
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
        // Created date: a choice, not a free-text date — "new" stamps today,
        // "keep" leaves it untouched.
        if (! empty($in['change_created']) && ($in['created_mode'] ?? 'new') === 'new') {
            $common['created_date'] = date('Y-m-d');
        }
        // Reference: resolve the chosen reference's stable id + a name snapshot.
        if (! empty($in['change_reference'])) {
            $refId   = (int) ($in['reference_id'] ?? 0) ?: null;
            $refName = trim((string) ($in['reference_name'] ?? '')) ?: null;
            if ($refId) {
                $ref     = (new LeadReferenceModel())->where('client_id', $cid)->find($refId);
                $refId   = $ref ? (int) $ref['id'] : null;
                $refName = $ref ? $ref['name'] : $refName;
            }
            $common['reference_id']   = $refId;
            $common['reference_name'] = $refName;
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

        // "Mass assignation" — treat each lead as fresh: clear the previous rep's
        // reminders/notes/follow-up/first-response so the new assignee starts clean.
        $massAssign = ! empty($in['mass_assign']);

        // Assignment date+time (optional) — defaults to now when not provided.
        $assignedAtIn = trim((string) ($in['assigned_at'] ?? ''));
        $now          = date('Y-m-d H:i:s');
        $assignWhen   = $now;
        if (preg_match('/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/', $assignedAtIn, $m)) {
            $assignWhen = $m[1] . ' ' . $m[2] . ':00';
        } elseif (preg_match('/^\d{4}-\d{2}-\d{2}$/', $assignedAtIn)) {
            $assignWhen = $assignedAtIn . ' 00:00:00';
        }

        if (! $common && ! $changeAssign && ! $massAssign) {
            return $this->fail('Choose at least one field to change.', 422);
        }

        $notify      = ! empty($in['notify']);
        $updated     = 0;
        $cursor      = 0; // round-robin position
        $perAssignee = [];

        foreach ($leads as $lead) {
            $data   = $common;
            $leadId = (int) $lead['id'];
            if ($changeAssign) {
                $assignTo = $assignees ? $assignees[$cursor % count($assignees)] : null;
                $cursor++;
                $data['assigned_to']   = $assignTo;
                $data['assigned_date'] = $assignTo ? $assignWhen : null;
                if ($assignTo && $assignTo !== (int) ($lead['assigned_to'] ?? 0)) {
                    $perAssignee[$assignTo] = ($perAssignee[$assignTo] ?? 0) + 1;
                }
            }
            if ($massAssign) {
                (new LeadReminderModel())->where('client_id', $cid)->where('lead_id', $leadId)->delete();
                (new LeadNoteModel())->where('client_id', $cid)->where('lead_id', $leadId)->delete();
                $data['follow_date']            = null;
                $data['first_response_seconds'] = null;
                $data['first_response_at']      = null;
                $data['description']            = null;
            }
            $model->skipValidation(true)->update($leadId, $data);
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

        // ---- Batch selections (chosen once at upload) — the FALLBACK for any row
        // that doesn't carry its own status/sub/source/type/assignee COLUMN. When
        // those columns are enabled, each row's value (matched by name) wins. ----
        $importCols = $this->leadImportColumns();
        $included   = [];
        foreach ($importCols as $c) {
            if (! empty($c['include'])) {
                $included[$c['key']] = true;
            }
        }
        $opt      = (array) ($this->input('options') ?? []);
        $statusId = (int) ($opt['status_id'] ?? 0);
        $status   = $statusId ? (new LeadStatusModel())->where('client_id', $cid)->find($statusId) : null;
        // A status must resolve per row — from the batch picker OR (when the Status
        // column is enabled) the row's own value. Only hard-fail upfront when
        // neither source can supply one.
        if (! $status && empty($included['status'])) {
            return $this->failValidationErrors(['status_id' => 'Pick a status to apply to the imported leads.']);
        }
        $statusId = $status ? $statusId : 0;
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
        $mandatory  = array_values(array_filter($importCols, static fn ($c) => ! empty($c['required']) && $c['key'] !== 'phone'));
        $customDefs = $this->formCustomFields('lead');

        // Name → id maps for the per-row lookup columns (case-insensitive).
        $mapNames = static function (array $rows): array {
            $m = [];
            foreach ($rows as $r) {
                $n = mb_strtolower(trim((string) ($r['name'] ?? '')));
                if ($n !== '' && ! isset($m[$n])) {
                    $m[$n] = (int) $r['id'];
                }
            }

            return $m;
        };
        $allStatuses = $this->lookupRows(LeadStatusModel::class, $cid);
        $isSubRow    = static function (array $r): bool {
            if (! empty($r['parent_id'])) {
                return true;
            }
            $p = json_decode((string) ($r['parent_ids'] ?? ''), true);

            return is_array($p) && count($p) > 0;
        };
        $statusMap = $mapNames(array_filter($allStatuses, static fn ($r) => ! $isSubRow($r)));
        $subMap    = $mapNames(array_filter($allStatuses, $isSubRow));
        $sourceMap = $mapNames($this->lookupRows(LeadSourceModel::class, $cid));
        $typeMap   = $mapNames($this->lookupRows(LeadTypeModel::class, $cid));
        $staffMap  = $mapNames((new ClientStaffModel())->where('client_id', $cid)->findAll());
        // Resolve a row cell against a name→id map → [id|null, ok]. Blank → fallback.
        $pick = static function ($cell, array $map): array {
            $cell = trim((string) $cell);
            if ($cell === '') {
                return [null, true];
            }
            $id = $map[mb_strtolower($cell)] ?? null;

            return [$id, $id !== null];
        };

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

            // Per-row lookup columns (name → id): a non-empty unmatched value fails
            // the row; a blank falls back to the batch pick above.
            $rowStatus = $statusId;
            $rowSub    = $subId;
            $rowSource = $sourceId;
            $rowType   = $typeId;
            $rowAssign = null;
            $bad       = null;
            foreach ([['status', $statusMap], ['sub_status', $subMap], ['source', $sourceMap], ['lead_type', $typeMap], ['assigned_to', $staffMap]] as $lk) {
                [$lid, $ok] = $pick($row[$lk[0]] ?? '', $lk[1]);
                if (! $ok) {
                    $bad = 'Unknown ' . str_replace('_', ' ', $lk[0]) . ' "' . trim((string) $row[$lk[0]]) . '".';
                    break;
                }
                if ($lid !== null) {
                    if ($lk[0] === 'status') {
                        $rowStatus = $lid;
                    } elseif ($lk[0] === 'sub_status') {
                        $rowSub = $lid;
                    } elseif ($lk[0] === 'source') {
                        $rowSource = $lid;
                    } elseif ($lk[0] === 'lead_type') {
                        $rowType = $lid;
                    } else {
                        $rowAssign = $lid;
                    }
                }
            }
            if ($bad !== null) {
                $errors[] = ['row' => $line, 'message' => $bad];

                continue;
            }
            if (! $rowStatus) {
                $errors[] = ['row' => $line, 'message' => 'Status is required.'];

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

            // A row's own "Assigned to" wins; otherwise fall back to round-robin.
            $assignTo = $rowAssign ?: ($assignees ? $assignees[$n % count($assignees)] : null);

            $data = [
                'client_id'      => $cid,
                'name'           => trim((string) ($row['name'] ?? '')),
                'phone'          => $phone,
                'alt_phone'      => $altPhone !== '' ? $altPhone : null,
                'status_id'      => $rowStatus,
                'sub_status_id'  => $rowSub,
                'lead_type_id'   => $rowType,
                'source_id'      => $rowSource,
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
        $cid   = $this->clientId();
        $cfg   = [];
        $saved = json_decode((string) ($this->settingsMap()['lead_import_fields'] ?? '[]'), true);
        if (is_array($saved)) {
            foreach ($saved as $c) {
                if (is_array($c) && isset($c['key'])) {
                    $cfg[(string) $c['key']] = ['include' => ! empty($c['include']), 'required' => ! empty($c['required'])];
                }
            }
        }
        // Build one column definition; `type`/`options` drive the sample download
        // and (for lookup columns) the per-row name→id matching on import.
        $col = static fn (string $key, string $label, bool $defInc, bool $defReq, string $type, array $options, bool $custom, bool $locked = false): array => [
            'key'      => $key,
            'label'    => $label,
            'include'  => $cfg[$key]['include'] ?? $defInc,
            'required' => $cfg[$key]['required'] ?? $defReq,
            'custom'   => $custom,
            'locked'   => $locked,
            'type'     => $type,
            'options'  => array_values($options),
        ];

        $cols = [$col('phone', 'Phone (contact)', true, true, 'text', [], false, true)];
        foreach (self::LEAD_IMPORT_COLUMNS as $k => $label) {
            $cols[] = $col($k, $label, true, false, $k === 'email' ? 'email' : 'text', [], false);
        }

        // Lookup columns — value matched to a status/source/type/staff by NAME on
        // import (opt-in; the upload dialog's picker is the fallback for blanks).
        // `options` are the live allowed values, surfaced in the sample download.
        $statuses = $this->lookupRows(LeadStatusModel::class, $cid);
        $isSub    = static function (array $r): bool {
            if (! empty($r['parent_id'])) {
                return true;
            }
            $p = json_decode((string) ($r['parent_ids'] ?? ''), true);

            return is_array($p) && count($p) > 0;
        };
        $namesOf = static fn (array $rows) => array_values(array_filter(array_map(static fn ($r) => (string) ($r['name'] ?? ''), $rows), static fn ($n) => $n !== ''));

        $cols[] = $col('status', 'Status', false, false, 'select', $namesOf(array_filter($statuses, static fn ($r) => ! $isSub($r))), false);
        $cols[] = $col('sub_status', 'Sub status', false, false, 'select', $namesOf(array_filter($statuses, $isSub)), false);
        $cols[] = $col('source', 'Source', false, false, 'select', $namesOf($this->lookupRows(LeadSourceModel::class, $cid)), false);
        $cols[] = $col('lead_type', 'Lead type', false, false, 'select', $namesOf($this->lookupRows(LeadTypeModel::class, $cid)), false);
        $cols[] = $col('assigned_to', 'Assigned to', false, false, 'select', $namesOf((new ClientStaffModel())->where('client_id', $cid)->orderBy('name', 'ASC')->findAll()), false);

        foreach ($this->formCustomFields('lead') as $f) {
            $cols[] = $col($f['key'], $f['label'], true, ! empty($f['required']), $f['type'] ?? 'text', $f['options'] ?? [], true);
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

    // ============================================= EXCEL DATA HUB (import) ===
    //
    // Generic spreadsheet import for TASKS and TEAM (leads keep their own richer
    // path above). Each entity has a locked required column + fixed data columns +
    // its custom fields; the include/mandatory flags live in the settings key
    // `<entity>_import_fields`. The frontend Excel hub maps sheet headers to these
    // keys, previews issues, then posts `{ rows, options }` here.

    private const IMPORT_ENTITIES = [
        'task' => [
            'locked'  => ['key' => 'title', 'label' => 'Title'],
            'columns' => ['description' => 'Description', 'priority' => 'Priority', 'type' => 'Type', 'status' => 'Status', 'start_date' => 'Start date', 'due_date' => 'Due date'],
            'form'    => 'task',
            'perm'    => 'tasks',
        ],
        'team' => [
            'locked'  => ['key' => 'name', 'label' => 'Name'],
            'columns' => ['email' => 'Email', 'phone' => 'Phone', 'alt_phone' => 'Alternative phone', 'designation' => 'Designation', 'emp_code' => 'Employee code'],
            'form'    => 'staff',
            'perm'    => 'team',
        ],
    ];

    /** Import template columns for an entity (locked key + fixed cols + custom fields), with saved flags. */
    private function genericImportColumns(string $entity): array
    {
        $spec = self::IMPORT_ENTITIES[$entity];
        $cfg  = [];
        foreach ((array) json_decode((string) ($this->settingsMap()[$entity . '_import_fields'] ?? '[]'), true) as $c) {
            if (is_array($c) && isset($c['key'])) {
                $cfg[(string) $c['key']] = ['include' => ! empty($c['include']), 'required' => ! empty($c['required'])];
            }
        }
        $cols = [['key' => $spec['locked']['key'], 'label' => $spec['locked']['label'], 'include' => true, 'required' => true, 'custom' => false, 'locked' => true]];
        foreach ($spec['columns'] as $k => $label) {
            $cols[] = ['key' => $k, 'label' => $label, 'include' => $cfg[$k]['include'] ?? true, 'required' => $cfg[$k]['required'] ?? false, 'custom' => false, 'locked' => false];
        }
        foreach ($this->formCustomFields($spec['form']) as $f) {
            $k      = $f['key'];
            $cols[] = ['key' => $k, 'label' => $f['label'], 'include' => $cfg[$k]['include'] ?? true, 'required' => $cfg[$k]['required'] ?? ! empty($f['required']), 'custom' => true, 'locked' => false];
        }

        return $cols;
    }

    /** GET /client/import-setup/{entity} — columns for lead|task|team (lead reuses the leads config). */
    public function importSetup(string $entity)
    {
        if ($entity === 'lead') {
            return $this->leadImportSetup();
        }
        if (! isset(self::IMPORT_ENTITIES[$entity])) {
            return $this->failNotFound('Unknown import type');
        }
        if (! $this->can(self::IMPORT_ENTITIES[$entity]['perm']) && ! $this->isAdmin()) {
            return $this->failForbidden('You do not have permission to view the import setup.');
        }

        return $this->respond(['columns' => $this->genericImportColumns($entity), 'can_manage' => $this->isAdmin()]);
    }

    /** POST /client/import-setup/{entity} — save include/mandatory column config (admin). */
    public function saveImportSetup(string $entity)
    {
        if ($entity === 'lead') {
            return $this->saveLeadImportSetup();
        }
        if (! isset(self::IMPORT_ENTITIES[$entity])) {
            return $this->failNotFound('Unknown import type');
        }
        if (! $this->isAdmin()) {
            return $this->failForbidden('Only an admin can change import columns.');
        }
        $locked = self::IMPORT_ENTITIES[$entity]['locked']['key'];
        $clean  = [];
        foreach ((array) $this->input('columns') as $c) {
            if (! is_array($c) || ! isset($c['key']) || (string) $c['key'] === $locked) {
                continue;
            }
            $clean[] = ['key' => (string) $c['key'], 'include' => ! empty($c['include']), 'required' => ! empty($c['required'])];
        }
        $this->setSetting($entity . '_import_fields', json_encode($clean));
        $this->logActivity('updated', 'settings', null, "Updated {$entity} import columns");

        return $this->respond(['message' => 'Saved', 'columns' => $this->genericImportColumns($entity)]);
    }

    /** Keep only real (non-deleted) staff ids of this client, preserving order. */
    private function validStaffIds(int $cid, array $ids): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $ids), static fn ($v) => $v > 0)));
        if (! $ids) {
            return [];
        }
        $valid = [];
        foreach ((new ClientStaffModel())->where('client_id', $cid)->findAll() as $st) {
            $valid[(int) $st['id']] = true;
        }

        return array_values(array_filter($ids, static fn ($id) => isset($valid[$id])));
    }

    /** Pull + coerce this entity's custom-field values out of a mapped import row. */
    private function importCustomValues(string $form, array $row): string
    {
        $custom = [];
        foreach ($this->formCustomFields($form) as $f) {
            if (array_key_exists($f['key'], $row)) {
                $v                 = $row[$f['key']];
                $custom[$f['key']] = $f['type'] === 'number'
                    ? (($v === '' || $v === null) ? '' : (string) (0 + $v))
                    : trim((string) $v);
            }
        }

        return json_encode($custom);
    }

    /** POST /client/tasks/import — bulk-create tasks from a mapped sheet. */
    public function importTasks()
    {
        if ($resp = $this->requirePermission('tasks', 'create')) {
            return $resp;
        }
        $cid  = $this->clientId();
        $rows = $this->input('rows');
        if (! is_array($rows) || $rows === []) {
            return $this->failValidationErrors(['rows' => 'No rows to import.']);
        }

        $opt       = (array) ($this->input('options') ?? []);
        $mode      = ($opt['assign_mode'] ?? 'single') === 'robin' ? 'robin' : 'single';
        $assignees = $this->validStaffIds($cid, (array) ($opt['assignees'] ?? []));
        if ($mode === 'single') {
            $assignees = array_slice($assignees, 0, 1);
        }
        $notify    = ! empty($opt['notify']);
        $mandatory = array_values(array_filter($this->genericImportColumns('task'), static fn ($c) => ! empty($c['required']) && $c['key'] !== 'title'));

        $model = new ClientTaskModel();
        $inserted = 0;
        $errors   = [];
        $perAssignee = [];
        $n = 0;

        foreach ($rows as $i => $row) {
            $line  = (int) $i + 2;
            $row   = is_array($row) ? $row : [];
            $title = trim((string) ($row['title'] ?? ''));
            if ($title === '') {
                $errors[] = ['row' => $line, 'message' => 'Title is required.'];
                continue;
            }
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

            $assignTo = $assignees ? $assignees[$n % count($assignees)] : null;
            $data     = [
                'client_id'       => $cid,
                'title'           => $title,
                'description'     => trim((string) ($row['description'] ?? '')) !== '' ? HtmlSanitizer::clean((string) $row['description']) : null,
                'assigned_to'     => $assignTo,
                'due_date'        => trim((string) ($row['due_date'] ?? '')) ?: null,
                'start_date'      => trim((string) ($row['start_date'] ?? '')) ?: null,
                'priority'        => trim((string) ($row['priority'] ?? '')) ?: 'medium',
                'type'            => trim((string) ($row['type'] ?? '')) ?: 'task',
                'status'          => trim((string) ($row['status'] ?? '')) ?: 'open',
                'custom_fields'   => $this->importCustomValues('task', $row),
                'created_by'      => $this->actorId() ?: null,
                'created_by_name' => $this->actorName(),
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

        if ($notify && $perAssignee) {
            foreach ($perAssignee as $sid => $cnt) {
                $this->notifyStaff((int) $sid, 'task_created', 'New tasks assigned', "{$cnt} new task(s) assigned to you", '/client/tasks');
            }
        }
        $this->logActivity('created', 'task', null, "Imported {$inserted} task(s)" . ($errors ? ', ' . count($errors) . ' skipped' : ''));

        return $this->respond(['inserted' => $inserted, 'failed' => count($errors), 'errors' => array_slice($errors, 0, 50), 'assigned' => $perAssignee]);
    }

    /** POST /client/team/import — bulk-create staff directory records from a mapped sheet. */
    public function importTeam()
    {
        if ($resp = $this->requirePermission('team', 'create')) {
            return $resp;
        }
        $cid  = $this->clientId();
        $rows = $this->input('rows');
        if (! is_array($rows) || $rows === []) {
            return $this->failValidationErrors(['rows' => 'No rows to import.']);
        }
        $mandatory = array_values(array_filter($this->genericImportColumns('team'), static fn ($c) => ! empty($c['required']) && $c['key'] !== 'name'));

        $model = new ClientStaffModel();
        $inserted = 0;
        $errors   = [];

        foreach ($rows as $i => $row) {
            $line = (int) $i + 2;
            $row  = is_array($row) ? $row : [];
            $name = trim((string) ($row['name'] ?? ''));
            if (mb_strlen($name) < 2) {
                $errors[] = ['row' => $line, 'message' => 'Name is required (min 2 characters).'];
                continue;
            }
            $email = trim((string) ($row['email'] ?? ''));
            if ($email !== '' && ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $errors[] = ['row' => $line, 'message' => 'Invalid email address.'];
                continue;
            }
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
            $data = [
                'client_id'     => $cid,
                'name'          => $name,
                'email'         => $email !== '' ? $email : null,
                'phone'         => preg_replace('/\D/', '', (string) ($row['phone'] ?? '')) ?: null,
                'alt_phone'     => preg_replace('/\D/', '', (string) ($row['alt_phone'] ?? '')) ?: null,
                'designation'   => trim((string) ($row['designation'] ?? '')) ?: null,
                'emp_code'      => trim((string) ($row['emp_code'] ?? '')) ?: null,
                'status'        => 'active',
                'custom_fields' => $this->importCustomValues('staff', $row),
            ];
            if ($model->insert($data) === false) {
                $first    = $model->errors();
                $errors[] = ['row' => $line, 'message' => $first ? reset($first) : 'Could not save row.'];
                continue;
            }
            $inserted++;
        }
        $this->logActivity('created', 'staff', null, "Imported {$inserted} team member(s)" . ($errors ? ', ' . count($errors) . ' skipped' : ''));

        return $this->respond(['inserted' => $inserted, 'failed' => count($errors), 'errors' => array_slice($errors, 0, 50)]);
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

    /**
     * Attach existing call logs for a phone number to a lead — used on lead
     * create/phone-change so calls ingested BEFORE the lead existed (lead_id
     * null) link up. Only claims unlinked calls (lead_id null/0), never steals
     * calls already tied to another lead.
     */
    private function linkCallsToLead(int $cid, int $leadId, string $phone, ?string $altPhone): void
    {
        $phones = array_values(array_unique(array_filter([$phone, (string) $altPhone], static fn ($p) => $p !== '')));
        if (! $phones || $leadId <= 0) {
            return;
        }
        (new CallLogModel())->builder()
            ->where('client_id', $cid)
            ->whereIn('contact', $phones)
            ->groupStart()->where('lead_id', null)->orWhere('lead_id', 0)->groupEnd()
            ->update(['lead_id' => $leadId]);
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
            // Rich-text description — sanitized (same policy as notes) to strip
            // scripts/handlers; stored as NULL when empty.
            'description'    => HtmlSanitizer::clean((string) $this->input('description')) ?: null,
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
        // Match by lead_id OR the lead's phone number(s), so calls made BEFORE the
        // lead existed (ingested with a null lead_id) still show up — consistent
        // with the list/summary, which also match by contact.
        $calls = [];
        if ($this->can('calls')) {
            $phones = array_values(array_unique(array_filter([
                (string) ($lead['phone'] ?? ''),
                (string) ($lead['alt_phone'] ?? ''),
            ], static fn ($p) => $p !== '')));
            $callsQ = (new CallLogModel())->where('client_id', $cid)->groupStart()->where('lead_id', $id);
            if ($phones) {
                $callsQ->orWhereIn('contact', $phones);
            }
            $calls = $callsQ->groupEnd()->orderBy('call_start', 'DESC')->orderBy('id', 'DESC')->findAll();
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
    /**
     * GET /client/call-sync-status — small header widget data: the overall call
     * count + total duration (all-time, NOT scoped to today), and the last-synced
     * time (latest call recorded). Scoped to what the user can see. Cheap + safe
     * to poll (auto-refresh every minute).
     */
    public function callSyncStatus()
    {
        if ($resp = $this->requirePermission('calls')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $today = date('Y-m-d');

        // Scope to the calls on the leads THIS user can SEE (reference/assignment
        // scope), matching a call's contact to a visible lead's phone — so an agent
        // sees stats for their own leads only, consistent with the leads table.
        // Admin = every call. A non-admin with no visible-lead phones sees zero.
        $phones = $this->isAdmin() ? null : $this->visibleLeadPhones();

        // TODAY's totals only — independent of any table filter. A day with no
        // calls reads as 0 (the UI then shows "No calls").
        $totalQ = (new CallLogModel())->select('COUNT(*) AS cnt, COALESCE(SUM(duration), 0) AS dur')
            ->where('client_id', $cid)
            ->where('call_start >=', "{$today} 00:00:00")
            ->where('call_start <=', "{$today} 23:59:59");
        if ($phones !== null) {
            $totalQ->whereIn('contact', $phones ?: ['']);
        }
        $agg = $totalQ->first();

        $lastQ = (new CallLogModel())->select('MAX(call_start) AS last')->where('client_id', $cid);
        if ($phones !== null) {
            $lastQ->whereIn('contact', $phones ?: ['']);
        }
        $last = $lastQ->first()['last'] ?? null;

        return $this->respond([
            'total_calls'    => (int) ($agg['cnt'] ?? 0),
            'total_duration' => (int) ($agg['dur'] ?? 0), // seconds
            'last_sync'      => $last ?: null,            // latest call datetime, or null
        ]);
    }

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
        $this->applyCallFilters($q, $cid);

        $total   = $q->countAllResults(false);
        $perPage = max(1, min(200, (int) ($this->request->getGet('per_page') ?: 50)));
        $page    = max(1, (int) ($this->request->getGet('page') ?: 1));
        $rows    = $q->orderBy('call_start', 'DESC')->orderBy('id', 'DESC')->findAll($perPage, ($page - 1) * $perPage);

        // Decorate only the page's rows (scope name lookups to their ids).
        $staffIds = array_values(array_unique(array_filter(array_map(static fn ($r) => (int) ($r['staff_id'] ?? 0), $rows))));
        $leadIds  = array_values(array_unique(array_filter(array_map(static fn ($r) => (int) ($r['lead_id'] ?? 0), $rows))));
        $staffNames = $staffIds ? $this->idNameMap((new ClientStaffModel())->where('client_id', $cid)->whereIn('id', $staffIds)->findAll()) : [];
        $leadNames  = [];
        if ($leadIds) {
            foreach ((new LeadModel())->select('id, name, phone')->where('client_id', $cid)->whereIn('id', $leadIds)->findAll() as $l) {
                $leadNames[(int) $l['id']] = ($l['name'] ?? '') !== '' ? $l['name'] : $l['phone'];
            }
        }
        foreach ($rows as &$r) {
            $r['staff_name'] = $r['staff_id'] ? ($staffNames[(int) $r['staff_id']] ?? null) : null;
            $r['lead_name']  = $r['lead_id'] ? ($leadNames[(int) $r['lead_id']] ?? null) : null;
            $r['connected']  = (bool) $r['connected'];
        }
        unset($r);

        return $this->respond([
            'calls'    => $rows,
            'total'    => $total,
            'page'     => $page,
            'per_page' => $perPage,
        ]);
    }

    /** Apply the calls-log filters (search, type, source, status, connected, date). */
    private function applyCallFilters($q, int $cid): void
    {
        $get  = fn (string $k): string => trim((string) ($this->request->getGet($k) ?? ''));
        $strs = fn (string $k): array => array_values(array_filter(array_map('trim', explode(',', $get($k))), static fn ($v) => $v !== ''));
        $db   = \Config\Database::connect();

        if (($search = $get('q')) !== '') {
            $like = '%' . $db->escapeLikeString($search) . '%';
            $q->groupStart()
                ->like('contact', $search)->orLike('staff_contact', $search)->orLike('call_status', $search)
                ->orWhere("staff_id IN (SELECT id FROM client_staff WHERE client_id = {$cid} AND name LIKE '{$like}')", null, false)
                ->orWhere("lead_id IN (SELECT id FROM leads WHERE client_id = {$cid} AND name LIKE '{$like}')", null, false)
                ->groupEnd();
        }
        if ($v = $strs('type')) {
            $q->whereIn('type', $v);
        }
        if ($v = $strs('source')) {
            $q->whereIn('source', $v);
        }
        // Connected: yes / no (only constrains when exactly one is chosen).
        $conn = $strs('connected');
        if (count($conn) === 1) {
            $q->where('connected', $conn[0] === 'yes' ? 1 : 0);
        }
        // Status keys — normalise call_status the same way the UI does
        // (UPPER, spaces/dashes → underscore) and match the selected keys.
        if ($v = $strs('status')) {
            $vals = array_map(static fn ($s) => strtoupper(str_replace([' ', '-'], '_', $s)), $v);
            $in   = implode(', ', array_map(static fn ($s) => $db->escape($s), $vals));
            $q->where("UPPER(REPLACE(REPLACE(TRIM(call_status), ' ', '_'), '-', '_')) IN ({$in})", null, false);
        }
        if (($f = $get('from')) !== '') {
            $q->where('call_start >=', $f . ' 00:00:00');
        }
        if (($f = $get('to')) !== '') {
            $q->where('call_start <=', $f . ' 23:59:59');
        }
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
        $cid      = $this->clientId();
        $todayStr = date('Y-m-d');

        // Date range [from, to] (default today→today). A single legacy ?date=
        // still works — it acts as from=to=date.
        $valid  = static fn (string $v): bool => (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $v);
        $from   = (string) ($this->request->getGet('from') ?? '');
        $to     = (string) ($this->request->getGet('to') ?? '');
        $single = (string) ($this->request->getGet('date') ?? '');
        if ($from === '' && $to === '' && $valid($single)) {
            $from = $to = $single;
        }
        if (! $valid($from)) {
            $from = $todayStr;
        }
        if (! $valid($to)) {
            $to = $todayStr;
        }
        if ($from > $to) {
            [$from, $to] = [$to, $from];
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

        // Current period + the preceding equal-length period (for the delta), and
        // a 7-day trend window ending at `to`. Load enough to cover all three.
        $lenDays     = (int) floor((strtotime($to) - strtotime($from)) / 86400) + 1;
        $prevTo      = date('Y-m-d', strtotime("{$from} -1 day"));
        $prevFrom    = date('Y-m-d', strtotime("{$from} -{$lenDays} day"));
        $trendStart  = date('Y-m-d', strtotime("{$to} -6 day"));
        $windowStart = min($prevFrom, $trendStart);

        // Lookups.
        $staffMap = [];
        foreach ((new ClientStaffModel())->where('client_id', $cid)->findAll() as $s) {
            $staffMap[(int) $s['id']] = ['name' => $s['name'], 'dept' => (int) ($s['department_id'] ?? 0), 'office' => (int) ($s['office_location_id'] ?? 0)];
        }
        $leadMap = [];
        foreach ((new LeadModel())->select('id, status_id, source_id, assigned_to, assigned_date')->where('client_id', $cid)->findAll() as $l) {
            $leadMap[(int) $l['id']] = [
                'status'        => (int) ($l['status_id'] ?? 0),
                'source'        => (int) ($l['source_id'] ?? 0),
                'assigned_to'   => (int) ($l['assigned_to'] ?? 0),
                'assigned_date' => (string) ($l['assigned_date'] ?? ''),
            ];
        }
        $statusMeta = [];
        foreach ($this->lookupRows(LeadStatusModel::class, $cid) as $st) {
            $statusMeta[(int) $st['id']] = ['name' => $st['name'], 'color' => $st['color']];
        }

        // Window of calls (covers the day, the previous day, and the 7-day trend).
        $scope = $this->visibleStaffIds();
        $q     = (new CallLogModel())->where('client_id', $cid)
            ->where('call_start >=', "{$windowStart} 00:00:00")
            ->where('call_start <=', "{$to} 23:59:59");
        if ($scope !== null) {
            $q->whereIn('staff_id', $scope ?: [0]);
        }
        $calls = $q->findAll();

        // Apply filters (staff / lead status / lead source / department / office).
        $rangeCalls = [];  // calls within the selected [from, to] period
        $prevCalls  = [];  // calls in the preceding equal-length period
        $byDay      = [];  // per-day buckets (drives the 7-day trend)
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
            $d           = substr((string) $c['call_start'], 0, 10);
            $byDay[$d][] = $c;
            if ($d >= $from && $d <= $to) {
                $rangeCalls[] = $c;
            } elseif ($d >= $prevFrom && $d <= $prevTo) {
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
        $today = $kpi($rangeCalls);
        $prev  = $kpi($prevCalls);
        $delta = static fn ($cur, $old) => $old ? (int) round(100 * ($cur - $old) / $old) : null;

        // Hourly distribution across office hours (9am–8pm).
        $hourly = [];
        for ($h = 9; $h <= 20; $h++) {
            $hourly[$h] = ['hour' => $h, 'calls' => 0, 'talk_sec' => 0];
        }
        foreach ($rangeCalls as $c) {
            $h = (int) substr((string) $c['call_start'], 11, 2);
            if (isset($hourly[$h])) {
                $hourly[$h]['calls']++;
                $hourly[$h]['talk_sec'] += (int) $c['duration'];
            }
        }

        // Calls + talk time grouped by the lead's status.
        $statusAgg = [];
        foreach ($rangeCalls as $c) {
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
        foreach ($rangeCalls as $i => $c) {
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
        foreach ($rangeCalls as $i => $c) {
            $sid = (int) ($c['staff_id'] ?? 0);
            if (! $sid) {
                continue;
            }
            $reps[$sid] ??= ['id' => $sid, 'name' => $staffMap[$sid]['name'] ?? "#{$sid}", 'total' => 0, 'after_assign' => 0, 'uniq' => [], 'connected' => 0, 'talk_sec' => 0, 'fresh' => 0, 'fresh_connected' => 0, 'fresh_talk_sec' => 0];
            $reps[$sid]['total']++;
            // "After assignment": calls made on/after the lead's assignment date —
            // i.e. genuine follow-up work once the lead had an owner (vs calls that
            // happened before the lead was assigned). Counted per calling rep.
            $lead = $leadMap[(int) ($c['lead_id'] ?? 0)] ?? null;
            if ($lead && $lead['assigned_date'] !== '' && (string) $c['call_start'] >= $lead['assigned_date']) {
                $reps[$sid]['after_assign']++;
            }
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

        // 7-day trend ending at the range end (keeps the trend readable even for a
        // single-day range; the KPIs above already reflect the full [from, to]).
        $trend = [];
        for ($d = 6; $d >= 0; $d--) {
            $dd   = date('Y-m-d', strtotime("{$to} -{$d} day"));
            $set  = $byDay[$dd] ?? [];
            $talk = 0;
            foreach ($set as $c) {
                $talk += (int) $c['duration'];
            }
            $trend[] = ['date' => $dd, 'calls' => count($set), 'avg_sec' => count($set) ? (int) round($talk / count($set)) : 0];
        }

        return $this->respond([
            'from'  => $from,
            'to'    => $to,
            'date'  => $to, // back-compat
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
        $connCallsByLead = []; // lead_id => connected call_start[] (feeds followFlag)
        foreach ((new CallLogModel())->select('lead_id, connected, call_start')->where('client_id', $cid)->where('lead_id IS NOT NULL')->findAll() as $c) {
            $lid = (int) $c['lead_id'];
            $callStats[$lid] ??= ['attempts' => 0, 'connected' => 0, 'last' => null];
            $callStats[$lid]['attempts']++;
            $cs = (string) ($c['call_start'] ?? '');
            if ((int) $c['connected']) {
                $callStats[$lid]['connected']++;
                if ($cs !== '') {
                    $connCallsByLead[$lid][] = $cs;
                }
            }
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
            $isDone = $this->followFlag($l['follow_date'], $remByLead[(int) $l['id']] ?? [], $notesByLead[(int) $l['id']] ?? [], $connCallsByLead[(int) $l['id']] ?? [], $date) === 'done';
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

    /**
     * Bump a lead's `updated_at` to now — called whenever work happens ON the lead
     * (note/reminder add or edit) so "Last updated" tracks activity, not just edits
     * to the lead row itself. Uses the builder to set the timestamp directly.
     */
    private function touchLead(int $cid, int $leadId): void
    {
        if ($leadId <= 0) {
            return;
        }
        (new LeadModel())->builder()
            ->where('client_id', $cid)->where('id', $leadId)
            ->update(['updated_at' => date('Y-m-d H:i:s')]);
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
        $this->touchLead($cid, $id);
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
        $this->touchLead($cid, (int) $row['lead_id']);
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
        $this->touchLead($cid, $id);

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
        $this->touchLead($cid, (int) $row['lead_id']);

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

    /**
     * The settings-key prefix for a form. Leads can be customized PER LEAD TYPE:
     * pass a type id to target that type's override (e.g. "lead__t5"); other forms
     * (and lead with no type) use the base form name.
     */
    private function formScope(string $form, $type): string
    {
        $t = (int) $type;

        return ($form === 'lead' && $t > 0) ? "{$form}__t{$t}" : $form;
    }

    /**
     * The EFFECTIVE lead-form scope for a lead type: the type's own override when
     * one has been configured, else the base "lead" config (types inherit base).
     */
    private function leadFormScope(int $typeId): string
    {
        if ($typeId > 0) {
            $map = $this->settingsMap();
            if (isset($map["lead__t{$typeId}_required_fields"]) || isset($map["lead__t{$typeId}_custom_fields"])) {
                return "lead__t{$typeId}";
            }
        }

        return 'lead';
    }

    /** Built-in fields the client has marked mandatory on $form (optionally scoped). */
    private function formRequiredFields(string $form, ?string $scope = null): array
    {
        $allowed = self::FORM_REQUIRABLE[$form] ?? [];
        $keys    = json_decode((string) ($this->settingsMap()[($scope ?? $form) . '_required_fields'] ?? '[]'), true);

        return is_array($keys) ? array_values(array_intersect(array_map('strval', $keys), $allowed)) : [];
    }

    /** Admin-customized field hint/tagline overrides for $form (fieldKey → text). */
    private function formHints(string $form, ?string $scope = null): array
    {
        $h = json_decode((string) ($this->settingsMap()[($scope ?? $form) . '_hints'] ?? '{}'), true);
        if (! is_array($h)) {
            return [];
        }
        $out = [];
        foreach ($h as $k => $v) {
            $k = preg_replace('/[^a-z0-9_]/', '', (string) $k);
            $v = mb_substr(trim((string) $v), 0, 300);
            if ($k !== '' && $v !== '') {
                $out[$k] = $v;
            }
        }

        return $out;
    }

    /** Admin-defined field display order for $form (list of field keys; optionally scoped). */
    private function formFieldOrder(string $form, ?string $scope = null): array
    {
        $ord = json_decode((string) ($this->settingsMap()[($scope ?? $form) . '_field_order'] ?? '[]'), true);
        if (! is_array($ord)) {
            return [];
        }
        $out = [];
        foreach ($ord as $k) {
            $k = preg_replace('/[^a-z0-9_]/', '', (string) $k);
            if ($k !== '' && ! in_array($k, $out, true)) {
                $out[] = $k;
            }
        }

        return $out;
    }

    /** The client's admin-defined custom fields for $form (sanitized; optionally scoped). */
    private function formCustomFields(string $form, ?string $scope = null): array
    {
        $defs = json_decode((string) ($this->settingsMap()[($scope ?? $form) . '_custom_fields'] ?? '[]'), true);
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

    /**
     * Every lead custom field the client has defined — the base "lead" scope PLUS
     * each per-lead-type override (lead__t{id}) — deduped by key (first wins). The
     * Web-to-Lead builder uses this so type-specific custom fields are selectable
     * too, not just base-scope ones.
     */
    private function allLeadCustomFields(int $cid): array
    {
        $byKey = [];
        foreach ($this->formCustomFields('lead', 'lead') as $f) {
            $byKey[$f['key']] = $f;
        }
        foreach ($this->lookupRows(LeadTypeModel::class, $cid) as $t) {
            $tid = (int) ($t['id'] ?? 0);
            if ($tid <= 0) {
                continue;
            }
            foreach ($this->formCustomFields('lead', "lead__t{$tid}") as $f) {
                if (! isset($byKey[$f['key']])) {
                    $byKey[$f['key']] = $f;
                }
            }
        }

        return array_values($byKey);
    }

    /** Pull + sanitize custom-field values from request input, keyed by field key. */
    private function formCustomValues(string $form, array $in, ?string $scope = null): array
    {
        $raw = $in['custom_fields'] ?? [];
        if (is_string($raw)) {
            $raw = json_decode($raw, true) ?: [];
        }
        if (! is_array($raw)) {
            $raw = [];
        }
        $out = [];
        foreach ($this->formCustomFields($form, $scope) as $f) {
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

    /** Validation errors for $form's mandatory built-in + custom fields (optionally scoped). */
    private function formFieldErrors(string $form, array $data, array $customValues, ?string $scope = null): array
    {
        $errors = [];
        $labels = self::FORM_LABELS[$form] ?? [];
        foreach ($this->formRequiredFields($form, $scope) as $key) {
            $val = $data[$key] ?? null;
            if ($val === null || $val === '' || $val === 0) {
                $errors[$key] = ($labels[$key] ?? $key) . ' is required.';
            }
        }
        foreach ($this->formCustomFields($form, $scope) as $f) {
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

    /**
     * GET /client/form-setup/{form} — requirable fields + current required + custom
     * defs. For the lead form, `?type=<id>` targets that lead type's config; add
     * `&effective=1` to resolve inheritance (type override, else base) — the lead
     * form uses that, while the admin editor edits the type's own override.
     */
    public function formSetup(string $form)
    {
        if (! isset(self::FORM_REQUIRABLE[$form])) {
            return $this->failNotFound('Unknown form');
        }
        $type  = (int) ($this->request->getGet('type') ?? 0);
        $scope = ($form === 'lead' && $this->request->getGet('effective') === '1')
            ? $this->leadFormScope($type)
            : $this->formScope($form, $type);

        return $this->respond([
            'form'            => $form,
            'type'            => $type,
            'requirable'      => array_map(fn ($k) => ['key' => $k, 'label' => self::FORM_LABELS[$form][$k] ?? $k], self::FORM_REQUIRABLE[$form]),
            'required_fields' => $this->formRequiredFields($form, $scope),
            'custom_fields'   => $this->formCustomFields($form, $scope),
            'hints'           => (object) $this->formHints($form, $scope),
            'order'           => $this->formFieldOrder($form, $scope),
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
        $scope    = $this->formScope($form, $in['type'] ?? 0); // lead: per-type override
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

        // Field hint/tagline overrides (fieldKey → text; blanks dropped).
        $hintsIn  = $in['hints'] ?? [];
        $hintsOut = [];
        if (is_array($hintsIn)) {
            foreach ($hintsIn as $k => $v) {
                $k = preg_replace('/[^a-z0-9_]/', '', (string) $k);
                $v = mb_substr(trim((string) $v), 0, 300);
                if ($k !== '' && $v !== '') {
                    $hintsOut[$k] = $v;
                }
            }
        }

        // Field display order (list of field keys, sanitized + de-duplicated).
        $orderOut = [];
        foreach ((array) ($in['order'] ?? []) as $k) {
            $k = preg_replace('/[^a-z0-9_]/', '', (string) $k);
            if ($k !== '' && ! in_array($k, $orderOut, true)) {
                $orderOut[] = $k;
            }
        }

        $this->setSetting($scope . '_required_fields', json_encode($required));
        $this->setSetting($scope . '_custom_fields', json_encode($custom));
        $this->setSetting($scope . '_hints', json_encode((object) $hintsOut));
        $this->setSetting($scope . '_field_order', json_encode($orderOut));
        $this->logActivity('updated', 'settings', null, "Updated {$form} form fields");

        return $this->respond(['message' => 'Saved', 'required_fields' => $required, 'custom_fields' => $custom, 'order' => $orderOut]);
    }

    // ========================================================= WEB TO LEAD
    //
    // Admin-built embeddable forms. A form's definition lives in this client's
    // `web_forms` table; a main-DB `web_form_index` row maps its public token to
    // this client so the sessionless /public/forms/{token} endpoint can resolve
    // the tenant. Submissions land in `leads` (stamped with `web_form_id`), and
    // `submission_count` tracks how many leads each form has produced.

    /** Built-in lead fields a web form may place (mirrors the frontend LEAD_FORM_FIELDS subset). */
    private const WEB_BUILTIN_FIELDS = [
        ['key' => 'name', 'label' => 'Full Name', 'type' => 'text'],
        ['key' => 'phone', 'label' => 'Mobile Number', 'type' => 'tel'],
        ['key' => 'alt_phone', 'label' => 'Alternative Phone', 'type' => 'tel'],
        ['key' => 'email', 'label' => 'Email Address', 'type' => 'email'],
        ['key' => 'city', 'label' => 'City', 'type' => 'text'],
        ['key' => 'state', 'label' => 'State', 'type' => 'text'],
        ['key' => 'description', 'label' => 'Description', 'type' => 'textarea'],
    ];

    /** GET /client/web-forms — list forms (+ the builder's available fields & lookups). */
    public function webForms()
    {
        if (! $this->isAdmin()) {
            return $this->failForbidden('Only an admin can manage web forms.');
        }
        $cid   = $this->clientId();
        $forms = (new WebFormModel())->where('client_id', $cid)->orderBy('id', 'DESC')->findAll();

        return $this->respond([
            'forms'          => array_map([$this, 'webFormOut'], $forms),
            'builder_fields' => $this->webFormBuilderFields($cid),
        ]);
    }

    /** GET /client/web-forms/{id} — one form (+ builder fields & lookups). */
    public function webForm(int $id)
    {
        if (! $this->isAdmin()) {
            return $this->failForbidden('Only an admin can manage web forms.');
        }
        $cid  = $this->clientId();
        $model = new WebFormModel();
        $form  = $model->where('client_id', $cid)->find($id);
        if (! $form) {
            return $this->failNotFound('Form not found');
        }
        // Backfill an API key for forms created before this feature existed.
        if (empty($form['api_key'])) {
            $form['api_key'] = bin2hex(random_bytes(24));
            $model->skipValidation(true)->update($id, ['api_key' => $form['api_key']]);
        }

        return $this->respond([
            'form'           => $this->webFormOut($form),
            'builder_fields' => $this->webFormBuilderFields($cid),
        ]);
    }

    /** POST /client/web-forms/{id}/api-key — regenerate the form's server-to-server API key (admin). */
    public function regenerateWebFormApiKey(int $id)
    {
        if (! $this->isAdmin()) {
            return $this->failForbidden('Only an admin can manage web forms.');
        }
        $cid   = $this->clientId();
        $model = new WebFormModel();
        $form  = $model->where('client_id', $cid)->find($id);
        if (! $form) {
            return $this->failNotFound('Form not found');
        }
        $key = bin2hex(random_bytes(24));
        $model->skipValidation(true)->update($id, ['api_key' => $key]);
        $this->logActivity('updated', 'web_form', $id, 'Regenerated API key for web form ' . $form['name']);

        return $this->respond(['message' => 'Regenerated', 'api_key' => $key]);
    }

    /** POST /client/web-forms — create a form (generates the public token). */
    public function createWebForm()
    {
        if (! $this->isAdmin()) {
            return $this->failForbidden('Only an admin can manage web forms.');
        }
        $cid   = $this->clientId();
        $model = new WebFormModel();
        $data  = $this->webFormPayload($cid);
        $data['token']   = bin2hex(random_bytes(16));
        $data['api_key'] = bin2hex(random_bytes(24)); // server-to-server (Postman) key

        $id = $model->insert($data);
        if ($id === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->syncWebFormIndex($data['token'], $cid, (int) $id, (int) $data['enabled']);
        $this->logActivity('created', 'web_form', (int) $id, 'Created web form ' . $data['name']);

        return $this->respondCreated(['message' => 'Created', 'id' => (int) $id, 'token' => $data['token']]);
    }

    /** POST /client/web-forms/{id} — update a form. */
    public function updateWebForm(int $id)
    {
        if (! $this->isAdmin()) {
            return $this->failForbidden('Only an admin can manage web forms.');
        }
        $cid   = $this->clientId();
        $model = new WebFormModel();
        $form  = $model->where('client_id', $cid)->find($id);
        if (! $form) {
            return $this->failNotFound('Form not found');
        }
        $data = $this->webFormPayload($cid);
        unset($data['token']); // token is immutable once issued

        if ($model->update($id, $data) === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->syncWebFormIndex((string) $form['token'], $cid, $id, (int) $data['enabled']);
        $this->logActivity('updated', 'web_form', $id, 'Updated web form ' . $data['name']);

        return $this->respond(['message' => 'Saved', 'id' => $id]);
    }

    /** POST /client/web-forms/{id}/delete — soft-delete a form (disables its public token). */
    public function deleteWebForm(int $id)
    {
        if (! $this->isAdmin()) {
            return $this->failForbidden('Only an admin can manage web forms.');
        }
        $cid   = $this->clientId();
        $model = new WebFormModel();
        $form  = $model->where('client_id', $cid)->find($id);
        if (! $form) {
            return $this->failNotFound('Form not found');
        }
        $model->delete($id); // soft delete
        // Disable the public token so the embedded form stops accepting submissions.
        (new WebFormIndexModel())->where('token', $form['token'])->set(['enabled' => 0])->update();
        $this->logActivity('deleted', 'web_form', $id, 'Deleted web form ' . $form['name']);

        return $this->respond(['message' => 'Deleted']);
    }

    /** Build a sanitized web_forms row from request input (shared by create/update). */
    private function webFormPayload(int $cid): array
    {
        $in = (array) $this->input();

        $intList = static function ($v): array {
            $v = is_array($v) ? $v : [];

            return array_values(array_unique(array_filter(array_map('intval', $v))));
        };

        // Ordered field definitions — keep only known built-in keys + this client's
        // custom-field keys; sanitize labels/placeholders.
        $customKeys = array_column($this->allLeadCustomFields($cid), 'key');
        $builtinKey = array_column(self::WEB_BUILTIN_FIELDS, 'key');
        $fields     = [];
        foreach ((array) ($in['fields'] ?? []) as $f) {
            if (! is_array($f)) {
                continue;
            }
            $key = preg_replace('/[^a-z0-9_]/', '', strtolower((string) ($f['key'] ?? '')));
            if ($key === '' || (! in_array($key, $builtinKey, true) && ! in_array($key, $customKeys, true))) {
                continue;
            }
            $builtin  = in_array($key, $builtinKey, true);
            // `param` is the parameter/JSON name external callers send (Postman,
            // their own site). Admin-chosen; defaults to the field key. The lead
            // mapping still uses `key`, so built-in fields keep working.
            $param = preg_replace('/[^a-z0-9_]/', '', strtolower((string) ($f['param'] ?? $key)));
            if ($param === '') {
                $param = $key;
            }
            $fields[] = [
                'key'         => $key,
                'param'       => $param,
                'label'       => mb_substr(trim((string) ($f['label'] ?? $key)), 0, 120),
                'type'        => (string) ($f['type'] ?? 'text'),
                'required'    => ! empty($f['required']),
                'placeholder' => mb_substr(trim((string) ($f['placeholder'] ?? '')), 0, 150),
                'builtin'     => $builtin,
                'options'     => is_array($f['options'] ?? null) ? array_values(array_map(static fn ($o) => (string) $o, $f['options'])) : [],
            ];
        }

        // State → counsellors map: each state maps to one or MANY staff ids
        // (round-robined at ingest). Keep only non-empty states with ≥1 staff id.
        $stateMap = [];
        foreach ((array) ($in['state_assignee_map'] ?? []) as $state => $ids) {
            $state = trim((string) $state);
            $list  = $intList(is_array($ids) ? $ids : [$ids]);
            if ($state !== '' && $list) {
                $stateMap[$state] = $list;
            }
        }

        return [
            'client_id'                => $cid,
            'name'                     => mb_substr(trim((string) ($in['name'] ?? '')), 0, 150) ?: 'Untitled form',
            'language'                 => mb_substr(trim((string) ($in['language'] ?? 'en')), 0, 20) ?: 'en',
            'submit_text'              => mb_substr(trim((string) ($in['submit_text'] ?? 'Submit')), 0, 100) ?: 'Submit',
            'success_message'          => mb_substr(trim((string) ($in['success_message'] ?? '')), 0, 2000) ?: null,
            'fields'                   => json_encode($fields),
            'source_id'                => (int) ($in['source_id'] ?? 0) ?: null,
            'status_id'                => (int) ($in['status_id'] ?? 0) ?: null,
            'assigned_to'              => (int) ($in['assigned_to'] ?? 0) ?: null,
            'lead_type_id'             => (int) ($in['lead_type_id'] ?? 0) ?: null,
            'auto_assignee'            => json_encode($intList($in['auto_assignee'] ?? [])),
            'auto_assign_state_wise'   => ! empty($in['auto_assign_state_wise']) ? 1 : 0,
            'state_assignee_map'       => json_encode((object) $stateMap),
            'auto_mark_public'         => ! empty($in['auto_mark_public']) ? 1 : 0,
            'allow_location_fields'    => ! empty($in['allow_location_fields']) ? 1 : 0,
            'notify_on_transfer'       => ! empty($in['notify_on_transfer']) ? 1 : 0,
            'allow_duplicate'          => ! empty($in['allow_duplicate']) ? 1 : 0,
            'prevent_duplicate_field'  => mb_substr(trim((string) ($in['prevent_duplicate_field'] ?? 'phone')), 0, 40) ?: null,
            'prevent_duplicate_field2' => mb_substr(trim((string) ($in['prevent_duplicate_field2'] ?? '')), 0, 40) ?: null,
            'create_duplicate_as_task' => ! empty($in['create_duplicate_as_task']) ? 1 : 0,
            'notify_on_import'         => ! empty($in['notify_on_import']) ? 1 : 0,
            'notify_type'              => in_array($in['notify_type'] ?? '', ['specific', 'roles', 'responsible'], true) ? $in['notify_type'] : 'responsible',
            'notify_staff'             => json_encode($intList($in['notify_staff'] ?? [])),
            'enabled'                  => array_key_exists('enabled', $in) ? (! empty($in['enabled']) ? 1 : 0) : 1,
        ];
    }

    /** Shape a web_forms row for the admin API (decode JSON columns, add helpers). */
    private function webFormOut(array $f): array
    {
        $decodeArr = static fn ($v) => (is_array($j = json_decode((string) $v, true)) ? $j : []);

        return [
            'id'                       => (int) $f['id'],
            'name'                     => $f['name'],
            'token'                    => $f['token'],
            'api_key'                  => $f['api_key'] ?? null,
            'language'                 => $f['language'],
            'submit_text'              => $f['submit_text'],
            'success_message'          => $f['success_message'],
            'fields'                   => $decodeArr($f['fields']),
            'source_id'                => $f['source_id'] !== null ? (int) $f['source_id'] : null,
            'status_id'                => $f['status_id'] !== null ? (int) $f['status_id'] : null,
            'assigned_to'              => $f['assigned_to'] !== null ? (int) $f['assigned_to'] : null,
            'lead_type_id'             => $f['lead_type_id'] !== null ? (int) $f['lead_type_id'] : null,
            'auto_assignee'            => array_map('intval', $decodeArr($f['auto_assignee'])),
            'auto_assign_state_wise'   => (int) $f['auto_assign_state_wise'],
            // Normalise to {state: number[]} — legacy single-id maps become 1-item arrays.
            'state_assignee_map'       => (object) array_map(
                static fn ($ids) => array_values(array_map('intval', is_array($ids) ? $ids : [$ids])),
                $decodeArr($f['state_assignee_map']),
            ),
            'auto_mark_public'         => (int) $f['auto_mark_public'],
            'allow_location_fields'    => (int) $f['allow_location_fields'],
            'notify_on_transfer'       => (int) $f['notify_on_transfer'],
            'allow_duplicate'          => (int) $f['allow_duplicate'],
            'prevent_duplicate_field'  => $f['prevent_duplicate_field'],
            'prevent_duplicate_field2' => $f['prevent_duplicate_field2'],
            'create_duplicate_as_task' => (int) $f['create_duplicate_as_task'],
            'notify_on_import'         => (int) $f['notify_on_import'],
            'notify_type'              => $f['notify_type'] ?: 'responsible',
            'notify_staff'             => array_map('intval', $decodeArr($f['notify_staff'])),
            'submission_count'         => (int) $f['submission_count'],
            'enabled'                  => (int) $f['enabled'],
            'created_at'               => $f['created_at'] ?? null,
        ];
    }

    /** Palette + lookups the form builder needs (built-in fields, custom fields, dropdown options). */
    private function webFormBuilderFields(int $cid): array
    {
        $mapIdName = static fn (array $rows) => array_map(static fn ($r) => ['id' => (int) $r['id'], 'name' => $r['name']], $rows);

        return [
            'builtin'    => self::WEB_BUILTIN_FIELDS,
            'custom'     => $this->allLeadCustomFields($cid),
            'sources'    => $mapIdName($this->lookupRows(LeadSourceModel::class, $cid)),
            'statuses'   => $mapIdName(array_values(array_filter($this->lookupRows(LeadStatusModel::class, $cid), static fn ($r) => empty($r['parent_id'])))),
            'lead_types' => $mapIdName($this->lookupRows(LeadTypeModel::class, $cid)),
            'staff'      => array_map(static fn ($s) => ['id' => (int) $s['id'], 'name' => $s['name']], (new ClientStaffModel())->where('client_id', $cid)->orderBy('name', 'ASC')->findAll()),
            'states'     => array_map(static fn ($r) => $r['name'], $this->lookupRows(StateModel::class, $cid)),
        ];
    }

    /** Upsert the main-DB token → client/form registry used by the public endpoint. */
    private function syncWebFormIndex(string $token, int $cid, int $formId, int $enabled): void
    {
        $model = new WebFormIndexModel();
        if ($model->where('token', $token)->first()) {
            $model->where('token', $token)->set(['client_id' => $cid, 'form_id' => $formId, 'enabled' => $enabled])->update();
        } else {
            $model->insert(['token' => $token, 'client_id' => $cid, 'form_id' => $formId, 'enabled' => $enabled]);
        }
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

        $offices = $model->where('client_id', $cid)->orderBy('sequence', 'ASC')->orderBy('name', 'ASC')->findAll();

        return $this->respond([
            'office_locations' => $offices,
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

    // --- Holidays (year-wise; drive the first-response SLA) -----------------

    /** GET /client/holidays?year=YYYY — holidays for a year + the years that have any. */
    public function holidays()
    {
        if ($resp = $this->requirePermission('team')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $year  = (int) ($this->request->getGet('year') ?: date('Y'));
        $model = new HolidayModel();

        $rows = $model->where('client_id', $cid)
            ->where('YEAR(holiday_date)', $year)
            ->orderBy('holiday_date', 'ASC')->findAll();

        $officeNames = $this->idNameMap((new OfficeLocationModel())->where('client_id', $cid)->findAll());
        foreach ($rows as &$h) {
            $oid                = $h['office_location_id'] !== null ? (int) $h['office_location_id'] : null;
            $h['office_location_id'] = $oid;
            $h['office_name']   = $oid ? ($officeNames[$oid] ?? null) : null; // null = all offices
        }
        unset($h);

        // Distinct years that have holidays, so the UI can offer a year switcher.
        $years = [];
        foreach ($model->select('holiday_date')->where('client_id', $cid)->orderBy('holiday_date', 'DESC')->findAll() as $r) {
            $y         = (int) substr((string) $r['holiday_date'], 0, 4);
            $years[$y] = true;
        }
        $years = array_keys($years);
        if (! in_array($year, $years, true)) {
            $years[] = $year;
        }
        rsort($years);

        return $this->respond(['holidays' => $rows, 'year' => $year, 'years' => array_values($years)]);
    }

    /** Build a holiday row from the request body. */
    private function holidayData(int $cid): array
    {
        $oid = (int) $this->input('office_location_id');

        return [
            'client_id'          => $cid,
            'office_location_id' => $oid > 0 ? $oid : null, // 0 / empty = all offices
            'holiday_date'       => $this->normalizeDate($this->input('holiday_date')),
            'name'               => trim((string) $this->input('name')),
        ];
    }

    /** POST /client/holidays */
    public function createHoliday()
    {
        if ($resp = $this->requirePermission('team', 'create')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new HolidayModel();
        $data  = $this->holidayData($cid);
        if (empty($data['holiday_date'])) {
            return $this->failValidationErrors(['holiday_date' => 'Pick a valid date.']);
        }
        $id = $model->insert($data);
        if ($id === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('created', 'holiday', (int) $id, 'Added holiday ' . $data['name']);

        return $this->respondCreated(['message' => 'Holiday added', 'id' => $id]);
    }

    /** POST /client/holidays/{id} */
    public function updateHoliday(int $id)
    {
        if ($resp = $this->requirePermission('team', 'update')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new HolidayModel();
        if (! $model->where('client_id', $cid)->find($id)) {
            return $this->failNotFound('Holiday not found');
        }
        $data = $this->holidayData($cid);
        if (empty($data['holiday_date'])) {
            return $this->failValidationErrors(['holiday_date' => 'Pick a valid date.']);
        }
        if ($model->update($id, $data) === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('updated', 'holiday', $id, 'Updated holiday ' . $data['name']);

        return $this->respond(['message' => 'Holiday updated']);
    }

    /** POST /client/holidays/{id}/delete — soft delete. */
    public function deleteHoliday(int $id)
    {
        if ($resp = $this->requirePermission('team', 'delete')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new HolidayModel();
        $row   = $model->where('client_id', $cid)->find($id);
        if (! $row) {
            return $this->failNotFound('Holiday not found');
        }
        $model->delete($id);
        $this->logActivity('deleted', 'holiday', $id, 'Deleted holiday ' . ($row['name'] ?? ''));

        return $this->respond(['message' => 'Holiday deleted']);
    }

    // --- Shifts (named weekly schedules, mapped to staff) ------------------

    /** GET /client/shifts — shifts with decoded weekly hours. */
    public function shiftsList()
    {
        if ($resp = $this->requirePermission('team')) {
            return $resp;
        }
        $cid    = $this->clientId();
        $shifts = (new ShiftModel())->where('client_id', $cid)->orderBy('sequence', 'ASC')->orderBy('name', 'ASC')->findAll();
        foreach ($shifts as &$s) {
            $s['working_hours'] = $this->decodeWorkingHours($s['working_hours'] ?? null);
        }
        unset($s);

        return $this->respond(['shifts' => $shifts]);
    }

    /** Shift fields from the request body. */
    private function shiftData(int $cid): array
    {
        return [
            'client_id'     => $cid,
            'name'          => trim((string) $this->input('name')),
            'working_hours' => json_encode($this->normalizeWorkingHours($this->input('working_hours'))),
        ];
    }

    /** POST /client/shifts */
    public function createShift()
    {
        if ($resp = $this->requirePermission('team', 'create')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new ShiftModel();
        $data  = $this->shiftData($cid);
        if ($data['name'] === '') {
            return $this->failValidationErrors(['name' => 'Enter a shift name.']);
        }
        $id = $model->insert($data);
        if ($id === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('created', 'shift', (int) $id, 'Added shift ' . $data['name']);

        return $this->respondCreated(['message' => 'Shift added', 'id' => $id]);
    }

    /** POST /client/shifts/{id} */
    public function updateShift(int $id)
    {
        if ($resp = $this->requirePermission('team', 'update')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new ShiftModel();
        if (! $model->where('client_id', $cid)->find($id)) {
            return $this->failNotFound('Shift not found');
        }
        $data = $this->shiftData($cid);
        if ($data['name'] === '') {
            return $this->failValidationErrors(['name' => 'Enter a shift name.']);
        }
        if ($model->update($id, $data) === false) {
            return $this->failValidationErrors($model->errors());
        }
        $this->logActivity('updated', 'shift', $id, 'Updated shift ' . $data['name']);

        return $this->respond(['message' => 'Shift updated']);
    }

    /** POST /client/shifts/{id}/delete — soft delete; unmaps any staff on it. */
    public function deleteShift(int $id)
    {
        if ($resp = $this->requirePermission('team', 'delete')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $model = new ShiftModel();
        $row   = $model->where('client_id', $cid)->find($id);
        if (! $row) {
            return $this->failNotFound('Shift not found');
        }
        $model->delete($id);
        (new ClientStaffModel())->builder()->where('client_id', $cid)->where('shift_id', $id)->update(['shift_id' => null]);
        $this->logActivity('deleted', 'shift', $id, 'Deleted shift ' . ($row['name'] ?? ''));

        return $this->respond(['message' => 'Shift deleted']);
    }

    /** Office fields from the request body. */
    private function officeData(int $cid): array
    {
        $lat = $this->input('latitude');
        $lng = $this->input('longitude');

        $data = [
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

        return $data;
    }

    /** Days of the week, index 0 = Sunday (matches JS Date.getDay()). */
    private const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    /** Default weekly schedule: Mon–Sat 10:00–19:00, Sunday off. */
    private function defaultWorkingHours(): array
    {
        $days = [];
        for ($d = 0; $d <= 6; $d++) {
            $days[] = ['off' => $d === 0, 'open' => '10:00', 'close' => '19:00'];
        }

        return $days;
    }

    /** Validate a posted weekly schedule into the canonical 7-day structure. */
    private function normalizeWorkingHours($in): array
    {
        $default = $this->defaultWorkingHours();
        if (! is_array($in)) {
            return $default;
        }
        $out = [];
        for ($d = 0; $d <= 6; $d++) {
            $row   = is_array($in[$d] ?? null) ? $in[$d] : [];
            $open  = preg_match('/^\d{2}:\d{2}$/', (string) ($row['open'] ?? '')) ? $row['open'] : $default[$d]['open'];
            $close = preg_match('/^\d{2}:\d{2}$/', (string) ($row['close'] ?? '')) ? $row['close'] : $default[$d]['close'];
            $out[] = ['off' => ! empty($row['off']), 'open' => $open, 'close' => $close];
        }

        return $out;
    }

    /** Decode a stored working_hours JSON to the canonical structure (with defaults). */
    private function decodeWorkingHours($json): array
    {
        $d = json_decode((string) $json, true);

        return is_array($d) && count($d) === 7 ? $this->normalizeWorkingHours($d) : $this->defaultWorkingHours();
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
        $shifts = $this->idNameMap((new ShiftModel())->where('client_id', $cid)->findAll());

        foreach ($staff as &$s) {
            $s['has_password'] = ! empty($s['password'] ?? null);
            unset($s['password']);
            $s['role_name']         = $s['role_id'] ? ($roles[$s['role_id']] ?? null) : null;
            $s['manager_name']      = $s['reports_to'] ? ($names[$s['reports_to']] ?? null) : null;
            $s['department']        = $s['department_id'] ? ($depts[$s['department_id']] ?? null) : null;
            $s['office_name']       = $s['office_location_id'] ? ($offices[$s['office_location_id']] ?? null) : null;
            $s['shift_name']        = ($s['shift_id'] ?? null) ? ($shifts[$s['shift_id']] ?? null) : null;
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
            'shift_id'           => (int) $this->input('shift_id') ?: null,
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
        $cid = $this->clientId();
        $aq  = (new AssetModel())->where('client_id', $cid);

        // Reporting-hierarchy scope: a non-admin sees assets they manage OR that
        // are currently allocated to someone in their reporting sub-tree. Admins
        // (scope null) see everything.
        $scope = $this->visibleStaffIds();
        if ($scope !== null) {
            $allocatedIds = array_column(
                (new AssetAllocationModel())->select('asset_id')
                    ->where(['client_id' => $cid, 'status' => 'allocated'])
                    ->whereIn('staff_id', $scope ?: [0])->findAll(),
                'asset_id',
            );
            $aq->groupStart()->whereIn('managed_by', $scope ?: [0]);
            if ($allocatedIds) {
                $aq->orWhereIn('id', $allocatedIds);
            }
            $aq->groupEnd();
        }
        $assets = $aq->orderBy('id', 'DESC')->findAll();
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
        // A non-admin creator who didn't pick a manager owns it themselves, so the
        // new asset stays inside their reporting-scoped view (see canSeeAsset).
        if (! $this->isAdmin() && empty($data['managed_by']) && $this->staffId()) {
            $data['managed_by'] = $this->staffId();
        }
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
        if (! $before || ! $this->canSeeAsset($before)) {
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
        $asset = $model->where('client_id', $cid)->find($id);
        if (! $asset || ! $this->canSeeAsset($asset)) {
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
        if (! $asset || ! $this->canSeeAsset($asset)) {
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
        if (! $asset || ! $this->canSeeAsset($asset)) {
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
        $cid   = $this->clientId();
        $asset = (new AssetModel())->where('client_id', $cid)->find($id);
        if (! $asset || ! $this->canSeeAsset($asset)) {
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
        $cid   = $this->clientId();
        $asset = (new AssetModel())->where('client_id', $cid)->find($id);
        if (! $asset || ! $this->canSeeAsset($asset)) {
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
        if ($resp = $this->requirePermission('assets')) {
            return $resp;
        }
        $cid   = $this->clientId();
        $asset = (new AssetModel())->where('client_id', $cid)->find($id);
        if (! $asset || ! $this->canSeeAsset($asset)) {
            return $this->failNotFound('Asset not found');
        }
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

    /**
     * Whether the current user may see/act on one asset under the reporting
     * hierarchy: admins always; otherwise they manage it (managed_by in their
     * sub-tree) OR it's currently allocated to someone in their sub-tree.
     */
    private function canSeeAsset(array $asset): bool
    {
        $scope = $this->visibleStaffIds();
        if ($scope === null) {
            return true; // admin
        }
        if (in_array((int) ($asset['managed_by'] ?? 0), $scope, true)) {
            return true;
        }
        $holder = $this->currentAllocStaff((int) ($asset['client_id'] ?? $this->clientId()), (int) ($asset['id'] ?? 0));

        return $holder !== null && in_array($holder, $scope, true);
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
