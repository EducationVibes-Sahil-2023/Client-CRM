<?php

namespace App\Libraries;

use App\Models\LeadModel;
use App\Models\LeadStatusModel;
use App\Models\SheetSyncModel;
use CodeIgniter\Database\ConnectionInterface;

/**
 * Runs one Google Sheet → Leads sync: read the rows, map columns to lead fields,
 * CREATE a lead for a new dedupe key or UPDATE the STATUS of an existing one, then
 * write each row's outcome (Inserted / Updated / Skipped) back into the sheet's
 * "CRM Status" column. Reuses {@see WebLeadIngest} for phone-normalising + the
 * round-robin/assignee engine. Stateless: takes an explicit tenant DB connection
 * so it works from the admin controller and the `sheets:sync` cron alike.
 */
class GoogleSheetsSync
{
    /** Normalise a header/status label for case-insensitive matching. */
    private static function norm(string $s): string
    {
        return mb_strtolower(trim($s));
    }

    /**
     * @param array<string,mixed> $cfg   a sheet_syncs row (passed by ref so the assign cursor advances)
     * @param string              $saJson the client's service-account JSON key
     *
     * @return array{inserted:int, updated:int, skipped:int, total:int, errors:array<int,array{row:int,message:string}>}
     */
    public static function run(int $cid, ConnectionInterface $db, array &$cfg, string $saJson): array
    {
        $svc = new GoogleSheetsService($saJson);
        if (! $svc->isConfigured()) {
            throw new \RuntimeException('Add your Google service-account key first.');
        }
        $spreadsheetId = (string) $cfg['spreadsheet_id'];
        if ($spreadsheetId === '') {
            throw new \RuntimeException('This sheet has no spreadsheet id.');
        }

        // Resolve the tab (first tab when unset) so read + write ranges are explicit.
        $tab = trim((string) $cfg['sheet_tab']);
        if ($tab === '') {
            $tab = $svc->tabs($spreadsheetId)[0] ?? '';
        }
        $prefix = $tab !== '' ? "'" . str_replace("'", "''", $tab) . "'!" : '';
        $rows   = $svc->getValues($spreadsheetId, $tab !== '' ? "'" . str_replace("'", "''", $tab) . "'" : 'A1:ZZ100000');

        $headerRow = max(1, (int) $cfg['header_row']);
        if (count($rows) < $headerRow) {
            return ['inserted' => 0, 'updated' => 0, 'skipped' => 0, 'total' => 0, 'errors' => []];
        }
        $headers  = $rows[$headerRow - 1] ?? [];
        $colIndex = [];
        foreach ($headers as $i => $h) {
            $colIndex[self::norm((string) $h)] = $i;
        }

        $map = json_decode((string) ($cfg['column_map'] ?? '{}'), true);
        $map = is_array($map) ? $map : [];

        // Parent lead statuses by name → id, for resolving a mapped "status" column.
        $statusByName = [];
        foreach ((new LeadStatusModel($db))->where('client_id', $cid)
            ->groupStart()->where('parent_id', null)->orWhere('parent_id', 0)->groupEnd()->findAll() as $s) {
            $statusByName[self::norm((string) $s['name'])] = (int) $s['id'];
        }
        $defaultStatus = (int) ($cfg['status_id'] ?? 0) ?: (int) (reset($statusByName) ?: 0);

        $leadModel = new LeadModel($db);
        $dedupe    = (string) ($cfg['dedupe_field'] ?? 'phone') ?: 'phone';

        $dataRows = array_slice($rows, $headerRow);
        $results  = [];
        $inserted = 0;
        $updated  = 0;
        $skipped  = 0;
        $errors   = [];

        foreach ($dataRows as $n => $cells) {
            $line = $headerRow + $n + 1;
            // Map cells → target values.
            $rec = [];
            foreach ($map as $header => $target) {
                $target = (string) $target;
                if ($target === '') {
                    continue;
                }
                $idx = $colIndex[self::norm((string) $header)] ?? null;
                if ($idx === null) {
                    continue;
                }
                $rec[$target] = trim((string) ($cells[$idx] ?? ''));
            }
            // Empty row → skip silently (no result written).
            if (! array_filter($rec, static fn ($v) => $v !== '')) {
                $results[] = '';
                continue;
            }

            $phone  = WebLeadIngest::normalizePhone($rec['phone'] ?? '');
            $dupVal = $dedupe === 'phone' ? $phone : trim((string) ($rec[$dedupe] ?? ''));
            if ($dupVal === '') {
                $results[] = 'Skipped (no ' . $dedupe . ')';
                $skipped++;
                continue;
            }

            // Status to apply (mapped status name → id, else the sheet's default).
            $statusId = 0;
            if (! empty($rec['status'])) {
                $statusId = $statusByName[self::norm($rec['status'])] ?? 0;
            }
            if (! $statusId) {
                $statusId = $defaultStatus;
            }

            $existing = $leadModel->where('client_id', $cid)->where($dedupe, $dupVal)->first();
            if ($existing) {
                // Update STATUS only (per the module's configured behaviour).
                if ($statusId && (int) ($existing['status_id'] ?? 0) !== $statusId) {
                    $leadModel->where('client_id', $cid)->where('id', (int) $existing['id'])->set(['status_id' => $statusId])->update();
                    $results[] = 'Updated';
                    $updated++;
                } else {
                    $results[] = 'Skipped (exists)';
                    $skipped++;
                }
                continue;
            }

            // New lead — a phone is required by the lead model.
            if ($phone === '') {
                $results[] = 'Skipped (no phone)';
                $skipped++;
                continue;
            }
            $assignee = WebLeadIngest::resolveAssignee($cid, $db, $cfg, $rec['state'] ?? '');
            $custom   = [];
            foreach ($rec as $target => $val) {
                if (strpos($target, 'custom_') === 0 && $val !== '') {
                    $custom[substr($target, 7)] = $val;
                }
            }
            $row = [
                'client_id'     => $cid,
                'name'          => trim((string) ($rec['name'] ?? '')),
                'phone'         => $phone,
                'alt_phone'     => WebLeadIngest::normalizePhone($rec['alt_phone'] ?? '') ?: null,
                'email'         => trim((string) ($rec['email'] ?? '')) ?: null,
                'city'          => trim((string) ($rec['city'] ?? '')) ?: null,
                'state'         => trim((string) ($rec['state'] ?? '')) ?: null,
                'description'   => trim((string) ($rec['description'] ?? '')) !== '' ? HtmlSanitizer::clean((string) $rec['description']) : null,
                'status_id'     => $statusId ?: null,
                'source_id'     => (int) ($cfg['source_id'] ?? 0) ?: null,
                'lead_type_id'  => (int) ($cfg['lead_type_id'] ?? 0) ?: null,
                'assigned_to'   => $assignee ?: null,
                'assigned_date' => $assignee ? date('Y-m-d H:i:s') : null,
                'created_date'  => date('Y-m-d'),
                'custom_fields' => json_encode((object) $custom),
            ];
            if ($leadModel->insert($row) === false) {
                $first     = $leadModel->errors();
                $errors[]  = ['row' => $line, 'message' => $first ? reset($first) : 'Could not save row.'];
                $results[] = 'Error';
                $skipped++;
                continue;
            }
            $results[] = 'Inserted';
            $inserted++;
        }

        // Write the outcome column back into the sheet.
        if (! empty($cfg['write_back'])) {
            self::writeBack($svc, $spreadsheetId, $prefix, $headers, $headerRow, (string) ($cfg['status_result_column'] ?? 'CRM Status') ?: 'CRM Status', $results);
        }

        // Persist run stats + the advanced assign cursor.
        (new SheetSyncModel($db))->where('client_id', $cid)->where('id', (int) $cfg['id'])->set([
            'inserted_count' => (int) ($cfg['inserted_count'] ?? 0) + $inserted,
            'updated_count'  => (int) ($cfg['updated_count'] ?? 0) + $updated,
            'skipped_count'  => (int) ($cfg['skipped_count'] ?? 0) + $skipped,
            'assign_cursor'  => (int) ($cfg['assign_cursor'] ?? 0),
            'last_synced_at' => date('Y-m-d H:i:s'),
        ])->update();

        return ['inserted' => $inserted, 'updated' => $updated, 'skipped' => $skipped, 'total' => count($dataRows), 'errors' => array_slice($errors, 0, 50)];
    }

    /** Write the per-row outcomes into the result column (creating it if absent). */
    private static function writeBack(GoogleSheetsService $svc, string $spreadsheetId, string $prefix, array $headers, int $headerRow, string $resultCol, array $results): void
    {
        $idx = null;
        foreach ($headers as $i => $h) {
            if (self::norm((string) $h) === self::norm($resultCol)) {
                $idx = $i;
                break;
            }
        }
        if ($idx === null) {
            $idx = count($headers); // append a new column
        }
        $col    = GoogleSheetsService::colLetter($idx);
        $values = [[$resultCol]]; // (re)write the header cell
        foreach ($results as $r) {
            $values[] = [$r];
        }
        $range = $prefix . $col . $headerRow . ':' . $col . ($headerRow + count($results));
        try {
            $svc->updateValues($spreadsheetId, $range, $values);
        } catch (\Throwable $e) {
            log_message('warning', 'Sheet write-back failed: ' . $e->getMessage());
        }
    }
}
