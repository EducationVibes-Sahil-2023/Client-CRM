<?php

namespace App\Libraries;

use App\Models\PushSubscriptionModel;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

/**
 * Sends Web Push notifications to a recipient's subscribed browsers.
 *
 * Gated by the per-client `web_push` feature (super-admin toggle): if a client
 * doesn't have it, sends are a silent no-op. Mirrors the in-app notification
 * recipient model — (recipient_type, recipient_id) within a client. Dead
 * subscriptions (404/410 from the push service) are pruned on send.
 *
 * A push failure must never break the action that triggered it, so every public
 * path is wrapped and logged.
 */
class PushService
{
    /** VAPID auth ready for WebPush, or null when keys aren't configured. */
    private static function vapid(): ?array
    {
        $public  = (string) env('vapid.publicKey', '');
        $private = (string) env('vapid.privateKey', '');
        $subject = (string) env('vapid.subject', '') ?: 'mailto:admin@example.com';

        if ($public === '' || $private === '') {
            return null;
        }

        return ['VAPID' => ['subject' => $subject, 'publicKey' => $public, 'privateKey' => $private]];
    }

    /** The VAPID public key the browser needs to subscribe (or '' if unset). */
    public static function publicKey(): string
    {
        return (string) env('vapid.publicKey', '');
    }

    /** Whether web push is usable for this client (feature on + keys present). */
    public static function enabledFor(int $clientId): bool
    {
        return self::vapid() !== null && (new FeatureService())->isEnabled($clientId, 'web_push');
    }

    /**
     * Push a notification to every browser the recipient has subscribed.
     * No-op (logged) on any failure, missing keys, or a client without the feature.
     */
    public static function sendToRecipient(int $clientId, string $recipientType, int $recipientId, string $title, ?string $body, ?string $link): void
    {
        try {
            if ($recipientId <= 0 || ! self::enabledFor($clientId)) {
                return;
            }

            $model = new PushSubscriptionModel();
            $subs  = $model->forRecipient($clientId, $recipientType, $recipientId);
            if (! $subs) {
                return;
            }

            $webPush = new WebPush(self::vapid());
            $payload = json_encode([
                'title' => $title,
                'body'  => $body ?? '',
                'url'   => $link ?? '/',
            ]);

            // endpoint => subscription row id, so we can prune the dead ones.
            $byEndpoint = [];
            foreach ($subs as $s) {
                $byEndpoint[(string) $s['endpoint']] = (int) $s['id'];
                $webPush->queueNotification(
                    Subscription::create([
                        'endpoint' => (string) $s['endpoint'],
                        'keys'     => ['p256dh' => (string) $s['p256dh'], 'auth' => (string) $s['auth']],
                    ]),
                    $payload,
                );
            }

            foreach ($webPush->flush() as $report) {
                $endpoint = $report->getEndpoint();
                if (! $report->isSuccess() && $report->isSubscriptionExpired() && isset($byEndpoint[$endpoint])) {
                    $model->delete($byEndpoint[$endpoint]);
                }
            }
        } catch (\Throwable $e) {
            log_message('error', 'Web push send failed: ' . $e->getMessage());
        }
    }
}
