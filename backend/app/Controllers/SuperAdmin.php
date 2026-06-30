<?php

namespace App\Controllers;

use App\Libraries\BackupRunner;
use App\Libraries\BackupService;
use App\Libraries\FeatureService;
use App\Libraries\GmailService;
use App\Libraries\GoogleCalendarService;
use App\Libraries\MailerService;
use App\Libraries\TenantManager;
use App\Models\ActivityLogModel;
use App\Models\AppSettingModel;
use App\Models\CalendarEventModel;
use App\Models\MessageModel;
use App\Models\ClientFeatureModel;
use App\Models\ClientModel;
use App\Models\ContactMessageModel;
use App\Models\DemoRequestModel;
use App\Models\LandingSettingModel;
use App\Models\UserModel;

/**
 * Super-admin endpoints. The whole group is protected by the
 * `auth:super_admin` filter in Routes.php.
 */
class SuperAdmin extends ApiController
{
    /**
     * GET /superadmin/dashboard — summary counts + clients.
     */
    public function dashboard()
    {
        $clientModel = new ClientModel();
        $userModel   = new UserModel();

        return $this->respond([
            'message' => 'Super admin dashboard',
            'stats'   => [
                'clients'       => $clientModel->countAllResults(),
                'client_admins' => $userModel->where('role', 'client_admin')->countAllResults(),
            ],
            'clients' => $clientModel->orderBy('created_at', 'DESC')->findAll(),
        ]);
    }

    /**
     * GET /superadmin/clients — list all tenants.
     */
    public function clients()
    {
        return $this->respond([
            'clients' => (new ClientModel())->orderBy('created_at', 'DESC')->findAll(),
        ]);
    }

    /**
     * POST /superadmin/clients — create a tenant, and optionally its first
     * client admin in the same step.
     *
     * Body: { name, subdomain?, db_name, db_username, db_password?, plan?,
     *         admin_name?, admin_email?, admin_password? }
     * If admin_email / admin_password are present, a client_admin is created
     * for the new tenant inside the same transaction.
     */
    public function createClient()
    {
        $clientModel = new ClientModel();
        $userModel   = new UserModel();

        $name = trim((string) $this->input('name'));

        // Auto-provision database credentials when the super admin doesn't
        // supply them — each new client gets its own isolated database.
        $default  = config('Database')->default;
        $dbName   = trim((string) ($this->input('db_name') ?? '')) ?: $this->generateDbName($name);
        $dbUser   = trim((string) ($this->input('db_username') ?? '')) ?: (string) ($default['username'] ?? 'root');
        $dbPass   = (string) ($this->input('db_password') ?? '');
        if ($dbPass === '') {
            $dbPass = (string) ($default['password'] ?? '');
        }
        $subdomain = trim((string) ($this->input('subdomain') ?? '')) ?: $this->slugify($name);

        $data = [
            'name'        => $name,
            'email'       => trim((string) ($this->input('email') ?? '')) ?: null,
            'phone'       => trim((string) ($this->input('phone') ?? '')) ?: null,
            'avatar'      => trim((string) ($this->input('avatar') ?? '')) ?: null,
            'status'      => $this->input('status', 'active'),
            'subdomain'   => $subdomain,
            'db_name'     => $dbName,
            'db_username' => $dbUser,
            'db_password' => $dbPass,
            'plan'        => $this->input('plan', 'starter'),
            'plan_start'  => trim((string) ($this->input('plan_start') ?? '')) ?: null,
            'plan_end'    => trim((string) ($this->input('plan_end') ?? '')) ?: null,
        ];

        $adminEmail    = trim((string) $this->input('admin_email'));
        $adminPassword = (string) $this->input('admin_password');
        $adminName     = trim((string) ($this->input('admin_name') ?? ''));
        $createAdmin   = $adminEmail !== '' || $adminPassword !== '';

        // Validate the admin fields up front (before creating the client) so we
        // never leave an orphaned tenant.
        if ($createAdmin) {
            if ($adminEmail === '' || ! filter_var($adminEmail, FILTER_VALIDATE_EMAIL)) {
                return $this->failValidationErrors(['admin_email' => 'Please enter a valid admin email.']);
            }
            if (strlen($adminPassword) < 8) {
                return $this->failValidationErrors(['admin_password' => 'Admin password must be at least 8 characters.']);
            }
            if ($userModel->where('email', $adminEmail)->first()) {
                return $this->failValidationErrors(['admin_email' => 'That admin email is already registered.']);
            }
        }

        $db = \Config\Database::connect();
        $db->transBegin();

        $clientId = $clientModel->insert($data);
        if ($clientId === false) {
            $db->transRollback();
            return $this->failValidationErrors($clientModel->errors());
        }

        $adminId = null;
        if ($createAdmin) {
            $adminId = $userModel->insert([
                'name'      => $adminName !== '' ? $adminName : null,
                'email'     => $adminEmail,
                'password'  => $adminPassword, // hashed automatically by UserModel
                'role'      => 'client_admin',
                'client_id' => $clientId,
            ]);

            if ($adminId === false) {
                $db->transRollback();
                return $this->failValidationErrors($userModel->errors());
            }
        }

        $db->transCommit();

        $this->logActivity(
            'created',
            'client',
            (int) $clientId,
            'Created client "' . $name . '"' . ($createAdmin ? ' with admin ' . $adminEmail : ''),
            (int) $clientId
        );

        // Provision the tenant's own database + base schema. DDL can't be rolled
        // back, so we do it after the commit and report the outcome.
        $provisioned = false;
        $provisionError = null;
        try {
            (new TenantManager())->provision($data);
            $provisioned = true;
        } catch (\Throwable $e) {
            $provisionError = $e->getMessage();
            log_message('error', 'Tenant DB provisioning failed for ' . $data['db_name'] . ': ' . $e->getMessage());
        }

        // Optionally email the new admin their credentials (platform Gmail).
        // Best-effort: never fails the creation, reports whether it went out.
        $emailSent  = false;
        $emailError = null;
        if ($createAdmin && $this->input('email_credentials') && $adminPassword !== '') {
            $r          = \App\Libraries\CredentialMailer::send(null, $adminName, $adminEmail, $adminPassword, $this->loginUrl());
            $emailSent  = $r['sent'];
            $emailError = $r['error'];
        }

        return $this->respondCreated([
            'message'        => $createAdmin ? 'Client and admin created' : 'Client created',
            'client_id'      => $clientId,
            'admin_id'       => $adminId,
            'admin_email'    => $createAdmin ? $adminEmail : null,
            'db_name'        => $data['db_name'],
            'subdomain'      => $data['subdomain'],
            'db_provisioned' => $provisioned,
            'db_error'       => $provisionError,
            'email_sent'     => $emailSent,
            'email_error'    => $emailError,
        ]);
    }

    /** The app's login page URL — from the request origin, falling back to config. */
    private function loginUrl(): string
    {
        $origin = $this->request->getHeaderLine('Origin');
        $base   = $origin !== '' ? $origin : rtrim((string) (env('app.baseURL') ?: site_url()), '/');

        return rtrim($base, '/') . '/login';
    }

    /**
     * POST /superadmin/clients/{id}/login-as — impersonate a client's admin so the
     * super admin can work inside that client's dashboard. The current super-admin
     * session is stashed under `impersonator` so it can be restored on exit.
     */
    public function loginAsClient(int $clientId)
    {
        $client = (new ClientModel())->find($clientId);
        if (! $client) {
            return $this->failNotFound('Client not found');
        }
        if (! ClientModel::statusAllowsAccess($client['status'] ?? null)) {
            return $this->fail('This workspace is suspended.', 403);
        }
        $admin = (new UserModel())->where('role', 'client_admin')->where('client_id', $clientId)->first();
        if (! $admin) {
            return $this->failValidationErrors(['client' => 'This client has no admin user to log in as.']);
        }

        // Stash the super-admin session, then become the client admin.
        $this->session->set('impersonator', $this->currentUser());
        $this->session->set('user', [
            'id'             => (int) $admin['id'],
            'email'          => $admin['email'],
            'name'           => $admin['name'] ?? $admin['email'],
            'role'           => 'client_admin',
            'client_id'      => (int) $clientId,
            'impersonated_by' => $this->currentUser()['name'] ?? 'Super admin',
            'client_name'    => $client['name'] ?? null,
        ]);
        $this->logActivity('login', 'session', (int) $admin['id'], 'Super admin logged in as client "' . ($client['name'] ?? $clientId) . '"', (int) $clientId);

        return $this->respond(['ok' => true]);
    }

