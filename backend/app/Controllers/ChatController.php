<?php

namespace App\Controllers;

use App\Models\AppNotificationModel;
use App\Models\ChatMessageModel;
use App\Models\ClientModel;
use App\Models\ClientStaffModel;
use App\Models\ConversationModel;
use App\Models\ConversationParticipantModel;
use App\Models\UserModel;

/**
 * Real-time (DB-polled) chat + in-app notifications, shared by the super-admin,
 * client-admin and staff areas. Routes live under /superadmin/chat/*,
 * /client/chat/* and /staff/chat/*; the acting party is resolved from the
 * session, and each route group's auth filter guarantees the role.
 *
 * Three conversation kinds, all on the same party-typed tables:
 *   - 'support' — super_admin ↔ client_admin (one thread per client).
 *   - 'team'    — a single group room per client (client_admin + all staff).
 *   - 'dm'      — a 1:1 thread between any two members of one client.
 *
 * Parties are addressed by (type, id): 'user' → users.id (super_admin /
 * client_admin), 'staff' → client_staff.id. Super admins are never part of
 * 'team' or 'dm' conversations — they only ever see 'support'.
 */
class ChatController extends ApiController
{
    /** Set by storeAttachment() when an uploaded file is rejected. */
    private ?string $attachmentError = null;

    /**
     * The acting party, derived from the session.
     *
     * @return array{type:string,id:int,role:string,client_id:?int}
     */
    private function me(): array
    {
        $u       = $this->currentUser();
        $role    = (string) ($u['role'] ?? '');
        $isStaff = $role === 'staff';

        return [
            'type'      => $isStaff ? 'staff' : 'user',
            'id'        => $isStaff ? (int) ($u['staff_id'] ?? $u['id'] ?? 0) : (int) ($u['id'] ?? 0),
            'role'      => $role,
            'client_id' => isset($u['client_id']) && $u['client_id'] !== null ? (int) $u['client_id'] : null,
        ];
    }

    /** True for members of a client team (client_admin or staff), i.e. not super_admin. */
    private function isTeamMember(array $me): bool
    {
        return ($me['role'] === 'client_admin' || $me['role'] === 'staff') && $me['client_id'] !== null;
    }

    /** ClientStaffModel bound to the current session's tenant DB. */
    private function staffModel(): ClientStaffModel
    {
        return new ClientStaffModel();
    }

    // ------------------------------------------------------------ conversations

    /** GET chat/conversations — my threads with last message + unread count. */
    public function conversations()
    {
        $me = $this->me();

        if ($me['role'] === 'client_admin') {
            // The client always has exactly one support thread; create on demand.
            $this->getOrCreateSupport($me['client_id']);
        }
        if ($this->isTeamMember($me)) {
            // Every client has one shared team room; create on demand.
            $this->getOrCreateTeam($me['client_id']);
        }

        $rows = $this->myConversations($me);

        return $this->respond(['conversations' => array_map(fn ($c) => $this->shapeConversation($c, $me), $rows)]);
    }

    /**
     * POST chat/conversations/start — open (or fetch) a support conversation.
     * Super admin: body { client_id }. Client admin: their own client.
     */
    public function startConversation()
    {
        $me = $this->me();

        if ($me['role'] === 'super_admin') {
            $clientId = (int) $this->input('client_id');
            if ($clientId <= 0 || ! (new ClientModel())->find($clientId)) {
                return $this->failValidationErrors(['client_id' => 'Pick a valid client.']);
            }
        } else {
            $clientId = $me['client_id'];
        }

        $conv = $this->getOrCreateSupport($clientId);

        return $this->respond(['conversation' => $this->shapeConversation($conv, $me)]);
    }

