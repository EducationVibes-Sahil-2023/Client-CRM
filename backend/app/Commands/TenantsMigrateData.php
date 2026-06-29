<?php

namespace App\Commands;

use App\Libraries\TenantManager;
use App\Libraries\TenantSchema;
use App\Models\ClientModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * One-time move of existing client-scoped rows out of the shared main DB and
 * into each client's own database. Idempotent (INSERT IGNORE preserves ids),
 * and it leaves the main-DB copies intact for rollback. Also seeds the
 * `staff_accounts` login index from each client's staff.
 *
 *   php spark tenants:migrate-data
 */
class TenantsMigrateData extends BaseCommand
{
    protected $group       = 'Tenants';
    protected $name        = 'tenants:migrate-data';
    protected $description = 'Copy existing client data from the main DB into each client database.';

    public function run(array $params)
    {
        $main    = \Config\Database::connect();
        $manager = new TenantManager();
        $clients = (new ClientModel())->findAll();

        if (! $clients) {
            CLI::write('No clients to migrate.', 'yellow');

            return;
        }

        foreach ($clients as $c) {
            $cid = (int) $c['id'];
            CLI::write("Client #{$cid} — {$c['db_name']}", 'cyan');

            try {
                $tenant = $manager->provision($c); // ensure tenant tables exist
            } catch (\Throwable $e) {
                CLI::error('  cannot connect: ' . $e->getMessage());
                continue;
            }

            foreach (TenantSchema::TABLES as $table) {
                if (! $main->tableExists($table)) {
                    continue;
                }
                $rows = $main->table($table)->where('client_id', $cid)->get()->getResultArray();
                if (! $rows) {
                    continue;
                }
                $tenant->table($table)->ignore(true)->insertBatch($rows);
                CLI::write("  • {$table}: " . count($rows) . ' rows', 'green');
            }

            $this->seedStaffAccounts($main, $cid);
        }

        CLI::write('Done. Main-DB tables left intact for rollback.', 'cyan');
    }

    /** Populate the main-DB login index from a client's staff. */
    private function seedStaffAccounts(\CodeIgniter\Database\BaseConnection $main, int $cid): void
    {
        if (! $main->tableExists('client_staff') || ! $main->tableExists('staff_accounts')) {
            return;
        }

        $staff = $main->table('client_staff')->where('client_id', $cid)->get()->getResultArray();
        foreach ($staff as $s) {
            if (empty($s['email'])) {
                continue; // no login without an email
            }
            $exists = $main->table('staff_accounts')
                ->where('client_id', $cid)->where('staff_id', (int) $s['id'])->countAllResults();
            if ($exists) {
                continue;
            }
            $main->table('staff_accounts')->ignore(true)->insert([
                'client_id'  => $cid,
                'staff_id'   => (int) $s['id'],
                'email'      => $s['email'],
                'password'   => $s['password'] ?? null,
                'status'     => $s['status'] ?? 'active',
                'created_at' => date('Y-m-d H:i:s'),
                'updated_at' => date('Y-m-d H:i:s'),
            ]);
        }
    }
}
