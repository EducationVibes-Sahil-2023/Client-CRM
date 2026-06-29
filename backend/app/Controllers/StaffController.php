<?php

namespace App\Controllers;

use App\Libraries\FeatureService;
use App\Models\AnnouncementModel;
use App\Models\AnnouncementReadModel;
use App\Models\ClientModel;
use App\Models\ClientRoleModel;
use App\Models\ClientRolePermissionModel;
use App\Models\ClientStaffModel;
use App\Models\ClientTaskModel;
use App\Models\UserModel;

/**
 * Staff area. Protected by the `auth:staff` filter, so the session always holds
 * a staff member (role 'staff', with client_id + staff_id + role_id).
 *
 * Everything is scoped to the staff's client_id and gated by the permission
 * matrix attached to their role (client_role_permissions). A staff member only
 * ever sees the modules their role grants `view` on.
 */
class StaffController extends ApiController
{
    /** module => {view,create,update,delete} for the staff's role. */
    private function loadPermissions(?int $roleId): array
    {
        if (! $roleId) {
            return [];
        }

        $map = [];
        foreach ((new ClientRolePermissionModel())->where('role_id', $roleId)->findAll() as $p) {
            $map[$p['module']] = [
                'view'   => (bool) $p['can_view'],
                'create' => (bool) $p['can_create'],
                'update' => (bool) $p['can_update'],
                'delete' => (bool) $p['can_delete'],
            ];
        }

        return $map;
    }

    /** A staff member's saved per-staff permission override (empty = none). */
    private function loadExtraPermissions(?int $staffId): array
    {
        if (! $staffId) {
            return [];
        }
        $staff = (new ClientStaffModel())->find($staffId);
        $extra = json_decode((string) ($staff['extra_permissions'] ?? ''), true);

        return is_array($extra) ? $extra : [];
    }

    /**
     * A staff member's effective grants. A per-staff permission set (saved when
     * the admin customises the matrix) OVERRIDES the role; otherwise the role's
     * permissions apply. So staff stay role-linked by default, but an admin can
     * tailor any individual once they adjust the matrix.
     */
    private function resolvePermissions(array $user): array
    {
        $extra = $this->loadExtraPermissions(isset($user['staff_id']) ? (int) $user['staff_id'] : null);
        if (! empty($extra)) {
            return $extra;
        }

        return $this->loadPermissions($user['role_id'] ?? null);
    }

    /**
     * Effective access = the role grants the permission AND the client's plan
     * includes the feature. A module disabled by the plan is hidden even if the
     * role permits it.
     *
     * @param array<string,array<string,bool>> $perms
     * @param array<string,bool>               $features
     * @return array<string,array<string,bool>>
     */
    private function effectivePermissions(array $perms, array $features): array
    {
        $out = [];
        foreach ($perms as $module => $actions) {
            $featureOn = $features[$module] ?? true; // non-feature modules aren't gated
            $out[$module] = [
                'view'   => $featureOn && ! empty($actions['view']),
                'create' => $featureOn && ! empty($actions['create']),
                'update' => $featureOn && ! empty($actions['update']),
                'delete' => $featureOn && ! empty($actions['delete']),
            ];
        }

        return $out;
    }

    /** GET /staff/me — identity + effective permission matrix (drives UI gating). */
    public function me()
    {
        $u        = $this->currentUser();
        $cid      = (int) $u['client_id'];
        $features = (new FeatureService())->effective($cid);
        $perms    = $this->effectivePermissions($this->resolvePermissions($u), $features);
        $client   = (new ClientModel())->find($cid);

        return $this->respond([
            'user' => [
                'name'      => ($u['name'] ?? '') !== '' ? $u['name'] : $u['email'],
                'email'     => $u['email'],
                'role'      => 'staff',
                'client_id' => $cid,
            ],
            'client'      => $client ? ['name' => $client['name']] : null,
            'permissions' => $perms,
            'features'    => $features,
            'modules'     => ClientController::MODULES,
        ]);
    }

    /** GET /staff/dashboard — stats + recent items, only for permitted modules. */
    public function dashboard()
    {
        $u        = $this->currentUser();
        $cid      = (int) $u['client_id'];
        $sid      = (int) ($u['staff_id'] ?? $u['id']);
        $features = (new FeatureService())->effective($cid);
        $perms    = $this->effectivePermissions($this->resolvePermissions($u), $features);

        $can = static fn (string $m): bool => ! empty($perms[$m]['view']);

        $stats         = [];
        $myTasks       = [];
        $announcements = [];

        if ($can('team')) {
            // A reporting manager only counts the staff under them (self + reports).
            $reports = (new ClientStaffModel())->subordinateIds($cid, $sid);
            $stats['team'] = max(0, count($reports) - 1); // exclude self
        }
        if ($can('roles')) {
            $stats['roles'] = (new ClientRoleModel())->where('client_id', $cid)->countAllResults();
        }
        if ($can('tasks')) {
            $stats['tasks_open'] = (new ClientTaskModel())->where('client_id', $cid)->where('status', 'open')->countAllResults();
            $stats['my_tasks']   = (new ClientTaskModel())->where('client_id', $cid)->where('assigned_to', $sid)->where('status', 'open')->countAllResults();
            $myTasks             = (new ClientTaskModel())->where('client_id', $cid)->where('assigned_to', $sid)->orderBy('id', 'DESC')->findAll(8);
        }
        if ($can('announcements')) {
            $announcements = (new AnnouncementModel())->where('client_id', $cid)
                ->orderBy('pinned', 'DESC')->orderBy('created_at', 'DESC')->findAll(6);
        }

        return $this->respond([
            'permissions'   => $perms,
            'features'      => $features,
            'modules'       => ClientController::MODULES,
            'stats'         => $stats,
            'my_tasks'      => $myTasks,
            'announcements' => $announcements,
        ]);
    }

