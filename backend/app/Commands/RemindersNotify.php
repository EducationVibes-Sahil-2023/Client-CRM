<?php

namespace App\Commands;

use App\Libraries\PushService;
use App\Libraries\TenantManager;
use App\Models\AppNotificationModel;
use App\Models\ClientModel;
use App\Models\LeadModel;
use App\Models\LeadReminderModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * Fire due lead reminders SERVER-SIDE — an in-app notification + web push to the
 * user who set each reminder — independent of whether that user's browser is
 * open. This is the reliable path: the client also polls /client/reminders/poll
 * (instant while the app is open), but only this cron delivers when the tab is
 * closed, which is exactly when web push matters.
 *
 * Idempotent: a reminder is sent once (its notified_at is stamped), so the poll
 * and this cron never double-send.
 *
 *   php spark reminders:notify
 *
 * Wire to cron every minute:
 *   * * * * *  cd /var/www/crm/backend && php spark reminders:notify >> writable/logs/reminders.log 2>&1
 */
class RemindersNotify extends BaseCommand
{
    protected $group       = 'Leads';
    protected $name        = 'reminders:notify';
    protected $description = 'Deliver due lead reminders (in-app + web push) server-side, even when the user is offline.';

    public function run(array $params)
    {
        $now     = date('Y-m-d H:i:s');
        $manager = new TenantManager();
        $notif   = new AppNotificationModel();
        $sent    = 0;

        foreach ((new ClientModel())->findAll() as $c) {
            $cid = (int) $c['id'];
            if (! ClientModel::statusAllowsAccess($c['status'] ?? null)) {
                continue;
            }
            try {
                $db = $manager->forClient($c);
            } catch (\Throwable $e) {
                CLI::error('  ✗ client #' . $cid . ' DB: ' . $e->getMessage());
                continue;
            }

            $reminderModel = new LeadReminderModel($db);
            $due = $reminderModel->where('client_id', $cid)
                ->where('notified_at', null)->where('done', 0)
                ->where('remind_at <=', $now)
                ->orderBy('remind_at', 'ASC')->findAll(500);
            if (! $due) {
                continue;
            }

            // Lead id → name, for a friendly notification title.
            $leadNames = [];
            foreach ((new LeadModel($db))->select('id, name')->where('client_id', $cid)->findAll() as $l) {
                $leadNames[(int) $l['id']] = (string) ($l['name'] ?? '');
            }

            foreach ($due as $r) {
                $userId = (int) ($r['user_id'] ?? 0);
                if ($userId <= 0) {
                    // No owner to notify — stamp it so it isn't reprocessed forever.
                    $reminderModel->update($r['id'], ['notified_at' => $now]);
                    continue;
                }
                $lead  = $leadNames[(int) $r['lead_id']] ?? '';
                $label = $lead !== '' ? $lead : ('Lead #' . $r['lead_id']);
                $title = 'Lead reminder: ' . $label;
                $body  = ($r['note'] ?? '') !== '' ? $r['note'] : 'You set a reminder for this lead.';

                try {
                    $notif->insert([
                        'recipient_type' => 'user',
                        'recipient_id'   => $userId,
                        'type'           => 'lead_reminder',
                        'title'          => $title,
                        'body'           => $body,
                        'link'           => '/client/leads',
                    ]);
                    PushService::sendToRecipient($cid, 'user', $userId, $title, $body, '/client/leads');
                    $reminderModel->update($r['id'], ['notified_at' => $now]);
                    $sent++;
                } catch (\Throwable $e) {
                    CLI::error("  ✗ client #{$cid} reminder #{$r['id']}: " . $e->getMessage());
                }
            }

            CLI::write("  ✓ client #{$cid}: " . count($due) . ' due reminder(s) processed', 'green');
        }

        CLI::write("Reminders done — {$sent} notification(s) delivered.", 'cyan');
    }
}