    /** Lowercase, underscore-separated slug of a company name. */
    private function slugify(string $name): string
    {
        $slug = strtolower((string) preg_replace('/[^a-z0-9]+/i', '_', $name));

        return trim($slug, '_') ?: 'tenant';
    }

    /** Generate a unique, safe database name for a new tenant. */
    private function generateDbName(string $name): string
    {
        $base  = 'crm_' . substr($this->slugify($name), 0, 24);
        $model = new ClientModel();

        $candidate = $base;
        $i         = 1;
        while ($model->where('db_name', $candidate)->first()) {
            $candidate = $base . '_' . $i++;
        }

        return $candidate;
    }

    /**
     * POST /superadmin/clients/{id}/status — update a client's status.
     * Body: { status }  (active | trial | suspended | inactive)
     */
    public function updateClientStatus(int $clientId)
    {
        $status = trim((string) $this->input('status'));

        if (! in_array($status, ClientModel::STATUSES, true)) {
            return $this->failValidationErrors(['status' => 'Invalid status.']);
        }

        $clientModel = new ClientModel();
        if (! $clientModel->find($clientId)) {
            return $this->failNotFound('Client not found');
        }

        $clientModel->skipValidation(true)->update($clientId, ['status' => $status]);

        $this->logActivity('updated', 'client', $clientId, 'Set client #' . $clientId . ' status to "' . $status . '"', $clientId);

        return $this->respond(['message' => 'Status updated', 'status' => $status]);
    }

    /**
     * POST /superadmin/clients/{id}/delete — soft-delete (archive) a client.
     * The client is hidden from listings but its database, login and feature
     * records are kept intact so it can be restored. Nothing is destroyed.
     */
    public function deleteClient(int $clientId)
    {
        $clientModel = new ClientModel();
        $client      = $clientModel->find($clientId);
        if (! $client) {
            return $this->failNotFound('Client not found');
        }

        // Soft delete: sets deleted_at; the row stays in the DB for recovery.
        $clientModel->delete($clientId);

        $this->logActivity('deleted', 'client', $clientId, 'Archived client "' . ($client['name'] ?? ('#' . $clientId)) . '"');

        return $this->respond(['message' => 'Client deleted']);
    }

    /**
     * POST /superadmin/clients/{id} — update a client's profile.
     * Body (any subset): { name, email, phone, avatar, status, plan,
     *                      subdomain, plan_start, plan_end }
     */
    public function updateClient(int $clientId)
    {
        $clientModel = new ClientModel();
        if (! $clientModel->find($clientId)) {
            return $this->failNotFound('Client not found');
        }

        $nullable = ['email', 'phone', 'avatar', 'subdomain', 'plan_start', 'plan_end'];
        $data     = [];

        foreach (['name', 'email', 'phone', 'avatar', 'status', 'plan', 'subdomain', 'plan_start', 'plan_end'] as $f) {
            $v = $this->input($f);
            if ($v === null) {
                continue;
            }
            $v = is_string($v) ? trim($v) : $v;
            if ($v === '' && in_array($f, $nullable, true)) {
                $v = null;
            }
            $data[$f] = $v;
        }

        if (! $data) {
            return $this->failValidationErrors('Nothing to update');
        }
        if (isset($data['name']) && strlen($data['name']) < 2) {
            return $this->failValidationErrors(['name' => 'Company name is required.']);
        }
        if (! empty($data['email']) && ! filter_var($data['email'], FILTER_VALIDATE_EMAIL)) {
            return $this->failValidationErrors(['email' => 'Please enter a valid client email address.']);
        }
        if (isset($data['status']) && ! in_array($data['status'], ClientModel::STATUSES, true)) {
            return $this->failValidationErrors(['status' => 'Invalid status.']);
        }
        if (isset($data['plan']) && ! in_array($data['plan'], ['starter', 'growth', 'enterprise'], true)) {
            return $this->failValidationErrors(['plan' => 'Invalid plan.']);
        }

        $clientModel->skipValidation(true)->update($clientId, $data);

        $this->logActivity('updated', 'client', $clientId, 'Updated client #' . $clientId . ' (' . implode(', ', array_keys($data)) . ')', $clientId);

        return $this->respond(['message' => 'Client updated', 'client' => $clientModel->find($clientId)]);
    }

    /**
     * POST /superadmin/upload — generic image upload (multipart, field "file").
     * Returns the stored URL so the client knows where to point an avatar/logo.
     */
    public function upload()
    {
        $file = $this->request->getFile('file');

        if (! $file || ! $file->isValid()) {
            return $this->failValidationErrors('Please choose a valid image file.');
        }

        $allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
        if (! in_array($file->getMimeType(), $allowed, true)) {
            return $this->failValidationErrors('Image must be a PNG, JPG, WEBP or GIF.');
        }

        if ($file->getSize() > 2 * 1024 * 1024) {
            return $this->failValidationErrors('Image must be 2MB or smaller.');
        }

        $uploadDir = FCPATH . 'uploads';
        if (! is_dir($uploadDir)) {
            mkdir($uploadDir, 0775, true);
        }

        $newName = $file->getRandomName();
        $file->move($uploadDir, $newName);

        return $this->respond(['message' => 'Uploaded', 'url' => '/uploads/' . $newName]);
    }

    /**
     * GET /superadmin/clients/{id}/features
     */
    public function clientFeatures(int $clientId)
    {
        $client = (new ClientModel())->find($clientId);
        if (! $client) {
            return $this->failNotFound('Client not found');
        }

        $svc       = new FeatureService();
        $effective = $svc->effective($clientId);   // bool map (plan + overrides)
        $limits    = $svc->limits($clientId);       // quota feature => int|null

        // Build the editor matrix from the catalog so the UI can render
        // every feature with its current enabled state + numeric limit.
        $items = [];
        foreach (FeatureService::CATALOG as $key => $meta) {
            $items[] = [
                'key'      => $key,
                'label'    => $meta['label'],
                'core'     => ! empty($meta['core']),
                'quota'    => $meta['quota'] ?? null,           // limit field label, or null
                'enabled'  => (bool) ($effective[$key] ?? false),
                'limit'    => array_key_exists($key, $limits) ? $limits[$key] : null,
            ];
        }

        return $this->respond([
            'client_id' => $clientId,
            'plan'      => $client['plan'] ?? 'starter',
            'features'  => $items,
        ]);
    }

    /**
     * GET /superadmin/clients/{id}/schema — introspect a client's own database
     * and return its structure (tables, columns, indexes, row counts + sizes)
     * for the super-admin schema viewer. Read-only; never touches client data.
     */
    /** GET /superadmin/backup/main — download a SQL dump of the main (shared) DB. */
    public function backupMain()
    {
        $db     = \Config\Database::connect();
        $dbName = (string) (config('Database')->default['database'] ?? 'crm_main');

        return $this->streamBackup($db, $dbName, 'main');
    }

    /** GET /superadmin/clients/{id}/backup — download a SQL dump of a client's DB. */
    public function backupClient(int $clientId)
    {
        $client = (new ClientModel())->find($clientId);
        if (! $client) {
            return $this->failNotFound('Client not found');
        }
        if (empty($client['db_name'])) {
            return $this->fail('This client has no provisioned database.', 409);
        }

        try {
            $db = (new TenantManager())->forClient($client);
        } catch (\Throwable $e) {
            return $this->fail('Could not connect to the client database: ' . $e->getMessage(), 502);
        }

        return $this->streamBackup($db, (string) $client['db_name'], (string) $client['db_name']);
    }

    /** Build a SQL dump and return it as a file-download response. */
    private function streamBackup(\CodeIgniter\Database\BaseConnection $db, string $dbName, string $label)
    {
        try {
            $sql = (new BackupService())->dump($db, $dbName);
        } catch (\Throwable $e) {
            return $this->fail('Backup failed: ' . $e->getMessage(), 500);
        }

        $filename = "backup-{$label}-" . date('Ymd-His') . '.sql';
        $this->logActivity('created', 'backup', null, "Downloaded database backup of {$dbName}");

        return $this->response
            ->setHeader('Content-Type', 'application/sql; charset=utf-8')
            ->setHeader('Content-Disposition', 'attachment; filename="' . $filename . '"')
            ->setBody($sql);
    }

