<?php

namespace App\Libraries;

use App\Models\ClientModel;
use CodeIgniter\Database\BaseConnection;

/**
 * Recompute the *derived* lead fields the app normally maintains itself, so
 * leads/reminders/notes/calls added straight into the database (bulk import,
 * manual SQL) display correctly. Recompute-only — never deletes rows and only
 * updates the rows that actually need it, so it is safe to run on a schedule.
 *
 * Shared by the CLI command ({@see \App\Commands\LeadsResync}) and the secured
 * web-cron endpoint ({@see \App\Controllers\Cron::leadsResync}) so raw-SQL inserts
 * get picked up automatically without anyone running a command by hand.
 */
class LeadsResyncRunner
{
    /**
     * Run every recompute step for one client (or all when $onlyClient is null).
     *
     * @return array{clients:int, follow_date:int, reference_id:int, calls_lead_id:int, updated_at:int, first_response:int, errors:array<int,string>}
     */
    public static function run(?int $onlyClient = null, bool $dryRun = false): array
    {
        $clients = (new ClientModel())->findAll();
        if ($onlyClient) {
            $clients = array_values(array_filter($clients, static fn ($c) => (int) $c['id'] === $onlyClient));
        }

        $manager = new TenantManager();
        $out     = ['clients' => 0, 'follow_date' => 0, 'reference_id' => 0, 'calls_lead_id' => 0, 'updated_at' => 0, 'first_response' => 0, 'errors' => []];

        foreach ($clients as $c) {
            try {
                $db = $manager->forClient($c);
            } catch (\Throwable $e) {
                $out['errors'][] = "client #{$c['id']}: " . $e->getMessage();

                continue;
            }
            $out['clients']++;
            $out['follow_date']    += self::syncFollowDates($db, $dryRun);
            $out['reference_id']   += self::backfillReferenceIds($db, $dryRun);
            $out['calls_lead_id']  += self::backfillCallLeadIds($db, $dryRun);
            $out['updated_at']     += self::recomputeUpdatedAt($db, $dryRun);
            $out['first_response'] += $dryRun ? 0 : FirstResponseService::recompute($db, (int) $c['id']);
        }

        return $out;
    }

