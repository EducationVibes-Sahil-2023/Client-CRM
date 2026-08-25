<?php

namespace App\Commands;

use App\Libraries\PushService;
use App\Models\ClientModel;
use App\Models\PushSubscriptionModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * Send a TEST web push to every subscribed browser of a client (or one recipient)
 * and report what happened — a quick way to verify the push pipeline on a server
 * without a browser button.
 *
 *   php spark push:test --client=1
 *   php spark push:test --client=1 --user=8
 *   php spark push:test --client=1 --staff=4
 */
class PushTest extends BaseCommand
{
    protected $group       = 'Notifications';
    protected $name        = 'push:test';
    protected $description = 'Send a test web push to a client\'s subscribed browsers and report delivery.';
    protected $usage       = 'push:test --client=ID [--user=ID | --staff=ID]';

    public function run(array $params)
    {
        $cid    = (int) (CLI::getOption('client') ?: 0);
        $userId = (int) (CLI::getOption('user') ?: 0);
        $staff  = (int) (CLI::getOption('staff') ?: 0);
        if (! $cid) {
            CLI::error('Pass --client=ID.');

            return;
        }
        if (! (new ClientModel())->find($cid)) {
            CLI::error("No client #{$cid}.");

            return;
        }

        CLI::write("VAPID keys:  " . (PushService::publicKey() !== '' ? 'set' : 'MISSING'), PushService::publicKey() !== '' ? 'green' : 'red');
        CLI::write("web_push feature (client #{$cid}): " . ((new \App\Libraries\FeatureService())->isEnabled($cid, 'web_push') ? 'ON' : 'OFF'));
        if (! PushService::enabledFor($cid)) {
            CLI::error('Web push is NOT usable for this client (need VAPID keys AND the web_push feature). Nothing sent.');

            return;
        }

        // Which recipients to test: explicit one, or every subscribed recipient.
        $model = new PushSubscriptionModel();
        if ($userId || $staff) {
            $targets = [[$userId ? 'user' : 'staff', $userId ?: $staff]];
        } else {
            $seen = [];
            foreach ($model->where('client_id', $cid)->findAll() as $s) {
                $seen[$s['recipient_type'] . ':' . (int) $s['recipient_id']] = [$s['recipient_type'], (int) $s['recipient_id']];
            }
            $targets = array_values($seen);
        }
        if (! $targets) {
            CLI::write('No subscribed browsers for this client — open the dashboard and enable notifications first.', 'yellow');

            return;
        }

        $total = 0;
        foreach ($targets as [$type, $id]) {
            $n = PushService::sendToRecipient($cid, $type, $id, 'Test notification 🔔', 'Web push is working from the server.', '/client/notifications');
            $total += $n;
            CLI::write("  {$type} #{$id}: delivered to {$n} browser(s)", $n > 0 ? 'green' : 'yellow');
        }

        CLI::write("Done — {$total} push(es) delivered across " . count($targets) . ' recipient(s).', 'cyan');
    }
}