    /** GET /superadmin/backup-settings — auto-backup config + stored backup files. */
    public function backupSettings()
    {
        $r = new BackupRunner();

        return $this->respond([
            'settings'    => $r->config(),
            'files'       => $r->files(),
            'frequencies' => BackupRunner::FREQUENCIES,
        ]);
    }

    /** POST /superadmin/backup-settings — save the auto-backup schedule. */
    public function saveBackupSettings()
    {
        $r   = new BackupRunner();
        $cfg = $r->saveConfig((array) $this->input());
        $this->logActivity('updated', 'settings', null, 'Updated automatic backup settings');

        return $this->respond(['settings' => $cfg, 'files' => $r->files()]);
    }

    /** POST /superadmin/backup-run — run a backup to disk now (manual trigger). */
    public function runBackupNow()
    {
        $r   = new BackupRunner();
        $res = $r->run($this->input('scope') === 'main' ? 'main' : null);
        $this->logActivity('created', 'backup', null, 'Ran backup to disk (' . $res['status'] . ')');

        return $this->respond([
            'status'   => $res['status'],
            'errors'   => $res['errors'],
            'settings' => $r->config(),
            'files'    => $r->files(),
        ]);
    }

    /** GET /superadmin/backup-files/{name} — download a stored backup file. */
    public function downloadBackupFile(string $name)
    {
        $path = (new BackupRunner())->pathFor($name);
        if ($path === null) {
            return $this->failNotFound('Backup file not found.');
        }

        return $this->response
            ->setHeader('Content-Type', 'application/gzip')
            ->setHeader('Content-Disposition', 'attachment; filename="' . basename($path) . '"')
            ->setBody((string) file_get_contents($path));
    }

    public function clientSchema(int $clientId)
    {
        $client = (new ClientModel())->find($clientId);
        if (! $client) {
            return $this->failNotFound('Client not found');
        }
        if (empty($client['db_name'])) {
            return $this->fail('This client has no provisioned database.', 409);
        }

        try {
            $db = (new TenantManager())->forClient($client);
        } catch (\Throwable $e) {
            return $this->fail('Could not connect to the client database: ' . $e->getMessage(), 502);
        }

        $dbName = (string) $client['db_name'];

        // One pass over information_schema for per-table size + approximate rows.
        $meta = [];
        foreach (
            $db->query(
                'SELECT table_name, engine, table_rows, data_length, index_length, table_comment
                   FROM information_schema.tables
                  WHERE table_schema = ?',
                [$dbName],
            )->getResultArray() as $row
        ) {
            $meta[(string) ($row['table_name'] ?? $row['TABLE_NAME'] ?? '')] = $row;
        }

        $tables    = [];
        $totalRows = 0;
        $totalSize = 0;

        foreach ($db->listTables() as $table) {
            $m         = $meta[$table] ?? [];
            $size      = (int) ($m['data_length'] ?? 0) + (int) ($m['index_length'] ?? 0);
            $totalSize += $size;

            // Exact row count (tenant DBs are small; information_schema is only
            // an estimate for InnoDB, so COUNT keeps the figure trustworthy).
            try {
                $rows = (int) $db->table($table)->countAllResults();
            } catch (\Throwable $e) {
                $rows = (int) ($m['table_rows'] ?? 0);
            }
            $totalRows += $rows;

            $columns = [];
            foreach ($db->query("SHOW FULL COLUMNS FROM `{$table}`")->getResultArray() as $c) {
                $columns[] = [
                    'name'    => $c['Field'],
                    'type'    => $c['Type'],
                    'null'    => strtoupper((string) $c['Null']) === 'YES',
                    'key'     => $c['Key'] ?: null,            // PRI | UNI | MUL | ''
                    'default' => $c['Default'],
                    'extra'   => $c['Extra'] ?: null,          // e.g. auto_increment
                    'comment' => ($c['Comment'] ?? '') !== '' ? $c['Comment'] : null,
                ];
            }

            // Index summary (name → columns, uniqueness).
            $idx = [];
            foreach ($db->query("SHOW INDEX FROM `{$table}`")->getResultArray() as $i) {
                $key = $i['Key_name'];
                if (! isset($idx[$key])) {
                    $idx[$key] = ['name' => $key, 'unique' => (int) $i['Non_unique'] === 0, 'columns' => []];
                }
                $idx[$key]['columns'][] = $i['Column_name'];
            }

            $tables[] = [
                'name'    => $table,
                'engine'  => $m['engine'] ?? $m['ENGINE'] ?? null,
                'comment' => ($m['table_comment'] ?? $m['TABLE_COMMENT'] ?? '') ?: null,
                'rows'    => $rows,
                'size'    => $size,
                'columns' => $columns,
                'indexes' => array_values($idx),
            ];
        }

        return $this->respond([
            'client' => [
                'id'      => (int) $client['id'],
                'name'    => $client['name'],
                'db_name' => $dbName,
            ],
            'summary' => [
                'tables'     => count($tables),
                'total_rows' => $totalRows,
                'total_size' => $totalSize,
            ],
            'tables' => $tables,
        ]);
    }

    /**
     * GET /superadmin/clients/{id}/data/{table} — browse one table's rows with
     * pagination, a global search across all columns, and column sorting.
     * Read-only. Query: ?page=1&per_page=25&search=&sort=&dir=asc
     *
     * The table name is validated against the database's real table list and
     * the sort column against the table's real columns, so neither is ever
     * interpolated unchecked; the search term is bound via the query builder.
     */
    public function clientTableData(int $clientId, string $table)
    {
        $client = (new ClientModel())->find($clientId);
        if (! $client) {
            return $this->failNotFound('Client not found');
        }
        if (empty($client['db_name'])) {
            return $this->fail('This client has no provisioned database.', 409);
        }

        try {
            $db = (new TenantManager())->forClient($client);
        } catch (\Throwable $e) {
            return $this->fail('Could not connect to the client database: ' . $e->getMessage(), 502);
        }

        if (! in_array($table, $db->listTables(), true)) {
            return $this->failNotFound('Table not found');
        }

        $columns = $db->getFieldNames($table);

        $page    = max(1, (int) ($this->request->getGet('page') ?: 1));
        $perPage = (int) ($this->request->getGet('per_page') ?: 25);
        $perPage = max(1, min(100, $perPage));
        $search  = trim((string) $this->request->getGet('search'));
        $sort    = (string) $this->request->getGet('sort');
        $dir     = strtolower((string) $this->request->getGet('dir')) === 'desc' ? 'DESC' : 'ASC';

        $builder = $db->table($table);

        // Global search: OR-LIKE across every column (values are bound/escaped).
        if ($search !== '') {
            $builder->groupStart();
            foreach ($columns as $col) {
                $builder->orLike($col, $search);
            }
            $builder->groupEnd();
        }

        // Count with the search applied, but keep the query for the row fetch.
        $total = $builder->countAllResults(false);

        if ($sort !== '' && in_array($sort, $columns, true)) {
            $builder->orderBy($sort, $dir);
        }

        $rows = $builder->limit($perPage, ($page - 1) * $perPage)->get()->getResultArray();

        return $this->respond([
            'table'      => $table,
            'columns'    => array_values($columns),
            'rows'       => $rows,
            'sort'       => ['column' => ($sort !== '' && in_array($sort, $columns, true)) ? $sort : null, 'dir' => strtolower($dir)],
            'search'     => $search,
            'pagination' => [
                'page'        => $page,
                'per_page'    => $perPage,
                'total'       => $total,
                'total_pages' => (int) max(1, ceil($total / $perPage)),
            ],
        ]);
    }

    /**
     * POST /superadmin/clients/{id}/features — save the per-client feature
     * matrix (checkboxes + quotas) in one shot.
     * Body: { features: [{ key, enabled, limit }] }  (limit: int|null)
     */
    public function saveClientFeatures(int $clientId)
    {
        if (! (new ClientModel())->find($clientId)) {
            return $this->failNotFound('Client not found');
        }

        $rows = $this->input('features');
        if (! is_array($rows)) {
            return $this->failValidationErrors('features must be a list');
        }

        $model = new ClientFeatureModel();
        foreach ($rows as $r) {
            $key = trim((string) ($r['key'] ?? ''));
            if (! in_array($key, FeatureService::FEATURES, true)) {
                continue;
            }
            // Core features stay on regardless of what the UI sends.
            $enabled = in_array($key, FeatureService::ALWAYS_ON, true)
                ? true
                : filter_var($r['enabled'] ?? false, FILTER_VALIDATE_BOOLEAN);

            // Limits only apply to quota features; clamp to >= 0, blank = unlimited.
            $limit      = null;
            $touchLimit = in_array($key, FeatureService::QUOTA_FEATURES, true);
            if ($touchLimit) {
                $raw   = $r['limit'] ?? null;
                $limit = ($raw === null || $raw === '') ? null : max(0, (int) $raw);
            }

            $model->setClientFeature($clientId, $key, $enabled, $limit, $touchLimit);
        }

        $this->logActivity('updated', 'feature', $clientId, 'Updated feature entitlements for client #' . $clientId, $clientId);

        return $this->clientFeatures($clientId);
    }

