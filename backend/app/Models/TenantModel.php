<?php

namespace App\Models;

use App\Libraries\TenantManager;
use CodeIgniter\Database\ConnectionInterface;
use CodeIgniter\Validation\ValidationInterface;

/**
 * Base model for client-owned data. When constructed without an explicit
 * connection, it binds to the *current* client's own database (resolved from
 * the session's client_id), so the same model class transparently reads and
 * writes that client's isolated database — never the shared main DB.
 *
 * Pass an explicit connection (`new SomeModel($db)`) to target a specific
 * client's DB outside a request (e.g. CLI/data-migration).
 */
class TenantModel extends BaseModel
{
    public function __construct(?ConnectionInterface &$db = null, ?ValidationInterface $validation = null)
    {
        if ($db === null) {
            $tenant = self::tenantConnection();
            if ($tenant !== null) {
                $db = $tenant;
            }
        }

        parent::__construct($db, $validation);
    }

    /** The current client's DB connection, or null when there's no client session. */
    protected static function tenantConnection(): ?ConnectionInterface
    {
        try {
            $user = service('session')->get('user');
            $cid  = $user['client_id'] ?? null;
            if (! $cid) {
                return null;
            }

            return (new TenantManager())->forClient((int) $cid);
        } catch (\Throwable $e) {
            return null;
        }
    }
}
