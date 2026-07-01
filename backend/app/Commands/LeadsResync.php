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
 *   - calls.lead_id      → linked from the call's `contact` phone to the matching
 *                          lead (imported calls often carry only the phone).
 *   - leads.updated_at   → bumped to the newest activity on the lead: MAX of its
 *                          latest note, latest reminder and latest call (matched by
 *                          phone). So "Last updated" reflects manual/imported work.
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
            $this->backfillCallLeadIds($db, $dryRun);
            $this->recomputeUpdatedAt($db, $dryRun);
            $this->stampFirstResponse($db, (int) $c['id'], $dryRun);
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

    /** First-response SLA (assignment → first connected call by the assigned user). */
    private function stampFirstResponse(BaseConnection $db, int $clientId, bool $dryRun): void
    {
        if ($dryRun) {
            CLI::write('  • first_response: skipped (dry run)', 'dark_gray');

            return;
        }
        $n = \App\Libraries\FirstResponseService::recompute($db, $clientId);
        CLI::write("  • first_response: {$n} lead(s) stamped", 'green');
    }

    /** calls.lead_id linked from the call's contact phone → the matching lead. */
    private function backfillCallLeadIds(BaseConnection $db, bool $dryRun): void
    {
        if (! $db->tableExists('calls') || ! $db->tableExists('leads')) {
            return;
        }

        $sql = "
            FROM `calls` c
            JOIN `leads` l ON l.phone = c.contact AND l.deleted_at IS NULL
            WHERE c.deleted_at IS NULL
              AND (c.lead_id IS NULL OR c.lead_id = 0)
              AND c.contact IS NOT NULL AND TRIM(c.contact) <> ''";

        $pending = (int) ($db->query("SELECT COUNT(*) AS n {$sql}")->getRow()->n ?? 0);
        if ($pending === 0) {
            CLI::write('  • calls.lead_id: already linked', 'dark_gray');

            return;
        }
        if (! $dryRun) {
            $db->query("UPDATE `calls` c
                JOIN `leads` l ON l.phone = c.contact AND l.deleted_at IS NULL
                SET c.lead_id = l.id
                WHERE c.deleted_at IS NULL AND (c.lead_id IS NULL OR c.lead_id = 0)
                  AND c.contact IS NOT NULL AND TRIM(c.contact) <> ''");
        }
        CLI::write("  • calls.lead_id: {$pending} call(s) " . ($dryRun ? 'would be linked' : 'linked'), 'green');
    }

    /**
     * leads.updated_at = the newest activity on the lead: MAX of its latest note
     * (created_at), latest reminder (created_at) and latest call (call_start,
     * matched by phone — any call, connected or not). Never moves backwards.
     */
    private function recomputeUpdatedAt(BaseConnection $db, bool $dryRun): void
    {
        if (! $db->tableExists('leads')) {
            return;
        }
        $floor = "'1000-01-01 00:00:00'";
        $joins = '';
        $terms = ["COALESCE(l.updated_at, l.created_at, {$floor})"];

        if ($db->tableExists('lead_notes')) {
            $joins   .= ' LEFT JOIN (SELECT lead_id, MAX(created_at) m FROM `lead_notes` WHERE deleted_at IS NULL GROUP BY lead_id) n ON n.lead_id = l.id';
            $terms[] = "COALESCE(n.m, {$floor})";
        }
        if ($db->tableExists('lead_reminders')) {
            $joins   .= ' LEFT JOIN (SELECT lead_id, MAX(created_at) m FROM `lead_reminders` WHERE deleted_at IS NULL GROUP BY lead_id) r ON r.lead_id = l.id';
            $terms[] = "COALESCE(r.m, {$floor})";
        }
        if ($db->tableExists('calls')) {
            $joins   .= " LEFT JOIN (SELECT contact, MAX(call_start) m FROM `calls` WHERE deleted_at IS NULL AND contact IS NOT NULL AND TRIM(contact) <> '' GROUP BY contact) c ON c.contact = l.phone";
            $terms[] = "COALESCE(c.m, {$floor})";
        }

        $greatest = 'GREATEST(' . implode(', ', $terms) . ')';
        $where    = "WHERE l.deleted_at IS NULL AND {$greatest} <> COALESCE(l.updated_at, {$floor})";

        $pending = (int) ($db->query("SELECT COUNT(*) AS n FROM `leads` l {$joins} {$where}")->getRow()->n ?? 0);
        if ($pending === 0) {
            CLI::write('  • updated_at: already current', 'dark_gray');

            return;
        }
        if (! $dryRun) {
            $db->query("UPDATE `leads` l {$joins} SET l.updated_at = {$greatest} {$where}");
        }
        CLI::write("  • updated_at: {$pending} lead(s) " . ($dryRun ? 'would be updated' : 'updated'), 'green');
    }
}
