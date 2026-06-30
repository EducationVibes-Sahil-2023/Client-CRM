# Production deployment & config

How to take this CRM live, and **exactly which config changes** differ from local
development. Topology assumed (chosen for this project):

> **One domain, API under `/api`.** nginx terminates TLS for
> `https://client.educationvibes.in`, serves the Next.js frontend at `/`, and
> reverse-proxies `/api/*` to the CodeIgniter backend. Frontend and API are the
> **same origin**, so the session cookie is first-party (`SameSite=Lax`) and CORS
> is not involved.

```
                      ┌──────────────────────── nginx (TLS, :443) ───────────────────────┐
 browser ──https──►   │  location /        → Next.js   (node, 127.0.0.1:3000)            │
 client.educationvibes│  location /api/    → CodeIgniter (php-fpm, backend/public)       │
                      └───────────────────────────────────────────────────────────────────┘
```

---

## 1. What changes between local and production

Everything below is **environment config only** — no application code changes.

| Setting | Local (dev) | Production | Where |
|---|---|---|---|
| `CI_ENVIRONMENT` | `development` | `production` | `backend/.env` |
| `app.baseURL` | `http://localhost:8080/` | `https://client.educationvibes.in/api/` | `backend/.env` |
| `app.forceGlobalSecureRequests` | `false` | `false` *(nginx enforces HTTPS — see note)* | `backend/.env` |
| `cookie.secure` | `false` | **`true`** | `backend/.env` |
| `cookie.samesite` | `Lax` | `Lax` | `backend/.env` |
| `cookie.domain` | `''` | `''` | `backend/.env` |
| DB host/user/pass | local XAMPP root | production MySQL creds | `backend/.env` |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080` | `/api` | `frontend/.env.production` |

Templates are committed: copy **`backend/.env.production.example` → `backend/.env`**
on the server and fill in the secrets. `frontend/.env.production` is already set to
`/api`.

> **Why `forceGlobalSecureRequests = false` behind a proxy:** TLS is terminated at
> nginx, so PHP sees plain HTTP from the proxy. If you turn this on without trusting
> the proxy's `X-Forwarded-Proto`, CI4 will redirect-loop. Enforce HTTPS at nginx
> instead (the `:80 → :443` redirect below).

> **Why `SameSite=Lax` (not `None`):** because the API shares the domain with the
> frontend, the cookie is first-party. `Lax` keeps CSRF protection; `None` would
> throw it away. Only a *different-domain* API would need `None`+`Secure`.

---

## 2. nginx site config

```nginx
# ── redirect all HTTP to HTTPS ────────────────────────────────────────────────
server {
    listen 80;
    server_name client.educationvibes.in;
    return 301 https://$host$request_uri;
}

# ── main HTTPS server ─────────────────────────────────────────────────────────
server {
    listen 443 ssl http2;
    server_name client.educationvibes.in;

    ssl_certificate     /etc/letsencrypt/live/client.educationvibes.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/client.educationvibes.in/privkey.pem;

    client_max_body_size 25M;          # allow file/asset uploads

    # ── API → CodeIgniter (php-fpm). The trailing slashes strip the /api prefix
    #    so CI sees /auth/login, not /api/auth/login. ──────────────────────────
    location /api/ {
        alias /var/www/crm/backend/public/;
        try_files $uri $uri/ @ci;

        # SECURITY: never execute uploaded files. The Apache .htaccess in
        # public/uploads does NOT apply under nginx — this rule replaces it.
        location ~* ^/api/uploads/.*\.(php|phtml|phar|cgi|pl|py|sh|html?)$ {
            default_type text/plain;
            add_header X-Content-Type-Options nosniff;
        }
    }
    location @ci {
        rewrite ^/api/(.*)$ /index.php/$1 break;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME /var/www/crm/backend/public/index.php;
        fastcgi_param REQUEST_URI /$1;
        fastcgi_param HTTPS on;                       # tell CI the request is secure
        fastcgi_param HTTP_X_FORWARDED_PROTO https;
        fastcgi_pass unix:/run/php/php8.x-fpm.sock;
    }

    # ── everything else → Next.js (next start on :3000) ───────────────────────
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

> Adjust paths (`/var/www/crm`, php-fpm socket version) to your server. If you
> prefer serving CI with its own `location ~ \.php$` block instead of the
> `alias`+`@ci` pattern, that's fine too — the key points are: strip `/api`, pass
> `HTTPS on`, and block script execution under `uploads/`.

---

## 3. First deploy — step by step

```bash
# ─── Backend ───────────────────────────────────────────────────────────────
cd /var/www/crm/backend
composer install --no-dev --optimize-autoloader
cp .env.production.example .env          # then edit: DB creds, VAPID keys, gmail
php spark push:keys                       # ONLY if you have no VAPID keys yet
php spark db:upgrade                       # creates/upgrades main + every tenant DB
# writable dirs must be writable by php-fpm:
chown -R www-data:www-data writable public/uploads

# ─── Frontend ──────────────────────────────────────────────────────────────
cd /var/www/crm/frontend
npm ci
npm run build
pm2 start "npm run start" --name crm-web   # or: pm2 start npm --name crm-web -- start
pm2 save
```

Then reload nginx (`nginx -t && systemctl reload nginx`) and obtain TLS with
`certbot --nginx -d client.educationvibes.in`.

---

## 4. Updating an already-live deployment

**Database — additive only. Never destructive.** (See the soft-delete & migration
policy.)

```bash
cd /var/www/crm/backend
git pull
composer install --no-dev --optimize-autoloader
php spark db:upgrade        # ✅ additive migrate + tenant sync, no data loss
#                            ❌ NEVER: db:setup --fresh, migrate:rollback, db:seed on prod

cd ../frontend
git pull
npm ci
npm run build
pm2 reload crm-web
```

`php spark db:upgrade` is the **only** schema command to run on production: it
applies new migrations to the main DB and mirrors structural changes to every
client database, never touching rows. A full backup before upgrading is still wise
(`php spark backup:run`, or a `mysqldump`).

**Why it's safe (verified):** every migration's `up()` is **additive and
idempotent** — new tables are guarded by `tableExists()` / `CREATE TABLE IF NOT
EXISTS`, new columns by `fieldExists()`, new indexes by an existence check. All
destructive operations (`dropTable` / `dropColumn` / `DROP INDEX`) live only in
`down()`, which `db:upgrade` never runs. The tenant mirror
(`TenantSchema::apply()`) only **creates missing** tables/columns/indexes — it
never drops or rewrites existing data. So re-running `db:upgrade`, or running it
against a database with minor schema drift, is harmless. The only command that
drops a tenant database is client deletion (`TenantManager::deprovision`), never
an upgrade.

---

## 5. Production checklist

- [ ] `backend/.env`: `CI_ENVIRONMENT=production`, real DB creds, `cookie.secure=true`.
- [ ] `php spark db:upgrade` run; new columns/tables present on main + tenant DBs.
- [ ] HTTPS works and HTTP redirects to it; valid certificate.
- [ ] Log in over HTTPS — session persists across navigation (confirms the cookie).
- [ ] Upload a file, then try fetching it as `…/api/uploads/<name>.php` → must come
      back as plain text / not execute (confirms the nginx uploads rule).
- [ ] `writable/` and `public/uploads/` writable by php-fpm.
- [ ] VAPID keys set (web push works) and the same keypair as before, if migrating.
- [ ] PM2 (or systemd) set to restart the Next.js process on boot (`pm2 startup`).
- [ ] Backups scheduled (admin Backup settings, or a cron `php spark backup:run`).
