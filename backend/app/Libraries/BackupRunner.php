<?php

namespace App\Libraries;

use App\Models\AppSettingModel;
use App\Models\ClientModel;

/**
 * Scheduled / on-demand database backups to disk. The super admin configures
 * the schedule (settings in `app_settings`); a cron entry runs `php spark
 * backup:run`, which calls {@see run()} only when {@see isDue()}.
 *
 * Backups are gzipped SQL dumps written to writable/backups/ (outside the web
 * root). Old files are pruned by the retention window on every run.
 */
class BackupRunner
{
    public const FREQUENCIES = ['daily', 'weekly', 'monthly'];
    private const FREQ_SECONDS = ['daily' => 86400, 'weekly' => 604800, 'monthly' => 2592000];

    private AppSettingModel $settings;

    public function __construct()
    {
        $this->settings = new AppSettingModel();
    }

    /** Directory where backup files live (created on demand). */
    public function dir(): string
    {
        return WRITEPATH . 'backups/';
    }

    /** Absolute path for a stored backup file, or null if it doesn't exist / is unsafe. */
    public function pathFor(string $name): ?string
    {
        $safe = basename($name);
        $path = $this->dir() . $safe;

        return (is_file($path) && str_ends_with($safe, '.sql.gz')) ? $path : null;
    }

    /** Current auto-backup configuration (with sane defaults). */
    public function config(): array
    {
        $m    = $this->settings->getMap();
        $freq = $m['backup_frequency'] ?? 'daily';

        return [
            'enabled'        => ($m['backup_auto_enabled'] ?? '0') === '1',
            'frequency'      => in_array($freq, self::FREQUENCIES, true) ? $freq : 'daily',
            'retention_days' => max(1, (int) ($m['backup_retention_days'] ?? 14)),
            'scope'          => ($m['backup_scope'] ?? 'all') === 'main' ? 'main' : 'all',
            'last_run'       => $m['backup_last_run'] ?? null,
            'last_status'    => $m['backup_last_status'] ?? null,
        ];
    }

    /** Persist new settings from a request body; returns the resolved config. */
    public function saveConfig(array $in): array
    {
        $this->settings->setValue('backup_auto_enabled', ! empty($in['enabled']) && $in['enabled'] !== '0' ? '1' : '0');
        $this->settings->setValue('backup_frequency', in_array($in['frequency'] ?? '', self::FREQUENCIES, true) ? $in['frequency'] : 'daily');
        $this->settings->setValue('backup_retention_days', (string) max(1, min(365, (int) ($in['retention_days'] ?? 14))));
        $this->settings->setValue('backup_scope', ($in['scope'] ?? 'all') === 'main' ? 'main' : 'all');

        return $this->config();
    }

    /** True when auto-backup is enabled and enough time has passed since last_run. */
    public function isDue(): bool
    {
        $c = $this->config();
        if (! $c['enabled']) {
            return false;
        }
        if (empty($c['last_run'])) {
            return true;
        }
        $elapsed = time() - strtotime((string) $c['last_run']);

        // 1h grace so a fixed daily cron never skips a day on minor drift.
        return $elapsed >= (self::FREQ_SECONDS[$c['frequency']] - 3600);
    }

    /**
     * Run a backup now. $scopeOverride: 'main' | 'all' | null (use config).
     * Returns ['made' => string[], 'errors' => string[], 'status' => string].
     */
    public function run(?string $scopeOverride = null): array
    {
        $scope = $scopeOverride ?? $this->config()['scope'];
        if (! is_dir($this->dir())) {
            @mkdir($this->dir(), 0775, true);
        }

        $svc   = new BackupService();
        $stamp = date('Ymd-His');
        $made  = [];
        $errors = [];

        // Main (shared) DB.
        try {
            $db     = \Config\Database::connect();
            $dbName = (string) (config('Database')->default['database'] ?? 'crm_main');
            $made[] = $this->write($svc, $db, $dbName, "main-{$dbName}-{$stamp}");
        } catch (\Throwable $e) {
            $errors[] = 'main: ' . $e->getMessage();
        }

        // Every client (tenant) DB.
        if ($scope === 'all') {
            $tm = new TenantManager();
            foreach ((new ClientModel())->findAll() as $c) {
                if (empty($c['db_name'])) {
                    continue;
                }
                try {
                    $db     = $tm->forClient($c);
                    $made[] = $this->write($svc, $db, (string) $c['db_name'], "client-{$c['db_name']}-{$stamp}");
                } catch (\Throwable $e) {
                    $errors[] = $c['db_name'] . ': ' . $e->getMessage();
                }
            }
        }

        $this->prune();

        $status = $errors
            ? ('partial — ' . count($made) . ' ok, ' . count($errors) . ' failed')
            : (count($made) . ' database(s) backed up');
        $this->settings->setValue('backup_last_run', date('Y-m-d H:i:s'));
        $this->settings->setValue('backup_last_status', $status);

        return ['made' => $made, 'errors' => $errors, 'status' => $status];
    }