    /**
     * GET chat/directory — people in my client I can start a direct message with
     * (client admins + active staff, excluding myself). Team members only.
     */
    public function directory()
    {
        $me = $this->me();
        if (! $this->isTeamMember($me)) {
            return $this->respond(['members' => []]);
        }

        $cid     = $me['client_id'];
        $members = [];

        foreach ((new UserModel())->where('role', 'client_admin')->where('client_id', $cid)->findAll() as $u) {
            if ($me['type'] === 'user' && (int) $u['id'] === $me['id']) {
                continue;
            }
            $members[] = [
                'party_type' => 'user',
                'party_id'   => (int) $u['id'],
                'name'       => ($u['name'] ?? '') !== '' ? $u['name'] : $u['email'],
                'role_label' => 'Admin',
            ];
        }

        foreach ($this->staffModel()->where('client_id', $cid)->findAll() as $st) {
            if (($st['status'] ?? 'active') !== 'active') {
                continue;
            }
            if ($me['type'] === 'staff' && (int) $st['id'] === $me['id']) {
                continue;
            }
            $members[] = [
                'party_type' => 'staff',
                'party_id'   => (int) $st['id'],
                'name'       => ($st['name'] ?? '') !== '' ? $st['name'] : 'Staff',
                'role_label' => 'Staff',
            ];
        }

        usort($members, static fn ($a, $b) => strcasecmp($a['name'], $b['name']));

        return $this->respond(['members' => $members]);
    }

    /**
     * POST chat/dm/start — open (or fetch) a 1:1 thread with another member of
     * my client. Body { party_type: 'user'|'staff', party_id }.
     */
    public function startDm()
    {
        $me = $this->me();
        if (! $this->isTeamMember($me)) {
            return $this->failForbidden('Direct messages are not available here.');
        }

        $type = (string) $this->input('party_type');
        $pid  = (int) $this->input('party_id');

        if (! in_array($type, ['user', 'staff'], true) || $pid <= 0) {
            return $this->failValidationErrors(['party_id' => 'Pick a valid member.']);
        }
        if ($type === $me['type'] && $pid === $me['id']) {
            return $this->failValidationErrors(['party_id' => 'You cannot message yourself.']);
        }
        if (! $this->isMember($me['client_id'], $type, $pid)) {
            return $this->failValidationErrors(['party_id' => 'That member is not in your team.']);
        }

        $conv = $this->getOrCreateDm($me['client_id'], $me, ['type' => $type, 'id' => $pid]);

        return $this->respond(['conversation' => $this->shapeConversation($conv, $me)]);
    }

    /**
     * GET chat/conversations/{id}/messages — thread messages, always returned
     * oldest-first for rendering. Three modes, by query param:
     *   - after=ID   : new messages since ID (the 2s poller). Returns all.
     *   - before=ID  : the page of older history ending just before ID (infinite
     *                  scroll up). Returns `limit` rows + `has_more`.
     *   - (neither)  : the latest `limit` messages (initial open) + `has_more`.
     * Opening (initial / poll) marks the thread read; paging history does not.
     */
    public function messages(int $id)
    {
        $me   = $this->me();
        $conv = (new ConversationModel())->find($id);
        if (! $conv || ! $this->canAccess($conv, $me)) {
            return $this->failNotFound('Conversation not found');
        }

        $after  = (int) ($this->request->getGet('after') ?? 0);
        $before = (int) ($this->request->getGet('before') ?? 0);
        $limit  = max(1, min(100, (int) ($this->request->getGet('limit') ?? 30)));

        $model   = new ChatMessageModel();
        $hasMore = false;

        if ($after > 0) {
            $rows = $model->where('conversation_id', $id)->where('id >', $after)
                ->orderBy('id', 'ASC')->findAll(300);
        } else {
            // Fetch newest-first for the LIMIT (with one look-ahead row to detect
            // more history), then reverse to oldest-first for the client.
            $q = $model->where('conversation_id', $id);
            if ($before > 0) {
                $q->where('id <', $before);
            }
            $rows = $q->orderBy('id', 'DESC')->findAll($limit + 1);
            if (count($rows) > $limit) {
                $hasMore = true;
                array_pop($rows);
            }
            $rows = array_reverse($rows);
        }

        $names = $this->nameMapForMessages($rows);
        $out   = array_map(fn ($m) => $this->shapeMessage($m, $names, $me), $rows);

        if ($before === 0) {
            $this->markRead($id, $me);
        }

        return $this->respond(['messages' => $out, 'has_more' => $hasMore]);
    }

