"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MODULES,
  createRole,
  deleteRole,
  getRoles,
  updateRole,
  type Perm,
  type Role,
} from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import { Card, EmptyState, Drawer, PageHeader, Spinner } from "../../admin/ui";

const label = (m: string) => m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const ACTIONS: (keyof Perm)[] = ["view", "create", "update", "delete"];
const emptyPerm = (): Perm => ({ view: false, create: false, update: false, delete: false });
const fullPerm = (): Perm => ({ view: true, create: true, update: true, delete: true });
const viewPerm = (): Perm => ({ view: true, create: false, update: false, delete: false });

type Mode = "create" | "edit" | "view";

interface Draft {
  id?: number;
  name: string;
  description: string;
  permissions: Record<string, Perm>;
}

function buildPerms(fn: (m: string) => Perm): Record<string, Perm> {
  const p: Record<string, Perm> = {};
  MODULES.forEach((m) => (p[m] = fn(m)));
  return p;
}
function blankDraft(): Draft {
  return { name: "", description: "", permissions: buildPerms(() => emptyPerm()) };
}

// Quick-start templates so admins can spin up common roles in one click.
const TEMPLATES: { key: string; name: string; desc: string; perms: () => Record<string, Perm> }[] = [
  { key: "manager", name: "Manager", desc: "Full access to run the team", perms: () => buildPerms(() => fullPerm()) },
  {
    key: "sales", name: "Sales Rep", desc: "Owns leads & tasks, reads the rest",
    perms: () => buildPerms((m) => (["leads", "tasks"].includes(m) ? fullPerm() : ["dashboard", "announcements", "chat", "notifications", "team"].includes(m) ? viewPerm() : emptyPerm())),
  },
  { key: "viewer", name: "Viewer", desc: "Read-only across modules", perms: () => buildPerms(() => viewPerm()) },
];