    /**
     * POST /superadmin/feature-toggle
     * Body: { client_id, feature_key, enabled }
     */
    public function toggleFeature()
    {
        $clientId   = (int) $this->input('client_id');
        $featureKey = trim((string) $this->input('feature_key'));
        $enabled    = filter_var($this->input('enabled'), FILTER_VALIDATE_BOOLEAN);

        if ($clientId <= 0 || $featureKey === '') {
            return $this->failValidationErrors('client_id and feature_key are required');
        }

        if (! (new ClientModel())->find($clientId)) {
            return $this->failNotFound('Client not found');
        }

        (new ClientFeatureModel())->setClientFeature($clientId, $featureKey, $enabled);

        $this->logActivity('updated', 'feature', $clientId, ($enabled ? 'Enabled' : 'Disabled') . ' feature "' . $featureKey . '" for client #' . $clientId, $clientId);

        return $this->respond([
            'message'     => 'Feature updated',
            'feature_key' => $featureKey,
            'enabled'     => $enabled,
        ]);
    }

    /**
     * POST /superadmin/admins — create a client_admin user for a tenant.
     * Body: { email, password, client_id }
     */
    public function createAdmin()
    {
        $email    = trim((string) $this->input('email'));
        $password = (string) $this->input('password');
        $clientId = (int) $this->input('client_id');

        if ($email === '' || $password === '' || $clientId <= 0) {
            return $this->failValidationErrors('email, password and client_id are required');
        }

        if (strlen($password) < 8) {
            return $this->failValidationErrors('Password must be at least 8 characters');
        }

        if (! (new ClientModel())->find($clientId)) {
            return $this->failNotFound('Client not found');
        }

        $userModel = new UserModel();
        $userId    = $userModel->insert([
            'email'     => $email,
            'password'  => $password, // hashed automatically by UserModel
            'role'      => 'client_admin',
            'client_id' => $clientId,
        ]);

        if ($userId === false) {
            return $this->failValidationErrors($userModel->errors());
        }

        $this->logActivity('created', 'admin', (int) $userId, 'Created client admin ' . $email . ' for client #' . $clientId, $clientId);

        return $this->respondCreated([
            'message' => 'Client admin created',
            'user_id' => $userId,
        ]);
    }

    /**
     * GET /superadmin/landing — landing-page content for the editor.
     */
    public function landing()
    {
        return $this->respond((new LandingSettingModel())->getContent());
    }

    /**
     * POST /superadmin/landing — update landing-page content.
     * Body (all optional): { company_name, logo_url, pricing_plans[], testimonials[] }
     * Only the keys present in the request are touched.
     */
    public function saveLanding()
    {
        $model = new LandingSettingModel();

        if (($name = $this->input('company_name')) !== null) {
            $model->setValue('company_name', trim((string) $name));
        }

        if (($logo = $this->input('logo_url')) !== null) {
            $model->setValue('logo_url', trim((string) $logo));
        }

        if (($plans = $this->input('pricing_plans')) !== null) {
            if (! is_array($plans)) {
                return $this->failValidationErrors('pricing_plans must be a list');
            }
            $model->setValue('pricing_plans', json_encode(array_values($plans)));
        }

        if (($testimonials = $this->input('testimonials')) !== null) {
            if (! is_array($testimonials)) {
                return $this->failValidationErrors('testimonials must be a list');
            }
            $model->setValue('testimonials', json_encode(array_values($testimonials)));
        }

        $this->logActivity('updated', 'landing', null, 'Updated landing page content');

        return $this->respond([
            'message' => 'Landing page updated',
            'content' => $model->getContent(),
        ]);
    }

    /**
     * POST /superadmin/landing/logo — upload a logo image (multipart/form-data,
     * field name "logo"). Stores the file under public/uploads and records its
     * URL in landing_settings.
     */
    public function uploadLogo()
    {
        $file = $this->request->getFile('logo');

        if (! $file || ! $file->isValid()) {
            return $this->failValidationErrors('Please choose a valid image file.');
        }

        $allowed = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/gif'];
        if (! in_array($file->getMimeType(), $allowed, true)) {
            return $this->failValidationErrors('Logo must be a PNG, JPG, SVG, WEBP or GIF image.');
        }

        if ($file->getSize() > 2 * 1024 * 1024) {
            return $this->failValidationErrors('Logo must be 2MB or smaller.');
        }

        $uploadDir = FCPATH . 'uploads';
        if (! is_dir($uploadDir)) {
            mkdir($uploadDir, 0775, true);
        }

        $newName = $file->getRandomName();
        $file->move($uploadDir, $newName);

        $url = '/uploads/' . $newName;
        (new LandingSettingModel())->setValue('logo_url', $url);

        $this->logActivity('updated', 'landing', null, 'Uploaded a new logo');

        return $this->respond([
            'message'  => 'Logo uploaded',
            'logo_url' => $url,
        ]);
    }

    /**
     * GET /superadmin/contact-messages — public contact-form inbox.
     * Query: ?page=1&per_page=10&q=search
     */
    public function contactMessages()
    {
        [$page, $perPage, $q] = $this->pageParams();

        $model = new ContactMessageModel();
        if ($q !== '') {
            $model->groupStart()
                ->like('name', $q)->orLike('email', $q)
                ->orLike('company', $q)->orLike('message', $q)
                ->groupEnd();
        }

        // countAllResults(false) keeps the builder (and the search WHERE) so the
        // subsequent findAll() paginates the same filtered result set.
        [$sort, $dir] = $this->sortParams(
            ['name', 'email', 'company', 'status', 'created_at'],
            'created_at',
        );

        $total = $model->countAllResults(false);
        $rows  = $model->orderBy($sort, $dir)->findAll($perPage, ($page - 1) * $perPage);

        return $this->respond([
            'contact_messages' => $rows,
            'pagination'       => $this->pageMeta($page, $perPage, $total),
        ]);
    }

    /**
     * GET /superadmin/demo-requests — submitted demo requests.
     * Query: ?page=1&per_page=10&q=search
     */
    public function demoRequests()
    {
        [$page, $perPage, $q] = $this->pageParams();

        $model = new DemoRequestModel();
        if ($q !== '') {
            $model->groupStart()
                ->like('name', $q)->orLike('email', $q)
                ->orLike('company', $q)->orLike('phone', $q)
                ->orLike('interest', $q)->orLike('message', $q)
                ->groupEnd();
        }

        [$sort, $dir] = $this->sortParams(
            ['name', 'email', 'company', 'phone', 'team_size', 'interest', 'status', 'created_at'],
            'created_at',
        );

        $total = $model->countAllResults(false);
        $rows  = $model->orderBy($sort, $dir)->findAll($perPage, ($page - 1) * $perPage);

        return $this->respond([
            'demo_requests' => $rows,
            'pagination'    => $this->pageMeta($page, $perPage, $total),
        ]);
    }

    /**
     * GET /superadmin/inbox — a page of real emails from the configured Gmail
     * account (IMAP). Query: ?page=1&per_page=12&q=search
     *
     * Returns { configured } so the UI can show a setup hint when credentials
     * are missing, and { error } when the connection itself fails — neither
     * case should surface as an HTTP error.
     */
    public function inbox()
    {
        [$page, $perPage, $q] = $this->pageParams();

        $gmail = new GmailService();
        if (! $gmail->isConfigured()) {
            return $this->respond([
                'configured' => false,
                'emails'     => [],
                'pagination' => $this->pageMeta($page, $perPage, 0),
            ]);
        }

        try {
            $res = $gmail->listMessages($page, $perPage, $q);
        } catch (\Throwable $e) {
            return $this->respond([
                'configured' => true,
                'error'      => $e->getMessage(),
                'emails'     => [],
                'pagination' => $this->pageMeta($page, $perPage, 0),
            ]);
        }

        return $this->respond([
            'configured' => true,
            'emails'     => $res['rows'],
            'pagination' => $this->pageMeta($page, $perPage, $res['total']),
        ]);
    }