    /**
     * POST chat/conversations/{id}/messages — { body } as JSON, or multipart
     * with a `body` field and/or a `file` attachment. At least one of text or
     * file is required.
     */
    public function sendMessage(int $id)
    {
        $me   = $this->me();
        $conv = (new ConversationModel())->find($id);
        if (! $conv || ! $this->canAccess($conv, $me)) {
            return $this->failNotFound('Conversation not found');
        }

        $body       = mb_substr(trim((string) $this->input('body')), 0, 5000);
        $attachment = $this->storeAttachment();
        if ($attachment === false) {
            return $this->failValidationErrors(['file' => $this->attachmentError ?? 'Invalid file.']);
        }

        if ($body === '' && $attachment === null) {
            return $this->failValidationErrors(['body' => 'Message cannot be empty.']);
        }

        $msgModel = new ChatMessageModel();
        $msgId    = $msgModel->insert([
            'conversation_id' => $id,
            'sender_type'     => $me['type'],
            'sender_id'       => $me['id'],
            'body'            => $body,
            'attachment_url'  => $attachment['url']  ?? null,
            'attachment_name' => $attachment['name'] ?? null,
            'attachment_type' => $attachment['type'] ?? null,
            'attachment_size' => $attachment['size'] ?? null,
        ]);

        (new ConversationModel())->update($id, ['last_message_at' => date('Y-m-d H:i:s')]);
        $this->markRead($id, $me); // I've read my own message

        $snippet = $body !== '' ? $body : '📎 ' . ($attachment['name'] ?? 'Attachment');
        $this->notifyOtherParties($conv, $me, $snippet);

        $msg   = $msgModel->find($msgId);
        $names = $this->nameMapForMessages([$msg]);

        return $this->respondCreated(['message' => $this->shapeMessage($msg, $names, $me)]);
    }

    /** GET chat/poll — lightweight unread snapshot for the 2s poller. */
    public function poll()
    {
        $me    = $this->me();
        $convs = $this->myConversations($me);

        $list      = [];
        $chatTotal = 0;
        foreach ($convs as $c) {
            $unread = $this->unreadCount((int) $c['id'], $me);
            $chatTotal += $unread;
            $list[] = ['id' => (int) $c['id'], 'unread' => $unread, 'last_message_at' => $c['last_message_at']];
        }

        $notifUnread = (new AppNotificationModel())
            ->where('recipient_type', $me['type'])->where('recipient_id', $me['id'])
            ->where('read_at', null)->countAllResults();

        return $this->respond([
            'conversations' => $list,
            'chat_unread'   => $chatTotal,
            'notif_unread'  => $notifUnread,
        ]);
    }

    // ----------------------------------------------------------- notifications

    /**
     * GET notifications — my in-app notifications, newest first. Paginated for
     * infinite scroll:
     *   - limit            : page size (default 20, max 50).
     *   - before=ID        : only rows older than ID (the next page).
     *   - filter=all|unread|read : restrict by read state (default all).
     * Returns `has_more` plus `unread` (the total unread, independent of filter).
     */
    public function notifications()
    {
        $me     = $this->me();
        $limit  = max(1, min(50, (int) ($this->request->getGet('limit') ?? 20)));
        $before = (int) ($this->request->getGet('before') ?? 0);
        $filter = (string) ($this->request->getGet('filter') ?? 'all');

        $q = (new AppNotificationModel())
            ->where('recipient_type', $me['type'])->where('recipient_id', $me['id']);
        if ($filter === 'unread') {
            $q->where('read_at', null);
        } elseif ($filter === 'read') {
            $q->where('read_at IS NOT NULL', null, false);
        }
        if ($before > 0) {
            $q->where('id <', $before);
        }

        $rows    = $q->orderBy('id', 'DESC')->findAll($limit + 1);
        $hasMore = count($rows) > $limit;
        if ($hasMore) {
            array_pop($rows);
        }

        $unread = (new AppNotificationModel())
            ->where('recipient_type', $me['type'])->where('recipient_id', $me['id'])
            ->where('read_at', null)->countAllResults();

        return $this->respond(['notifications' => $rows, 'unread' => $unread, 'has_more' => $hasMore]);
    }