    /** leads.follow_date = DATE(latest non-deleted reminder), for leads with reminders. Returns rows changed. */
    private static function syncFollowDates(BaseConnection $db, bool $dryRun): int
    {
        if (! $db->tableExists('leads') || ! $db->tableExists('lead_reminders')) {
            return 0;
        }
        $where = '
            FROM `leads` l
            JOIN (
                SELECT lead_id, DATE(MAX(remind_at)) AS max_date
                FROM `lead_reminders` WHERE deleted_at IS NULL GROUP BY lead_id
            ) r ON r.lead_id = l.id
            WHERE l.deleted_at IS NULL AND (l.follow_date IS NULL OR l.follow_date <> r.max_date)';

        $pending = (int) ($db->query("SELECT COUNT(*) AS n {$where}")->getRow()->n ?? 0);
        if ($pending > 0 && ! $dryRun) {
            $db->query("UPDATE `leads` l
                JOIN (
                    SELECT lead_id, DATE(MAX(remind_at)) AS max_date
                    FROM `lead_reminders` WHERE deleted_at IS NULL GROUP BY lead_id
                ) r ON r.lead_id = l.id
                SET l.follow_date = r.max_date
                WHERE l.deleted_at IS NULL AND (l.follow_date IS NULL OR l.follow_date <> r.max_date)");
        }

        return $pending;
    }

    /** leads.reference_id linked from reference_name → lead_references row. Returns rows changed. */
    private static function backfillReferenceIds(BaseConnection $db, bool $dryRun): int
    {
        if (! $db->tableExists('leads') || ! $db->tableExists('lead_references') || ! $db->fieldExists('reference_id', 'leads')) {
            return 0;
        }
        $where = "
            FROM `leads` l
            JOIN `lead_references` ref
              ON LOWER(TRIM(ref.name)) = LOWER(TRIM(l.reference_name)) AND ref.deleted_at IS NULL
            WHERE l.deleted_at IS NULL AND (l.reference_id IS NULL OR l.reference_id = 0)
              AND l.reference_name IS NOT NULL AND TRIM(l.reference_name) <> ''";

        $pending = (int) ($db->query("SELECT COUNT(*) AS n {$where}")->getRow()->n ?? 0);
        if ($pending > 0 && ! $dryRun) {
            $db->query("UPDATE `leads` l
                JOIN `lead_references` ref
                  ON LOWER(TRIM(ref.name)) = LOWER(TRIM(l.reference_name)) AND ref.deleted_at IS NULL
                SET l.reference_id = ref.id
                WHERE l.deleted_at IS NULL AND (l.reference_id IS NULL OR l.reference_id = 0)
                  AND l.reference_name IS NOT NULL AND TRIM(l.reference_name) <> ''");
        }

        return $pending;
    }

    /** calls.lead_id linked from the call's contact phone → the matching lead. Returns rows changed. */
    private static function backfillCallLeadIds(BaseConnection $db, bool $dryRun): int
    {
        if (! $db->tableExists('calls') || ! $db->tableExists('leads')) {
            return 0;
        }
        $where = "
            FROM `calls` c
            JOIN `leads` l ON l.phone = c.contact AND l.deleted_at IS NULL
            WHERE c.deleted_at IS NULL AND (c.lead_id IS NULL OR c.lead_id = 0)
              AND c.contact IS NOT NULL AND TRIM(c.contact) <> ''";

        $pending = (int) ($db->query("SELECT COUNT(*) AS n {$where}")->getRow()->n ?? 0);
        if ($pending > 0 && ! $dryRun) {
            $db->query("UPDATE `calls` c
                JOIN `leads` l ON l.phone = c.contact AND l.deleted_at IS NULL
                SET c.lead_id = l.id
                WHERE c.deleted_at IS NULL AND (c.lead_id IS NULL OR c.lead_id = 0)
                  AND c.contact IS NOT NULL AND TRIM(c.contact) <> ''");
        }

        return $pending;
    }

    /** leads.updated_at = newest activity (latest note / reminder / call). Returns rows changed. */
    private static function recomputeUpdatedAt(BaseConnection $db, bool $dryRun): int
    {
        if (! $db->tableExists('leads')) {
            return 0;
        }
        $floor   = "'1000-01-01 00:00:00'";
        $hasAlt  = $db->fieldExists('alt_phone', 'leads');
        $joins   = '';
        $terms   = ["COALESCE(l.updated_at, l.created_at, {$floor})"];

        // Notes / reminders: take the latest of created_at OR updated_at, so an
        // *edit* to an existing note/reminder also counts as recent activity.
        if ($db->tableExists('lead_notes')) {
            $joins   .= ' LEFT JOIN (SELECT lead_id, MAX(GREATEST(COALESCE(created_at, ' . $floor . '), COALESCE(updated_at, ' . $floor . '))) m FROM `lead_notes` WHERE deleted_at IS NULL GROUP BY lead_id) n ON n.lead_id = l.id';
            $terms[] = "COALESCE(n.m, {$floor})";
        }
        if ($db->tableExists('lead_reminders')) {
            $joins   .= ' LEFT JOIN (SELECT lead_id, MAX(GREATEST(COALESCE(created_at, ' . $floor . '), COALESCE(updated_at, ' . $floor . '))) m FROM `lead_reminders` WHERE deleted_at IS NULL GROUP BY lead_id) r ON r.lead_id = l.id';
            $terms[] = "COALESCE(r.m, {$floor})";
        }
        // Calls: match by the linked lead_id OR either phone number, so calls to a
        // lead's alt_phone (and calls whose contact was normalised differently than
        // the stored phone) still count. Undated calls fall back to created_at.
        if ($db->tableExists('calls')) {
            $callMatch = 'c2.lead_id = l2.id OR c2.contact = l2.phone' . ($hasAlt ? ' OR c2.contact = l2.alt_phone' : '');
            $joins   .= " LEFT JOIN (
                SELECT l2.id AS lead_id, MAX(COALESCE(c2.call_start, c2.created_at)) m
                FROM `calls` c2
                JOIN `leads` l2 ON ({$callMatch})
                WHERE c2.deleted_at IS NULL AND l2.deleted_at IS NULL
                GROUP BY l2.id
            ) c ON c.lead_id = l.id";
            $terms[] = "COALESCE(c.m, {$floor})";
        }

        $greatest = 'GREATEST(' . implode(', ', $terms) . ')';
        $where    = "WHERE l.deleted_at IS NULL AND {$greatest} <> COALESCE(l.updated_at, {$floor})";

        $pending = (int) ($db->query("SELECT COUNT(*) AS n FROM `leads` l {$joins} {$where}")->getRow()->n ?? 0);
        if ($pending > 0 && ! $dryRun) {
            $db->query("UPDATE `leads` l {$joins} SET l.updated_at = {$greatest} {$where}");
        }

        return $pending;
    }
}
