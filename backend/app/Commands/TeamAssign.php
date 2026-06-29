<?php

namespace App\Commands;

use App\Libraries\TenantManager;
use App\Models\ClientModel;
use App\Models\ClientRoleModel;
use App\Models\ClientStaffModel;
use App\Models\DepartmentModel;
use App\Models\OfficeLocationModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * Spread departments, office locations and roles across the whole team so every
 * staff member has all three set and every option is represented. Creates a
 * default set of each lookup if the client has none. Roles follow the reporting
 * hierarchy (head → Director, managers → Manager, rest → mixed ICs).
 *
 *   php spark team:assign            # all clients
 *   php spark team:assign 1          # only client #1
 */
class TeamAssign extends BaseCommand
{
    protected $group       = 'Tenants';
    protected $name        = 'team:assign';
    protected $description = 'Assign varied departments, offices and roles across every team member.';
    protected $usage       = 'team:assign [clientId]';

    private array $deptNames   = ['Sales', 'Marketing', 'Engineering', 'Support', 'Operations', 'Finance'];
    private array $officeSpecs = [
        ['name' => 'Head Office', 'city' => 'Pune'],
        ['name' => 'Mumbai Branch', 'city' => 'Mumbai'],
        ['name' => 'Bangalore Branch', 'city' => 'Bengaluru'],
        ['name' => 'Delhi Branch', 'city' => 'New Delhi'],
    ];
    private array $icRoles = ['Team Lead', 'Senior Executive', 'Executive', 'Associate'];

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

            $deptModel   = new DepartmentModel($tenant);
            $officeModel = new OfficeLocationModel($tenant);
            $roleModel   = new ClientRoleModel($tenant);
            $staffModel  = new ClientStaffModel($tenant);

            $deptIds   = $this->ensureDepartments($deptModel, $cid);
            $officeIds = $this->ensureOffices($officeModel, $cid);
            $roleIds   = $this->ensureRoles($roleModel, $cid); // name => id

            $deptNameById = array_column($deptModel->where('client_id', $cid)->findAll(), 'name', 'id');

            $staff = $staffModel->where('client_id', $cid)->orderBy('id', 'ASC')->findAll();
            if (! $staff) {
                CLI::write("Client #{$cid}: no staff to assign.", 'yellow');
                continue;
            }

            // Who has reports (managers) and who has none (head = no manager).
            $reportCount = [];
            foreach ($staff as $s) {
                if ($s['reports_to'] !== null) {
                    $reportCount[(int) $s['reports_to']] = ($reportCount[(int) $s['reports_to']] ?? 0) + 1;
                }
            }

            $i = 0;
            foreach ($staff as $s) {
                $sid     = (int) $s['id'];
                $isHead   = $s['reports_to'] === null;
                $isMgr    = ($reportCount[$sid] ?? 0) > 0;
                $roleKey  = $isHead ? 'Director' : ($isMgr ? 'Manager' : $this->icRoles[$i % count($this->icRoles)]);
                $deptId   = $deptIds[$i % count($deptIds)];
                $deptName = $deptNameById[$deptId] ?? 'General';
                $designation = $isHead ? 'Chief Executive Officer'
                    : ($isMgr ? "{$deptName} Manager" : "{$deptName} {$this->icRoles[$i % count($this->icRoles)]}");

                $staffModel->skipValidation(true)->update($sid, [
                    'department_id'      => $deptId,
                    'office_location_id' => $officeIds[$i % count($officeIds)],
                    'role_id'            => $roleIds[$roleKey] ?? null,
                    'designation'        => $designation,
                ]);
                $i++;
            }

            CLI::write("Client #{$cid}: assigned dept/office/role across {$i} staff "
                . '(' . count($deptIds) . ' depts, ' . count($officeIds) . ' offices, ' . count($roleIds) . ' roles).', 'green');
        }

        CLI::write('Done.', 'cyan');
    }

    /** @return int[] department ids (creating the default set if none exist). */
    private function ensureDepartments(DepartmentModel $model, int $cid): array
    {
        $existing = $model->where('client_id', $cid)->findAll();
        if ($existing) {
            return array_map(static fn ($d) => (int) $d['id'], $existing);
        }
        $ids = [];
        foreach ($this->deptNames as $name) {
            $ids[] = (int) $model->insert(['client_id' => $cid, 'name' => $name], true);
        }

        return $ids;
    }

    /** @return int[] office ids (creating the default set if none exist). */
    private function ensureOffices(OfficeLocationModel $model, int $cid): array
    {
        $existing = $model->where('client_id', $cid)->findAll();
        if ($existing) {
            return array_map(static fn ($o) => (int) $o['id'], $existing);
        }
        $ids = [];
        foreach ($this->officeSpecs as $spec) {
            $ids[] = (int) $model->insert(['client_id' => $cid, 'name' => $spec['name'], 'city' => $spec['city']], true);
        }

        return $ids;
    }

    /** @return array<string,int> role name => id (creating defaults if needed). */
    private function ensureRoles(ClientRoleModel $model, int $cid): array
    {
        $wanted = ['Director', 'Manager', ...$this->icRoles];
        $byName = [];
        foreach ($model->where('client_id', $cid)->findAll() as $r) {
            $byName[$r['name']] = (int) $r['id'];
        }
        foreach ($wanted as $name) {
            if (! isset($byName[$name])) {
                $byName[$name] = (int) $model->insert(['client_id' => $cid, 'name' => $name], true);
            }
        }

        return $byName;
    }
}
