<?php

namespace App\Controllers;

use App\Libraries\FbPollRunner;

/**
 * PUBLIC (sessionless) cron trigger endpoints, guarded by a shared secret so any
 * scheduler that can only hit a URL (host cron, cron-job.com, UptimeRobot, Windows
 * Task Scheduler) can drive the CRM's background jobs — no server shell/crontab
 * required. Secret = env `cron.key`; when it's blank the endpoints are disabled.
 */
class Cron extends ApiController
{
    /** 403 unless the request carries the configured cron key (query `key` or X-Cron-Key). */
    private function guard()
    {
        $expected = trim((string) env('cron.key', ''));
        if ($expected === '') {
            return $this->failForbidden('Cron endpoints are disabled — set cron.key in the server config.');
        }
        $given = trim((string) ($this->request->getGet('key') ?? $this->request->getHeaderLine('X-Cron-Key')));
        if ($given === '' || ! hash_equals($expected, $given)) {
            return $this->failForbidden('Invalid cron key.');
        }

        return null;
    }

    /**
     * GET /public/cron/fb-poll?key=… — pull new Facebook Lead Ads leads for every
     * client and ingest them. Point a 5-minute scheduler at this URL for automatic
     * (hands-off) sync, alongside the real-time per-project webhook.
     */
    public function fbPoll()
    {
        if ($resp = $this->guard()) {
            return $resp;
        }
        // A poll pass hits the Graph API for every client's forms — let it finish
        // even if the scheduler's HTTP client disconnects, and give it headroom.
        @set_time_limit(300);
        ignore_user_abort(true);

        $r = FbPollRunner::run();

        return $this->respond(['ok' => true] + $r);
    }
}
