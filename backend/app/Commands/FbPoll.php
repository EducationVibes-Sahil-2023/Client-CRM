<?php

namespace App\Commands;

use App\Libraries\FbPollRunner;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * Poll Facebook Lead Ads for every client and ingest any new leads — the backfill
 * / safety net alongside the real-time webhook (both are idempotent on leadgen id).
 *
 *   php spark fb:poll
 *
 * Run automatically every ~5 minutes. Two options:
 *   • Server crontab:
 *       * /5 * * * *  cd /var/www/crm/backend && php spark fb:poll >> writable/logs/fb-poll.log 2>&1
 *   • Or, when you can only ping a URL (shared hosting / cron-job.com / Windows
 *     Task Scheduler), hit the secured web endpoint every 5 min instead:
 *       GET /public/cron/fb-poll?key=<cron.key>   ({@see \App\Controllers\Cron::fbPoll})
 * Both share the same logic ({@see FbPollRunner}).
 */
class FbPoll extends BaseCommand
{
    protected $group       = 'Facebook';
    protected $name        = 'fb:poll';
    protected $description = 'Pull new Facebook Lead Ads leads for every client and ingest them.';

    public function run(array $params)
    {
        $r = FbPollRunner::run();
        foreach ($r['errors'] as $e) {
            CLI::error('  ✗ ' . $e);
        }
        CLI::write("Facebook poll done — {$r['leads']} new lead(s) across {$r['forms']} form(s), {$r['clients']} client(s).", 'cyan');
    }
}
