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

The ingest endpoint is part of the authenticated **client** API. The external
app signs in as a **staff** user and reuses the session cookie:

1. `POST /auth/login` with the staff member's `email` + `password`
   (send/store the returned `ci_session` cookie).
2. `POST /client/call-logs` with that cookie.

The client (tenant DB) and the default staff id are taken from the session — no
client id is sent in the payload.

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
