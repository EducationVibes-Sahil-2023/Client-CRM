<?php

namespace App\Models;

/**
 * Per-client feature entitlements (feature flags + optional numeric quota),
 * toggled by the super admin. `limit_value` NULL = unlimited.
 */
class ClientFeatureModel extends BaseModel
{
    protected $table         = 'client_features';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'feature_key', 'enabled', 'limit_value'];

    protected $validationRules = [
        'client_id'   => 'required|is_natural_no_zero',
        'feature_key' => 'required|max_length[100]',
    ];

    /** All feature rows for a client. */
    public function getClientFeatures(int $clientId): array
    {
        return $this->where('client_id', $clientId)->findAll();
    }

    /**
     * Enable/disable a feature for a client (insert if missing). When
     * $touchLimit is true, also writes limit_value (null = unlimited).
     */
    public function setClientFeature(int $clientId, string $featureKey, bool $enabled, ?int $limit = null, bool $touchLimit = true): bool
    {
        $existing = $this->where(['client_id' => $clientId, 'feature_key' => $featureKey])->first();

        $data = ['enabled' => $enabled ? 1 : 0];
        if ($touchLimit) {
            $data['limit_value'] = $limit;
        }

        if ($existing) {
            return (bool) $this->update($existing['id'], $data);
        }

        return (bool) $this->insert($data + ['client_id' => $clientId, 'feature_key' => $featureKey]);
    }
}
