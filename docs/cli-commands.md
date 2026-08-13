# CLI / Spark commands (sync, ingest & maintenance)

All commands run from the backend directory:

```bash
cd /var/www/crm/backend        # production
# cd c:\Users\sahil\OneDrive\Desktop\crm\backend   # local (Windows)
php spark list                  # list every available command
```

Client **#1** = `crm_education_vibes`. Most commands take `--client=ID` to scope to one tenant.

---

## Sync & ingest — run on a schedule (cron)

| Command | What it does | Suggested cron |
|---|---|---|
| `php spark fb:poll` | Pull new Facebook Lead Ads leads for every client and ingest them. Backfill/safety-net alongside the real-time webhook (idempotent on `leadgen_id`). | `*/5 * * * *` |
| `php spark sheets:sync` | Sync every client's connected Google Sheets into leads (create/update + write back "CRM Status"). | `*/5 * * * *` |
| `php spark backup:run [--force] [--main-only]` | Run scheduled DB backups to `writable/backups` when due. `--force` ignores the schedule; `--main-only` skips tenant DBs. | `0 2 * * *` |
| `php spark leadtransfer:auto [--client=ID] [--dry-run] [--force]` | Auto-transfer stale leads to another counsellor per each client's admin rules (Auto Lead Transfer page). Moves leads matching: assigned N+ days ago, (optional) created N+ days ago, dialled fewer than M times by the assigned rep, (optional) at most X activity updates, in a selected status, transferred fewer than K times. Skips clients who haven't enabled it (`--force` overrides). | `0 6 * * *` |

Example crontab lines:

```cron
*/5 * * * *  cd /var/www/crm/backend && php spark fb:poll          >> writable/logs/fb-poll.log 2>&1
*/5 * * * *  cd /var/www/crm/backend && php spark sheets:sync       >> writable/logs/sheets-sync.log 2>&1
0   2 * * *  cd /var/www/crm/backend && php spark backup:run        >> writable/logs/backup.log 2>&1
0   6 * * *  cd /var/www/crm/backend && php spark leadtransfer:auto >> writable/logs/lead-transfer.log 2>&1
```

---

## Data sync after a manual/bulk import — run by hand

### `php spark leads:resync`
Recompute the **derived** lead fields the app normally maintains, so leads/calls/reminders
added straight to the DB (bulk import, manual SQL) display + link correctly.
**Recompute-only — never deletes; updates only rows that need it. Safe on production.**

```bash
php spark leads:resync --client=1 --dry-run   # preview (writes nothing)
php spark leads:resync --client=1             # apply to one client
php spark leads:resync                         # all clients
```

Fixes, per client:
- `calls.lead_id` — link each call to its lead by matching `calls.contact` → `leads.phone`
  (exact match; leads store the **last 10 digits**, so imported calls must be the same format).
- `leads.follow_date` — date of each lead's latest reminder (only leads that have reminders).
- `leads.reference_id` — linked from `reference_name` → the matching Reference row.
- `leads.updated_at` — bumped to the newest note/reminder/call on the lead.
- first-response SLA — assignment → first connected call by the assignee.

> **Run this after every bulk import of leads and/or calls** so calls attach to leads and
> follow-ups/last-updated are correct.

---

## Schema & deployment

| Command | When | Notes |
|---|---|---|
| `php spark db:upgrade` | **Every production update** | Apply new migrations + sync tenant DBs. Additive, never removes data. **This is the prod update command.** |
| `php spark tenants:sync` | After adding a tenant table/column | Applies the tenant schema to every client DB (create tables / add columns). |
| `php spark db:setup [--fresh] [--force]` | First-time / local setup only | Creates + loads schema + migrates + seeds main DB and syncs tenants. **NEVER run `--fresh` on production — it wipes data.** |
| `php spark push:keys` | Once, when enabling Web Push | Generate the VAPID public/private key pair. |
| `php spark secondary:check` | Diagnostics | Check the read-only Applicant/secondary DB (config, connection, tables). |

---

## One-off migrations (main DB → tenant DBs)

Used when moving data out of the shared main DB into per-client DBs.

```bash
php spark tenants:migrate-data       # copy existing client data into each client DB
php spark tenants:migrate-activity   # copy each client's activity_logs into its tenant DB
```

---

## Seed / dev only — do NOT run on production

| Command | Purpose |
|---|---|
| `php spark team:seed [clientId]` | Seed 20 demo staff with a reporting hierarchy. |
| `php spark team:assign [clientId]` | Assign varied departments/offices/roles across the team. |
| `php spark calls:seed [--force]` | Insert sample call-tracking rows into each client DB. |
| `php spark tmp:seed-calls [--purge]` | Insert marked test calls for one lead (`--purge` removes them). |

---

### Quick reference — "I just imported data, what do I run?"

1. Imported **leads and/or calls** → `php spark leads:resync --client=<id>` (dry-run first).
2. Added a **new table/column** in a migration → `php spark db:upgrade` (prod) or `tenants:sync`.
3. Facebook / Google Sheets not appearing → confirm the cron jobs above are installed, or run
   `php spark fb:poll` / `php spark sheets:sync` once by hand.
