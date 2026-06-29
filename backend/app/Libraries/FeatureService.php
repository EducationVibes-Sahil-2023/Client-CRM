<?php

namespace App\Libraries;

use App\Models\ClientFeatureModel;
use App\Models\ClientModel;

/**
 * Resolves which features a client may use.
 *
 * A client's effective feature set = the preset for its plan (subscription)
 * MERGED with any explicit per-client overrides the super admin has set in the
 * `client_features` table:
 *   - an override row with enabled=1 turns a feature ON  (even if the plan omits it)
 *   - an override row with enabled=0 turns a feature OFF (even if the plan grants it)
 *
 * This keeps "features follow the plan" by default, while letting the super
 * admin tailor any individual client.
 */
class FeatureService
{
    /** Every gateable feature key (mirrors the client modules). */
    public const FEATURES = [
        'dashboard', 'leads', 'lead_import', 'tasks', 'team', 'roles', 'assets',
        'announcements', 'chat', 'notifications', 'email_config', 'settings',
    ];

    /** Core features every plan always includes (cannot be left without a shell). */
    public const ALWAYS_ON = ['dashboard', 'settings', 'notifications'];

    /** Features that carry a numeric quota (limit_value; null = unlimited). */
    public const QUOTA_FEATURES = ['leads', 'lead_import', 'team'];

    /**
     * Display metadata for the super-admin feature editor.
     * 'core' features can't be turned off; 'quota' is the limit field's label.
     *
     * @var array<string, array{label:string, core?:bool, quota?:string}>
     */
    public const CATALOG = [
        'dashboard'     => ['label' => 'Dashboard', 'core' => true],
        'leads'         => ['label' => 'Leads', 'quota' => 'Max leads'],
        'lead_import'   => ['label' => 'Lead import', 'quota' => 'Max imports'],
        'team'          => ['label' => 'Team / staff', 'quota' => 'Max staff'],
        'tasks'         => ['label' => 'Tasks'],
        'roles'         => ['label' => 'Roles & permissions'],
        'assets'        => ['label' => 'Assets'],
        'announcements' => ['label' => 'Announcements'],
        'chat'          => ['label' => 'Chat'],
        'email_config'  => ['label' => 'Email setup'],
        'notifications' => ['label' => 'Notifications', 'core' => true],
        'settings'      => ['label' => 'Settings', 'core' => true],
    ];

    /** Plan → features granted (on top of ALWAYS_ON). 'enterprise' gets everything. */
    public const PLAN_PRESETS = [
        'starter' => ['leads', 'tasks', 'team', 'announcements'],
        'growth'  => ['leads', 'tasks', 'team', 'announcements', 'roles', 'chat', 'email_config'],
        // enterprise resolved as "all features" in presetFor().
    ];

    /** Features a given plan grants before per-client overrides. */
    public static function presetFor(string $plan): array
    {
        $plan = strtolower(trim($plan)) ?: 'starter';

        if ($plan === 'enterprise') {
            return self::FEATURES;
        }

        $grant = self::PLAN_PRESETS[$plan] ?? self::PLAN_PRESETS['starter'];

        return array_values(array_unique(array_merge(self::ALWAYS_ON, $grant)));
    }

    /**
     * The client's effective feature map: feature_key => bool.
     *
     * @return array<string, bool>
     */
    public function effective(int $clientId): array
    {
        $plan   = 'starter';
        $client = (new ClientModel())->find($clientId);
        if ($client) {
            $plan = (string) ($client['plan'] ?? 'starter');
        }

        $granted = array_fill_keys(self::presetFor($plan), true);

        // Start from the full list defaulting to whatever the plan grants.
        $map = [];
        foreach (self::FEATURES as $key) {
            $map[$key] = isset($granted[$key]);
        }

        // Apply explicit per-client overrides.
        foreach ((new ClientFeatureModel())->getClientFeatures($clientId) as $row) {
            $key = $row['feature_key'] ?? '';
            if ($key !== '' && array_key_exists($key, $map)) {
                $map[$key] = (int) ($row['enabled'] ?? 0) === 1;
            }
        }

        // Core features can never be turned off — the panel needs its shell.
        foreach (self::ALWAYS_ON as $key) {
            $map[$key] = true;
        }

        return $map;
    }

    /**
     * Per-client numeric limits for quota features: feature_key => int|null
     * (null = unlimited). Only reflects explicit per-client limit_value rows.
     *
     * @return array<string, int|null>
     */
    public function limits(int $clientId): array
    {
        $map = array_fill_keys(self::QUOTA_FEATURES, null);

        foreach ((new ClientFeatureModel())->getClientFeatures($clientId) as $row) {
            $key = $row['feature_key'] ?? '';
            if (in_array($key, self::QUOTA_FEATURES, true) && ($row['limit_value'] ?? null) !== null) {
                $map[$key] = (int) $row['limit_value'];
            }
        }

        return $map;
    }

    /** The numeric limit for one quota feature (null = unlimited / not set). */
    public function limitFor(int $clientId, string $feature): ?int
    {
        return $this->limits($clientId)[$feature] ?? null;
    }

    /** Is a single feature enabled for this client? */
    public function isEnabled(int $clientId, string $feature): bool
    {
        if (in_array($feature, self::ALWAYS_ON, true)) {
            return true;
        }
        if (! in_array($feature, self::FEATURES, true)) {
            // Unknown keys are not gated (fail open for non-feature routes).
            return true;
        }

        return $this->effective($clientId)[$feature] ?? false;
    }
}
