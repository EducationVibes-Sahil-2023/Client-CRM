  # Call Tracking

Ingest phone-call logs from a client's external call-logging app (an IVR system
or a device dialer) into the CRM, match each call to a lead and staff member by
phone number, and surface them in the dashboard.

Where calls show:

- **Lead → Calls tab** — every call matched to that lead, newest first.
- **Leads table → "Last call" column** — each lead's latest *connected* call.
- **Call Tracking page** (`/client/calls`) — all calls with type/source/connected
  filters, search and per-user column layout.

---

## How a call is stored

Calls live in each client's own database (table `calls`, mirrored via
`TenantSchema`). Key fields:

| Field | Meaning |
|-------|---------|
| `contact` | the other party's number, normalised to the **last 10 digits** |
| `staff_contact` | the staff member's number (last 10 digits) |
| `lead_id` | auto-matched: a lead whose `phone`/`alt_phone` equals `contact` |
| `staff_id` | matched by `staff_contact`; falls back to the posting staff |
| `source` | `ivr` or `phone` |
| `type` | `incoming`, `outgoing` or `missed` |
| `duration` | seconds |
| `connected` | `1` when answered (`duration > 0`), else `0` |
| `call_start` / `call_end` | `YYYY-MM-DD HH:MM:SS` |

A lead's **"Last call"** is the most recent call to its number with
`connected = 1`.

---

## Authentication

There are **two** ways to authenticate, depending on the app:

### Option 1 — API key (recommended for unattended dialer / IVR servers)

Use the public endpoint **`POST /calls/ingest`** with a per-client **API key**.
No login, no session — ideal for a device or server that can't hold a cookie.

- The admin finds the key in the CRM under **Call Tracker → Connect app**
  (`GET /client/call-api-key`), and can rotate it there if it leaks.
- The key both authenticates the request and selects which client's database the
  calls land in. Send it as **any** of:
  - header `X-API-Key: <key>` (preferred), or
  - header `Authorization: Bearer <key>`, or
  - an `api_key` field in the body.