    /**
     * Scheduled run (called by cron, hourly). Backs up:
     *   - the main DB when the global super-admin schedule is due, and
     *   - each client DB when THAT client's own schedule (set in their settings)
     *     is due — clients control their own frequency / time / retention.
     */
    public function runScheduled(): array
    {
        if (! is_dir($this->dir())) {
            @mkdir($this->dir(), 0775, true);
        }
        $svc   = new BackupService();
        $stamp = date('Ymd-His');
        $made  = [];
        $errors = [];

        // Main DB — global super-admin schedule.
        if ($this->isDue()) {
            try {
                $db     = \Config\Database::connect();
                $dbName = (string) (config('Database')->default['database'] ?? 'crm_main');
                $made[] = $this->write($svc, $db, $dbName, "main-{$dbName}-{$stamp}");
                $this->prune();
                $this->settings->setValue('backup_last_run', date('Y-m-d H:i:s'));
                $this->settings->setValue('backup_last_status', 'main DB backed up');
            } catch (\Throwable $e) {
                $errors[] = 'main: ' . $e->getMessage();
            }
        }

        // Client DBs — each client's own schedule.
        $tm = new TenantManager();
        foreach ((new ClientModel())->findAll() as $c) {
            if (empty($c['db_name'])) {
                continue;
            }
            try {
                $db  = $tm->forClient($c);
                $cfg = $this->clientConfig($db);
                if (! $this->isClientDue($cfg)) {
                    continue;
                }
                $made[] = $this->write($svc, $db, (string) $c['db_name'], "client-{$c['db_name']}-{$stamp}");
                $this->pruneClient((string) $c['db_name'], $cfg['retention_days']);
                $this->setClientSetting($db, (int) $c['id'], 'backup_last_run', date('Y-m-d H:i:s'));
                $this->setClientSetting($db, (int) $c['id'], 'backup_last_status', 'backed up');
            } catch (\Throwable $e) {
                $errors[] = ($c['db_name'] ?? ('client #' . $c['id'])) . ': ' . $e->getMessage();
            }
        }

        return [
            'made'   => $made,
            'errors' => $errors,
            'status' => $made ? (count($made) . ' database(s) backed up') : 'nothing due this run',
        ];
    }

    /** Read a client's backup schedule from their tenant `settings` table. */
    private function clientConfig(\CodeIgniter\Database\BaseConnection $db): array
    {
        $map = [];
        try {
            foreach ($db->table('settings')->get()->getResultArray() as $r) {
                $map[$r['setting_key']] = $r['setting_value'];
            }
        } catch (\Throwable $e) {
            // No settings table yet — treat as disabled.
        }
        $freq = $map['backup_frequency'] ?? 'daily';

        return [
            'enabled'        => ($map['backup_enabled'] ?? '0') === '1',
            'frequency'      => in_array($freq, self::FREQUENCIES, true) ? $freq : 'daily',
            'hour'           => max(0, min(23, (int) ($map['backup_hour'] ?? 2))),
            'retention_days' => max(1, (int) ($map['backup_retention_days'] ?? 14)),
            'last_run'       => $map['backup_last_run'] ?? null,
        ];
    }

    /** Is a client's backup due now? Only at their chosen hour + after the interval. */
    private function isClientDue(array $cfg): bool
    {
        if (! $cfg['enabled'] || (int) date('G') !== $cfg['hour']) {
            return false;
        }
        if (empty($cfg['last_run'])) {
            return true;
        }

        return (time() - strtotime((string) $cfg['last_run'])) >= (self::FREQ_SECONDS[$cfg['frequency']] - 3600);
    }

    /** Upsert one setting in a client's tenant `settings` table. */
    private function setClientSetting(\CodeIgniter\Database\BaseConnection $db, int $cid, string $key, string $val): void
    {
        $row = $db->table('settings')->where('setting_key', $key)->get()->getRowArray();
        if ($row) {
            $db->table('settings')->where('id', $row['id'])->update(['setting_value' => $val]);
        } else {
            $db->table('settings')->insert(['client_id' => $cid, 'setting_key' => $key, 'setting_value' => $val]);
        }
    }

    /** Prune one client's backup files older than its retention window. */
    private function pruneClient(string $dbName, int $retentionDays): void
    {
        $cutoff = time() - ($retentionDays * 86400);
        foreach (glob($this->dir() . "client-{$dbName}-*.sql.gz") ?: [] as $f) {
            if (filemtime($f) < $cutoff) {
                @unlink($f);
            }
        }
    }

    /** Dump one DB to a gzipped file; returns the file name. */
    private function write(BackupService $svc, \CodeIgniter\Database\BaseConnection $db, string $dbName, string $base): string
    {
        $sql  = $svc->dump($db, $dbName);
        $name = $base . '.sql.gz';
        file_put_contents($this->dir() . $name, gzencode($sql, 6));

        return $name;
    }

    /** Delete backup files older than the retention window. */
    private function prune(): void
    {
        $cutoff = time() - ($this->config()['retention_days'] * 86400);
        foreach (glob($this->dir() . '*.sql.gz') ?: [] as $f) {
            if (filemtime($f) < $cutoff) {
                @unlink($f);
            }
        }
    }

    /** Stored backup files, newest first. */
    public function files(): array
    {
        $out = [];
        foreach (glob($this->dir() . '*.sql.gz') ?: [] as $f) {
            $out[] = [
                'name'    => basename($f),
                'size'    => filesize($f),
                'created' => date('Y-m-d H:i:s', filemtime($f)),
            ];
        }
        usort($out, static fn ($a, $b) => strcmp($b['created'], $a['created']));

        return $out;
    }
}
