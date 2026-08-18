<?php

namespace App\Commands;

use App\Libraries\HtmlSanitizer;
use App\Libraries\SecondaryDb;
use App\Libraries\TenantManager;
use App\Libraries\WebLeadIngest;
use App\Models\ClientModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;
use CodeIgniter\Database\BaseConnection;

/**
 * Import (and re-sync) leads from an OLD CRM into a client's tenant DB. The source
 * is EITHER the live read-only SECONDARY database, OR a CSV export file (--file).
 * Idempotent: keyed on the old lead id (leads.legacy_id), so a re-run UPDATES the
 * matching lead instead of creating a duplicate.
 *
 *   php spark leads:import-legacy --dry-run                       # live DB, preview only
 *   php spark leads:import-legacy --client=1                      # live DB, apply
 *   php spark leads:import-legacy --file=writable/imports/leads.csv --dry-run
 *   php spark leads:import-legacy --client=1 --file=leads.csv     # CSV, apply
 *
 * The old CRM's ids are NOT the new CRM's ids, so every lookup is mapped BY NAME:
 *   - status  → new status_id by name; unmatched falls back to the default status
 *               (or is auto-created with --create-status).
 *   - source  → new source_id by name; auto-created if missing.
 *   - type    → a single new lead type for the segment; --new-type NAME.
 *   - reference_name → stored as text AND linked to a lead_references row
 *     (auto-created if missing) so reference-scoping works immediately.
 *   - assignee → new client_staff by full name; unmatched left Unassigned.
 * Phones are normalised to 10 digits (rows without a valid phone are skipped).
 *
 * CSV columns (headers, case-insensitive) — the aliases from the export query, or
 * the raw old columns; both are accepted:
 *   id, name, email, phone|phonenumber, alt_phone|alternative_phonenumber,
 *   status|status_name, sub_status, source|source_name, reference_name, assigned_to|assigned,
 *   assigned_date|dateassigned, city, state, description,
 *   created_date|dateadded, created_at, updated_at|lastupdate_date, converted_at|datecreated
 */
class LeadsImportLegacy extends BaseCommand
{
    protected $group       = 'Leads';
    protected $name        = 'leads:import-legacy';
    protected $description = 'Import/sync leads from an old CRM (live secondary DB or a CSV export) into a client tenant DB (idempotent on legacy_id).';
    protected $usage       = 'leads:import-legacy [--client=ID] [--file=PATH.csv] [--dry-run] [--new-type=NAME] [--create-status] [--limit=N]';

    /** Default LIVE-DB segment filter — matches the export query. (CSV files are already filtered.) */
    private const OLD_SOURCE   = 1;
    private const OLD_TYPE     = 2;
    private const ASSIGNED_IDS = [92, 133, 202, 187, 200];
    private const REFERENCES   = [
        'uc global', 'novel', 'janardan', 'eduguide', 'lectures abroad', 'pathway',
        'best education consultancy', 'lav gupta', 'wasim', 'soham', 'eduvinn', 'vks',
        'anurag shrivastav', 'fdm', 'dinesh omsk', 'numinous educare', 'ananya',
        'angel youth', 'dr komal gupta', 'dr komal',
    ];

    /** CSV header (lower-cased) → canonical field. First matching header wins. */
    private const CSV_ALIASES = [
        'old_id'         => ['id', 'old_id', 'lead_id', 'legacy_id'],
        'name'           => ['name', 'full_name'],
        'email'          => ['email'],
        'phone'          => ['phone', 'phonenumber', 'mobile', 'contact'],
        'alt_phone'      => ['alt_phone', 'alternative_phonenumber'],
        'status_name'    => ['status', 'status_name'],
        'sub_status_name' => ['sub_status', 'sub_status_name', 'substatus'],
        'source_name'    => ['source', 'source_name'],
        'reference_name' => ['reference_name', 'reference'],
        'assignee_name'  => ['assigned_to', 'assignee', 'assignee_name', 'assigned'],
        'assigned_date'  => ['assigned_date', 'dateassigned'],
        'city'           => ['city'],
        'state'          => ['state'],
        'description'    => ['description'],
        'created_date'   => ['created_date', 'dateadded', 'date_added'],
        'created_at'     => ['created_at'],
        'updated_at'     => ['updated_at', 'lastupdate_date', 'lastupdate'],
        'converted_at'   => ['converted_at', 'datecreated'],
    ];