    /** POST notifications/{id}/read */
    public function readNotification(int $id)
    {
        $me = $this->me();
        $n  = (new AppNotificationModel())->find($id);
        if (! $n || $n['recipient_type'] !== $me['type'] || (int) $n['recipient_id'] !== $me['id']) {
            return $this->failNotFound('Notification not found');
        }
        (new AppNotificationModel())->update($id, ['read_at' => date('Y-m-d H:i:s')]);

        return $this->respond(['message' => 'Marked read']);
    }

    /** POST notifications/read-all */
    public function readAllNotifications()
    {
        $me = $this->me();
        (new AppNotificationModel())
            ->where('recipient_type', $me['type'])->where('recipient_id', $me['id'])
            ->where('read_at', null)
            ->set('read_at', date('Y-m-d H:i:s'))->update();

        return $this->respond(['message' => 'All marked read']);
    }

    // ----------------------------------------------------------------- helpers

    /** Public shape of a single message row for the current actor. */
    private function shapeMessage(array $m, array $names, array $me): array
    {
        $senderType = (string) ($m['sender_type'] ?? 'user');

        return [
            'id'              => (int) $m['id'],
            'body'            => $m['body'],
            'attachment_url'  => $m['attachment_url'] ?? null,
            'attachment_name' => $m['attachment_name'] ?? null,
            'attachment_type' => $m['attachment_type'] ?? null,
            'attachment_size' => isset($m['attachment_size']) && $m['attachment_size'] !== null ? (int) $m['attachment_size'] : null,
            'sender_type'     => $senderType,
            'sender_id'       => (int) $m['sender_id'],
            'sender_name'     => $names[$senderType . ':' . (int) $m['sender_id']] ?? 'Unknown',
            'is_mine'         => $senderType === $me['type'] && (int) $m['sender_id'] === $me['id'],
            'created_at'      => $m['created_at'],
        ];
    }