    /**
     * GET /superadmin/inbox/{uid} — the full body of one Gmail message.
     * Opening it marks the message as read on the server.
     */
    public function inboxMessage(int $uid)
    {
        $gmail = new GmailService();
        if (! $gmail->isConfigured()) {
            return $this->failNotFound('Gmail is not configured.');
        }

        try {
            $message = $gmail->getMessage($uid);
        } catch (\Throwable $e) {
            return $this->fail($e->getMessage());
        }

        if (! $message) {
            return $this->failNotFound('Message not found.');
        }

        return $this->respond(['email' => $message]);
    }

    /**
     * GET /superadmin/integrations/gmail — current Gmail inbox settings.
     * The app password is never returned; only whether one is stored.
     */
    public function gmailSettings()
    {
        $map = (new AppSettingModel())->getMap();

        return $this->respond([
            'user'            => $map['gmail_user'] ?? '',
            'mailbox'         => $map['gmail_mailbox'] ?? '',
            'has_password'    => ! empty($map['gmail_app_password']),
            'configured'      => (new GmailService())->isConfigured(),
            'default_mailbox' => GmailService::DEFAULT_MAILBOX,
            'signature'       => $map['email_signature'] ?? '',
        ]);
    }

    /**
     * POST /superadmin/integrations/gmail — save Gmail inbox settings.
     * Body: { user, app_password?, mailbox? }
     * A blank app_password leaves the stored one untouched.
     */
    public function saveGmailSettings()
    {
        $user     = trim((string) $this->input('user'));
        $password = (string) $this->input('app_password');
        $mailbox  = trim((string) $this->input('mailbox'));

        if ($user !== '' && ! filter_var($user, FILTER_VALIDATE_EMAIL)) {
            return $this->failValidationErrors(['user' => 'Please enter a valid Gmail address.']);
        }

        $settings = new AppSettingModel();
        $settings->setValue('gmail_user', $user);
        $settings->setValue('gmail_mailbox', $mailbox !== '' ? $mailbox : GmailService::DEFAULT_MAILBOX);

        // Only overwrite the password when a new one is supplied, so the UI can
        // submit the form without re-entering the secret every time.
        $cleanPassword = str_replace(' ', '', $password);
        if ($cleanPassword !== '') {
            $settings->setValue('gmail_app_password', $cleanPassword);
        }

        $this->logActivity('updated', 'settings', null, 'Updated Gmail inbox settings');

        return $this->gmailSettings();
    }

    /**
     * POST /superadmin/integrations/signature — save just the company email
     * signature (HTML). Kept separate so it can't clobber the mailbox config.
     */
    public function saveEmailSignature()
    {
        $settings = new AppSettingModel();
        $settings->setValue('email_signature', (string) $this->input('signature'));

        $this->logActivity('updated', 'settings', null, 'Updated email signature');

        return $this->respond(['signature' => $settings->get('email_signature', '')]);
    }

    /**
     * POST /superadmin/integrations/gmail/test — try connecting with the saved
     * (or just-entered) credentials and report success or the exact error.
     * Body (optional): { user, app_password, mailbox } to test before saving.
     */
    public function testGmailSettings()
    {
        $user     = trim((string) $this->input('user'));
        $password = str_replace(' ', '', (string) $this->input('app_password'));
        $mailbox  = trim((string) $this->input('mailbox'));

        // Fall back to the stored password when the form left it blank.
        if ($password === '') {
            $password = (string) (new AppSettingModel())->get('gmail_app_password', '');
        }

        $override = null;
        if ($user !== '' || $password !== '' || $mailbox !== '') {
            $override = [
                'gmail_user'         => $user !== '' ? $user : null,
                'gmail_app_password' => $password !== '' ? $password : null,
                'gmail_mailbox'      => $mailbox !== '' ? $mailbox : null,
            ];
        }

        $gmail = new GmailService($override);
        if (! $gmail->isConfigured()) {
            return $this->respond(['ok' => false, 'error' => 'Enter a Gmail address and App Password first.']);
        }

        try {
            $res = $gmail->listMessages(1, 1, '');
        } catch (\Throwable $e) {
            return $this->respond(['ok' => false, 'error' => $e->getMessage()]);
        }

        return $this->respond(['ok' => true, 'total' => $res['total']]);
    }

    /**
     * Read & sanitise the standard pagination/search query params.
     *
     * @return array{0:int,1:int,2:string} [page, perPage, q]
     */
    private function pageParams(): array
    {
        $page    = max(1, (int) ($this->request->getGet('page') ?? 1));
        $perPage = (int) ($this->request->getGet('per_page') ?? 10);
        $perPage = max(1, min(100, $perPage)); // clamp to a sane range
        $q       = trim((string) ($this->request->getGet('q') ?? ''));

        return [$page, $perPage, $q];
    }

    /**
     * Read & validate the sort column/direction query params against an
     * allowlist so callers can never inject arbitrary column names.
     *
     * @param string[] $allowed Sortable column names.
     * @param string   $default Column used when none/invalid is supplied.
     * @return array{0:string,1:string} [column, 'ASC'|'DESC']
     */
    private function sortParams(array $allowed, string $default): array
    {
        $sort = (string) ($this->request->getGet('sort') ?? '');
        if (! in_array($sort, $allowed, true)) {
            $sort = $default;
        }
        $dir = strtoupper((string) ($this->request->getGet('dir') ?? 'DESC'));
        $dir = $dir === 'ASC' ? 'ASC' : 'DESC';

        return [$sort, $dir];
    }

    /** Build the pagination metadata returned alongside a page of rows. */
    private function pageMeta(int $page, int $perPage, int $total): array
    {
        return [
            'page'        => $page,
            'per_page'    => $perPage,
            'total'       => $total,
            'total_pages' => (int) max(1, ceil($total / $perPage)),
        ];
    }

    /**
     * GET /superadmin/profile — the signed-in super admin's profile.
     */
    public function profile()
    {
        $user = (new UserModel())->find($this->currentUser()['id']);

        if (! $user) {
            return $this->failNotFound('Profile not found');
        }

        unset($user['password']);

        return $this->respond(['profile' => $user]);
    }

    /**
     * POST /superadmin/profile — update the super admin's name and/or email.
     * Body (all optional): { name, email }
     */
    public function updateProfile()
    {
        $userModel = new UserModel();
        $id        = (int) $this->currentUser()['id'];
        $data      = [];

        if (($name = $this->input('name')) !== null) {
            $data['name'] = trim((string) $name);
        }

        if (($email = $this->input('email')) !== null) {
            $email = trim((string) $email);

            if ($email === '' || ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
                return $this->failValidationErrors(['email' => 'Please enter a valid email address.']);
            }

            // Manual uniqueness check (excluding self) so we control the message.
            $taken = $userModel->where('email', $email)->where('id !=', $id)->first();
            if ($taken) {
                return $this->failValidationErrors(['email' => 'That email address is already registered.']);
            }

            $data['email'] = $email;
        }

        if (! $data) {
            return $this->failValidationErrors('Nothing to update');
        }

        if (! $userModel->skipValidation(true)->update($id, $data)) {
            return $this->failValidationErrors($userModel->errors());
        }

        // Keep the session user in sync with the new email.
        if (isset($data['email'])) {
            $sessionUser          = $this->currentUser();
            $sessionUser['email'] = $data['email'];
            $this->session->set('user', $sessionUser);
        }

        $user = $userModel->find($id);
        unset($user['password']);

        $this->logActivity('updated', 'profile', $id, 'Updated their profile (' . implode(', ', array_keys($data)) . ')');

        return $this->respond(['message' => 'Profile updated', 'profile' => $user]);
    }

    /**
     * POST /superadmin/password — change the super admin's password.
     * Body: { current_password, new_password }
     */
    public function changePassword()
    {
        $current = (string) $this->input('current_password');
        $next    = (string) $this->input('new_password');

        if ($current === '' || $next === '') {
            return $this->failValidationErrors('Current and new password are required');
        }

        $email = (string) ($this->currentUser()['email'] ?? '');
        if ($problems = \App\Libraries\PasswordPolicy::problems($next, $email)) {
            return $this->failValidationErrors(['new_password' => 'Password must: ' . implode('; ', $problems) . '.']);
        }

        $userModel = new UserModel();
        $id        = (int) $this->currentUser()['id'];
        $user      = $userModel->find($id);

        if (! $user || ! password_verify($current, $user['password'])) {
            return $this->failValidationErrors(['current_password' => 'Current password is incorrect.']);
        }

        // Password is hashed automatically by UserModel::hashPassword().
        if (! $userModel->skipValidation(true)->update($id, ['password' => $next])) {
            return $this->failValidationErrors($userModel->errors());
        }

        $u = $this->currentUser();
        if (is_array($u)) {
            $u['must_change_password'] = false;
            session()->set('user', $u);
        }
        $this->logActivity('updated', 'profile', $id, 'Changed their password');

        return $this->respond(['message' => 'Password changed']);
    }