    public function run(array $params)
    {
        $cid          = (int) ($this->opt('client') ?: '1');
        $dry          = $this->flag('dry-run');
        $newType      = trim($this->opt('new-type', 'Study Abroad')) ?: 'Study Abroad';
        $limit        = (int) $this->opt('limit');
        $createStatus = $this->flag('create-status');
        $file         = trim($this->opt('file'));

        $client = (new ClientModel())->find($cid);
        if (! $client) {
            CLI::error("No client #{$cid}.");

            return;
        }

        // --- 1. Gather canonical rows from the chosen source --------------------
        if ($file !== '') {
            $rows = $this->fromCsv($file, $limit);
            if ($rows === null) {
                return;
            }
            CLI::write(($dry ? 'DRY RUN — ' : '') . "Import legacy leads from CSV → client #{$cid} ({$client['db_name']})", 'cyan');
        } else {
            $sdb = new SecondaryDb();
            if (! $sdb->isConfigured()) {
                CLI::error('Secondary (old CRM) DB not configured, and no --file given. Set database.secondary.* in .env or pass --file=export.csv.');

                return;
            }
            CLI::write(($dry ? 'DRY RUN — ' : '') . "Import legacy leads from live old CRM → client #{$cid} ({$client['db_name']})", 'cyan');
            $rows = $this->fromDb($sdb, $limit);
            if ($rows === null) {
                return;
            }
        }
        CLI::write('  Fetched ' . count($rows) . ' lead(s) from the old CRM.', 'yellow');
        if (! $rows) {
            return;
        }

        // --- 2. Map + upsert into the tenant DB (shared engine) -----------------
        $db     = (new TenantManager())->forClient($client);
        $report = $this->import($db, $cid, $rows, $dry, $newType, $createStatus);
        if ($report === null) {
            return; // engine already printed the blocking error
        }

        // --- 3. Report ----------------------------------------------------------
        CLI::write('');
        CLI::write('  ' . ($dry ? 'Would insert' : 'Inserted') . ": {$report['inserted']}", 'green');
        CLI::write('  ' . ($dry ? 'Would update' : 'Updated') . ": {$report['updated']}", 'green');
        if ($report['skipped']) {
            CLI::write("  Skipped (no valid 10-digit phone): {$report['skipped']}", 'yellow');
        }
        CLI::write("  Default status for unmatched: {$report['defaultStatus']}", 'dark_gray');

        $this->listNames($dry ? 'Sources that WOULD be created' : 'Sources created', $report['created']['source']);
        $this->listNames($dry ? 'References that WOULD be created' : 'References created', $report['created']['reference']);
        if ($createStatus) {
            $this->listNames($dry ? 'Statuses that WOULD be created' : 'Statuses created', $report['created']['status']);
        }
        $this->counts('Unmatched statuses (used default)', $report['unStatus']);
        $this->counts('Unmatched sub-statuses (left blank)', $report['unSub']);
        $this->counts('Unmatched assignees (left Unassigned)', $report['unAssign']);

        CLI::write('');
        if ($dry) {
            CLI::write('  Dry run — nothing written. Re-run without --dry-run to apply.', 'yellow');
        } else {
            CLI::write('  Done. Now run:  php spark leads:resync --client=' . $cid, 'cyan');
        }
    }

    // Spark natively parses only "--name value"; these also accept "--name=value".

    /** Read a value option, supporting both "--name value" and "--name=value". */
    private function opt(string $name, string $default = ''): string
    {
        $v = CLI::getOption($name);
        if (is_string($v) && $v !== '') {
            return $v;
        }
        foreach (array_keys(CLI::getOptions()) as $k) {
            if (strncmp((string) $k, $name . '=', strlen($name) + 1) === 0) {
                return substr((string) $k, strlen($name) + 1);
            }
        }

        return $default;
    }

    /** Read a boolean flag, supporting both "--name" and "--name=1". */
    private function flag(string $name): bool
    {
        if (CLI::getOption($name) !== null) {
            return true;
        }
        foreach (array_keys(CLI::getOptions()) as $k) {
            if ((string) $k === $name || strncmp((string) $k, $name . '=', strlen($name) + 1) === 0) {
                return true;
            }
        }

        return false;
    }

    // =============================================================== SOURCES

