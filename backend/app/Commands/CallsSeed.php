<?php

namespace App\Commands;

use App\Libraries\TenantManager;
use App\Models\ClientModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * Seed sample call-tracking rows so the Call Tracking page, the lead "Calls"
 * tab and the leads "Last call" column have data to show in a fresh install.
 *
 * Calls are spread across each client's existing leads and staff, with a mix of
 * incoming/outgoing/missed, IVR/phone and connected/unanswered records over the
 * last ~10 days. Skips a client that already has calls unless --force is passed
 * (which clears existing rows first).
 *
 *   php spark calls:seed
 *   php spark calls:seed --force
 */
class CallsSeed extends BaseCommand
{
    protected $group       = 'Tenants';
    protected $name        = 'calls:seed';
    protected $description = 'Insert sample call-tracking rows into each client database.';
    protected $usage       = 'calls:seed [--force]';
    protected $options     = ['--force' => 'Clear existing calls and reseed.'];

    public function run(array $params)
    {
        $force   = array_key_exists('force', $params) || in_array('--force', $params, true);
        $manager = new TenantManager();
        $clients = (new ClientModel())->findAll();

        if (! $clients) {
            CLI::write('No clients found.', 'yellow');

            return;
        }

        foreach ($clients as $c) {
            $cid = (int) $c['id'];
            CLI::write("Client #{$cid} — {$c['name']}", 'cyan');

            try {
                $db = $manager->provision($c);
            } catch (\Throwable $e) {
                CLI::error('  cannot connect: ' . $e->getMessage());
                continue;
            }
            if (! $db->tableExists('calls')) {
                CLI::error('  calls table missing — run `php spark tenants:sync` first.');
                continue;
            }

            $existing = $db->table('calls')->countAllResults();
            if ($existing > 0 && ! $force) {
                CLI::write("  already has {$existing} calls — skipping (use --force to reseed).", 'yellow');
                continue;
            }
            if ($force && $existing > 0) {
                $db->table('calls')->truncate();
                CLI::write("  cleared {$existing} existing calls.", 'yellow');
            }

            $leads = $db->table('leads')->select('id, phone, alt_phone')
                ->where('deleted_at', null)->orderBy('id', 'DESC')->limit(15)->get()->getResultArray();
            if (! $leads) {
                CLI::write('  no leads to attach calls to — skipping.', 'yellow');
                continue;
            }
            $staff = $db->table('client_staff')->select('id, phone, alt_phone')
                ->where('deleted_at', null)->get()->getResultArray();

            $rows = $this->buildCalls($cid, $leads, $staff);
            if ($rows) {
                $db->table('calls')->insertBatch($rows);
            }
            CLI::write('  • inserted ' . count($rows) . ' sample calls', 'green');
        }

        CLI::write('Done.', 'cyan');
    }

    /** Build a varied set of call rows across the given leads/staff. */
    private function buildCalls(int $cid, array $leads, array $staff): array
    {
        $types    = ['incoming', 'outgoing', 'missed'];
        $sources  = ['phone', 'phone', 'ivr']; // phone-heavy, like real usage
        // Unanswered outcomes drawn from the canonical call-status set.
        $statuses = ['Missed', 'NotPicked', 'Rejected', 'Busy', 'Agent Busy', 'Cancelled', 'Blocked', 'Disconnected By Caller'];
        $now      = time();

        $rows = [];
        $i    = 0;
        foreach ($leads as $lead) {
            $contact = $this->last10($lead['phone'] ?? '');
            if ($contact === '') {
                continue;
            }
            // 1–3 calls per lead.
            $count = 1 + ($i % 3);
            for ($j = 0; $j < $count; $j++) {
                $type   = $types[($i + $j) % count($types)];
                $source = $sources[($i + $j) % count($sources)];
                // Missed calls never connect; others mostly do.
                $connected = $type === 'missed' ? 0 : (($i + $j) % 4 === 0 ? 0 : 1);
                $duration  = $connected ? (15 + (($i * 7 + $j * 23) % 600)) : 0; // up to ~10 min
                $startTs   = $now - (($i + $j) * 6 + 1) * 3600 - (($i * 13) % 50) * 60; // last ~few days
                $st        = $staff ? $staff[($i + $j) % count($staff)] : null;

                $rows[] = [
                    'client_id'     => $cid,
                    'lead_id'       => (int) $lead['id'],
                    'staff_id'      => $st ? (int) $st['id'] : null,
                    'staff_contact' => $st ? $this->last10($st['phone'] ?? '') : null,
                    'contact'       => $contact,
                    'call_status'   => $connected ? 'Answered' : $statuses[($i + $j) % count($statuses)],
                    'source'        => $source,
                    'type'          => $type,
                    'duration'      => $duration,
                    'connected'     => $connected,
                    'call_start'    => date('Y-m-d H:i:s', $startTs),
                    'call_end'      => date('Y-m-d H:i:s', $startTs + $duration),
                    'created_at'    => date('Y-m-d H:i:s'),
                    'updated_at'    => date('Y-m-d H:i:s'),
                ];
                $i++;
            }
        }

        return $rows;
    }

    private function last10(?string $raw): string
    {
        $digits = preg_replace('/\D+/', '', (string) $raw);

        return $digits !== '' ? substr($digits, -10) : '';
    }
}
