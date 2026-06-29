<?php

namespace App\Commands;

use App\Libraries\TenantManager;
use App\Models\ClientModel;
use App\Models\ClientStaffModel;
use App\Models\DepartmentModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * Seed a demo team of 20 staff with a reporting hierarchy (1 head → 3 managers
 * → 16 members) into each client's tenant database. Useful for demoing the org
 * chart. Idempotent: skips a client that already has seeded rows (emp_code TMS*).
 *
 *   php spark team:seed            # all clients
 *   php spark team:seed 1          # only client #1
 */
class TeamSeed extends BaseCommand
{
    protected $group       = 'Tenants';
    protected $name        = 'team:seed';
    protected $description = 'Seed 20 demo staff with a reporting hierarchy into each client database.';
    protected $usage       = 'team:seed [clientId]';

    private array $names = [
        'Rajesh Kumar', 'Priya Sharma', 'Amit Patel', 'Sneha Reddy', 'Vikram Singh',
        'Anjali Gupta', 'Rahul Verma', 'Pooja Iyer', 'Karan Mehta', 'Divya Nair',
        'Arjun Rao', 'Neha Joshi', 'Sanjay Pillai', 'Meera Desai', 'Rohan Das',
        'Kavya Menon', 'Aditya Bose', 'Ritu Agarwal', 'Manish Kapoor', 'Swati Chauhan',
    ];

    public function run(array $params)
    {
        $only    = isset($params[0]) ? (int) $params[0] : null;
        $clients = (new ClientModel())->findAll();

        foreach ($clients as $c) {
            $cid = (int) $c['id'];
            if ($only !== null && $cid !== $only) {
                continue;
            }

            try {
                $tenant = (new TenantManager())->forClient($cid);
            } catch (\Throwable $e) {
                CLI::error("Client #{$cid}: cannot connect — " . $e->getMessage());
                continue;
            }

            $staff = new ClientStaffModel($tenant);
            if ($staff->where('client_id', $cid)->like('emp_code', 'TMS', 'after')->countAllResults() > 0) {
                CLI::write("Client #{$cid}: already seeded, skipping.", 'yellow');
                continue;
            }

            $deptIds = array_column((new DepartmentModel($tenant))->where('client_id', $cid)->findAll(), 'id');
            $seq     = 0;
            $dept    = fn () => $deptIds ? $deptIds[$seq % count($deptIds)] : null;

            $mk = function (string $name, ?int $reportsTo) use ($staff, $cid, $dept, &$seq): int {
                $seq++;
                $slug = strtolower(str_replace(' ', '.', $name));
                $id   = $staff->insert([
                    'client_id'     => $cid,
                    'name'          => $name,
                    'email'         => $slug . '@demo.team',
                    'emp_code'      => sprintf('TMS%02d', $seq),
                    'reports_to'    => $reportsTo,
                    'department_id' => $dept(),
                    'status'        => 'active',
                ], true);

                return (int) $id;
            };

            // 1 head → 3 managers → remaining members spread under the managers.
            $headId     = $mk($this->names[0], null);
            $managerIds = [];
            foreach (array_slice($this->names, 1, 3) as $n) {
                $managerIds[] = $mk($n, $headId);
            }
            foreach (array_slice($this->names, 4) as $i => $n) {
                $mk($n, $managerIds[$i % count($managerIds)]);
            }

            CLI::write("Client #{$cid}: seeded " . count($this->names) . ' staff (1 head, 3 managers, ' . (count($this->names) - 4) . ' members).', 'green');
        }

        CLI::write('Done.', 'cyan');
    }
}