    /** Pull the segment from the live old CRM (read-only). Returns canonical rows. */
    private function fromDb(SecondaryDb $sdb, int $limit): ?array
    {
        $assigned = self::ASSIGNED_IDS;
        $refs     = array_map('mb_strtolower', self::REFERENCES);
        $phA      = implode(',', array_fill(0, count($assigned), '?'));
        $phR      = implode(',', array_fill(0, count($refs), '?'));

        $sql = "SELECT
                l.id AS old_id, l.name, l.email,
                l.phonenumber AS phone, l.alternative_phonenumber AS alt_phone,
                so.name AS source_name, sa.name AS status_name, subs.name AS sub_status_name,
                l.reference_name,
                TRIM(CONCAT(COALESCE(ts.firstname,''),' ',COALESCE(ts.lastname,''))) AS assignee_name,
                l.dateassigned AS assigned_date,
                l.city, l.state, l.description,
                l.dateadded AS created_date, l.dateadded AS created_at,
                l.lastupdate_date AS updated_at, c.datecreated AS converted_at
            FROM tblleads l
            LEFT JOIN tblclients c        ON c.leadid = l.id
            LEFT JOIN tblleads_sources so ON so.id = l.source
            LEFT JOIN tblleads_status sa  ON sa.id = l.status
            LEFT JOIN tblleads_status subs ON subs.id = l.sub_status
            LEFT JOIN tblstaff ts         ON ts.staffid = l.assigned
            WHERE l.source = ? AND l.type = ?
              AND l.assigned IN ({$phA})
              AND LOWER(l.reference_name) IN ({$phR})
            ORDER BY l.id ASC" . ($limit > 0 ? " LIMIT {$limit}" : '');

        try {
            return $sdb->select($sql, array_merge([self::OLD_SOURCE, self::OLD_TYPE], $assigned, $refs));
        } catch (\Throwable $e) {
            CLI::error('Old CRM query failed: ' . $e->getMessage());

            return null;
        }
    }

    /** Read a CSV export into canonical rows, mapping headers via CSV_ALIASES. */
    private function fromCsv(string $path, int $limit): ?array
    {
        // Resolve the path against common bases so a bare filename or a
        // writable/-relative path works regardless of the shell's cwd.
        $candidates = [
            $path,
            WRITEPATH . $path,
            WRITEPATH . 'imports/' . basename($path),
            ROOTPATH . $path,
        ];
        $resolved = null;
        foreach ($candidates as $c) {
            if (is_file($c) && is_readable($c)) {
                $resolved = $c;
                break;
            }
        }
        if ($resolved === null) {
            CLI::error("CSV file not found or unreadable: {$path}");
            CLI::write('  Looked in: ' . implode(', ', array_unique($candidates)), 'dark_gray');

            return null;
        }
        $path = $resolved;
        $fh = fopen($path, 'r');
        if (! $fh) {
            CLI::error("Could not open CSV: {$path}");

            return null;
        }

        $header = fgetcsv($fh);
        if (! $header) {
            fclose($fh);
            CLI::error('CSV is empty (no header row).');

            return null;
        }
        // Strip a UTF-8 BOM from the first header, index headers lower-cased.
        $header[0] = preg_replace('/^\xEF\xBB\xBF/', '', (string) $header[0]);
        $idx       = [];
        foreach ($header as $i => $h) {
            $idx[mb_strtolower(trim((string) $h))] = $i;
        }
        // Resolve each canonical field to a column index (or null when absent).
        $col = [];
        foreach (self::CSV_ALIASES as $canonical => $aliases) {
            $col[$canonical] = null;
            foreach ($aliases as $a) {
                if (isset($idx[$a])) {
                    $col[$canonical] = $idx[$a];
                    break;
                }
            }
        }
        if ($col['phone'] === null) {
            fclose($fh);
            CLI::error('CSV has no phone column (expected one of: phone, phonenumber, mobile, contact).');

            return null;
        }
        if ($col['old_id'] === null) {
            CLI::write('  ⚠ No id column in CSV — re-runs will dedupe by phone only (idempotency is weaker).', 'yellow');
        }

        $rows = [];
        while (($r = fgetcsv($fh)) !== false) {
            if ($r === [null] || $r === false) {
                continue; // blank line
            }
            $row = [];
            foreach ($col as $k => $i) {
                $row[$k] = $i !== null ? ($r[$i] ?? null) : null;
            }
            $rows[] = $row;
            if ($limit > 0 && count($rows) >= $limit) {
                break;
            }
        }
        fclose($fh);

        return $rows;
    }

    // =============================================================== ENGINE