    /**
     * POST /superadmin/profile/avatar — upload a profile photo (multipart/form-data,
     * field name "avatar"). Stores the file under public/uploads and records its
     * URL on the user's row.
     */
    public function uploadAvatar()
    {
        $file = $this->request->getFile('avatar');

        if (! $file || ! $file->isValid()) {
            return $this->failValidationErrors('Please choose a valid image file.');
        }

        $allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
        if (! in_array($file->getMimeType(), $allowed, true)) {
            return $this->failValidationErrors('Photo must be a PNG, JPG, WEBP or GIF image.');
        }

        if ($file->getSize() > 2 * 1024 * 1024) {
            return $this->failValidationErrors('Photo must be 2MB or smaller.');
        }

        $uploadDir = FCPATH . 'uploads';
        if (! is_dir($uploadDir)) {
            mkdir($uploadDir, 0775, true);
        }

        $newName = $file->getRandomName();
        $file->move($uploadDir, $newName);

        $url = '/uploads/' . $newName;
        (new UserModel())->skipValidation(true)->update((int) $this->currentUser()['id'], ['avatar' => $url]);

        $this->logActivity('updated', 'profile', (int) $this->currentUser()['id'], 'Updated their profile photo');

        return $this->respond(['message' => 'Photo updated', 'avatar' => $url]);
    }

    /**
     * GET /superadmin/overview — rich dashboard payload: headline stats,
     * plan/status distribution, a 14-day activity time series, and recents.
     */
    public function overview()
    {
        $clients  = new ClientModel();
        $demos    = new DemoRequestModel();
        $contacts = new ContactMessageModel();

        $plans = [];
        foreach ((new ClientModel())->select('plan, COUNT(*) as c')->groupBy('plan')->findAll() as $r) {
            $plans[$r['plan'] ?: 'starter'] = (int) $r['c'];
        }

        $clientStatus = [];
        foreach ((new ClientModel())->select('status, COUNT(*) as c')->groupBy('status')->findAll() as $r) {
            $clientStatus[$r['status'] ?: 'active'] = (int) $r['c'];
        }

        $since30 = date('Y-m-d', strtotime('-29 day')) . ' 00:00:00';

        return $this->respond([
            'stats' => [
                'clients'         => $clients->countAllResults(),
                'clients_active'  => (new ClientModel())->where('status', 'active')->countAllResults(),
                'clients_new_30d' => (new ClientModel())->where('created_at >=', $since30)->countAllResults(),
                'client_admins'   => (new UserModel())->where('role', 'client_admin')->countAllResults(),
                'users_total'     => (new UserModel())->countAllResults(),
                'demo_total'      => $demos->countAllResults(),
                'demo_new'        => (new DemoRequestModel())->where('status', 'new')->countAllResults(),
                'contact_total'   => $contacts->countAllResults(),
                'contact_new'     => (new ContactMessageModel())->where('status', 'new')->countAllResults(),
            ],
            'plans'           => $plans,
            'client_status'   => $clientStatus,
            'series'          => $this->dailySeries(14),
            'recent_demos'    => (new DemoRequestModel())->orderBy('created_at', 'DESC')->findAll(5),
            'recent_contacts' => (new ContactMessageModel())->orderBy('created_at', 'DESC')->findAll(5),
            'recent_clients'  => (new ClientModel())->orderBy('created_at', 'DESC')->findAll(5),
        ]);
    }

    /** Build a per-day demos/contacts count series for the last N days. */
    private function dailySeries(int $days): array
    {
        $demoMap    = $this->countByDay('demo_requests', $days);
        $contactMap = $this->countByDay('contact_messages', $days);

        $out = [];
        for ($i = $days - 1; $i >= 0; $i--) {
            $date  = date('Y-m-d', strtotime("-{$i} day"));
            $out[] = [
                'date'     => $date,
                'demos'    => $demoMap[$date] ?? 0,
                'contacts' => $contactMap[$date] ?? 0,
            ];
        }

        return $out;
    }

    /** @return array<string,int> date => count for the last N days. */
    private function countByDay(string $table, int $days): array
    {
        $since = date('Y-m-d', strtotime('-' . ($days - 1) . ' day')) . ' 00:00:00';
        $rows  = \Config\Database::connect()
            ->table($table)
            ->select('DATE(created_at) as d, COUNT(*) as c')
            ->where('created_at >=', $since)
            ->groupBy('d')
            ->get()
            ->getResultArray();

        $map = [];
        foreach ($rows as $r) {
            $map[$r['d']] = (int) $r['c'];
        }

        return $map;
    }

    /**
     * GET /superadmin/notifications — unread alerts derived from new demo &
     * contact submissions, newest first.
     */
    public function notifications()
    {
        $items = [];

        foreach ((new DemoRequestModel())->where('status', 'new')->orderBy('created_at', 'DESC')->findAll(25) as $d) {
            $items[] = [
                'id'         => (int) $d['id'],
                'type'       => 'demo',
                'title'      => 'New demo request',
                'name'       => $d['name'],
                'email'      => $d['email'],
                'company'    => $d['company'] ?? '',
                'created_at' => $d['created_at'],
            ];
        }

        foreach ((new ContactMessageModel())->where('status', 'new')->orderBy('created_at', 'DESC')->findAll(25) as $c) {
            $items[] = [
                'id'         => (int) $c['id'],
                'type'       => 'contact',
                'title'      => 'New contact message',
                'name'       => $c['name'],
                'email'      => $c['email'],
                'company'    => $c['company'] ?? '',
                'created_at' => $c['created_at'],
            ];
        }

        usort($items, static fn ($a, $b) => strcmp((string) $b['created_at'], (string) $a['created_at']));

        return $this->respond(['notifications' => $items, 'count' => count($items)]);
    }

    /** POST /superadmin/demo-requests/{id}/read */
    public function markDemoRead(int $id)
    {
        $m = new DemoRequestModel();
        if (! $m->find($id)) {
            return $this->failNotFound('Demo request not found');
        }
        $m->skipValidation(true)->update($id, ['status' => 'read']);

        $this->logActivity('updated', 'demo_request', $id, 'Marked demo request #' . $id . ' as read');

        return $this->respond(['message' => 'Marked as read']);
    }

    /** POST /superadmin/demo-requests/{id}/replied — mark a demo request replied. */
    public function markDemoReplied(int $id)
    {
        $m = new DemoRequestModel();
        if (! $m->find($id)) {
            return $this->failNotFound('Demo request not found');
        }
        $m->skipValidation(true)->update($id, ['status' => 'replied']);

        $this->logActivity('updated', 'demo_request', $id, 'Replied to demo request #' . $id);

        return $this->respond(['message' => 'Marked as replied']);
    }

    /** POST /superadmin/demo-requests/{id}/delete — soft-delete a demo request. */
    public function deleteDemo(int $id)
    {
        $m = new DemoRequestModel();
        if (! $m->find($id)) {
            return $this->failNotFound('Demo request not found');
        }
        $m->delete($id);

        $this->logActivity('deleted', 'demo_request', $id, 'Deleted demo request #' . $id);

        return $this->respond(['message' => 'Deleted']);
    }

    /** POST /superadmin/contact-messages/{id}/read */
    public function markContactRead(int $id)
    {
        $m = new ContactMessageModel();
        if (! $m->find($id)) {
            return $this->failNotFound('Contact message not found');
        }
        $m->skipValidation(true)->update($id, ['status' => 'read']);

        $this->logActivity('updated', 'contact_message', $id, 'Marked contact message #' . $id . ' as read');

        return $this->respond(['message' => 'Marked as read']);
    }