    // --------------------------------------------------------- ANNOUNCEMENTS
    //
    // Announcements are a broadcast feature: every staff member sees the ones
    // targeted to them (all-team / their department / them specifically),
    // regardless of role permissions.

    /** GET /staff/announcements — announcements targeted to me + my read/ack state. */
    public function announcements()
    {
        $u   = $this->currentUser();
        $cid = (int) $u['client_id'];
        $sid = (int) ($u['staff_id'] ?? $u['id']);

        $me     = (new ClientStaffModel())->find($sid);
        $deptId = $me && $me['department_id'] !== null ? (int) $me['department_id'] : 0;

        $reads = [];
        foreach ((new AnnouncementReadModel())->where('client_id', $cid)->where('staff_id', $sid)->findAll() as $r) {
            $reads[(int) $r['announcement_id']] = $r;
        }

        $rows = (new AnnouncementModel())->where('client_id', $cid)
            ->orderBy('pinned', 'DESC')->orderBy('id', 'DESC')->findAll();

        $out = [];
        foreach ($rows as $a) {
            if (! $this->announcementVisible($a, $sid, $deptId)) {
                continue;
            }
            $r     = $reads[(int) $a['id']] ?? null;
            $out[] = [
                'id'              => (int) $a['id'],
                'title'           => $a['title'],
                'body'            => $a['body'],
                'pinned'          => (bool) $a['pinned'],
                'require_ack'     => (bool) ($a['require_ack'] ?? false),
                'attachments'     => $this->decodeAttachments($a['attachments'] ?? null),
                'author'          => $this->authorName($a['created_by'] ?? null),
                'created_at'      => $a['created_at'],
                'read_at'         => $r['read_at'] ?? null,
                'acknowledged_at' => $r['acknowledged_at'] ?? null,
            ];
        }

        $unread = count(array_filter($out, static fn ($a) => empty($a['read_at'])));

        return $this->respond(['announcements' => $out, 'unread' => $unread]);
    }

    /** POST /staff/announcements/{id}/read — mark an announcement read. */
    public function markAnnouncementRead(int $id)
    {
        return $this->touchAnnouncement($id, false);
    }

    /** POST /staff/announcements/{id}/ack — acknowledge an announcement. */
    public function acknowledgeAnnouncement(int $id)
    {
        return $this->touchAnnouncement($id, true);
    }

    /** Upsert my read/ack marker for an announcement I'm allowed to see. */
    private function touchAnnouncement(int $id, bool $ack)
    {
        $u   = $this->currentUser();
        $cid = (int) $u['client_id'];
        $sid = (int) ($u['staff_id'] ?? $u['id']);

        $a = (new AnnouncementModel())->where('client_id', $cid)->find($id);
        if (! $a) {
            return $this->failNotFound('Announcement not found');
        }

        $me     = (new ClientStaffModel())->find($sid);
        $deptId = $me && $me['department_id'] !== null ? (int) $me['department_id'] : 0;
        if (! $this->announcementVisible($a, $sid, $deptId)) {
            return $this->failNotFound('Announcement not found');
        }

        $now   = date('Y-m-d H:i:s');
        $model = new AnnouncementReadModel();
        $row   = $model->where('client_id', $cid)->where('announcement_id', $id)->where('staff_id', $sid)->first();

        if ($row) {
            $data = ['read_at' => $row['read_at'] ?: $now];
            if ($ack) {
                $data['acknowledged_at'] = $row['acknowledged_at'] ?: $now;
            }
            $model->update($row['id'], $data);
        } else {
            $model->insert([
                'client_id'       => $cid,
                'announcement_id' => $id,
                'staff_id'        => $sid,
                'read_at'         => $now,
                'acknowledged_at' => $ack ? $now : null,
            ]);
        }

        return $this->respond(['message' => $ack ? 'Acknowledged' : 'Marked read']);
    }

    /** Is this announcement targeted at the given staff member? */
    private function announcementVisible(array $a, int $sid, int $deptId): bool
    {
        $audience = $a['audience'] ?? 'all';
        if ($audience === 'all') {
            return true;
        }
        $targets = json_decode((string) ($a['target_ids'] ?? '[]'), true);
        $targets = is_array($targets) ? array_map('intval', $targets) : [];

        if ($audience === 'department') {
            return in_array($deptId, $targets, true);
        }
        if ($audience === 'staff') {
            return in_array($sid, $targets, true);
        }

        return false;
    }

    /**
     * @param mixed $value
     * @return array<int,array<string,mixed>>
     */
    private function decodeAttachments($value): array
    {
        $value = is_string($value) ? json_decode($value, true) : $value;
        if (! is_array($value)) {
            return [];
        }
        $out = [];
        foreach ($value as $x) {
            if (is_array($x) && ! empty($x['url'])) {
                $out[] = [
                    'url'  => (string) $x['url'],
                    'name' => (string) ($x['name'] ?? 'file'),
                    'type' => (string) ($x['type'] ?? ''),
                    'size' => (int) ($x['size'] ?? 0),
                ];
            }
        }

        return $out;
    }

    /** Display name of the client admin who posted an announcement. */
    private function authorName($userId): string
    {
        if (! $userId) {
            return 'Admin';
        }
        $u = (new UserModel())->find((int) $userId);
        if (! $u) {
            return 'Admin';
        }

        return ($u['name'] ?? '') !== '' ? $u['name'] : ($u['email'] ?? 'Admin');
    }
}