    /**
     * Map canonical rows onto new-CRM leads and upsert them (idempotent on
     * legacy_id). Returns a report array, or null on a blocking error.
     *
     * @param array<int, array<string, mixed>> $rows
     */
    private function import(BaseConnection $db, int $cid, array $rows, bool $dry, string $newType, bool $createStatus): ?array
    {
        $lc  = static fn ($s) => mb_strtolower(trim((string) $s));
        $map = static function (string $table) use ($db, $cid, $lc): array {
            $m = [];
            foreach ($db->table($table)->select('id, name')->where('client_id', $cid)->get()->getResultArray() as $r) {
                $m[$lc($r['name'])] = (int) $r['id'];
            }

            return $m;
        };
        $statusMap = $map('lead_statuses');
        $sourceMap = $map('lead_sources');
        $typeMap   = $map('lead_types');
        $refMap    = $map('lead_references');
        $staffMap  = $map('client_staff');

        // Sub-statuses live in lead_statuses too (rows WITH a parent); map them by
        // name separately so an old sub-status name resolves to the right child.
        $subMap = [];
        foreach ($db->table('lead_statuses')->select('id, name, parent_id, parent_ids')->where('client_id', $cid)->get()->getResultArray() as $r) {
            $isSub = ! empty($r['parent_id']) || (! empty($r['parent_ids']) && ! in_array((string) $r['parent_ids'], ['[]', 'null', ''], true));
            if ($isSub) {
                $subMap[$lc($r['name'])] = (int) $r['id'];
            }
        }

        // Default status when a lead has no (or an unmatched) status: prefer a
        // parent status named "Fresh" (Fresh Lead), else the first parent status.
        $parents = static fn () => $db->table('lead_statuses')->where('client_id', $cid)
            ->groupStart()->where('parent_id', null)->orWhere('parent_id', 0)->groupEnd();
        $defRow = $parents()->like('name', 'Fresh')->orderBy('sequence', 'ASC')->orderBy('id', 'ASC')->get()->getRowArray()
            ?: $parents()->orderBy('sequence', 'ASC')->orderBy('id', 'ASC')->get()->getRowArray();
        $defaultStatus = $defRow ? (int) $defRow['id'] : 0;
        if (! $defaultStatus) {
            CLI::error('  Client has no lead statuses — cannot import (status is required).');

            return null;
        }

        $created = ['source' => [], 'reference' => [], 'type' => [], 'status' => []];
        $typeId  = $this->ensure($db, $cid, 'lead_types', $typeMap, $newType, $dry, $created['type']);

        $inserted = 0;
        $updated  = 0;
        $skipped  = 0;
        $unStatus = [];
        $unAssign = [];
        $unSub    = [];

        foreach ($rows as $o) {
            $phone = WebLeadIngest::normalizePhone((string) ($o['phone'] ?? ''));
            if (strlen($phone) !== 10) {
                $skipped++;
                continue;
            }
            $alt = WebLeadIngest::normalizePhone((string) ($o['alt_phone'] ?? ''));
            $alt = strlen($alt) === 10 ? $alt : null;

            $statusKey = $lc($o['status_name'] ?? '');
            if ($statusKey === '') {
                $statusId = $defaultStatus;
            } elseif (isset($statusMap[$statusKey])) {
                $statusId = $statusMap[$statusKey];
            } elseif ($createStatus) {
                $statusId = $this->ensure($db, $cid, 'lead_statuses', $statusMap, (string) $o['status_name'], $dry, $created['status']) ?? $defaultStatus;
            } else {
                $statusId = $defaultStatus;
                $unStatus[(string) $o['status_name']] = ($unStatus[(string) $o['status_name']] ?? 0) + 1;
            }

            // Sub-status: mapped by name to a child status; unmatched left blank.
            $subKey   = $lc($o['sub_status_name'] ?? '');
            $subId    = $subKey !== '' ? ($subMap[$subKey] ?? null) : null;
            if ($subKey !== '' && $subId === null) {
                $unSub[(string) $o['sub_status_name']] = ($unSub[(string) $o['sub_status_name']] ?? 0) + 1;
            }

            $sourceId = ($o['source_name'] ?? '') !== ''
                ? $this->ensure($db, $cid, 'lead_sources', $sourceMap, (string) $o['source_name'], $dry, $created['source'])
                : null;

            $refName = trim((string) ($o['reference_name'] ?? ''));
            $refId   = $refName !== ''
                ? $this->ensure($db, $cid, 'lead_references', $refMap, $refName, $dry, $created['reference'])
                : null;

            $assignName = trim((string) ($o['assignee_name'] ?? ''));
            $assignId   = $assignName !== '' ? ($staffMap[$lc($assignName)] ?? null) : null;
            if ($assignName !== '' && $assignId === null) {
                $unAssign[$assignName] = ($unAssign[$assignName] ?? 0) + 1;
            }

            $legacyId = (int) ($o['old_id'] ?? 0) ?: null;
            $descIn   = (string) ($o['description'] ?? '');

            $row = [
                'client_id'      => $cid,
                'legacy_id'      => $legacyId,
                'name'           => trim((string) ($o['name'] ?? '')) ?: null,
                'phone'          => $phone,
                'alt_phone'      => $alt,
                'email'          => trim((string) ($o['email'] ?? '')) ?: null,
                'status_id'      => $statusId,
                'sub_status_id'  => $subId ?: null,
                'lead_type_id'   => $typeId ?: null,
                'source_id'      => $sourceId ?: null,
                'reference_id'   => $refId ?: null,
                'reference_name' => $refName ?: null,
                'assigned_to'    => $assignId ?: null,
                'assigned_date'  => $this->dt($o['assigned_date'] ?? null),
                'city'           => trim((string) ($o['city'] ?? '')) ?: null,
                'state'          => trim((string) ($o['state'] ?? '')) ?: null,
                'description'    => $descIn !== '' ? HtmlSanitizer::clean($descIn) : null,
                'converted_at'   => $this->dt($o['converted_at'] ?? null),
                'updated_at'     => $this->dt($o['updated_at'] ?? null),
            ];

            // Upsert: match on legacy_id first; else adopt an existing phone match
            // that hasn't been linked to a legacy id yet.
            $existing = null;
            if ($legacyId !== null) {
                $existing = $db->table('leads')->where('client_id', $cid)->where('legacy_id', $legacyId)->get()->getRowArray();
            }
            if (! $existing) {
                $existing = $db->table('leads')->where('client_id', $cid)->where('phone', $phone)->where('legacy_id', null)->get()->getRowArray();
            }

            if ($existing) {
                if (! $dry) {
                    $db->table('leads')->where('id', $existing['id'])->update($row); // keep original created_*
                }
                $updated++;
            } else {
                $row['created_date'] = $this->d($o['created_date'] ?? null) ?: date('Y-m-d');
                $row['created_at']   = $this->dt($o['created_at'] ?? null) ?: date('Y-m-d H:i:s');
                if (! $dry) {
                    $db->table('leads')->insert($row);
                }
                $inserted++;
            }
        }

        return [
            'inserted'      => $inserted,
            'updated'       => $updated,
            'skipped'       => $skipped,
            'created'       => $created,
            'unStatus'      => $unStatus,
            'unSub'         => $unSub,
            'unAssign'      => $unAssign,
            'defaultStatus' => $defRow['name'],
        ];
    }

