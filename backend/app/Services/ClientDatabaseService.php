<?php

namespace App\Services;

use App\Models\ClientModel;
use CodeIgniter\Database\BaseConnection;
use Config\Database;

/**
 * Resolves a database connection for a specific tenant (client), using the
 * connection details stored on the client record. This is the core of the
 * multi-tenant / per-client database isolation.
 */
class ClientDatabaseService
{
    /**
     * Build (or reuse) a connection to the given client's database.
     */
    public static function connectionForClient(int $clientId): ?BaseConnection
    {
        $client = (new ClientModel())->find($clientId);

        if (! $client) {
            return null;
        }

        return self::connectionFromClient($client);
    }

    /**
     * Build a connection from an already-loaded client row.
     */
    public static function connectionFromClient(array $client): BaseConnection
    {
        $config = config(Database::class);

        // Start from the default group and override the per-client details.
        $group = $config->default;
        $group['database'] = $client['db_name'];
        $group['username'] = $client['db_username'];
        $group['password'] = (string) ($client['db_password'] ?? '');

        // The second argument (false) returns a fresh connection rather than a
        // shared one, so different tenants never collide.
        return Database::connect($group, false);
    }
}
