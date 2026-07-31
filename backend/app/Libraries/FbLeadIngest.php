<?php

namespace App\Libraries;

use App\Models\LeadModel;
use CodeIgniter\Database\ConnectionInterface;

/**
 * Turn a Facebook Lead Ads submission into a CRM lead, reusing the shared
 * {@see WebLeadIngest} engine (dedupe + state/round-robin assignment + status
 * default + notify). The only FB-specific step is mapping the form's `field_data`
 * onto lead fields via the `fb_forms.field_map`.
 *
 * Idempotent: a lead already stored for a given `leadgen_id` is skipped, so the
 * real-time webhook and the polling cron can both deliver the same lead safely.
 */
class FbLeadIngest
{
    /** Built-in lead keys a mapping may target (custom fields use `custom_<key>`). */
    private const BUILTINS = ['name', 'phone', 'alt_phone', 'email', 'city', 'state', 'description'];

    /**
     * Ingest one FB lead. $fbForm is an `fb_forms` row (passed by ref so the
     * assign cursor can advance). Returns the WebLeadIngest result, or a skip
     * status when the lead is a duplicate leadgen / has no phone.
     *
     * @param array<int, array{name:string, values:array}> $fieldData
     */
    public static function ingest(int $cid, ConnectionInterface $db, array &$fbForm, array $fieldData, string $leadgenId): array
    {
        // Idempotency: never insert the same leadgen twice (webhook + poll overlap).
        if ($leadgenId !== '' && (new LeadModel($db))->where('client_id', $cid)->where('fb_leadgen_id', $leadgenId)->first()) {
            return ['status' => 'duplicate_leadgen', 'lead_id' => null];
        }

        [$input, $custom] = self::mapFields($fbForm, $fieldData);

        if (WebLeadIngest::normalizePhone($input['phone'] ?? '') === '') {
            return ['status' => 'skipped_no_phone', 'lead_id' => null];
        }

        return WebLeadIngest::ingest($cid, $db, $fbForm, $input, [
            'table'    => 'fb_forms',
            'id_field' => null, // FB records provenance via fb_leadgen_id, not a form-id column
            'extra'    => ['fb_leadgen_id' => $leadgenId !== '' ? $leadgenId : null],
            'custom'   => $custom,
        ]);
    }

    /**
     * Map FB `field_data` → [built-in input, custom map] using the form's field_map
     * (fbFieldName → leadKey | custom_<key>), falling back to sensible defaults for
     * the standard FB field names when a field is unmapped.
     *
     * @return array{0: array<string,string>, 1: array<string,string>}
     */
    public static function mapFields(array $fbForm, array $fieldData): array
    {
        $map = json_decode((string) ($fbForm['field_map'] ?? '{}'), true);
        $map = is_array($map) ? $map : [];

        $input  = [];
        $custom = [];
        foreach ($fieldData as $fd) {
            $fname = (string) ($fd['name'] ?? '');
            if ($fname === '') {
                continue;
            }
            $vals   = $fd['values'] ?? [];
            $value  = is_array($vals) ? implode(', ', array_map('strval', $vals)) : (string) $vals;
            $target = (string) ($map[$fname] ?? self::defaultTarget($fname));
            if ($target === '') {
                continue;
            }
            if (strpos($target, 'custom_') === 0) {
                $custom[substr($target, 7)] = $value;
            } elseif (in_array($target, self::BUILTINS, true)) {
                $input[$target] = $value;
            }
        }

        return [$input, $custom];
    }

    /** Best-effort mapping for the common Facebook field names when unmapped. */
    private static function defaultTarget(string $fbName): string
    {
        $n = strtolower(trim($fbName));
        if ($n === 'full_name' || $n === 'name' || $n === 'first_name') {
            return 'name';
        }
        if (strpos($n, 'email') !== false) {
            return 'email';
        }
        if (strpos($n, 'phone') !== false || strpos($n, 'mobile') !== false) {
            return 'phone';
        }
        if (strpos($n, 'city') !== false) {
            return 'city';
        }
        if (strpos($n, 'state') !== false || strpos($n, 'province') !== false) {
            return 'state';
        }

        return '';
    }
}
