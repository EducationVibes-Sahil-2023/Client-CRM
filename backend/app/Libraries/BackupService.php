<?php

namespace App\Libraries;

use CodeIgniter\Database\BaseConnection;

/**
 * Produces a portable SQL dump (schema + data) for a database connection — used
 * for the super-admin "download backup" of the main or any client DB, and the
 * per-client self-service backup. Pure PHP over the existing DB connection, so
 * it needs no `mysqldump` binary on the server.
 *
 * The output restores into an empty database: each table is DROP-ed and
 * recreated from its exact `SHOW CREATE TABLE`, then its rows are re-inserted.
 */
class BackupService
{
    /** Rows per INSERT statement — keeps lines a sane size on large tables. */
    private const CHUNK = 200;

    /** Build a full SQL backup for every table on the given connection. */
    public function dump(BaseConnection $db, string $dbName): string
    {
        $out  = "-- ---------------------------------------------------------\n";
        $out .= "-- CRM database backup\n";
        $out .= "-- Database : {$dbName}\n";
        $out .= '-- Generated: ' . date('Y-m-d H:i:s') . "\n";
        $out .= "-- Restore  : mysql -u <user> -p {$dbName} < this-file.sql\n";
        $out .= "-- ---------------------------------------------------------\n\n";
        $out .= "SET NAMES utf8mb4;\n";
        $out .= "SET FOREIGN_KEY_CHECKS = 0;\n\n";

        foreach ($db->listTables() as $table) {
            $out .= $this->dumpTable($db, (string) $table);
        }

        $out .= "SET FOREIGN_KEY_CHECKS = 1;\n";

        return $out;
    }

    /** One table: structure (DROP + CREATE) followed by chunked INSERTs. */
    private function dumpTable(BaseConnection $db, string $table): string
    {
        $sql  = "-- Table `{$table}`\n";
        $sql .= "DROP TABLE IF EXISTS `{$table}`;\n";

        $create    = $db->query("SHOW CREATE TABLE `{$table}`")->getRowArray() ?? [];
        $createSql = $create['Create Table'] ?? ($create['Create View'] ?? '');
        if ($createSql === '') {
            return $sql . "\n";
        }
        $sql .= $createSql . ";\n\n";

        $rows = $db->query("SELECT * FROM `{$table}`")->getResultArray();
        if (! $rows) {
            return $sql;
        }

        $cols    = '`' . implode('`, `', array_keys($rows[0])) . '`';
        $values  = [];
        foreach ($rows as $r) {
            $cells = [];
            foreach ($r as $v) {
                $cells[] = $v === null ? 'NULL' : $db->escape($v);
            }
            $values[] = '(' . implode(', ', $cells) . ')';
        }

        foreach (array_chunk($values, self::CHUNK) as $chunk) {
            $sql .= "INSERT INTO `{$table}` ({$cols}) VALUES\n" . implode(",\n", $chunk) . ";\n";
        }

        return $sql . "\n";
    }
}