function IconBtn({ title, onClick, icon, danger }: { title: string; onClick: () => void; icon: string; danger?: boolean }) {
  return (
    <button onClick={onClick} title={title} className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${danger ? "text-slate-400 hover:bg-rose-50 hover:text-rose-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"}`}>
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

const ICON = {
  view: "M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z M12 15a3 3 0 100-6 3 3 0 000 6z",
  edit: "M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z",
  trash: "M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
};

export default function RolesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [mode, setMode] = useState<Mode>("create");
  const [saving, setSaving] = useState(false);

  function load() {
    getRoles().then((d) => setRoles(d.roles)).catch(() => setRoles([]));
  }
  useEffect(load, []);

  function openCreate() {
    setMode("create");
    setDraft(blankDraft());
  }
  function openRole(r: Role, m: Mode) {
    setMode(m);
    setDraft({ id: r.id, name: r.name, description: r.description ?? "", permissions: buildPerms((mod) => ({ ...emptyPerm(), ...r.permissions[mod] })) });
  }

  const readOnly = mode === "view";

  function toggle(module: string, action: keyof Perm) {
    if (readOnly) return;
    setDraft((d) => d && ({ ...d, permissions: { ...d.permissions, [module]: { ...d.permissions[module], [action]: !d.permissions[module][action] } } }));
  }
  function toggleRow(module: string, value: boolean) {
    if (readOnly) return;
    setDraft((d) => d && ({ ...d, permissions: { ...d.permissions, [module]: { view: value, create: value, update: value, delete: value } } }));
  }
  function applyTemplate(t: (typeof TEMPLATES)[number]) {
    setDraft((d) => d && ({ ...d, name: d.name.trim() || t.name, description: d.description.trim() || t.desc, permissions: t.perms() }));
  }

  async function save() {
    if (!draft) return;
    if (draft.name.trim().length < 2) { toast.warning("Enter a role name."); return; }
    setSaving(true);
    try {
      const body = { name: draft.name, description: draft.description, permissions: draft.permissions };
      if (draft.id) { await updateRole(draft.id, body); toast.success("Role updated."); }
      else { await createRole(body); toast.success("Role created."); }
      setDraft(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save role");
    } finally {
      setSaving(false);
    }
  }

  async function remove(r: Role) {
    const assigned = r.staff_count ?? 0;

    // Blocked: system role — informational popup, with a Cancel option to dismiss.
    if (r.is_system) {
      await confirm({
        title: "Can't delete this role",
        message: <><b>{r.name}</b> is a system role and can&apos;t be deleted. You can still open it to view or edit its permissions.</>,
        confirmLabel: "Got it",
        cancelLabel: "Cancel",
      });
      return;
    }

    // Blocked: members assigned — popup explaining why, with a shortcut to fix it.
    if (assigned > 0) {
      const goToTeam = await confirm({
        title: "Can't delete this role",
        message: (
          <>
            You haven&apos;t deleted <b>{r.name}</b> — {assigned} team member{assigned === 1 ? " is" : "s are"} still
            under this role. Reassign or remove them in <b>Team</b> first, then delete the role.
          </>
        ),
        confirmLabel: "Go to Team",
        cancelLabel: "Cancel",
      });
      if (goToTeam) router.push("/client/team");
      return;
    }

    // Safe to delete — destructive confirmation.
    const ok = await confirm({
      danger: true,
      title: `Delete "${r.name}"?`,
      message: <>This hides the role from your workspace. It&apos;s a soft delete — the role and its permissions are kept and can be restored later.</>,
      confirmLabel: "Yes, delete",
      cancelLabel: "No, keep it",
    });
    if (!ok) return;
    try { await deleteRole(r.id); toast.success("Role deleted."); load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete"); }
  }

  function permCount(r: Role) {
    return Object.values(r.permissions).reduce((n, p) => n + ACTIONS.filter((a) => p[a]).length, 0);
  }
  const activeModules = (r: Role) => Object.entries(r.permissions).filter(([, p]) => ACTIONS.some((a) => p[a])).map(([m]) => m);

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        subtitle="Create roles and control what each can view, create, update and delete"
        action={<button onClick={openCreate} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"><svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>New role</button>}
      />

      {roles === null ? (
        <Card><Spinner /></Card>
      ) : roles.length === 0 ? (
        <Card><EmptyState title="No roles yet" hint="Create your first role to assign permissions to staff." /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {roles.map((r) => {
            const mods = activeModules(r);
            const members = r.staff_count ?? 0;
            return (
              <div key={r.id} className="group relative flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={ICON.shield} strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold text-slate-900">{r.name}</h3>
                      {!!r.is_system && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">SYSTEM</span>}
                    </div>
                    <p className="truncate text-xs text-slate-400">{r.description || "No description"}</p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                    <div className="text-slate-400">Members</div>
                    <div className="font-semibold text-slate-700">{members}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                    <div className="text-slate-400">Permissions</div>
                    <div className="font-semibold text-slate-700">{permCount(r)}</div>
                  </div>
                </div>

                <div className="mt-3 flex min-h-[1.5rem] flex-wrap gap-1">
                  {mods.slice(0, 6).map((m) => <span key={m} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{label(m)}</span>)}
                  {mods.length > 6 && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-400">+{mods.length - 6}</span>}
                  {mods.length === 0 && <span className="text-[11px] text-slate-300">No permissions granted</span>}
                </div>

                <div className="mt-3 flex items-center gap-1 border-t border-slate-100 pt-3">
                  {members > 0 ? (
                    <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      {members} member{members === 1 ? "" : "s"}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-400">Unassigned</span>
                  )}
                  <div className="ml-auto flex items-center gap-0.5">
                    <IconBtn title="View" onClick={() => openRole(r, "view")} icon={ICON.view} />
                    <IconBtn title="Edit" onClick={() => openRole(r, "edit")} icon={ICON.edit} />
                    <IconBtn title="Delete" danger onClick={() => remove(r)} icon={ICON.trash} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / edit / view — right-side drawer */}
      <Drawer
        open={!!draft}
        onClose={() => !saving && setDraft(null)}
        title={mode === "create" ? "New role" : mode === "edit" ? "Edit role" : draft?.name || "Role details"}
        subtitle={mode === "view" ? "Read-only — what this role can access" : "Name the role and set its permission matrix"}
        width="max-w-2xl"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setDraft(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">{readOnly ? "Close" : "Cancel"}</button>
            {!readOnly && (
              <button onClick={save} disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? "Saving…" : "Save role"}</button>
            )}
          </div>
        }
      >
        {draft && (
          <div className="space-y-4">
            {mode === "create" && (
              <div>
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">Quick start</span>
                <div className="grid grid-cols-3 gap-2">
                  {TEMPLATES.map((t) => (
                    <button key={t.key} type="button" onClick={() => applyTemplate(t)} title={t.desc} className="rounded-lg border border-slate-200 px-2 py-2 text-center text-xs font-semibold text-slate-600 transition hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700">
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <input value={draft.name} disabled={readOnly} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Role name *" className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15 disabled:bg-slate-50 disabled:text-slate-500" />
              <input value={draft.description} disabled={readOnly} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Description" className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15 disabled:bg-slate-50 disabled:text-slate-500" />
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Module</th>
                    {ACTIONS.map((a) => <th key={a} className="px-2 py-2 text-center font-medium">{a}</th>)}
                    <th className="px-2 py-2 text-center font-medium">All</th>
                  </tr>
                </thead>
                <tbody>
                  {MODULES.map((m) => {
                    const p = draft.permissions[m];
                    const all = ACTIONS.every((a) => p[a]);
                    return (
                      <tr key={m} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-medium text-slate-700">{label(m)}</td>
                        {ACTIONS.map((a) => (
                          <td key={a} className="px-2 py-2 text-center">
                            <input type="checkbox" disabled={readOnly} checked={p[a]} onChange={() => toggle(m, a)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-60" />
                          </td>
                        ))}
                        <td className="px-2 py-2 text-center">
                          <input type="checkbox" disabled={readOnly} checked={all} onChange={(e) => toggleRow(m, e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-60" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
