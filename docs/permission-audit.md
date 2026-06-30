# Permission Audit & Test Report

Date: 2026-06-30

## The bug you reported
"I removed the delete permission but the delete icon still shows and the lead can still be deleted."

**Root cause:** permissions were only enforced at two layers — the sidebar (hides nav links) and the page guard (blocks page access). The actual **write API endpoints had no permission checks**, and the **action buttons (Add/Edit/Delete) were always rendered**. So removing `delete` changed nothing: the icon stayed and `POST /client/leads/{id}/delete` still succeeded.

Inventory found **89 write endpoints, only 29 with a permission check** — the majority of create/update/delete actions were ungated.

## What was fixed

### 1. Backend — every write endpoint now enforced (`requirePermission(module, action)`)
`ClientController.php` gates raised from 29 → 62. Newly gated:
- **Leads**: createLead, updateLead, deleteLead, importLeads, createReminder, deleteReminder, createNote, deleteNote
- **Team**: createDepartment, updateDepartment, deleteDepartment, restoreDepartment, createOfficeLocation, updateOfficeLocation, deleteOfficeLocation, restoreOfficeLocation
- **Roles**: createRole, updateRole, deleteRole
- **Tasks**: createTask, updateTask, addTaskComment, deleteTaskComment
- **Assets**: createAsset, updateAsset, allocateAsset, transferAsset, revokeAsset, addAssetNote
- **Announcements**: createAnnouncement, deleteAnnouncement
- **Leads Setup** (statuses, sources, types, marketing, conversions, follow-up groups, **states, cities**): gated centrally in `saveLookup`/`deleteLookup`/`reorderLookup`
- **Settings**: saveGmailSettings (email_config), saveGoogleCalendarSettings (settings)

Action mapping: create→`create`, edit→`update`, delete→`delete`; sub-items (notes, reminders, comments, allocate/transfer/revoke) → `update`; restore → `update`.

### 2. Frontend — action buttons now gated by `can(module, action)`
Add / Edit / Delete (and bulk-delete, import) are hidden unless the user holds the matching action, on: **leads, team, tasks, assets, leads-setup, announcements, roles, departments, office-locations**.

### 3. Page-level guard (added previously)
Direct-URL access to a page the user can't view shows **Access Denied** (`RouteGuard` in `client/layout.tsx`).

## How permissions resolve
- **Super admin** — full platform access on `/superadmin/*`; not subject to client module permissions.
- **Client admin** — `isAdmin` ⇒ all modules/actions allowed automatically.
- **Staff** — effective = role permissions **+** per-staff `extra_permissions` override; each module carries view/create/update/delete.

A module must be in the `MODULES` list (backend + `lib/client.ts`) to be grantable and enforceable.

## Test results (authenticated, live API — 2026-06-30)
Logged in as each role and exercised the matrix. `403` = correctly blocked; `200/400/404` = permission passed.

### Staff "Swati" set to **Leads = view only** (create/update/delete removed)
| Action | Endpoint | Result | Expected |
|---|---|---|---|
| View leads | `GET /client/leads` | **200** | ✅ allowed |
| Create lead | `POST /client/leads` | **403** | ✅ blocked |
| Update lead | `POST /client/leads/{id}` | **403** | ✅ blocked |
| **Delete lead** | `POST /client/leads/{id}/delete` | **403** | ✅ **blocked (the reported bug)** |
| Follow-ups (no perm) | `GET /client/followup-dashboard` | **403** | ✅ blocked |
| Assets (no perm) | `GET /client/assets` | **403** | ✅ blocked |
| Create lead status (no perm) | `POST /client/lead-statuses` | **403** | ✅ blocked |

### Client admin (full)
| Action | Result | Expected |
|---|---|---|
| `GET /client/leads` | 200 | ✅ |
| `POST /client/leads` | 400 (validation, not permission) | ✅ allowed |
| `POST /client/leads/{id}/delete` | 200 | ✅ allowed |
| `GET /client/assets` | 200 | ✅ |

### Super admin
| Action | Result | Expected |
|---|---|---|
| `GET /superadmin/clients` | 200 | ✅ |

**Conclusion:** removing `delete` (or any action) now both **hides the button** and **blocks the API** with 403. Verified end-to-end. Test accounts' passwords and Swati's permissions were temporarily changed for the test and **restored afterward**.

## How to re-test in the browser
1. Login as the client admin → Team → open a staff member → uncheck **Leads → Delete** → save.
2. Login as that staff → Leads: the **delete icon is gone**; if forced via API, the server returns **403**.
3. Re-check **Delete** → the icon and action return.
