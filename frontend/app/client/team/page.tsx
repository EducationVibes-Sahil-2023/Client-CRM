"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  clientUpload,
  createStaff,
  deleteStaff,
  getLookups,
  getRoles,
  getStaff,
  getStaffLeads,
  updateStaff,
  MODULES,
  type LookupItem,
  type Perm,
  type Role,
  type Staff,
  type StaffLeads,
  type StaffLeadBrief,
} from "../../lib/client";
import { API_URL } from "../../lib/api";
import { useToast } from "../../components/toast/ToastProvider";
import { useClient } from "../ClientContext";
import { Badge, Drawer, PageHeader } from "../../admin/ui";
import { Avatar, AvatarCell, DataTable, EntityCard, IconButton, RowMenu, type Column, type RowAction } from "../../admin/DataTable";
import { FieldRow, inputCls, isEmail, isPhone } from "../../admin/clients/formKit";
import RichTextEditor from "../../admin/RichTextEditor";

const ACTIONS: (keyof Perm)[] = ["view", "create", "update", "delete"];
const emptyPerm = (): Perm => ({ view: false, create: false, update: false, delete: false });
const moduleLabel = (m: string) => m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const clonePerms = (p: Record<string, Perm>): Record<string, Perm> =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { ...v }]));
// Stable key of the "true" (module,action) flags — used to compare two matrices.
const permsKey = (p: Record<string, Perm>): string =>
  Object.entries(p)
    .map(([m, v]) => `${m}:${ACTIONS.filter((a) => v[a]).join("")}`)
    .filter((s) => !s.endsWith(":"))
    .sort()
    .join("|");
const permsEqual = (a: Record<string, Perm>, b: Record<string, Perm>) => permsKey(a) === permsKey(b);

interface Draft {
  id?: number;
  name: string; email: string; phone: string; alt_phone: string; emp_code: string; designation: string;
  avatar: string; role_id: string; reports_to: string; lead_type_id: string;
  office_location_id: string; department_id: string;
  facebook: string; linkedin: string; skype: string; email_signature: string;
  password: string; status: string;
  permissions: Record<string, Perm>;
}
const blank: Draft = {
  name: "", email: "", phone: "", alt_phone: "", emp_code: "", designation: "", avatar: "",
  role_id: "", reports_to: "", lead_type_id: "", office_location_id: "", department_id: "",
  facebook: "", linkedin: "", skype: "", email_signature: "", password: "", status: "active",
  permissions: {},
};
const num = (v: string) => (v ? Number(v) : 0);

function toDraft(s: Staff): Draft {
  return {
    id: s.id, name: s.name, email: s.email ?? "", phone: s.phone ?? "", alt_phone: s.alt_phone ?? "",
    emp_code: s.emp_code ?? "", designation: s.designation ?? "", avatar: s.avatar ?? "", role_id: s.role_id ? String(s.role_id) : "",
    reports_to: s.reports_to ? String(s.reports_to) : "", lead_type_id: s.lead_type_id ? String(s.lead_type_id) : "",
    office_location_id: s.office_location_id ? String(s.office_location_id) : "", department_id: s.department_id ? String(s.department_id) : "",
    facebook: s.facebook ?? "", linkedin: s.linkedin ?? "", skype: s.skype ?? "", email_signature: s.email_signature ?? "",
    password: "", status: s.status, permissions: s.extra_permissions ?? {},
  };
}

