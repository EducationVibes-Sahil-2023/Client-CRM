<?php

namespace App\Commands;

use App\Libraries\TenantManager;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * Temp: seed a handful of clearly-marked test calls against one real lead so the
 * "Call Count" / total-calls columns can be verified. Every row is tagged
 * call_status='CLAUDE_TESTCALL' for exact-marker cleanup (see --purge).
 */
class TmpSeedCalls extends BaseCommand
{
    protected $group       = 'Custom';
    protected $name        = 'tmp:seed-calls';
    protected $description = 'Temp: insert marked test calls for one lead (or --purge to remove them).';
    protected $usage       = 'tmp:seed-calls [--purge]';

    private const MARKER = 'CLAUDE_TESTCALL';

    public function run(array $params)
    {
        $cid = 1;
        $db  = (new TenantManager())->forClient($cid);

        if (in_array('--purge', $params, true) || in_array('purge', $params, true)) {
            $n = $db->table('calls')->where('client_id', $cid)->where('call_status', self::MARKER)->countAllResults(false);
            $db->table('calls')->where('client_id', $cid)->where('call_status', self::MARKER)->delete();
            CLI::write("Purged {$n} test call(s) marked '" . self::MARKER . "'.", 'yellow');

            return;
        }

        // Pick one real lead that has a phone and an assigned rep.
        $lead = $db->table('leads')
            ->select('id, name, phone, alt_phone, assigned_to')
            ->where('deleted_at', null)
            ->where("phone IS NOT NULL", null, false)
            ->where("phone <> ''", null, false)
            ->where("assigned_to IS NOT NULL", null, false)
            ->orderBy('id', 'ASC')
            ->get(1)->getRowArray();

        if (! $lead) {
            CLI::error('No lead with a phone + assigned rep found; cannot seed.');

            return;
        }

        $staff = (int) $lead['assigned_to'];
        $phone = (string) $lead['phone'];
        $now   = time();

        // 5 calls: 3 connected (with durations), 2 missed/unanswered.
        $rows = [
            ['type' => 'outgoing', 'connected' => 1, 'duration' => 95,  'ago' => 60],
            ['type' => 'outgoing', 'connected' => 1, 'duration' => 240, 'ago' => 150],
            ['type' => 'incoming', 'connected' => 1, 'duration' => 47,  'ago' => 300],
            ['type' => 'outgoing', 'connected' => 0, 'duration' => 0,   'ago' => 20],
            ['type' => 'missed',   'connected' => 0, 'duration' => 0,   'ago' => 10],
        ];

        $ids = [];
        foreach ($rows as $r) {
            $start = date('Y-m-d H:i:s', $now - $r['ago'] * 60);
            $end   = date('Y-m-d H:i:s', $now - $r['ago'] * 60 + $r['duration']);
            $db->table('calls')->insert([
                'client_id'    => $cid,
                'lead_id'      => (int) $lead['id'],
                'staff_id'     => $staff,
                'contact'      => $phone,
                'call_status'  => self::MARKER,
                'source'       => 'phone',
                'type'         => $r['type'],
                'duration'     => $r['duration'],
                'connected'    => $r['connected'],
                'call_start'   => $start,
                'call_end'     => $end,
                'calling_date' => date('Y-m-d', $now - $r['ago'] * 60),
                'created_at'   => date('Y-m-d H:i:s'),
                'updated_at'   => date('Y-m-d H:i:s'),
            ]);
            $ids[] = (int) $db->insertID();
        }

        $total     = $db->table('calls')->where('client_id', $cid)->where('contact', $phone)->where('deleted_at', null)->countAllResults(false);
        $connected = $db->table('calls')->where('client_id', $cid)->where('contact', $phone)->where('connected', 1)->where('deleted_at', null)->countAllResults();

        CLI::write('Seeded 5 test calls.', 'green');
        CLI::write("Lead   : #{$lead['id']}  {$lead['name']}  (phone {$phone})");
        CLI::write("Rep    : staff_id {$staff}");
        CLI::write('Call ids: ' . implode(', ', $ids));
        CLI::write("Now for phone {$phone}: total calls = {$total}, connected = {$connected}");
        CLI::write("Cleanup : php spark tmp:seed-calls --purge", 'yellow');
    }
}
