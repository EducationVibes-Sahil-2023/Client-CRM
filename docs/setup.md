# Setup Instructions

## Prerequisites

- Node.js 18+ and npm
- PHP 8.1+ with CLI and PDO extensions
- Composer
- MySQL or MariaDB

## Frontend setup

1. Change into the frontend folder:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy environment example:
   ```bash
   cp .env.local.example .env.local
   ```
4. Run development server:
   ```bash
   npm run dev
   ```

## Backend setup

1. Change into the backend folder:
   ```bash
   cd backend
   ```
2. Install Composer dependencies:
   ```bash
   composer install
   ```
3. Copy environment file:
   ```bash
   cp .env.example .env
   ```
4. Use phpMyAdmin to create the main CRM database and any client databases:
   - Open `http://localhost/phpmyadmin/index.php`
   - Create database `crm_main`
   - Create client database names like `client_abc`, `client_xyz`, etc.
   - Run the SQL schema in `backend/database/schema.sql` to create tables.
   - Optionally import `backend/database/seed.sql` to add a default super admin user.
   - `crm_main` stores shared product metadata and user access control.
   - Each `client_*` database stores that clients tenant CRM data.
5. Configure each client database in `app/Config/Database.php`
6. Run the backend dev server:
   ```bash
   php -S localhost:8080 -t public
   ```

## Database & migrations

The app is multi-tenant: a shared **main** database (`crm_main`) plus one isolated
`client_*` database per tenant. Schema lives in CodeIgniter migrations
(`backend/app/Database/Migrations`); each tenant DB mirrors the main structure via
the tenant-sync step.

### Fresh install (new machine / dev)

One command creates the main DB, loads the base schema, runs every migration, seeds
the default super admin, and provisions all client databases:

```bash
cd backend
php spark db:setup
```

- Default super admin: `admin@example.com` / `Password123!` (change after first login).
- `php spark db:setup --fresh` **drops** the database and rebuilds from scratch — dev only.

### Production updates (after deploying new code) — SAFE

The CRM runs in production with live data. To apply new columns/tables **without
removing any data**, run **only**:

```bash
cd backend
php spark db:upgrade
```

This is purely additive:

1. `migrate` — applies only new, unapplied migrations (their `up()`), adding
   columns/tables. It never runs the destructive `down()` methods.
2. **Tenant sync** — adds any missing tables/columns/indexes to every `client_*`
   database, mirroring the main DB. It only creates what's missing; it never drops.

Neither step deletes data or re-seeds (so the admin password is untouched). New
columns appear in the main DB **and** every tenant DB.

> A typical deploy: `git pull` → `composer install` → `php spark db:upgrade` (backend),
> then `npm install` → `npm run build` (frontend).

### ⚠️ Never run these against live/production data

| Command | Why it's dangerous |
| --- | --- |
| `php spark db:setup --fresh` | **Drops** the database. |
| `php spark db:setup` (plain) | Re-seeds — **resets the super-admin password**. |
| `php spark migrate:rollback` / `migrate:refresh` | Run the destructive `down()` methods (drop tables/columns). |

For safety, `db:setup` refuses to run when `CI_ENVIRONMENT = production` unless you
pass `--force`. On production, always use `db:upgrade`.

### Automatic database backups (cron)

Two layers configure backups:

- **Super admin** → Admin → Database → *Automatic backups*: the schedule for the
  **main** DB (enable, frequency, retention) + manual "Run now" + download stored files.
- **Client admin** (when granted the **Database backup** feature) → Dashboard
  Configuration → *Automatic database backup*: their own DB's schedule — frequency
  (daily / weekly / monthly), time of day, and retention. Clients **cannot download**;
  backups run on the server and are managed by the platform admin.

Wire one cron entry, run it **hourly** (so each client's chosen time is honoured):

```bash
0 * * * *  cd /path/to/backend && php spark backup:run >> writable/logs/backup.log 2>&1
```

- `php spark backup:run` backs up the main DB when its global schedule is due, plus
  any client whose own schedule is due at the current hour.
- Backups are gzipped SQL dumps in `backend/writable/backups/` (outside the web root);
  old files are pruned per the retention window (per-client for client DBs).
- `php spark backup:run --force` backs up everything now (`--main-only` skips clients).
- Super admins can also download a one-off SQL dump of the main or any client DB.

### Adding a new column to a tenant table

Write a guarded migration (`if (! $this->db->fieldExists(...)) $this->forge->addColumn(...)`)
against the **main** DB table, then `php spark db:upgrade` rolls it out to every
tenant DB. Keep all `dropColumn`/`dropTable` calls in `down()` only.

## Documentation refresh

After making changes to controllers, models, or pages, run:

```bash
node scripts/generate-docs.js
```

This updates the generated documentation artifacts.