    /**
     * Validate and store an optional uploaded file (multipart field "file").
     *
     * @return array{url:string,name:string,type:string,size:int}|false|null
     *         null when no file was sent, false on a rejected file (reason in
     *         $this->attachmentError), or the stored file's metadata on success.
     */
    private function storeAttachment()
    {
        $file = $this->request->getFile('file');
        if (! $file || $file->getError() === UPLOAD_ERR_NO_FILE) {
            return null;
        }
        if (! $file->isValid()) {
            $this->attachmentError = 'The file could not be uploaded.';

            return false;
        }

        $allowed = [
            'image/png', 'image/jpeg', 'image/webp', 'image/gif',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/plain', 'text/csv',
        ];
        $mime = $file->getMimeType();
        $size = $file->getSize();
        if (! in_array($mime, $allowed, true)) {
            $this->attachmentError = 'Unsupported file type.';

            return false;
        }
        if ($size > 10 * 1024 * 1024) {
            $this->attachmentError = 'File must be 10MB or smaller.';

            return false;
        }

        $dir = FCPATH . 'uploads/chat';
        if (! is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $original = $file->getClientName();
        $newName  = $file->getRandomName();
        $file->move($dir, $newName);

        return [
            'url'  => '/uploads/chat/' . $newName,
            'name' => mb_substr($original, 0, 200),
            'type' => $mime,
            'size' => $size,
        ];
    }

    /** Find or create the single support thread for a client. */
    private function getOrCreateSupport(?int $clientId): array
    {
        $model = new ConversationModel();
        $conv  = $model->where('type', 'support')->where('client_id', $clientId)->first();
        if ($conv) {
            return $conv;
        }

        $id = $model->insert([
            'client_id'       => $clientId,
            'type'            => 'support',
            'title'           => null,
            'last_message_at' => null,
        ]);

        return $model->find($id);
    }

    /** Find or create the single team room for a client. */
    private function getOrCreateTeam(?int $clientId): array
    {
        $model = new ConversationModel();
        $conv  = $model->where('type', 'team')->where('client_id', $clientId)->first();
        if ($conv) {
            return $conv;
        }

        $id = $model->insert([
            'client_id'       => $clientId,
            'type'            => 'team',
            'title'           => 'Team',
            'last_message_at' => null,
        ]);

        return $model->find($id);
    }

    /**
     * Find or create the 1:1 thread between two parties of one client. DM
     * participants are materialised at creation so the thread is discoverable
     * before either side has posted.
     *
     * @param array{type:string,id:int} $a
     * @param array{type:string,id:int} $b
     */
    private function getOrCreateDm(int $clientId, array $a, array $b): array
    {
        $convModel = new ConversationModel();
        $pModel    = new ConversationParticipantModel();

        $dmIds = array_column(
            $convModel->where('type', 'dm')->where('client_id', $clientId)->findAll(),
            'id'
        );
        if ($dmIds) {
            $aConvIds = array_column(
                $pModel->whereIn('conversation_id', $dmIds)
                    ->where('party_type', $a['type'])->where('party_id', $a['id'])->findAll(),
                'conversation_id'
            );
            if ($aConvIds) {
                $match = $pModel->whereIn('conversation_id', $aConvIds)
                    ->where('party_type', $b['type'])->where('party_id', $b['id'])->first();
                if ($match) {
                    return $convModel->find((int) $match['conversation_id']);
                }
            }
        }

        $id = $convModel->insert([
            'client_id'       => $clientId,
            'type'            => 'dm',
            'title'           => null,
            'last_message_at' => null,
        ]);
        foreach ([$a, $b] as $party) {
            $pModel->insert([
                'conversation_id' => $id,
                'party_type'      => $party['type'],
                'party_id'        => $party['id'],
                'last_read_at'    => null,
            ]);
        }

        return $convModel->find($id);
    }

    /** Is (type,id) an active member of this client (admin user or active staff)? */
    private function isMember(?int $clientId, string $type, int $id): bool
    {
        if ($type === 'user') {
            return (bool) (new UserModel())
                ->where('id', $id)->where('role', 'client_admin')->where('client_id', $clientId)->first();
        }

        $st = $this->staffModel()->where('id', $id)->where('client_id', $clientId)->first();

        return $st !== null && ($st['status'] ?? 'active') === 'active';
    }

    /** Conversations visible to the current actor. */
    private function myConversations(array $me): array
    {
        if ($me['role'] === 'super_admin') {
            return (new ConversationModel())->where('type', 'support')
                ->orderBy('last_message_at', 'DESC')->orderBy('id', 'DESC')->findAll();
        }

        if (! $this->isTeamMember($me)) {
            return [];
        }

        $cid = $me['client_id'];
        $out = [];

        if ($me['role'] === 'client_admin') {
            $support = (new ConversationModel())->where('type', 'support')->where('client_id', $cid)->first();
            if ($support) {
                $out[(int) $support['id']] = $support;
            }
        }

        $team = (new ConversationModel())->where('type', 'team')->where('client_id', $cid)->first();
        if ($team) {
            $out[(int) $team['id']] = $team;
        }

        $myDmIds = array_column(
            (new ConversationParticipantModel())
                ->where('party_type', $me['type'])->where('party_id', $me['id'])->findAll(),
            'conversation_id'
        );
        if ($myDmIds) {
            foreach (
                (new ConversationModel())->whereIn('id', $myDmIds)
                    ->where('type', 'dm')->where('client_id', $cid)->findAll() as $dm
            ) {
                $out[(int) $dm['id']] = $dm;
            }
        }

        $rows = array_values($out);
        // Most recently active first; threads with no messages yet sort last.
        usort($rows, static function ($a, $b) {
            $av = $a['last_message_at'] ?? '';
            $bv = $b['last_message_at'] ?? '';
            if ($av === $bv) {
                return (int) $b['id'] <=> (int) $a['id'];
            }

            return strcmp((string) $bv, (string) $av);
        });

        return $rows;
    }

    private function canAccess(array $conv, array $me): bool
    {
        if ($me['role'] === 'super_admin') {
            return $conv['type'] === 'support';
        }

        if (! $this->isTeamMember($me) || (int) $conv['client_id'] !== $me['client_id']) {
            return false;
        }

        switch ($conv['type']) {
            case 'support':
                return $me['role'] === 'client_admin';
            case 'team':
                return true; // any member of the client
            case 'dm':
                return (bool) (new ConversationParticipantModel())
                    ->where('conversation_id', $conv['id'])
                    ->where('party_type', $me['type'])->where('party_id', $me['id'])->first();
            default:
                return false;
        }
    }

    /** Public shape of a conversation for the current actor. */
    private function shapeConversation(array $conv, array $me): array
    {
        $clientId = $conv['client_id'] !== null ? (int) $conv['client_id'] : null;
        $type     = (string) $conv['type'];

        if ($type === 'support') {
            // The label is the "other side": super admin sees the client's name;
            // the client sees the platform support team.
            if ($me['role'] === 'super_admin') {
                $client = $clientId ? (new ClientModel())->find($clientId) : null;
                $title  = $client['name'] ?? ('Client #' . $clientId);
            } else {
                $title = 'Support team';
            }
        } elseif ($type === 'team') {
            $title = 'Team';
        } else { // dm
            $title = $this->dmTitle($conv, $me);
        }

        $last = (new ChatMessageModel())->where('conversation_id', $conv['id'])->orderBy('id', 'DESC')->first();

        return [
            'id'              => (int) $conv['id'],
            'type'            => $type,
            'client_id'       => $clientId,
            'title'           => $title,
            'last_message'    => $last ? mb_substr((string) $last['body'], 0, 120) : null,
            'last_message_at' => $conv['last_message_at'],
            'unread'          => $this->unreadCount((int) $conv['id'], $me),
        ];
    }

    /** Label for a DM = the other participant's name. */
    private function dmTitle(array $conv, array $me): string
    {
        $other = (new ConversationParticipantModel())
            ->where('conversation_id', $conv['id'])
            ->groupStart()->where('party_type !=', $me['type'])->orWhere('party_id !=', $me['id'])->groupEnd()
            ->first();

        if (! $other) {
            return 'Direct message';
        }

        return $this->partyName((string) $other['party_type'], (int) $other['party_id']);
    }

    /** Messages in a thread newer than my read marker and not sent by me. */
    private function unreadCount(int $convId, array $me): int
    {
        $p = (new ConversationParticipantModel())
            ->where('conversation_id', $convId)
            ->where('party_type', $me['type'])->where('party_id', $me['id'])
            ->first();

        $q = (new ChatMessageModel())->where('conversation_id', $convId)
            ->groupStart()->where('sender_type !=', $me['type'])->orWhere('sender_id !=', $me['id'])->groupEnd();

        if ($p && ! empty($p['last_read_at'])) {
            $q->where('created_at >', $p['last_read_at']);
        }

        return $q->countAllResults();
    }

    /** Upsert my read marker to now, and clear my chat notifications. */
    private function markRead(int $convId, array $me): void
    {
        $now   = date('Y-m-d H:i:s');
        $model = new ConversationParticipantModel();
        $row   = $model->where('conversation_id', $convId)
            ->where('party_type', $me['type'])->where('party_id', $me['id'])->first();

        if ($row) {
            $model->update($row['id'], ['last_read_at' => $now]);
        } else {
            $model->insert([
                'conversation_id' => $convId,
                'party_type'      => $me['type'],
                'party_id'        => $me['id'],
                'last_read_at'    => $now,
            ]);
        }

        (new AppNotificationModel())
            ->where('recipient_type', $me['type'])->where('recipient_id', $me['id'])
            ->where('type', 'chat_message')->where('read_at', null)
            ->set('read_at', $now)->update();
    }

    /** Notify the participants on the other side that a message arrived. */
    private function notifyOtherParties(array $conv, array $me, string $body): void
    {
        $senderName = $this->partyName($me['type'], $me['id']);
        $snippet    = mb_substr($body, 0, 140);
        $type       = (string) $conv['type'];

        if ($type === 'support') {
            if ($me['role'] === 'super_admin') {
                // Notify the client's admin(s).
                $recipients = (new UserModel())
                    ->where('role', 'client_admin')->where('client_id', $conv['client_id'])->findAll();
                $title = 'New message from support';
                foreach ($recipients as $r) {
                    $this->notifyParty('user', (int) $r['id'], $title, $snippet, '/client/chat');
                }
            } else {
                // Notify all super admins.
                $recipients = (new UserModel())->where('role', 'super_admin')->findAll();
                $title      = 'New message from ' . $senderName;
                foreach ($recipients as $r) {
                    $this->notifyParty('user', (int) $r['id'], $title, $snippet, '/admin/chat');
                }
            }

            return;
        }

        if ($type === 'team') {
            $this->notifyMembers($conv['client_id'], $me, 'New message in Team', $senderName . ': ' . $snippet);

            return;
        }

        // dm — notify the single other participant.
        $other = (new ConversationParticipantModel())
            ->where('conversation_id', $conv['id'])
            ->groupStart()->where('party_type !=', $me['type'])->orWhere('party_id !=', $me['id'])->groupEnd()
            ->first();
        if ($other) {
            $this->notifyParty((string) $other['party_type'], (int) $other['party_id'], 'New message from ' . $senderName, $snippet);
        }
    }

    /** Notify every member of a client (admins + active staff) except the sender. */
    private function notifyMembers(?int $clientId, array $me, string $title, string $body): void
    {
        foreach ((new UserModel())->where('role', 'client_admin')->where('client_id', $clientId)->findAll() as $u) {
            if ($me['type'] === 'user' && (int) $u['id'] === $me['id']) {
                continue;
            }
            $this->notifyParty('user', (int) $u['id'], $title, $body);
        }
        foreach ($this->staffModel()->where('client_id', $clientId)->findAll() as $st) {
            if (($st['status'] ?? 'active') !== 'active') {
                continue;
            }
            if ($me['type'] === 'staff' && (int) $st['id'] === $me['id']) {
                continue;
            }
            $this->notifyParty('staff', (int) $st['id'], $title, $body);
        }
    }

    /**
     * Insert one chat notification for a party. The deep-link defaults to the
     * party's own chat area when not given (staff vs client admin).
     */
    private function notifyParty(string $type, int $id, string $title, string $body, ?string $link = null): void
    {
        $link ??= $type === 'staff' ? '/staff/chat' : '/client/chat';

        (new AppNotificationModel())->insert([
            'recipient_type' => $type,
            'recipient_id'   => $id,
            'type'           => 'chat_message',
            'title'          => $title,
            'body'           => mb_substr($body, 0, 140),
            'link'           => $link,
        ]);
    }

    /** Display name for a single party (user or staff). */
    private function partyName(string $type, int $id): string
    {
        if ($type === 'staff') {
            $st = $this->staffModel()->find($id);

            return $st && ($st['name'] ?? '') !== '' ? $st['name'] : 'Staff';
        }

        $u = (new UserModel())->find($id);
        if (! $u) {
            return 'Unknown';
        }

        return ($u['name'] ?? '') !== '' ? $u['name'] : $u['email'];
    }

    /**
     * Build a "{type}:{id}" => display-name map covering both user and staff
     * senders of the given message rows. Keys are namespaced by party type
     * because user.id and staff.id share no sequence.
     *
     * @param array<int,array<string,mixed>> $rows message rows (sender_type, sender_id)
     * @return array<string,string>
     */
    private function nameMapForMessages(array $rows): array
    {
        $userIds  = [];
        $staffIds = [];
        foreach ($rows as $r) {
            $sid = (int) $r['sender_id'];
            if (($r['sender_type'] ?? 'user') === 'staff') {
                $staffIds[] = $sid;
            } else {
                $userIds[] = $sid;
            }
        }

        $map = [];
        if ($userIds) {
            foreach ((new UserModel())->whereIn('id', array_values(array_unique($userIds)))->findAll() as $u) {
                $map['user:' . (int) $u['id']] = ($u['name'] ?? '') !== '' ? $u['name'] : $u['email'];
            }
        }
        if ($staffIds) {
            foreach ($this->staffModel()->whereIn('id', array_values(array_unique($staffIds)))->findAll() as $st) {
                $map['staff:' . (int) $st['id']] = ($st['name'] ?? '') !== '' ? $st['name'] : 'Staff';
            }
        }

        return $map;
    }
}
