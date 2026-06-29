<?php

namespace App\Models;

/**
 * Global landing-page content store (key/value), managed by the super admin.
 *
 * Platform-wide — unlike SettingsModel there is no client_id. Powers the
 * public marketing site: logo, company name, pricing plans, testimonials.
 */
class LandingSettingModel extends BaseModel
{
    protected $table         = 'landing_settings';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['setting_key', 'setting_value'];

    protected $validationRules = [
        'setting_key' => 'required|max_length[100]',
    ];

    /** All rows as a flat key => value map. */
    public function getAllAsMap(): array
    {
        $map = [];
        foreach ($this->findAll() as $row) {
            $map[$row['setting_key']] = $row['setting_value'];
        }

        return $map;
    }

    /** Insert or update a single key. */
    public function setValue(string $key, ?string $value): bool
    {
        $existing = $this->where('setting_key', $key)->first();

        if ($existing) {
            return (bool) $this->update($existing['id'], ['setting_value' => $value]);
        }

        return (bool) $this->insert(['setting_key' => $key, 'setting_value' => $value]);
    }

    /**
     * The full landing-page payload with sensible defaults, ready to hand to
     * both the public site and the admin editor. JSON values are decoded.
     */
    public function getContent(): array
    {
        $map = $this->getAllAsMap();

        return [
            'logo_url'      => $map['logo_url'] ?? '',
            'company_name'  => $map['company_name'] ?? 'Nexus CRM',
            'pricing_plans' => $this->decodeList($map['pricing_plans'] ?? null),
            'testimonials'  => $this->decodeList($map['testimonials'] ?? null),
        ];
    }

    /** Decode a stored JSON list, returning [] for empty/invalid values. */
    private function decodeList(?string $json): array
    {
        if ($json === null || $json === '') {
            return [];
        }

        $decoded = json_decode($json, true);

        return is_array($decoded) ? $decoded : [];
    }
}