    /** POST /superadmin/contact-messages/{id}/replied — mark a contact replied. */
    public function markContactReplied(int $id)
    {
        $m = new ContactMessageModel();
        if (! $m->find($id)) {
            return $this->failNotFound('Contact message not found');
        }
        $m->skipValidation(true)->update($id, ['status' => 'replied']);

        $this->logActivity('updated', 'contact_message', $id, 'Replied to contact message #' . $id);

        return $this->respond(['message' => 'Marked as replied']);
    }

    /** POST /superadmin/contact-messages/{id}/delete — soft-delete a contact. */
    public function deleteContact(int $id)
    {
        $m = new ContactMessageModel();
        if (! $m->find($id)) {
            return $this->failNotFound('Contact message not found');
        }
        $m->delete($id);

        $this->logActivity('deleted', 'contact_message', $id, 'Deleted contact message #' . $id);

        return $this->respond(['message' => 'Deleted']);
    }

    /** POST /superadmin/notifications/read-all — clear all unread alerts. */
    public function markAllRead()
    {
        (new DemoRequestModel())->where('status', 'new')->set('status', 'read')->update();
        (new ContactMessageModel())->where('status', 'new')->set('status', 'read')->update();

        $this->logActivity('updated', 'notification', null, 'Marked all notifications as read');

        return $this->respond(['message' => 'All notifications cleared']);
    }

    /**
     * GET /superadmin/activity — the audit log: who created/updated/deleted
     * what, across super admins, client admins, users and anonymous public
     * visitors, newest first.
     *
     * Query: ?limit=100 (max 200), ?role=super_admin, ?action=created
     */
    public function activity()
    {
        $limit  = max(1, min((int) ($this->request->getGet('limit') ?? 20), 50));
        $offset = max(0, (int) ($this->request->getGet('offset') ?? 0));
        $action = trim((string) ($this->request->getGet('action') ?? ''));

        // The super-admin feed shows only platform (super-admin) activity from
        // the main DB; client/staff activity lives in each client's own DB.
        $role = trim((string) ($this->request->getGet('role') ?? 'super_admin'));

        $where = ['actor_role' => $role];
        if ($action !== '') {
            $where['action'] = $action;
        }

        $rows = (new ActivityLogModel())
            ->where($where)
            ->orderBy('created_at', 'DESC')->orderBy('id', 'DESC')
            ->findAll($limit, $offset);

        // Show the actor's current display name (older rows stored an email).
        $ids = array_values(array_unique(array_filter(array_map(
            static fn ($r) => $r['actor_id'] ?? null,
            $rows,
        ), static fn ($v) => $v !== null)));
        if ($ids) {
            $names = [];
            foreach ((new \App\Models\UserModel())->select('id, name')->whereIn('id', $ids)->findAll() as $u) {
                if (! empty($u['name'])) {
                    $names[(int) $u['id']] = $u['name'];
                }
            }
            foreach ($rows as &$r) {
                $aid = $r['actor_id'] ?? null;
                if ($aid !== null && isset($names[(int) $aid])) {
                    $r['actor_name'] = $names[(int) $aid];
                }
            }
            unset($r);
        }

        $payload = [
            'activity' => $rows,
            'count'    => count($rows),
            'has_more' => count($rows) === $limit,
        ];

        // Send headline stats only with the first page so the client can render
        // accurate KPIs without holding the whole dataset.
        if ($offset === 0) {
            $payload['stats'] = $this->activityStats($role);
        }

        return $this->respond($payload);
    }

    /**
     * Audit-log KPIs for a role, with day/week windows measured in IST
     * (Asia/Kolkata) even though timestamps are stored in UTC.
     *
     * @return array{today:int,active:int,created_week:int,deleted_week:int,total:int}
     */
    private function activityStats(string $role): array
    {
        $ist          = new \DateTimeZone('Asia/Kolkata');
        $utc          = new \DateTimeZone('UTC');
        $todayStartUtc = (new \DateTime('now', $ist))->setTime(0, 0, 0)->setTimezone($utc)->format('Y-m-d H:i:s');
        $weekAgoUtc    = (new \DateTime('now', $utc))->modify('-7 days')->format('Y-m-d H:i:s');

        $base = static fn () => (new ActivityLogModel())->where('actor_role', $role);

        // Per-action totals power the filter-tab badges.
        $byAction = [];
        $rows = $base()->select('action, COUNT(*) AS n')->groupBy('action')->get()->getResultArray();
        foreach ($rows as $r) {
            $byAction[$r['action']] = (int) $r['n'];
        }

        return [
            'total'        => array_sum($byAction),
            'today'        => $base()->where('created_at >=', $todayStartUtc)->countAllResults(),
            'active'       => (int) ($base()->select('COUNT(DISTINCT actor_id) AS n')->get()->getRow('n') ?? 0),
            'created_week' => $base()->where('action', 'created')->where('created_at >=', $weekAgoUtc)->countAllResults(),
            'deleted_week' => $base()->where('action', 'deleted')->where('created_at >=', $weekAgoUtc)->countAllResults(),
            'by_action'    => $byAction,
        ];
    }

    /**
     * GET /superadmin/events?month=YYYY-MM — calendar events for a month
     * (defaults to the current month).
     */
    public function events()
    {
        $month = (string) ($this->request->getGet('month') ?? date('Y-m'));
        if (! preg_match('/^\d{4}-\d{2}$/', $month)) {
            $month = date('Y-m');
        }
        $start = $month . '-01';
        $end   = date('Y-m-t', strtotime($start));

        $rows = (new CalendarEventModel())
            ->where('event_date >=', $start)
            ->where('event_date <=', $end)
            ->orderBy('event_date', 'ASC')
            ->orderBy('start_time', 'ASC')
            ->findAll();

        $resp = [
            'events'           => $rows,
            'month'            => $month,
            'google_connected' => false,
            'google_events'    => [],
        ];

        // Merge in Google Calendar meetings for the visible grid (the month
        // plus a week of padding on each side, so spill-over days show too).
        $gcal = new GoogleCalendarService();
        if ($gcal->isConfigured()) {
            $resp['google_connected'] = true;
            try {
                $timeMin = date('Y-m-d', strtotime($start . ' -7 days')) . 'T00:00:00Z';
                $timeMax = date('Y-m-d', strtotime($end . ' +8 days')) . 'T00:00:00Z';
                $resp['google_events'] = $gcal->listEvents($timeMin, $timeMax);
            } catch (\Throwable $e) {
                $resp['google_error'] = $e->getMessage();
            }
        }

        return $this->respond($resp);
    }

    /**
     * POST /superadmin/meetings — schedule a meeting on the connected Google
     * Calendar. Body: { title, event_date, start_time?, end_time?, description?,
     * location?, attendees? (array or comma list), with_meet? }
     */
    public function createMeeting()
    {
        $gcal = new GoogleCalendarService();
        if (! $gcal->isConfigured()) {
            return $this->failValidationErrors('Connect Google Calendar in Integrations first.');
        }

        $title = trim((string) $this->input('title'));
        if ($title === '') {
            return $this->failValidationErrors(['title' => 'A meeting title is required.']);
        }

        $date = (string) $this->input('event_date');
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            return $this->failValidationErrors(['event_date' => 'A valid date is required.']);
        }

        // Attendees may arrive as an array or a comma-separated string.
        $attendees = $this->input('attendees');
        if (is_string($attendees)) {
            $attendees = explode(',', $attendees);
        }
        $attendees = array_values(array_filter(
            array_map(static fn ($e) => trim((string) $e), (array) $attendees),
            static fn ($e) => filter_var($e, FILTER_VALIDATE_EMAIL) !== false,
        ));

        try {
            $event = $gcal->insertEvent([
                'title'       => $title,
                'description' => trim((string) ($this->input('description') ?? '')) ?: null,
                'date'        => $date,
                'start_time'  => trim((string) ($this->input('start_time') ?? '')),
                'end_time'    => trim((string) ($this->input('end_time') ?? '')),
                'location'    => trim((string) ($this->input('location') ?? '')) ?: null,
                'attendees'   => $attendees,
                'with_meet'   => filter_var($this->input('with_meet'), FILTER_VALIDATE_BOOLEAN),
            ]);
        } catch (\Throwable $e) {
            return $this->fail($e->getMessage());
        }

        $this->logActivity('created', 'meeting', null, 'Scheduled Google Calendar meeting "' . $title . '"');

