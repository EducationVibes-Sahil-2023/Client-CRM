<?php

namespace App\Libraries;

use App\Models\ClientModel;
use CodeIgniter\Database\BaseConnection;

/**
 * Resolves a database connection to a *client's own database* (multi-tenant
 * data isolation). The main database (`crm_main`) holds platform/admin data
 * (users, clients, settings, audit log, support chat); every client's CRM data
 * — staff, roles, tasks, leads, etc. — lives in that client's own database,
 * created at client-provision time from {@see TenantSchema}.
 *
 * Connections are cached per request, keyed by database name, and reuse the
 * platform's host/port/driver while pointing at the client's stored db name +
 * credentials.
 */
class TenantManager
{
    /** @var array<string, BaseConnection> */
    private static array $cache = [];

    /**
     * A connection to a client's database.
     *
     * @param int|array<string,mixed> $client A client id or a client row.
     */
    public function forClient(int|array $client): BaseConnection
    {
        $row = is_array($client) ? $client : (new ClientModel())->find($client);
        if (! $row || empty($row['db_name'])) {
            throw new \RuntimeException('Client database is not provisioned.');
        }

        $name = (string) $row['db_name'];
        if (isset(self::$cache[$name])) {
            return self::$cache[$name];
        }

        $conn = \Config\Database::connect($this->config($row), false);
        // Pin the session to IST (+05:30) so any DB-side time function matches the
        // app timezone. Numeric offset avoids needing MySQL's named-tz tables.
        try {
            $conn->query("SET time_zone = '+05:30'");
        } catch (\Throwable $e) {
            // Non-fatal: app-generated timestamps already use the app timezone.
        }

        return self::$cache[$name] = $conn;
    }

    /** Build a connection config for a client, inheriting platform defaults. */
    private function config(array $row): array
    {
        $default = config('Database')->default;

        return [
            'DSN'      => '',
            'hostname' => $default['hostname'] ?? 'localhost',
            'username' => ($row['db_username'] ?? '') !== '' ? $row['db_username'] : ($default['username'] ?? 'root'),
            'password' => (string) ($row['db_password'] ?? ($default['password'] ?? '')),
            'database' => (string) $row['db_name'],
            'DBDriver' => $default['DBDriver'] ?? 'MySQLi',
            'DBPrefix' => '',
            'pConnect' => false,
            'charset'  => $default['charset'] ?? 'utf8mb4',
            'DBCollat' => $default['DBCollat'] ?? 'utf8mb4_general_ci',
            'port'     => $default['port'] ?? 3306,
        ];
    }

    /**
     * Ensure the client's database exists, then create/upgrade its schema to
     * match {@see TenantSchema}. Safe to call repeatedly (idempotent).
     */
    public function provision(array $row): BaseConnection
    {
        // CREATE DATABASE must run on the platform connection (the client db may
        // not exist yet), with a back-tick-quoted, validated name.
        $name = (string) $row['db_name'];
        \Config\Database::connect()->query(
            "CREATE DATABASE IF NOT EXISTS `{$name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
        );

        $conn = $this->forClient($row);
        (new TenantSchema())->apply($conn);

        return $conn;
    }

    /**
     * Tear down a client's database (used when a client is deleted). The name is
     * validated and back-tick quoted; the cached connection is dropped first.
     */
    public function deprovision(int|array $client): void
    {
        $row  = is_array($client) ? $client : (new ClientModel())->find($client);
        $name = (string) ($row['db_name'] ?? '');
        if ($name === '' || ! preg_match('/^[A-Za-z0-9_]+$/', $name)) {
            return; // nothing safe to drop
        }

        if (isset(self::$cache[$name])) {
            self::$cache[$name]->close();
            unset(self::$cache[$name]);
        }

        \Config\Database::connect()->query("DROP DATABASE IF EXISTS `{$name}`");
    }
}
