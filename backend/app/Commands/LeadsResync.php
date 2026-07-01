<?php

namespace App\Commands;

use App\Libraries\TenantManager;
use App\Models\ClientModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;
use CodeIgniter\Database\BaseConnection;

/**
 * Recompute the *derived* lead fields that the app normally maintains itself, so
 * leads/reminders/notes added straight into the database (bulk import, manual
 * SQL) display correctly. Recompute-only — it never deletes rows and only
 * updates the rows that actually need it.
 *
 *   php spark leads:resync                # every client
 *   php spark leads:resync --client=3     # one client
 *   php spark leads:resync --dry-run      # report what would change, change nothing
 *
 * What it fixes:
 *   - leads.follow_date  → the date of each lead's latest reminder (the follow-up
 *                          date/flag + Follow Up Tracker read this). Only leads
 *                          that HAVE reminders are touched, so a manually-set
 *                          follow_date on a lead with no reminders is preserved.
 *   - leads.reference_id → linked from the lead's reference_name to the matching
 *                          Reference row (the reference feature keys off the id).
 */
class LeadsResync extends BaseCommand
{
    protected $group       = 'Leads';
    protected $name        = 'leads:resync';
    protected $description = 'Recompute derived lead fields (follow_date, reference_id) after manual/imported data.';
    protected $usage       = 'leads:resync [--client=ID] [--dry-run]';

    public function run(array $params)
    {
        $only   = isset($params['client']) ? (int) $params['client'] : (int) (CLI::getOption('client') ?? 0);
        $dryRun = array_key_exists('dry-run', $params) || CLI::getOption('dry-run') !== null;

        $clients = (new ClientModel())->findAll();
        if ($only) {
            $clients = array_values(array_filter($clients, static fn ($c) => (int) $c['id'] === $only));
        }
        if (! $clients) {
            CLI::write('No matching clients.', 'yellow');

            return;
        }

        if ($dryRun) {
            CLI::write('DRY RUN — no changes will be written.', 'yellow');
        }

        $manager = new TenantManager();
        foreach ($clients as $c) {
            CLI::write("Client #{$c['id']} — {$c['db_name']}", 'cyan');
            try {
                $db = $manager->forClient($c);
            } catch (\Throwable $e) {
                CLI::error('  cannot connect: ' . $e->getMessage());
                continue;
            }
            $this->syncFollowDates($db, $dryRun);
            $this->backfillReferenceIds($db, $dryRun);
        }

        CLI::write($dryRun ? 'Dry run complete.' : 'Resync complete.', 'green');
    }

    /** leads.follow_date = DATE(latest non-deleted reminder), for leads with reminders. */
    private function syncFollowDates(BaseConnection $db, bool $dryRun): void
    {
        if (! $db->tableExists('leads') || ! $db->tableExists('lead_reminders')) {
            return;
        }

        // Count how many would change (report), then apply unless dry-run.
        $sql = '
            FROM `leads` l
            JOIN (
                SELECT lead_id, DATE(MAX(remind_at)) AS max_date
                FROM `lead_reminders`
                WHERE deleted_at IS NULL
                GROUP BY lead_id
            ) r ON r.lead_id = l.id
            WHERE l.deleted_at IS NULL
              AND (l.follow_date IS NULL OR l.follow_date <> r.max_date)';

        $pending = (int) ($db->query("SELECT COUNT(*) AS n {$sql}")->getRow()->n ?? 0);
        if ($pending === 0) {
            CLI::write('  • follow_date: already in sync', 'dark_gray');

            return;
        }
        if (! $dryRun) {
            $db->query("UPDATE `leads` l
                JOIN (
                    SELECT lead_id, DATE(MAX(remind_at)) AS max_date
                    FROM `lead_reminders` WHERE deleted_at IS NULL GROUP BY lead_id
                ) r ON r.lead_id = l.id
                SET l.follow_date = r.max_date
                WHERE l.deleted_at IS NULL AND (l.follow_date IS NULL OR l.follow_date <> r.max_date)");
        }
        CLI::write("  • follow_date: {$pending} lead(s) " . ($dryRun ? 'would be updated' : 'updated'), 'green');
    }

    /** leads.reference_id linked from reference_name → lead_references row. */
    private function backfillReferenceIds(BaseConnection $db, bool $dryRun): void
    {
        if (! $db->tableExists('leads') || ! $db->tableExists('lead_references')
            || ! $db->fieldExists('reference_id', 'leads')) {
            return;
        }

        $sql = "
            FROM `leads` l
            JOIN `lead_references` ref
              ON LOWER(TRIM(ref.name)) = LOWER(TRIM(l.reference_name)) AND ref.deleted_at IS NULL
            WHERE l.deleted_at IS NULL
              AND (l.reference_id IS NULL OR l.reference_id = 0)
              AND l.reference_name IS NOT NULL AND TRIM(l.reference_name) <> ''";

        $pending = (int) ($db->query("SELECT COUNT(*) AS n {$sql}")->getRow()->n ?? 0);
        if ($pending === 0) {
            CLI::write('  • reference_id: already linked', 'dark_gray');

            return;
        }
        if (! $dryRun) {
            $db->query("UPDATE `leads` l
                JOIN `lead_references` ref
                  ON LOWER(TRIM(ref.name)) = LOWER(TRIM(l.reference_name)) AND ref.deleted_at IS NULL
                SET l.reference_id = ref.id
                WHERE l.deleted_at IS NULL AND (l.reference_id IS NULL OR l.reference_id = 0)
                  AND l.reference_name IS NOT NULL AND TRIM(l.reference_name) <> ''");
        }
        CLI::write("  • reference_id: {$pending} lead(s) " . ($dryRun ? 'would be linked' : 'linked'), 'green');
    }
}