export default function TeamPage() {
  const toast = useToast();
  const { limitFor } = useClient();
  const staffLimit = limitFor("team"); // null = unlimited
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [lookups, setLookups] = useState<Record<string, LookupItem[]>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [modules, setModules] = useState<string[]>([...MODULES]);
  const [showPerms, setShowPerms] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [selected, setSelected] = useState<Staff | null>(null);
  const [staffLeads, setStaffLeads] = useState<StaffLeads | null>(null);
  const [leadsTab, setLeadsTab] = useState<"assigned" | "created" | "team">("assigned");
  const [view, setView] = useState<"directory" | "hierarchy">("directory");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    getStaff().then((d) => { setStaff(d.staff); if (d.modules?.length) setModules(d.modules); }).catch(() => setStaff([]));
    getRoles().then((d) => setRoles(d.roles)).catch(() => {});
    getLookups().then((d) => setLookups(d.lookups)).catch(() => {});
  }
  useEffect(load, []);

  // Load the selected member's leads (assigned / created / their team's) when
  // the details drawer opens.
  useEffect(() => {
    if (!selected) { setStaffLeads(null); return; }
    setStaffLeads(null);
    setLeadsTab("assigned");
    getStaffLeads(selected.id).then(setStaffLeads).catch(() => setStaffLeads(null));
  }, [selected]);

  const set = (k: keyof Draft) => (v: string) => {
    setDraft((d) => d && { ...d, [k]: v });
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  function openDraft(d: Draft) {
    // Pre-fill the permission matrix from the role when this staff has no saved
    // override yet, so it always shows a sensible starting point.
    let perms = d.permissions;
    if (Object.keys(perms).length === 0 && d.role_id) {
      const role = roles.find((r) => String(r.id) === d.role_id);
      if (role) perms = clonePerms(role.permissions);
    }
    setErrors({}); setShowPerms(false); setShowPwd(false);
    setDraft({ ...d, permissions: perms });
  }

  // Selecting a role auto-fills the permission matrix with that role's grants.
  const onRoleChange = (roleId: string) => {
    const role = roles.find((r) => String(r.id) === roleId);
    setDraft((d) => d && ({ ...d, role_id: roleId, permissions: role ? clonePerms(role.permissions) : d.permissions }));
  };

  // Toggle one permission cell, or a whole module row.
  const togglePerm = (module: string, action: keyof Perm) =>
    setDraft((d) => d && ({ ...d, permissions: { ...d.permissions, [module]: { ...(d.permissions[module] ?? emptyPerm()), [action]: !(d.permissions[module]?.[action]) } } }));
  const toggleRow = (module: string, value: boolean) =>
    setDraft((d) => d && ({ ...d, permissions: { ...d.permissions, [module]: { view: value, create: value, update: value, delete: value } } }));

  function validate(d: Draft): boolean {
    const e: Partial<Record<keyof Draft, string>> = {};
    if (d.name.trim().length < 2) e.name = "Full name is required (min 2 characters).";
    if (!d.emp_code.trim()) e.emp_code = "Employee code is required.";
    if (!d.email.trim()) e.email = "Email is required (used to sign in).";
    else if (!isEmail(d.email)) e.email = "Enter a valid email address.";
    if (d.phone && !isPhone(d.phone)) e.phone = "Enter a valid phone number.";
    if (d.alt_phone && !isPhone(d.alt_phone)) e.alt_phone = "Enter a valid phone number.";
    if (!d.id && d.password.length < 8) e.password = "Set a login password (min 8 characters).";
    else if (d.password && d.password.length < 8) e.password = "Password must be at least 8 characters.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function uploadPhoto(file: File) {
    setUploading(true);
    try { const r = await clientUpload(file); setDraft((d) => d && { ...d, avatar: r.url }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Upload failed"); }
    finally { setUploading(false); }
  }

  async function save() {
    if (!draft) return;
    if (!validate(draft)) { toast.warning("Please fix the highlighted fields."); return; }
    setSaving(true);
    try {
      // Only store a per-staff override when the matrix actually differs from the
      // role; otherwise keep the staff role-linked (so role edits still flow through).
      const rolePerms = roles.find((r) => String(r.id) === draft.role_id)?.permissions ?? {};
      const permsToSave = permsEqual(draft.permissions, rolePerms) ? {} : draft.permissions;
      const body = {
        name: draft.name, email: draft.email, phone: draft.phone, alt_phone: draft.alt_phone,
        emp_code: draft.emp_code, designation: draft.designation, avatar: draft.avatar, role_id: num(draft.role_id),
        reports_to: num(draft.reports_to), lead_type_id: num(draft.lead_type_id),
        office_location_id: num(draft.office_location_id), department_id: num(draft.department_id),
        facebook: draft.facebook, linkedin: draft.linkedin, skype: draft.skype,
        email_signature: draft.email_signature, password: draft.password, status: draft.status,
        permissions: permsToSave,
      };
      if (draft.id) { await updateStaff(draft.id, body); toast.success("Staff updated."); }
      else { await createStaff(body); toast.success("Staff added."); }
      setDraft(null); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
    finally { setSaving(false); }
  }

  const permCount = (p: Record<string, Perm>) =>
    Object.values(p).reduce((n, x) => n + ACTIONS.filter((a) => x[a]).length, 0);

  async function remove(s: Staff) {
    if (!confirm(`Remove ${s.name}?`)) return;
    try { await deleteStaff(s.id); toast.success("Staff removed."); load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not remove"); }
  }

  const avatarUrl = (s: Staff) => (s.avatar ? `${API_URL}${s.avatar}` : undefined);

  const actions = (s: Staff): RowAction<Staff>[] => [
    { label: "View", icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" /></svg>, onClick: () => setSelected(s) },
    { label: "Edit", icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>, onClick: () => openDraft(toDraft(s)) },
    { label: "Remove", danger: true, icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>, onClick: () => remove(s) },
  ];

  const columns: Column<Staff>[] = [
    { key: "name", header: "Name", render: (s) => <AvatarCell name={s.name} image={avatarUrl(s)} subtitle={s.emp_code ? `${s.emp_code} · ${s.email ?? ""}` : s.email ?? "—"} color="from-emerald-500 to-teal-600" /> },
    { key: "designation", header: "Designation", render: (s) => <span className="text-slate-600">{s.designation || "—"}</span> },
    { key: "role", header: "Role", render: (s) => s.role_name ? <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">{s.role_name}</span> : <span className="text-slate-400">—</span> },
    { key: "department", header: "Department", render: (s) => <span className="text-slate-600">{s.department || "—"}</span> },
    { key: "office", header: "Office", render: (s) => <span className="text-slate-600">{s.office_name || "—"}</span> },
    { key: "manager", header: "Reports to", render: (s) => <span className="text-slate-600">{s.manager_name || "—"}</span> },
    { key: "status", header: "Status", render: (s) => <Badge value={s.status} /> },
  ];

  // Reporting tree for the single-view hierarchy: childrenOf[managerId] = reports.
  const { childrenOf, roots } = useMemo(() => {
    const list = staff ?? [];
    const byId = new Map(list.map((s) => [s.id, s]));
    const childrenOf = new Map<number, Staff[]>();
    const roots: Staff[] = [];
    for (const s of list) {
      const m = s.reports_to;
      if (m != null && byId.has(m)) (childrenOf.get(m) ?? childrenOf.set(m, []).get(m)!).push(s);
      else roots.push(s);
    }
    return { childrenOf, roots };
  }, [staff]);

  // One indented row + its sub-tree. Clicking opens that person's details.
  function HierarchyRow({ s, seen }: { s: Staff; seen: Set<number> }) {
    if (seen.has(s.id)) return null;
    const next = new Set(seen).add(s.id);
    const kids = childrenOf.get(s.id) ?? [];
    const img = avatarUrl(s);
    return (
      <li>
        <button onClick={() => setSelected(s)} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-emerald-50/60">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt="" className="h-8 w-8 flex-shrink-0 rounded-full object-cover" />
          ) : (
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-[11px] font-bold text-white">{s.name.slice(0, 1).toUpperCase()}</span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-slate-800">{s.name}</span>
            <span className="block truncate text-xs text-slate-400">{[s.designation || s.role_name, s.department].filter(Boolean).join(" · ") || "—"}</span>
          </span>
          {kids.length > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">{kids.length} report{kids.length > 1 ? "s" : ""}</span>}
        </button>
        {kids.length > 0 && (
          <ul className="ml-5 border-l border-slate-200 pl-3">
            {kids.map((k) => <HierarchyRow key={k.id} s={k} seen={next} />)}
          </ul>
        )}
      </li>
    );
  }

  const leadTabs = staffLeads
    ? [
        { key: "assigned" as const, label: "Assigned", count: staffLeads.counts.assigned },
        { key: "created" as const, label: "Created", count: staffLeads.counts.created },
        ...(staffLeads.reports_count > 0 ? [{ key: "team" as const, label: "Team", count: staffLeads.counts.team }] : []),
      ]
    : [];
  const leadRows: StaffLeadBrief[] = staffLeads ? staffLeads[leadsTab] ?? [] : [];

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Manage staff, roles, departments and the reporting hierarchy"
        action={
          <div className="flex items-center gap-3">
            {staffLimit !== null && (
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${(staff?.length ?? 0) >= staffLimit ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"}`}>
                {staff?.length ?? 0} / {staffLimit} staff
              </span>
            )}
            <button
              onClick={() => {
                if (staffLimit !== null && (staff?.length ?? 0) >= staffLimit) {
                  toast.warning(`Staff limit reached (${staffLimit}). Contact your administrator to raise it.`);
                  return;
                }
                openDraft({ ...blank });
              }}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>Add staff
            </button>
          </div>
        }
      />

      <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1">
        {(["directory", "hierarchy"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${view === v ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            {v === "directory" ? (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 3h6v4H9zM3 17h6v4H3zm12 0h6v4h-6zM12 7v4M6 17v-2a1 1 0 011-1h10a1 1 0 011 1v2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
            {v === "directory" ? "Directory" : "Hierarchy"}
          </button>
        ))}
      </div>

      {view === "hierarchy" ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {staff === null ? (
            <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
          ) : roots.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">No team members yet. Add staff and set their reporting person to see the hierarchy.</div>
          ) : (
            <>
              <p className="mb-3 text-xs text-slate-400">Reporting hierarchy — click anyone to see their details. Set the <b>Reporting person</b> on a staff member to change the lines.</p>
              <ul className="space-y-0.5">
                {roots.map((r) => <HierarchyRow key={r.id} s={r} seen={new Set()} />)}
              </ul>
            </>
          )}
        </div>
      ) : (
      <DataTable
        columns={columns}
        rows={staff ?? []}
        getKey={(s) => s.id}
        loading={staff === null}
        emptyTitle="No staff yet"
        emptyHint="Add your first team member."
        onRowClick={(s) => setSelected(s)}
        quickActions={(s) => (
          <>
            <IconButton title="View details" onClick={() => setSelected(s)}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" /></svg>
            </IconButton>
            <IconButton title="Edit" onClick={() => openDraft(toDraft(s))}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </IconButton>
            <IconButton title="Remove" danger onClick={() => remove(s)}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </IconButton>
          </>
        )}
        searchKeys={(s) => [s.name, s.email, s.role_name, s.department, s.office_name, s.emp_code]}
        searchPlaceholder="Search staff…"
        card={(s) => (
          <EntityCard
            onClick={() => openDraft(toDraft(s))}
            menu={<RowMenu actions={actions(s)} row={s} />}
            avatar={<Avatar name={s.name} image={avatarUrl(s)} size="lg" color="from-emerald-500 to-teal-600" />}
            title={s.name}
            subtitle={s.email ?? s.emp_code ?? "—"}
            badge={<Badge value={s.status} />}
            footer={
              <>
                <div className="font-medium text-slate-700">{s.designation || s.role_name || "Staff"}</div>
                {(s.department || s.office_name) && (
                  <div className="mt-0.5 text-slate-400">{[s.department, s.office_name].filter(Boolean).join(" · ")}</div>
                )}
              </>
            }
          />
        )}
      />
      )}

      <Drawer
        open={!!draft}
        onClose={() => !saving && setDraft(null)}
        title={draft?.id ? "Edit staff" : "Add staff"}
        subtitle={draft?.id ? "Update this team member's details" : "Add a member to your team"}
        width="max-w-2xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setDraft(null)} disabled={saving} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
            <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
              {saving && <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>}
              {saving ? "Saving…" : draft?.id ? "Save changes" : "Add staff"}
            </button>
          </div>
        }
      >
        {draft && (
          <div className="space-y-6">
            {/* Photo */}
            <div className="flex items-center gap-4">
              {draft.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${API_URL}${draft.avatar}`} alt="" className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-xl font-bold text-white">{(draft.name || "?").slice(0, 1).toUpperCase()}</span>
              )}
              <div>
                <button onClick={() => fileRef.current?.click()} disabled={uploading} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">{uploading ? "Uploading…" : "Upload photo"}</button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
                {draft.avatar && <button onClick={() => set("avatar")("")} className="ml-2 text-sm text-slate-400 hover:text-red-500">Remove</button>}
              </div>
            </div>

            {/* Personal */}
            <section>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Personal details</h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FieldRow label="Full name" required error={errors.name} full>
                  <input className={inputCls(errors.name)} placeholder="Jane Doe" value={draft.name} onChange={(e) => set("name")(e.target.value)} />
                </FieldRow>
                <FieldRow label="Employee code" required error={errors.emp_code}>
                  <input className={inputCls(errors.emp_code)} placeholder="EMP-001" value={draft.emp_code} onChange={(e) => set("emp_code")(e.target.value)} />
                </FieldRow>
                <FieldRow label="Email" required error={errors.email} hint="Used to sign in to the staff panel.">
                  <input className={inputCls(errors.email)} placeholder="jane@company.com" value={draft.email} onChange={(e) => set("email")(e.target.value)} />
                </FieldRow>
                <FieldRow label="Phone" error={errors.phone}>
                  <input className={inputCls(errors.phone)} placeholder="+91 98765 43210" value={draft.phone} onChange={(e) => set("phone")(e.target.value)} />
                </FieldRow>
                <FieldRow label="Alternate number" error={errors.alt_phone}>
                  <input className={inputCls(errors.alt_phone)} placeholder="Optional" value={draft.alt_phone} onChange={(e) => set("alt_phone")(e.target.value)} />
                </FieldRow>
              </div>
            </section>

            {/* Work */}
            <section>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Work</h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FieldRow label="Designation" hint="Job title, e.g. Senior Sales Executive." full>
                  <input className={inputCls()} placeholder="e.g. Sales Manager" value={draft.designation} onChange={(e) => set("designation")(e.target.value)} />
                </FieldRow>
                <FieldRow label="Role (base permissions)">
                  <select value={draft.role_id} onChange={(e) => onRoleChange(e.target.value)} className={inputCls()}>
                    <option value="">— Select —</option>
                    {roles.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </FieldRow>
                <FieldRow label="Reporting person">
                  <select value={draft.reports_to} onChange={(e) => set("reports_to")(e.target.value)} className={inputCls()}>
                    <option value="">— Select —</option>
                    {(staff ?? []).filter((s) => s.id !== draft.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </FieldRow>
                <FieldRow label="Lead type">
                  <select value={draft.lead_type_id} onChange={(e) => set("lead_type_id")(e.target.value)} className={inputCls()}>
                    <option value="">— Select —</option>
                    {(lookups.lead_type ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </FieldRow>
                <FieldRow label="Office location">
                  <select value={draft.office_location_id} onChange={(e) => set("office_location_id")(e.target.value)} className={inputCls()}>
                    <option value="">— Select —</option>
                    {(lookups.office_location ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </FieldRow>
                <FieldRow label="Department">
                  <select value={draft.department_id} onChange={(e) => set("department_id")(e.target.value)} className={inputCls()}>
                    <option value="">— Select —</option>
                    {(lookups.department ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </FieldRow>
                <FieldRow label="Status">
                  <select value={draft.status} onChange={(e) => set("status")(e.target.value)} className={inputCls()}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </FieldRow>
              </div>
              <p className="mt-1.5 text-xs text-slate-400">Manage Lead types, Offices &amp; Departments in <b>Field Setup</b>.</p>
            </section>

            {/* Login */}
            <section>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Login</h4>
              <FieldRow label="Password" required={!draft.id} error={errors.password} hint={draft.id ? "Leave blank to keep the current password." : "Minimum 8 characters."}>
                <div className="relative">
                  <input type={showPwd ? "text" : "password"} className={`${inputCls(errors.password)} pr-10`} placeholder={draft.id ? "••••••••" : "Login password"} value={draft.password} onChange={(e) => set("password")(e.target.value)} />
                  <button type="button" onClick={() => setShowPwd((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600" title={showPwd ? "Hide" : "Show"}>
                    {showPwd ? (
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.5 9.5 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 3.9M6.2 6.2A17 17 0 002 12s4 7 10 7a9.5 9.5 0 003.9-.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" /></svg>
                    )}
                  </button>
                </div>
              </FieldRow>
            </section>

            {/* Permissions (pre-filled from role, override per staff) */}
            <section>
              <button type="button" onClick={() => setShowPerms((v) => !v)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left hover:bg-slate-50">
                <span>
                  <span className="block text-sm font-semibold text-slate-800">Permissions</span>
                  <span className="block text-xs text-slate-400">Pre-filled from the role — adjust to override this staff member{permCount(draft.permissions) > 0 ? ` · ${permCount(draft.permissions)} allowed` : ""}</span>
                </span>
                <svg className={`h-5 w-5 text-slate-400 transition ${showPerms ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              {showPerms && (
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase text-slate-400">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Module</th>
                        {ACTIONS.map((a) => <th key={a} className="px-2 py-2 text-center font-medium capitalize">{a}</th>)}
                        <th className="px-2 py-2 text-center font-medium">All</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modules.map((m) => {
                        const p = draft.permissions[m] ?? emptyPerm();
                        const all = ACTIONS.every((a) => p[a]);
                        return (
                          <tr key={m} className="border-t border-slate-100">
                            <td className="px-3 py-2 font-medium text-slate-700">{moduleLabel(m)}</td>
                            {ACTIONS.map((a) => (
                              <td key={a} className="px-2 py-2 text-center">
                                <input type="checkbox" checked={!!p[a]} onChange={() => togglePerm(m, a)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                              </td>
                            ))}
                            <td className="px-2 py-2 text-center">
                              <input type="checkbox" checked={all} onChange={(e) => toggleRow(m, e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Email signature */}
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Email signature</h4>
              <RichTextEditor key={`sig-${draft.id ?? "new"}`} initialHTML={draft.email_signature} onChange={(html) => set("email_signature")(html)} placeholder="e.g. Regards, Jane — Sales" minHeight={120} />
            </section>

            {/* Social */}
            <section>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Social</h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FieldRow label="Facebook"><input className={inputCls()} placeholder="URL" value={draft.facebook} onChange={(e) => set("facebook")(e.target.value)} /></FieldRow>
                <FieldRow label="LinkedIn"><input className={inputCls()} placeholder="URL" value={draft.linkedin} onChange={(e) => set("linkedin")(e.target.value)} /></FieldRow>
                <FieldRow label="Skype"><input className={inputCls()} placeholder="Username" value={draft.skype} onChange={(e) => set("skype")(e.target.value)} /></FieldRow>
              </div>
            </section>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title="Staff details"
        subtitle={selected?.role_name ?? undefined}
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {avatarUrl(selected) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl(selected)} alt="" className="h-12 w-12 rounded-full object-cover" />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-lg font-bold text-white">{selected.name.slice(0, 1).toUpperCase()}</span>
              )}
              <div>
                <div className="font-semibold text-slate-900">{selected.name}</div>
                <div className="text-sm text-slate-500">{selected.email || "No email"}</div>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 text-sm">
              <div><dt className="text-slate-400">Emp code</dt><dd className="mt-1 font-medium text-slate-800">{selected.emp_code || "—"}</dd></div>
              <div><dt className="text-slate-400">Designation</dt><dd className="mt-1 font-medium text-slate-800">{selected.designation || "—"}</dd></div>
              <div><dt className="text-slate-400">Status</dt><dd className="mt-1"><Badge value={selected.status} /></dd></div>
              <div><dt className="text-slate-400">Phone</dt><dd className="mt-1 font-medium text-slate-800">{selected.phone || "—"}</dd></div>
              <div><dt className="text-slate-400">Alternate</dt><dd className="mt-1 font-medium text-slate-800">{selected.alt_phone || "—"}</dd></div>
              <div><dt className="text-slate-400">Role</dt><dd className="mt-1 font-medium text-slate-800">{selected.role_name || "—"}</dd></div>
              <div><dt className="text-slate-400">Reports to</dt><dd className="mt-1 font-medium text-slate-800">{selected.manager_name || "—"}</dd></div>
              <div><dt className="text-slate-400">Department</dt><dd className="mt-1 font-medium text-slate-800">{selected.department || "—"}</dd></div>
              <div><dt className="text-slate-400">Office</dt><dd className="mt-1 font-medium text-slate-800">{selected.office_name || "—"}</dd></div>
              <div><dt className="text-slate-400">Lead type</dt><dd className="mt-1 font-medium text-slate-800">{selected.lead_type || "—"}</dd></div>
            </dl>

            {/* Leads — assigned to / created by this member, plus their team's leads */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Leads</h4>
                {staffLeads && (
                  <span className="text-[11px] text-slate-400">
                    {staffLeads.reports_count > 0 ? `Manager · ${staffLeads.reports_count} report${staffLeads.reports_count > 1 ? "s" : ""}` : "Individual contributor"}
                  </span>
                )}
              </div>

              {staffLeads === null ? (
                <div className="rounded-xl border border-slate-200 py-8 text-center text-sm text-slate-400">Loading leads…</div>
              ) : (
                <>
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium">
                    {leadTabs.map((t) => (
                      <button
                        key={t.key}
                        onClick={() => setLeadsTab(t.key)}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${leadsTab === t.key ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                      >
                        {t.label}
                        <span className={`rounded-full px-1.5 text-[10px] ${leadsTab === t.key ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>{t.count}</span>
                      </button>
                    ))}
                  </div>

                  <p className="mt-2 text-[11px] text-slate-400">
                    {leadsTab === "assigned" && "Leads currently assigned to this member."}
                    {leadsTab === "created" && "Leads this member captured (created)."}
                    {leadsTab === "team" && "Leads assigned to everyone reporting up to this member."}
                  </p>

                  {leadRows.length === 0 ? (
                    <p className="mt-2 rounded-xl bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">No {leadsTab} leads.</p>
                  ) : (
                    <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">
                      {leadRows.map((l) => (
                        <li key={l.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2">
                          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-[11px] font-bold text-white">
                            {(l.name || l.phone || "?").slice(0, 1).toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-800">{l.name || "Unnamed lead"}</span>
                            <span className="block truncate text-xs text-slate-400">
                              {l.phone || "No phone"}
                              {leadsTab === "assigned" && l.creator_name ? ` · by ${l.creator_name}` : ""}
                              {leadsTab !== "assigned" && l.assigned_name ? ` · → ${l.assigned_name}` : ""}
                            </span>
                          </span>
                          {l.status && <span className="flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{l.status}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {leadRows.length >= 100 && <p className="mt-2 text-center text-[11px] text-slate-400">Showing the first 100.</p>}
                </>
              )}
            </div>

            {(selected.facebook || selected.linkedin || selected.skype) && (
              <div className="flex flex-wrap gap-2">
                {selected.facebook && <a href={selected.facebook} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Facebook</a>}
                {selected.linkedin && <a href={selected.linkedin} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">LinkedIn</a>}
                {selected.skype && <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600">Skype: {selected.skype}</span>}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => { const s = selected; setSelected(null); openDraft(toDraft(s)); }} className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-emerald-700">Edit details</button>
              <button onClick={() => { const s = selected; setSelected(null); remove(s); }} className="flex-1 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50">Remove</button>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
