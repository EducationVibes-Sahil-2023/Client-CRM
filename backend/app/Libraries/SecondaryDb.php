<?php

namespace App\Libraries;

use CodeIgniter\Database\BaseConnection;
use Config\Database;

/**
 * READ-ONLY access to the SECONDARY database — a separate MySQL server on the
 * `secondary` connection group ({@see \Config\Database::$secondary}).
 *
 * This class only ever runs SELECT (or WITH…SELECT) statements. Every query is
 * validated first ({@see self::assertSelect()}); anything that could modify data
 * — INSERT/UPDATE/DELETE/REPLACE/DDL, stacked statements, or SELECT … INTO
 * OUTFILE/DUMPFILE — is REJECTED with a clear error and never sent to the
 * server. The only non-SELECT the class itself runs is a one-time, hard-coded
 * `SET SESSION sql_mode=''` at connect (a session pragma that changes no data),
 * so grouped reads with non-aggregated columns are allowed.
 *
 * As defence in depth, the DB account on that server should also be granted
 * SELECT-only. Configure the server in .env under database.secondary.* (host,
 * port, user, password, database); until a host + database are set,
 * isConfigured() returns false so callers can skip it gracefully.
 *
 * Usage:
 *   $sdb = new SecondaryDb();
 *   if ($sdb->isConfigured()) {
 *       $rows = $sdb->select('SELECT id, name FROM customers WHERE city = ?', [$city]);
 *   }
 */
class SecondaryDb
{
    /** Cached connection for the request (keyed by the single secondary group). */
    private static ?BaseConnection $conn = null;

    /** Whether a secondary server has actually been configured in .env. */
    public function isConfigured(): bool
    {
        $cfg = config(Database::class)->secondary ?? [];

        return ! empty($cfg['hostname']) && ! empty($cfg['database']);
    }

    /**
     * The shared secondary connection (lazily opened, cached per request). Kept
     * public for internal reuse, but callers should go through select() so the
     * read-only guard always runs — never issue writes on this handle.
     */
    public function db(): BaseConnection
    {
        if (self::$conn === null) {
            if (! $this->isConfigured()) {
                throw new \RuntimeException('Secondary database is not configured (set database.secondary.* in .env).');
            }
            // sharedInstance = false: keep this pool separate from the tenant pool.
            self::$conn = Database::connect('secondary', false);

            // Configure the read session ONCE: relax ONLY_FULL_GROUP_BY so grouped
            // read queries with non-aggregated columns are allowed. This is a
            // session pragma (no data change) and the ONLY non-SELECT this class
            // ever runs — a fixed literal, never built from input.
            try {
                self::$conn->query("SET SESSION sql_mode = ''");
            } catch (\Throwable $e) {
                // Non-fatal: the query still runs, just under the server default.
            }
        }

        return self::$conn;
    }

    /**
     * Run a validated, read-only SELECT and return every row as an associative
     * array. Any non-SELECT is rejected before it reaches the server.
     *
     * @param array<int|string, mixed> $binds Bound params (? positional or :name: named)
     *
     * @return array<int, array<string, mixed>>
     */
    public function select(string $sql, array $binds = []): array
    {
        $this->assertSelect($sql);
        $res = $this->db()->query($sql, $binds);

        return $res ? $res->getResultArray() : [];
    }

    /**
     * Run a validated, read-only SELECT and return the first row (or null).
     *
     * @param array<int|string, mixed> $binds
     *
     * @return array<string, mixed>|null
     */
    public function selectRow(string $sql, array $binds = []): ?array
    {
        return $this->select($sql, $binds)[0] ?? null;
    }

    /**
     * Validate that $sql is a single, read-only SELECT. Throws (and the caller
     * shows the message) WITHOUT executing anything when it is not — so a write
     * of any kind can never reach the secondary server through this class.
     *
     * @throws \RuntimeException when the statement is not a plain, single SELECT
     */
    private function assertSelect(string $sql): void
    {
        // Strip leading line/block comments + whitespace so the check sees the
        // real leading keyword (e.g. "-- note\nSELECT …").
        $clean = preg_replace('/^\s*(?:--[^\n]*(?:\n|$)|\/\*.*?\*\/|\s)+/s', '', (string) $sql) ?? (string) $sql;
        // Allow a query that opens with parentheses, e.g. "(SELECT …) UNION …".
        $clean = ltrim($clean, " \t\r\n(");

        if ($clean === '') {
            throw new \RuntimeException('Secondary DB: empty query blocked (read-only, nothing was executed).');
        }
        // Must start with SELECT or WITH (CTE). Anything else — INSERT, UPDATE,
        // DELETE, REPLACE, CREATE, ALTER, DROP, TRUNCATE, GRANT, SET, CALL … — is
        // a write/side-effect and is refused.
        if (! preg_match('/^(select|with)\b/i', $clean)) {
            throw new \RuntimeException('Secondary DB is READ-ONLY — only SELECT queries are allowed. This action was blocked and nothing was executed.');
        }
        // No stacked statements (a single trailing ';' is fine); blocks
        // "SELECT 1; DROP TABLE t" style injection.
        if (str_contains(rtrim($clean, "; \t\r\n"), ';')) {
            throw new \RuntimeException('Secondary DB: multiple statements in one query are not allowed. Blocked and nothing was executed.');
        }
        // A SELECT can still WRITE a file on the server — refuse those.
        if (preg_match('/\binto\s+(out|dump)file\b/i', $clean)) {
            throw new \RuntimeException('Secondary DB: SELECT … INTO OUTFILE/DUMPFILE writes to disk and is not allowed. Blocked and nothing was executed.');
        }
    }
}
