# CRM API Reference

REST-style JSON API for the multi-tenant CRM platform, built on **CodeIgniter 4.7**.

- **Base URL (development):** `http://localhost:8080`
- **Content type:** all request bodies and responses are `application/json`
- **Auth:** session-cookie based (see [Authentication](#authentication))
- **Call Tracking ingest API:** see [call-tracking.md](call-tracking.md)
  (`POST /client/call-logs`, `GET /client/calls`).

---

## Table of contents

1. [Conventions](#conventions)
2. [Authentication](#authentication)
3. [CORS](#cors)
4. [Errors](#errors)
5. [Endpoints](#endpoints)
   - [Public](#public-endpoints)
   - [Auth](#auth-endpoints)
   - [Super Admin](#super-admin-endpoints)
   - [Client Admin](#client-admin-endpoints)
6. [Roles & access matrix](#roles--access-matrix)
7. [Data model](#data-model)

---

## Conventions

| Item | Value |
|------|-------|
| Protocol | HTTP/1.1 |
| Encoding | UTF-8 |
| Request body | JSON (`Content-Type: application/json`) |
| Response body | JSON |
| Timestamps | `YYYY-MM-DD HH:MM:SS` (UTC) |
| IDs | unsigned integers |

The API reads JSON request bodies. Form-encoded posts are also accepted, but the
frontend and all examples below use JSON.

### Standard HTTP status codes

| Code | Meaning |
|------|---------|
| `200 OK` | Successful read / action |
| `201 Created` | Resource created |
| `400 Bad Request` | Validation failed / missing fields |
| `401 Unauthorized` | Not logged in, or bad credentials |
| `403 Forbidden` | Logged in but wrong role |
| `404 Not Found` | Resource (or route) not found |

---

## Authentication

Authentication is **session based**. The flow is:

1. `POST /auth/login` with email + password.
2. On success the server sets a session cookie (`crm_session`) and stores the user
   in the session.
3. Subsequent requests must send that cookie. In the browser, use
   `fetch(..., { credentials: 'include' })`. With `curl`, use a cookie jar
   (`-c cookies.txt -b cookies.txt`).
4. `POST /auth/logout` destroys the session.

There are two authenticated roles:

- **`super_admin`** — platform owner; manages clients, features, admins, and views
  inbound leads.
- **`client_admin`** — administrator of a single tenant (client); sees only their
  own client's data.

Protected route groups are guarded by the `auth` filter:

- `superadmin/*` → requires `super_admin`
- `client/*` → requires `client_admin`

A request to a protected route **without** a session returns `401`; with the
**wrong** role returns `403`.

---

## CORS

Cross-origin requests are enabled for the frontend dev origins:

```
http://localhost:3000
http://127.0.0.1:3000
```

- Credentials are allowed (`Access-Control-Allow-Credentials: true`), so the
  session cookie round-trips.
- Preflight `OPTIONS` requests are answered with `204` and the appropriate
  `Access-Control-*` headers.
- Allowed methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`.

To allow another origin, edit `backend/app/Config/Cors.php`.

---

## Errors

Validation and error responses use a consistent shape.

**Simple error** (e.g. bad credentials):

```json
{ "error": "Invalid credentials" }
```

**Validation errors** (field-level, from `400` responses) use CodeIgniter's
`messages` envelope:

```json
{
  "messages": {
    "error": "Email and password are required"
  }
}
```

or, for model validation:

```json
{
  "messages": {
    "email": "Please enter a valid email address.",
    "message": "Please enter a slightly longer message."
  }
}
```

> Clients should read `error` first, then fall back to the first value in
> `messages`.

---

## Endpoints

### Public endpoints

No authentication required. Used by the marketing site to capture leads.

---

#### `POST /contact`

Submit a "Contact us" message.

**Request body**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | yes | min 2 chars |
| `email` | string | yes | valid email |
| `company` | string | no | |
| `message` | string | yes | min 5 chars |

```json
{
  "name": "Jane Cooper",
  "email": "jane@acme.com",
  "company": "Acme Inc.",
  "message": "I would like to learn more about your CRM."
}
```

**`201 Created`**

```json
{
  "message": "Thanks for reaching out! We will get back to you shortly.",
  "id": 1
}
```

**`400 Bad Request`** — validation failed (see [Errors](#errors)).

```bash
curl -X POST http://localhost:8080/contact \
  -H "Content-Type: application/json" \
  -d '{"name":"Jane Cooper","email":"jane@acme.com","company":"Acme Inc.","message":"Tell me more."}'
```

---

#### `POST /demo-request`

Submit a "Request a demo" form.

**Request body**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | yes | min 2 chars |
| `email` | string | yes | valid email |
| `company` | string | yes | |
| `phone` | string | no | |
| `teamSize` | string | no | accepted as `teamSize` or `team_size` |
| `interest` | string | no | |
| `message` | string | no | |

```json
{
  "name": "Sam Lee",
  "email": "sam@globex.com",
  "company": "Globex",
  "phone": "+1 555 222 3333",
  "teamSize": "11-50",
  "interest": "Lead management",
  "message": "Interested in a walkthrough."
}
```

**`201 Created`**

```json
{
  "message": "Your demo request is in! A specialist will reach out within one business day.",
  "id": 1
}
```

---

### Auth endpoints

#### `POST /auth/login`

Authenticate and start a session.

**Request body**

| Field | Type | Required |
|-------|------|----------|
| `email` | string | yes |
| `password` | string | yes |

```json
{ "email": "admin@example.com", "password": "Password123!" }
```

**`200 OK`** — also sets the `crm_session` cookie.

```json
{
  "message": "Login successful",
  "user": {
    "id": 1,
    "email": "admin@example.com",
    "role": "super_admin",
    "client_id": null
  }
}
```

**`400`** — missing email/password. **`401`** — invalid credentials.

```bash
curl -c cookies.txt -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Password123!"}'
```

---

#### `POST /auth/logout`

Destroy the current session.

**`200 OK`**

```json
{ "message": "Logged out" }
```

---

#### `GET /auth/me`

Return the currently authenticated user.

**`200 OK`**

```json
{
  "user": {
    "id": 1,
    "email": "admin@example.com",
    "role": "super_admin",
    "client_id": null
  }
}
```

**`401`** — not authenticated.

---

### Super Admin endpoints

All require a `super_admin` session. Prefix: `/superadmin`.

---

#### `GET /superadmin/dashboard`

Summary counts and the full client list.

**`200 OK`**

```json
{
  "message": "Super admin dashboard",
  "stats": { "clients": 1, "client_admins": 1 },
  "clients": [
    {
      "id": "1",
      "name": "Acme Corp",
      "subdomain": "acme",
      "db_name": "client_acme",
      "db_username": "root",
      "db_password": "",
      "plan": "growth",
      "created_at": "2026-06-02 18:29:39",
      "updated_at": "2026-06-02 18:29:39"
    }
  ]
}
```

---

#### `GET /superadmin/clients`

List all tenants (newest first).

**`200 OK`**

```json
{ "clients": [ /* client objects */ ] }
```

---

#### `POST /superadmin/clients`

Create a new tenant (client).

**Request body**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | yes | min 2 chars |
| `subdomain` | string | no | |
| `db_name` | string | yes | unique, `alpha_dash` |
| `db_username` | string | yes | |
| `db_password` | string | no | |
| `plan` | string | no | `starter` \| `growth` \| `enterprise` (default `starter`) |

```json
{
  "name": "Acme Corp",
  "subdomain": "acme",
  "db_name": "client_acme",
  "db_username": "root",
  "db_password": "",
  "plan": "growth"
}
```

**`201 Created`**

```json
{ "message": "Client created", "client_id": 1 }
```

**`400`** — validation errors (e.g. duplicate `db_name`).

---

#### `GET /superadmin/clients/{id}/features`

List feature entitlements for a client.

**`200 OK`**

```json
{
  "client_id": 1,
  "features": [
    {
      "id": "1",
      "client_id": "1",
      "feature_key": "contacts",
      "enabled": "1",
      "created_at": "2026-06-02 18:29:55",
      "updated_at": "2026-06-02 18:29:55"
    }
  ]
}
```

**`404`** — client not found.

---

#### `POST /superadmin/feature-toggle`

Enable or disable a feature for a client. Inserts the row if it doesn't exist.

**Request body**

| Field | Type | Required |
|-------|------|----------|
| `client_id` | integer | yes |
| `feature_key` | string | yes |
| `enabled` | boolean | yes |

```json
{ "client_id": 1, "feature_key": "contacts", "enabled": true }
```

**`200 OK`**

```json
{ "message": "Feature updated", "feature_key": "contacts", "enabled": true }
```

**`400`** — missing fields. **`404`** — client not found.

---

#### `POST /superadmin/admins`

Create a `client_admin` user for a tenant. Password is hashed automatically.

**Request body**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `email` | string | yes | unique, valid email |
| `password` | string | yes | min 8 chars |
| `client_id` | integer | yes | existing client |

```json
{ "email": "acme.admin@example.com", "password": "ClientPass1", "client_id": 1 }
```

**`201 Created`**

```json
{ "message": "Client admin created", "user_id": 2 }
```

**`400`** — validation errors. **`404`** — client not found.

---

#### `GET /superadmin/contact-messages`

Inbox of public contact-form submissions (newest first).

**`200 OK`**

```json
{
  "contact_messages": [
    {
      "id": "1",
      "name": "Jane Cooper",
      "email": "jane@acme.com",
      "company": "Acme Inc.",
      "message": "I would like to learn more about your CRM.",
      "status": "new",
      "created_at": "2026-06-02 18:39:12",
      "updated_at": "2026-06-02 18:39:12"
    }
  ]
}
```

---

#### `GET /superadmin/demo-requests`

Inbox of public demo-request submissions (newest first).

**`200 OK`**

```json
{
  "demo_requests": [
    {
      "id": "1",
      "name": "Sam Lee",
      "email": "sam@globex.com",
      "company": "Globex",
      "phone": "+1 555 222 3333",
      "team_size": "11-50",
      "interest": "Lead management",
      "message": "Interested in a walkthrough.",
      "status": "new",
      "created_at": "2026-06-02 18:39:13",
      "updated_at": "2026-06-02 18:39:13"
    }
  ]
}
```

---

### Client Admin endpoints

All require a `client_admin` session. Prefix: `/client`.

---

#### `GET /client/dashboard`

The signed-in client admin's own tenant overview. Database credentials are
**stripped** from the response.

**`200 OK`**

```json
{
  "message": "Client dashboard",
  "client": {
    "id": "1",
    "name": "Acme Corp",
    "subdomain": "acme",
    "db_name": "client_acme",
    "plan": "growth",
    "created_at": "2026-06-02 18:29:39",
    "updated_at": "2026-06-02 18:29:39"
  },
  "features": [ /* feature objects */ ]
}
```

**`404`** — client record not found.

---

#### `GET /client/settings`

Key/value CRM settings for the signed-in client.

**`200 OK`**

```json
{ "message": "Client CRM settings", "settings": [] }
```

---

## Roles & access matrix

| Endpoint | Public | super_admin | client_admin |
|----------|:------:|:-----------:|:------------:|
| `POST /contact` | ✅ | ✅ | ✅ |
| `POST /demo-request` | ✅ | ✅ | ✅ |
| `POST /auth/login` | ✅ | ✅ | ✅ |
| `POST /auth/logout` | ✅ | ✅ | ✅ |
| `GET /auth/me` | — (401) | ✅ | ✅ |
| `GET /superadmin/*` | ❌ 401 | ✅ | ❌ 403 |
| `POST /superadmin/*` | ❌ 401 | ✅ | ❌ 403 |
| `GET /client/*` | ❌ 401 | ❌ 403 | ✅ |

---

## Data model

All tables live in the shared **`crm_main`** database. Per-tenant CRM data lives
in each client's own `client_*` database (resolved at runtime by
`ClientDatabaseService`).

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `users` | Platform users | `email`, `password` (bcrypt), `role`, `client_id` |
| `clients` | Tenants | `name`, `db_name` (unique), `db_username`, `db_password`, `plan` |
| `client_features` | Feature flags per client | `client_id`, `feature_key`, `enabled` |
| `permissions` | Role → permission map | `role`, `permission_key`, `description` |
| `settings` | Per-client config | `client_id`, `setting_key`, `setting_value` |
| `contact_messages` | Public contact inbox | `name`, `email`, `company`, `message`, `status` |
| `demo_requests` | Public demo inbox | `name`, `email`, `company`, `phone`, `team_size`, `interest`, `message`, `status` |

Schema: `backend/database/schema.sql` · Seed: `backend/database/seed.sql`

### Default super admin (from seed)

```
Email:    admin@example.com
Password: Password123!
```

---

## Quick start (curl)

```bash
# 1. Public lead capture
curl -X POST http://localhost:8080/contact \
  -H "Content-Type: application/json" \
  -d '{"name":"Jane","email":"jane@acme.com","message":"Hello there"}'

# 2. Log in (save the session cookie)
curl -c cookies.txt -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Password123!"}'

# 3. Use the session to call a protected endpoint
curl -b cookies.txt http://localhost:8080/superadmin/dashboard

# 4. Read the lead inbox
curl -b cookies.txt http://localhost:8080/superadmin/contact-messages
```