- The payload is identical to `/client/call-logs` (both shapes below), but on this
  endpoint **every field is mandatory** (see [Call fields](#call-fields)).
- There is no "posting staff", so a call's `staff_id` is set **only** when its
  `staff_contact` matches a staff member's phone; otherwise it's left null.

```http
POST /calls/ingest
Content-Type: application/json
X-API-Key: <your-client-api-key>

{ "calls": [ {
  "contact": "+919876543210", "staff_contact": "9000000000",
  "type": "outgoing", "source": "phone", "status": "ANSWERED",
  "duration": 87, "call_start": "2026-06-30 10:15:00", "call_end": "2026-06-30 10:16:27"
} ] }
```

Errors: `401` (missing/invalid key), `403` (workspace suspended/inactive),
`422` (missing/invalid field). Success returns `{ "status": 1, "inserted": <n> }`.

### Option 2 — staff session (the original app)

The external app signs in as a **staff** user and reuses the session cookie:

1. `POST /auth/login` with the staff member's `email` + `password`
   (send/store the returned `ci_session` cookie).
2. `POST /client/call-logs` with that cookie.

The client (tenant DB) and the default staff id are taken from the session — no
client id is sent in the payload.

Both endpoints share the same parsing + lead/staff matching + insert logic
(`App\Libraries\CallIngestService`), so calls are stored identically either way.

---

## Quick start — how to call the API

This is the **recommended** path for an external calling app (no login needed).

### Step 1 — get your API key

In the CRM, sign in as an admin and open **Call Tracker → Connect app**. Copy the
**API key** and the **endpoint** shown there. (You can rotate the key on that screen
if it's ever exposed — the old key stops working immediately.)

### Step 2 — pick the URL

| Environment | URL |
|---|---|
| Production | `https://client.educationvibes.in/api/calls/ingest` |
| Local dev  | `http://localhost:8080/calls/ingest` |

Always use **POST** with `Content-Type: application/json`.

### Step 3 — send the calls

Send a `calls` array (1 or many). **Every field is required** for every call:

```bash
curl -X POST "https://client.educationvibes.in/api/calls/ingest" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "calls": [
      {
        "contact": "+91 98765 43210",
        "staff_contact": "9000000000",
        "type": "outgoing",
        "source": "phone",
        "status": "ANSWERED",
        "duration": 87,
        "call_start": "2026-06-30 10:15:00",
        "call_end": "2026-06-30 10:16:27"
      }
    ]
  }'
```

### Call fields

**All fields are mandatory** for every call. A request with any missing or invalid
field is rejected (`422`) with a message naming the call number and field
(e.g. `Call #1: 'call_end' is required …`).

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `contact` | **Yes** | string | The lead's number. Any format — only the **last 10 digits** are kept and used to match the lead. |
| `staff_contact` | **Yes** | string | The agent's number. If it matches a staff member's phone, the call is attributed to that staff (`staff_id`). |
| `type` | **Yes** | `incoming` \| `outgoing` \| `missed` | Must be one of these. |
| `source` | **Yes** | `ivr` \| `phone` | Where the call ran. Must be one of these. |
| `status` | **Yes** | string | Free text (≤60 chars), e.g. `ANSWERED`, `MISSED`, `Busy`. Shown as-is. |
| `duration` | **Yes** | integer | Seconds (0 or more). `connected` is set automatically (`true` when duration > 0). |
| `call_start` | **Yes** | string \| number | `YYYY-MM-DD HH:MM:SS` or a UNIX timestamp. Stored in **IST (UTC+5:30)** — see below. |
| `call_end` | **Yes** | string \| number | Same formats as `call_start`. |

#### Date & time (IST)

Call times are stored as **Indian Standard Time, UTC+5:30** wall-clock:

- A **UNIX timestamp** is an absolute instant (epoch/UTC) and is converted to IST —
  e.g. `1751256900` (04:15 UTC) is stored as `2025-06-30 09:45:00`.
- A **`YYYY-MM-DD HH:MM:SS` string** is taken as IST exactly as given (no shifting),
  so the local time your dialer recorded is stored unchanged.

> Already using the old app? You can post the legacy `call_data` shape to this same
> endpoint instead — see [Legacy `call_data`](#b-legacy-call_data-drop-in-for-the-existing-app) below.
> Each workspace has its **own** API key, so the key both authenticates and routes
> the calls to the right client's database.

### Responses

```jsonc
// 200 — success
{ "status": 1, "message": "Call data saved.", "inserted": 2 }

// 200 — nothing to import (empty calls array)
{ "status": 1, "message": "No calls to import.", "inserted": 0 }
```

| Status | Meaning | Fix |
|--------|---------|-----|
| `401` | Missing or invalid API key | Send the key in `X-API-Key` (or `Authorization: Bearer`); check it wasn't rotated. |
| `403` | Workspace suspended / inactive | Contact the CRM admin. |
| `422` | Missing/invalid field, or no `calls` in the body | The message names the call number + field; send all fields for every call. |
| `500` | Server couldn't store the calls | Retry later; the response is logged server-side. |

### More language examples

Node.js (fetch):

```js
await fetch("https://client.educationvibes.in/api/calls/ingest", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-Key": process.env.CRM_CALL_KEY },
  body: JSON.stringify({ calls: [{
    contact: "9876543210", staff_contact: "9000000000", type: "outgoing",
    source: "phone", status: "ANSWERED", duration: 87,
    call_start: "2026-06-30 10:15:00", call_end: "2026-06-30 10:16:27",
  }] }),
});
```

PHP (cURL):

```php
$ch = curl_init("https://client.educationvibes.in/api/calls/ingest");
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'X-API-Key: ' . $key],
    CURLOPT_POSTFIELDS     => json_encode(['calls' => [
        [
            'contact' => '9876543210', 'staff_contact' => '9000000000',
            'type' => 'outgoing', 'source' => 'phone', 'status' => 'ANSWERED',
            'duration' => 87, 'call_start' => '2026-06-30 10:15:00', 'call_end' => '2026-06-30 10:16:27',
        ],
    ]]),
]);
$response = curl_exec($ch);
```

### Good to know

- **Batch** as many calls as you like in one `calls` array — one request inserts them all.
- **Unmatched numbers still save:** if `contact` doesn't match any lead, the call is
  stored with no lead link and shows as *Unmatched* in the call log.
- **No de-duplication:** posting the same call twice creates two rows. Send each call
  once (e.g. track which were already synced on your side).
- **Keep the key secret** — it grants write access to your call data. Rotate it on the
  Connect app screen if it leaks.

---

## `POST /client/call-logs`

Accepts **two payload shapes**. Both upsert into the caller's client DB and
return how many rows were inserted.

### A. Clean JSON (recommended)

```http
POST /client/call-logs
Content-Type: application/json
Cookie: ci_session=…

{
  "calls": [
    {
      "contact": "+91 98765 43210",   // lead number (any format; last 10 used)
      "staff_contact": "9000000000",  // optional; matches a staff by phone
      "type": "outgoing",             // incoming | outgoing | missed
      "source": "phone",              // ivr | phone
      "status": "ANSWERED",           // free text, shown as-is
      "duration": 87,                  // seconds
      "call_start": "2026-06-08 10:15:00", // or a UNIX timestamp
      "call_end": "2026-06-08 10:16:27"
    }
  ]
}
```

### B. Legacy `call_data` (drop-in for the existing app)

The original app posts a `call_data` form field holding a JSON string with a
`type` (1 = IVR/single, 2 = phone/bulk) and `formData`:

```http
POST /client/call-logs
Content-Type: application/json
Cookie: ci_session=…

{
  "call_data": "{\"type\":2,\"formData\":[{\"phonenumber\":\"+919876543210\",\"callassignee\":\"9000000000\",\"calls_type\":2,\"call_duration\":87,\"form-cf-13\":\"ANSWERED\",\"startdate_time\":\"2026-06-08 10:15:00\",\"enddate_time\":\"2026-06-08 10:16:27\"}]}"
}
```

Legacy mapping:

| Legacy | Maps to |
|--------|---------|
| `type` 1 / 2 | `source` `ivr` / `phone` |
| `calls_type` 1 / 2 / 3,5 | `type` `incoming` / `outgoing` / `missed` |
| `form-cf-13` | `call_status` |
| `phonenumber` | `contact` |
| `callassignee` | `staff_contact` |
| `call_duration` | `duration` |
| `startdate_time` / `enddate_time` | `call_start` / `call_end` |

A single legacy call may send `formData` as an object instead of a list — both
are accepted.

### Response

```json
{ "status": 1, "message": "Call data saved.", "inserted": 1 }
```

Invalid/empty payloads return `{ "status": 1, "inserted": 0 }` (nothing to do)
or `422` with a validation message when no `calls`/`call_data` is present.

---

## `GET /client/calls`

Returns all active (non-deleted) calls for the client, newest first, enriched
with `lead_name` and `staff_name`. Staff users see only their own calls (and
their reports'); client admins see everything.

```json
{
  "calls": [
    {
      "id": 12, "lead_id": 3, "lead_name": "Asha Rao",
      "staff_id": 5, "staff_name": "Vikram", "staff_contact": "9000000000",
      "contact": "9876543210", "type": "outgoing", "source": "phone",
      "call_status": "ANSWERED", "duration": 87, "connected": true,
      "call_start": "2026-06-08 10:15:00", "call_end": "2026-06-08 10:16:27",
      "created_at": "2026-06-08 10:16:30"
    }
  ]
}
```

Calls also appear inside `GET /client/leads/{id}/detail` under a `calls` array,
and each lead in `GET /client/leads` carries a `last_call_at` timestamp.
