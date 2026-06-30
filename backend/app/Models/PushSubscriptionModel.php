<?php

namespace App\Models;

/**
 * Browser Web Push subscriptions, addressed to the same (recipient_type,
 * recipient_id) pair as in-app notifications. Lives in the main DB. Append-only;
 * rows are pruned when a push endpoint reports gone (404/410).
 */
class PushSubscriptionModel extends BaseModel
{
    protected $table        = 'push_subscriptions';
    protected $primaryKey   = 'id';
    protected $useTimestamps = true;
    protected $createdField  = 'created_at';
    protected $updatedField  = '';
    protected $allowedFields = [
        'client_id', 'recipient_type', 'recipient_id',
        'endpoint', 'endpoint_hash', 'p256dh', 'auth', 'user_agent',
    ];

    /** Save (or refresh) a subscription, keyed by the endpoint hash. */
    public function upsertByEndpoint(array $data): void
    {
        $data['endpoint_hash'] = hash('sha256', (string) ($data['endpoint'] ?? ''));
        $existing = $this->where('endpoint_hash', $data['endpoint_hash'])->first();
        if ($existing) {
            // Refresh keys + ownership; don't touch the hash/created_at.
            $this->update($existing['id'], [
                'client_id'      => $data['client_id'],
                'recipient_type' => $data['recipient_type'],
                'recipient_id'   => $data['recipient_id'],
                'p256dh'         => $data['p256dh'],
                'auth'           => $data['auth'],
                'user_agent'     => $data['user_agent'] ?? null,
            ]);
            return;
        }
        $this->insert($data);
    }

    /** All subscriptions for one recipient in one client. */
    public function forRecipient(int $clientId, string $type, int $id): array
    {
        return $this->where('client_id', $clientId)
            ->where('recipient_type', $type)
            ->where('recipient_id', $id)
            ->findAll();
    }
}