        return $this->respondCreated(['message' => 'Meeting scheduled', 'event' => $event]);
    }

    /**
     * GET /superadmin/integrations/google-calendar — current Calendar settings.
     * The service account key is never returned, only whether one is stored.
     */
    public function googleCalendarSettings()
    {
        $map  = (new AppSettingModel())->getMap();
        $gcal = new GoogleCalendarService();

        return $this->respond([
            'calendar_id'           => $map['google_calendar_id'] ?? '',
            'has_service_account'   => ! empty($map['google_service_account']),
            'service_account_email' => $gcal->getServiceAccountEmail(),
            'configured'            => $gcal->isConfigured(),
        ]);
    }

    /**
     * POST /superadmin/integrations/google-calendar — save Calendar settings.
     * Body: { calendar_id, service_account? (JSON key) }
     * A blank service_account leaves the stored key untouched.
     */
    public function saveGoogleCalendarSettings()
    {
        $calendarId = trim((string) $this->input('calendar_id'));
        $sa         = $this->input('service_account');

        $settings = new AppSettingModel();

        if (is_string($sa) && trim($sa) !== '') {
            $decoded = json_decode($sa, true);
            if (! is_array($decoded) || empty($decoded['client_email']) || empty($decoded['private_key'])) {
                return $this->failValidationErrors([
                    'service_account' => 'That is not a valid service account JSON key (missing client_email / private_key).',
                ]);
            }
            $settings->setValue('google_service_account', json_encode($decoded));
        }

        $settings->setValue('google_calendar_id', $calendarId);

        $this->logActivity('updated', 'settings', null, 'Updated Google Calendar settings');

        return $this->googleCalendarSettings();
    }

    /**
     * POST /superadmin/integrations/google-calendar/test — verify access with
     * the saved (or just-entered) credentials and report success or the error.
     * Body (optional): { service_account, calendar_id } to test before saving.
     */
    public function testGoogleCalendarSettings()
    {
        $sa         = $this->input('service_account');
        $calendarId = trim((string) $this->input('calendar_id'));

        $override = null;
        if ((is_string($sa) && trim($sa) !== '') || $calendarId !== '') {
            $override = [
                'service_account' => is_string($sa) && trim($sa) !== '' ? $sa : null,
                'calendar_id'     => $calendarId !== '' ? $calendarId : null,
            ];
        }

        $gcal = new GoogleCalendarService($override);
        if (! $gcal->isConfigured()) {
            return $this->respond(['ok' => false, 'error' => 'Paste the service account JSON and the calendar ID first.']);
        }

        try {
            $info = $gcal->ping();
        } catch (\Throwable $e) {
            return $this->respond(['ok' => false, 'error' => $e->getMessage()]);
        }

        return $this->respond(['ok' => true, 'calendar' => $info['summary'] ?? $calendarId]);
    }

    /** POST /superadmin/events — create an event. */
    public function createEvent()
    {
        $model = new CalendarEventModel();
        $id    = $model->insert([
            'title'       => trim((string) $this->input('title')),
            'description' => trim((string) ($this->input('description') ?? '')) ?: null,
            'event_date'  => (string) $this->input('event_date'),
            'start_time'  => trim((string) ($this->input('start_time') ?? '')) ?: null,
            'end_time'    => trim((string) ($this->input('end_time') ?? '')) ?: null,
            'color'       => trim((string) ($this->input('color') ?? 'indigo')) ?: 'indigo',
            'created_by'  => (int) $this->currentUser()['id'],
        ]);

        if ($id === false) {
            return $this->failValidationErrors($model->errors());
        }

        $this->logActivity('created', 'event', (int) $id, 'Created calendar event "' . trim((string) $this->input('title')) . '"');

        return $this->respondCreated(['message' => 'Event created', 'event' => $model->find($id)]);
    }

    /** POST /superadmin/events/{id} — update an event. */
    public function updateEvent(int $id)
    {
        $model = new CalendarEventModel();
        if (! $model->find($id)) {
            return $this->failNotFound('Event not found');
        }

        $data = [];
        foreach (['title', 'description', 'event_date', 'start_time', 'end_time', 'color'] as $f) {
            $v = $this->input($f);
            if ($v === null) {
                continue;
            }
            $v = is_string($v) ? trim($v) : $v;
            if ($v === '' && in_array($f, ['description', 'start_time', 'end_time'], true)) {
                $v = null;
            }
            $data[$f] = $v;
        }

        if (! $data) {
            return $this->failValidationErrors('Nothing to update');
        }

        if (! $model->skipValidation(true)->update($id, $data)) {
            return $this->failValidationErrors($model->errors());
        }

        $this->logActivity('updated', 'event', $id, 'Updated calendar event #' . $id);

        return $this->respond(['message' => 'Event updated', 'event' => $model->find($id)]);
    }

    /** POST /superadmin/events/{id}/delete — delete an event. */
    public function deleteEvent(int $id)
    {
        $model = new CalendarEventModel();
        if (! $model->find($id)) {
            return $this->failNotFound('Event not found');
        }
        $model->delete($id);

        $this->logActivity('deleted', 'event', $id, 'Deleted calendar event #' . $id);

        return $this->respond(['message' => 'Event deleted']);
    }

    /**
     * GET /superadmin/messages?folder=sent — list composed messages.
     */
    public function messages()
    {
        $folder = (string) ($this->request->getGet('folder') ?? 'sent');

        $rows = (new MessageModel())
            ->where('folder', $folder)
            ->orderBy('created_at', 'DESC')
            ->findAll(100);

        return $this->respond(['messages' => $rows, 'folder' => $folder]);
    }

    /**
     * POST /superadmin/messages — compose & send a real email (Gmail SMTP),
     * then store it in the Sent folder. Body: { to_email, to_name?, subject?, body? }
     *
     * If delivery fails the message is NOT stored (so a retry won't duplicate),
     * and the exact SMTP error is returned with sent=false.
     */
    public function sendMessage()
    {
        $to      = trim((string) $this->input('to_email'));
        $toName  = trim((string) ($this->input('to_name') ?? '')) ?: null;
        $subject = trim((string) ($this->input('subject') ?? '')) ?: null;
        $body    = trim((string) ($this->input('body') ?? '')) ?: null;

        if ($to === '' || ! filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return $this->failValidationErrors(['to_email' => 'Enter a valid recipient email.']);
        }

        // Actually deliver the email.
        $fromName = $this->currentUser()['name'] ?? null;
        $result   = (new MailerService())->send($to, (string) $subject, (string) $body, $fromName);

        if (! $result['ok']) {
            $this->logActivity('updated', 'message', null, 'Email to ' . $to . ' failed to send');

            return $this->respond([
                'sent'    => false,
                'error'   => $result['error'] ?? 'The email could not be delivered.',
                'message' => 'Email not sent',
            ]);
        }

        $model = new MessageModel();
        $id    = $model->insert([
            'to_email'   => $to,
            'to_name'    => $toName,
            'subject'    => $subject,
            'body'       => $body,
            'folder'     => 'sent',
            'created_by' => (int) $this->currentUser()['id'],
        ]);

        $this->logActivity('created', 'message', $id ? (int) $id : null, 'Emailed ' . $to);

        return $this->respondCreated([
            'message' => 'Message sent',
            'mail'    => $id ? $model->find($id) : null,
            'sent'    => true,
            'error'   => null,
        ]);
    }

    /**
     * POST /superadmin/integrations/email-test — send a test email to verify
     * outgoing mail works. Body: { to }. Returns { ok, error }.
     */
    public function emailTest()
    {
        $to = trim((string) $this->input('to'));
        if ($to === '' || ! filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return $this->failValidationErrors(['to' => 'Enter a valid recipient email.']);
        }

        $html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b">'
            . '<p>This is a test email from your CRM admin panel.</p>'
            . '<p>If you can read this, outgoing email (Gmail SMTP) is working. 🎉</p>'
            . '</div>';

        $result = (new MailerService())->send($to, 'CRM — test email', $html, $this->currentUser()['name'] ?? null);

        $this->logActivity('updated', 'settings', null, 'Sent a test email to ' . $to . ($result['ok'] ? '' : ' (failed)'));

        return $this->respond(['ok' => $result['ok'], 'error' => $result['ok'] ? null : ($result['error'] ?? 'Send failed.')]);
    }

    /** POST /superadmin/messages/{id}/delete */
    public function deleteMessage(int $id)
    {
        $model = new MessageModel();
        if (! $model->find($id)) {
            return $this->failNotFound('Message not found');
        }
        $model->delete($id);

        $this->logActivity('deleted', 'message', $id, 'Deleted message #' . $id);

        return $this->respond(['message' => 'Message deleted']);
    }
}
