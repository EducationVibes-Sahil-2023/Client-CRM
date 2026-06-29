<?php

namespace App\Models;

/**
 * Per-client CRM configuration key/value store.
 */
class SettingsModel extends TenantModel
{
    protected $table         = 'settings';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'setting_key', 'setting_value'];

    protected $validationRules = [
        'client_id'   => 'required|is_natural_no_zero',
        'setting_key' => 'required|max_length[100]',
    ];

    public function getSettingsForClient(int $clientId): array
    {
        return $this->where('client_id', $clientId)->findAll();
    }
}