    /**
     * Find a lookup id by name (case-insensitive), creating the row when missing
     * (unless $dry, where it records the name in $wouldCreate and returns null).
     * Caches created ids back into $map so a run creates each name once.
     */
    private function ensure(BaseConnection $db, int $cid, string $table, array &$map, string $name, bool $dry, array &$wouldCreate = []): ?int
    {
        $name = trim($name);
        if ($name === '') {
            return null;
        }
        $k = mb_strtolower($name);
        if (isset($map[$k])) {
            return $map[$k];
        }
        if ($dry) {
            $wouldCreate[$k] = $name; // dedup by lower-cased key; keep a display name

            return null;
        }
        $seq = (int) ($db->table($table)->selectMax('sequence', 'm')->where('client_id', $cid)->get()->getRow()->m ?? 0) + 1;
        $db->table($table)->insert(['client_id' => $cid, 'name' => $name, 'color' => 'slate', 'sequence' => $seq, 'enabled' => 1]);
        $id              = (int) $db->insertID();
        $map[$k]         = $id;
        $wouldCreate[$k] = $name;

        return $id;
    }

    /** Old datetime → 'Y-m-d H:i:s' (null for empty / zero-dates). */
    private function dt($v): ?string
    {
        $v = trim((string) $v);
        if ($v === '' || strpos($v, '0000-00-00') === 0) {
            return null;
        }
        $ts = strtotime($v);

        return $ts ? date('Y-m-d H:i:s', $ts) : null;
    }

    /** Old date → 'Y-m-d' (null for empty / zero-dates). */
    private function d($v): ?string
    {
        $dt = $this->dt($v);

        return $dt ? substr($dt, 0, 10) : null;
    }

    /** Print a bulleted list of display names (values of $items). */
    private function listNames(string $title, array $items): void
    {
        if (! $items) {
            return;
        }
        CLI::write("  {$title} (" . count($items) . '):', 'white');
        foreach ($items as $name) {
            CLI::write('    • ' . $name, 'dark_gray');
        }
    }

    /** Print a name → count list, highest first. */
    private function counts(string $title, array $items): void
    {
        if (! $items) {
            return;
        }
        arsort($items);
        CLI::write("  {$title} (" . count($items) . '):', 'white');
        foreach ($items as $name => $n) {
            CLI::write("    • {$name} × {$n}", 'dark_gray');
        }
    }
}
