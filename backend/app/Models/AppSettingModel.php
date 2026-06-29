<?php

namespace App\Models;

/**
 * Global platform settings store (key/value), managed by the super admin.
 *
 * Platform-wide — no client_id. Holds integration credentials (e.g. the Gmail
 * inbox account) so they can be configured from the admin panel rather than
 * the .env file.
 */
class AppSettingModel extends BaseModel
{
    protected $table         = 'app_settings';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['setting_key', 'setting_value'];

    protected $validationRules = [
        'setting_key' => 'required|max_length[100]',
    ];

    /** All rows as a flat key => value map. */
    public function getMap(): array
    {
        $map = [];
        foreach ($this->findAll() as $row) {
            $map[$row['setting_key']] = $row['setting_value'];
        }

        return $map;
    }

    /** A single value, or $default when the key is absent. */
    public function get(string $key, ?string $default = null): ?string
    {
        $row = $this->where('setting_key', $key)->first();

        return $row ? $row['setting_value'] : $default;
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
}
