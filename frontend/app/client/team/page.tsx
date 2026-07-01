"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  clientUpload,
  createStaff,
  deleteStaff,
  getLookups,
  getRoles,
  getStaff,
  getStaffLeadLoad,
  reassignStaffLeads,
  updateStaff,
  getFormSetup,
  getLeadsSetup,
  MODULES,
  type LookupItem,
  type Perm,
  type Role,
  type Staff,
  type CustomField,
  type LeadStatus,
  type LeadSource,
  type LeadType,
} from "../../lib/client";
import { API_URL } from "../../lib/api";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import { useClient } from "../ClientContext";
import { CustomFieldInputs, customFieldErrors } from "../CustomFields";
import { Badge, Drawer, Modal, PageHeader, SkeletonText } from "../../admin/ui";
import { Avatar, AvatarCell, DataTable, EntityCard, IconButton, RowMenu, type Column, type RowAction } from "../../admin/DataTable";
import { MultiSelect, SearchSelect, type SelectOption } from "../../admin/SearchSelect";
import { FilterRail, FilterToggle, FilterLabel, filterRailPad } from "../FilterRail";
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

// A member is either normal "staff" or a reference-scoped "agent". The type is
// derived from whether a reference is set — an agent MUST have a reference (that
// reference gates which leads they see); staff never carry one.
type StaffType = "staff" | "agent";

interface Draft {
  id?: number;
  name: string; email: string; phone: string; alt_phone: string; emp_code: string; designation: string;
  avatar: string; role_id: string; reports_to: string; lead_type_id: string; reference_id: string;
  staff_type: StaffType;
  office_location_id: string; department_id: string;
  facebook: string; linkedin: string; skype: string; email_signature: string;
  password: string; status: string;
  permissions: Record<string, Perm>;
  custom: Record<string, string>;
}
const blank: Draft = {
  name: "", email: "", phone: "", alt_phone: "", emp_code: "", designation: "", avatar: "",
  role_id: "", reports_to: "", lead_type_id: "", reference_id: "", staff_type: "staff", office_location_id: "", department_id: "",
  facebook: "", linkedin: "", skype: "", email_signature: "", password: "", status: "active",
  permissions: {}, custom: {},
};
const num = (v: string) => (v ? Number(v) : 0);

// ---- Directory filters (a draft the user edits + the applied set that filters
// the table; they sync only on "Apply", mirroring the Leads section). ----
interface TeamFilters {
  role: string[];        // role_id
  department: string[];  // department_id
  office: string[];      // office_location_id
  leadType: string[];    // lead_type_id
  reportsTo: string[];   // reporting person (staff id)
  status: string[];      // "active" | "inactive"
}
const BLANK_TEAM_FILTERS: TeamFilters = { role: [], department: [], office: [], leadType: [], reportsTo: [], status: [] };

const STATUS_OPTIONS: SelectOption[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const teamFiltersActive = (f: TeamFilters): boolean =>
  !!(f.role.length || f.department.length || f.office.length || f.leadType.length || f.reportsTo.length || f.status.length);
// Active filter-group count — drives the badge on the Filters button.
const countTeamFilters = (f: TeamFilters): number =>
  [f.role, f.department, f.office, f.leadType, f.reportsTo, f.status].filter((g) => g.length).length;
// Whether a staff member matches a multi-select group (empty group = no constraint).
const inGroup = (group: string[], value: number | null | undefined): boolean =>
  group.length === 0 || (value != null && group.includes(String(value)));

function toDraft(s: Staff): Draft {
  return {
    id: s.id, name: s.name, email: s.email ?? "", phone: s.phone ?? "", alt_phone: s.alt_phone ?? "",
    emp_code: s.emp_code ?? "", designation: s.designation ?? "", avatar: s.avatar ?? "", role_id: s.role_id ? String(s.role_id) : "",
    reports_to: s.reports_to ? String(s.reports_to) : "", lead_type_id: s.lead_type_id ? String(s.lead_type_id) : "", reference_id: s.reference_id ? String(s.reference_id) : "",
    staff_type: s.reference_id ? "agent" : "staff",
    office_location_id: s.office_location_id ? String(s.office_location_id) : "", department_id: s.department_id ? String(s.department_id) : "",
    facebook: s.facebook ?? "", linkedin: s.linkedin ?? "", skype: s.skype ?? "", email_signature: s.email_signature ?? "",
    password: "", status: s.status, permissions: s.extra_permissions ?? {}, custom: { ...(s.custom_fields ?? {}) },
  };
}

export default function TeamPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { limitFor, defaultPageSize, isAdmin, can } = useClient();
  const staffLimit = limitFor("team"); // null = unlimited
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [lookups, setLookups] = useState<Record<string, LookupItem[]>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [modules, setModules] = useState<string[]>([...MODULES]);
  const [showPerms, setShowPerms] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [emailCreds, setEmailCreds] = useState(true); // email login details to new staff
  const [selected, setSelected] = useState<Staff | null>(null);
  // Reassign-before-delete dialog: the member being deleted + their lead count.
  const [delTarget, setDelTarget] = useState<{ staff: Staff; count: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Transfer config (phase 1 of the dialog) and whether the transfer is done (phase 2).
  const [xMode, setXMode] = useState<"single" | "robin">("single");
  const [xTargets, setXTargets] = useState<string[]>([]);
  const [xDate, setXDate] = useState(true);
  const [xNotify, setXNotify] = useState(true);
  const [xStatus, setXStatus] = useState("");
  const [xType, setXType] = useState("");
  const [xSource, setXSource] = useState("");
  const [xferred, setXferred] = useState(false);
  const [processing, setProcessing] = useState(false);
  // Lead status/source/type options for the optional "change on transfer" pickers.
  const [leadStatuses, setLeadStatuses] = useState<LeadStatus[]>([]);
  const [leadSources, setLeadSources] = useState<LeadSource[]>([]);
  const [leadTypes, setLeadTypes] = useState<LeadType[]>([]);
  const [view, setView] = useState<"directory" | "hierarchy">("directory");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [staffCustomFields, setStaffCustomFields] = useState<CustomField[]>([]);
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  useEffect(() => { getFormSetup("staff").then((d) => setStaffCustomFields(d.custom_fields)).catch(() => {}); }, []);

  // Directory filters — `filters` is the draft being edited in the drawer;
  // `applied` is what actually filters the table (synced on Apply).
  const [filters, setFilters] = useState<TeamFilters>(BLANK_TEAM_FILTERS);
  const [applied, setApplied] = useState<TeamFilters>(BLANK_TEAM_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const setFilter = <K extends keyof TeamFilters>(key: K, value: TeamFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  function load() {
    getStaff().then((d) => { setStaff(d.staff); if (d.modules?.length) setModules(d.modules); }).catch(() => setStaff([]));
    getRoles().then((d) => setRoles(d.roles)).catch(() => {});
    getLookups().then((d) => setLookups(d.lookups)).catch(() => {});
  }
  useEffect(load, []);

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
    // emp_code is auto-generated by the server — not entered or required here.
    if (!d.email.trim()) e.email = "Email is required (used to sign in).";
    else if (!isEmail(d.email)) e.email = "Enter a valid email address.";
    if (d.phone && !isPhone(d.phone)) e.phone = "Enter a valid phone number.";
    if (d.alt_phone && !isPhone(d.alt_phone)) e.alt_phone = "Enter a valid phone number.";
    if (!d.id && d.password.length < 8) e.password = "Set a login password (min 8 characters).";
    else if (d.password && d.password.length < 8) e.password = "Password must be at least 8 characters.";
    if (d.staff_type === "agent" && !d.reference_id) e.reference_id = "An agent must be tied to a reference.";
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
    const ce = customFieldErrors(staffCustomFields, draft.custom);
    setCustomErrors(ce);
    if (!validate(draft) || Object.keys(ce).length) { toast.warning("Please fix the highlighted fields."); return; }
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
        // Only agents carry a reference; staff never do (it gates lead visibility).
        reference_id: draft.staff_type === "agent" ? num(draft.reference_id) : 0,
        office_location_id: num(draft.office_location_id), department_id: num(draft.department_id),
        facebook: draft.facebook, linkedin: draft.linkedin, skype: draft.skype,
        email_signature: draft.email_signature, password: draft.password, status: draft.status,
        permissions: permsToSave, custom_fields: draft.custom,
        email_credentials: emailCreds,
      };
      if (draft.id) { await updateStaff(draft.id, body); toast.success("Staff updated."); }
      else {
        const r = await createStaff(body) as { email_sent?: boolean; email_error?: string | null };
        const note = emailCreds ? (r.email_sent ? " Credentials emailed." : ` Credentials not emailed (${r.email_error ?? "email not configured"}).`) : "";
        toast.success("Staff added." + note);
      }
      setDraft(null); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
    finally { setSaving(false); }
  }

  const permCount = (p: Record<string, Perm>) =>
    Object.values(p).reduce((n, x) => n + ACTIONS.filter((a) => x[a]).length, 0);

  // Deleting a member must never orphan their leads. Check their live lead load
  // first: none → plain confirm + delete; some → open the reassign dialog so the
  // admin must hand the leads to another member before the delete goes through.
  async function remove(s: Staff) {
    let count = 0;
    try { count = (await getStaffLeadLoad(s.id)).assigned_leads; } catch { /* fall through to plain delete */ }
    if (count > 0) {
      // Reset the transfer config and open the (two-phase) reassign dialog.
      setXMode("single"); setXTargets([]); setXDate(true); setXNotify(true); setXStatus(""); setXType(""); setXSource("");
      setXferred(false); setDelTarget({ staff: s, count });
      if (!leadStatuses.length && !leadSources.length && !leadTypes.length) {
        getLeadsSetup().then((d) => {
          setLeadStatuses((d.lead_statuses ?? []).filter((st) => (st.parent_ids?.length ?? 0) === 0 && !st.parent_id));
          setLeadSources(d.lead_sources ?? []);
          setLeadTypes(d.lead_types ?? []);
        }).catch(() => {});
      }
      return;
    }
    const ok = await confirm({ danger: true, title: `Remove ${s.name}?`, message: <>This archives the team member (kept for audit) and can be restored later — no data is destroyed.</>, confirmLabel: "Yes, remove", cancelLabel: "No, keep" });
    if (!ok) return;
    try { await deleteStaff(s.id); toast.success("Staff removed."); load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not remove"); }
  }

  // Phase 1 — transfer the departing member's leads (single or round-robin),
  // optionally changing the assigned date / status / type / source.
  async function doTransfer() {
    if (!delTarget) return;
    const targets = (xMode === "single" ? xTargets.slice(0, 1) : xTargets).map(Number).filter(Boolean);
    if (!targets.length) { toast.warning("Pick at least one member to transfer the leads to."); return; }
    setProcessing(true);
    try {
      const r = await reassignStaffLeads(delTarget.staff.id, {
        targets,
        update_assigned_date: xDate,
        notify: xNotify,
        status_id: xStatus ? Number(xStatus) : undefined,
        lead_type_id: xType ? Number(xType) : undefined,
        source_id: xSource ? Number(xSource) : undefined,
      });
      toast.success(`Transferred ${r.moved} lead${r.moved === 1 ? "" : "s"}.`);
      setXferred(true);
      setDelTarget((t) => t && { ...t, count: 0 });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not transfer leads.");
    } finally {
      setProcessing(false);
    }
  }

  // Phase 2 — the leads are clear, so delete the member.
  async function doDelete() {
    if (!delTarget) return;
    setDeleting(true);
    try {
      await deleteStaff(delTarget.staff.id);
      toast.success(`${delTarget.staff.name} removed.`);
      setDelTarget(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove");
    } finally {
      setDeleting(false);
    }
  }

  const avatarUrl = (s: Staff) => (s.avatar ? `${API_URL}${s.avatar}` : undefined);

  const actions = (s: Staff): RowAction<Staff>[] => [
    { label: "View", icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" /></svg>, onClick: () => setSelected(s) },
    ...(can("team", "update") ? [{ label: "Edit", icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>, onClick: () => openDraft(toDraft(s)) }] : []),
    ...(can("team", "delete") ? [{ label: "Remove", danger: true, icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>, onClick: () => remove(s) }] : []),
  ];

  const columns: Column<Staff>[] = [
    { key: "name", header: "Name", lockVisible: true, render: (s) => <AvatarCell name={s.name} image={avatarUrl(s)} subtitle={s.emp_code ? `${s.emp_code} · ${s.email ?? ""}` : s.email ?? "—"} color="from-emerald-500 to-teal-600" /> },
    { key: "designation", header: "Designation", render: (s) => <span className="text-slate-600">{s.designation || "—"}</span> },
    { key: "role", header: "Role", sortAccessor: (s) => s.role_name, render: (s) => s.role_name ? <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">{s.role_name}</span> : <span className="text-slate-400">—</span> },
    { key: "phone", header: "Phone", render: (s) => <span className="text-slate-600">{s.phone || "—"}</span> },
    { key: "department", header: "Department", render: (s) => <span className="text-slate-600">{s.department || "—"}</span> },
    { key: "office", header: "Office location", sortAccessor: (s) => s.office_name, render: (s) => <span className="text-slate-600">{s.office_name || "—"}</span> },
    { key: "reference", header: "Reference", sortAccessor: (s) => s.reference_name, render: (s) => <span className="text-slate-600">{s.reference_name || "—"}</span> },
    { key: "user_type", header: "User type", sortAccessor: (s) => (s.reference_id ? "Agent" : "Staff"), render: (s) => (
      s.reference_id
        ? <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700">Agent</span>
        : <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">Staff</span>
    ) },
    { key: "lead_type", header: "Lead type", render: (s) => <span className="text-slate-600">{s.lead_type || "—"}</span> },
    { key: "manager", header: "Reports to", sortAccessor: (s) => s.manager_name, render: (s) => <span className="text-slate-600">{s.manager_name || "—"}</span> },
    { key: "status", header: "Status", render: (s) => <Badge value={s.status} /> },
  ];

  // Filter option lists, built from roles, lookups and the staff directory.
  const opt = (items: { id: number; name: string }[]): SelectOption[] => items.map((i) => ({ value: String(i.id), label: i.name }));
  const roleOptions = useMemo(() => opt(roles), [roles]);
  const deptOptions = useMemo(() => opt(lookups.department ?? []), [lookups]);
  const officeOptions = useMemo(() => opt(lookups.office_location ?? []), [lookups]);
  const leadTypeOptions = useMemo(() => opt(lookups.lead_type ?? []), [lookups]);
  const managerOptions = useMemo(() => opt((staff ?? []).map((s) => ({ id: s.id, name: s.name }))), [staff]);

  // Rows after applying the directory filters (the DataTable's own search runs
  // on top of these). Hierarchy view is unfiltered.
  const filteredStaff = useMemo(() => {
    const list = staff ?? [];
    if (!teamFiltersActive(applied)) return list;
    return list.filter((s) =>
      inGroup(applied.role, s.role_id)
      && inGroup(applied.department, s.department_id)
      && inGroup(applied.office, s.office_location_id)
      && inGroup(applied.leadType, s.lead_type_id)
      && inGroup(applied.reportsTo, s.reports_to)
      && (applied.status.length === 0 || applied.status.includes(s.status)),
    );
  }, [staff, applied]);

  const appliedCount = useMemo(() => countTeamFilters(applied), [applied]);
  const draftDirty = useMemo(() => JSON.stringify(filters) !== JSON.stringify(applied), [filters, applied]);

  function applyFilters() { setApplied(filters); }
  function clearFilters() { setFilters(BLANK_TEAM_FILTERS); setApplied(BLANK_TEAM_FILTERS); }

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
            {can("team", "create") && (
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
            )}
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
            <SkeletonText lines={6} className="py-2" />
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
      <>
      {/* Filters open a full-height right rail (shared FilterRail); the table
          search stays instant. Nothing applies until “Apply”. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterToggle open={filterOpen} count={appliedCount} onClick={() => { if (!filterOpen) setFilters(applied); setFilterOpen((o) => !o); }} />
        <div className="flex items-center gap-3">
          <p className="text-xs text-slate-400">
            {filteredStaff.length} of {staff?.length ?? 0} staff{teamFiltersActive(applied) ? " match your filters" : ""}.
          </p>
          {teamFiltersActive(applied) && (
            <button onClick={clearFilters} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Clear filters</button>
          )}
        </div>
      </div>

      <FilterRail
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        dirty={draftDirty}
        onReset={() => setFilters(BLANK_TEAM_FILTERS)}
        resetDisabled={!teamFiltersActive(filters)}
        onApply={applyFilters}
        applyDisabled={!draftDirty}
      >
        <label className="flex flex-col gap-1">
          <FilterLabel>Role</FilterLabel>
          <MultiSelect ariaLabel="Filter by role" value={filters.role} onChange={(v) => setFilter("role", v)} options={roleOptions} placeholder="All roles" searchPlaceholder="Search role…" />
        </label>
        <label className="flex flex-col gap-1">
          <FilterLabel>Department</FilterLabel>
          <MultiSelect ariaLabel="Filter by department" value={filters.department} onChange={(v) => setFilter("department", v)} options={deptOptions} placeholder="All departments" searchPlaceholder="Search department…" />
        </label>
        <label className="flex flex-col gap-1">
          <FilterLabel>Office</FilterLabel>
          <MultiSelect ariaLabel="Filter by office" value={filters.office} onChange={(v) => setFilter("office", v)} options={officeOptions} placeholder="All offices" searchPlaceholder="Search office…" />
        </label>
        <label className="flex flex-col gap-1">
          <FilterLabel>Lead type</FilterLabel>
          <MultiSelect ariaLabel="Filter by lead type" value={filters.leadType} onChange={(v) => setFilter("leadType", v)} options={leadTypeOptions} placeholder="All types" searchPlaceholder="Search type…" />
        </label>
        <label className="flex flex-col gap-1">
          <FilterLabel>Reports to</FilterLabel>
          <MultiSelect ariaLabel="Filter by reporting person" value={filters.reportsTo} onChange={(v) => setFilter("reportsTo", v)} options={managerOptions} placeholder="Anyone" searchPlaceholder="Search team…" />
        </label>
        <label className="flex flex-col gap-1">
          <FilterLabel>Status</FilterLabel>
          <MultiSelect ariaLabel="Filter by status" value={filters.status} onChange={(v) => setFilter("status", v)} options={STATUS_OPTIONS} placeholder="Any status" searchPlaceholder="Search status…" />
        </label>
      </FilterRail>

      <div className={filterRailPad(filterOpen)}>
      <DataTable
        tableKey="team"
        canRenameColumns={isAdmin}
        paginate
        infiniteScroll
        defaultPageSize={defaultPageSize}
        columns={columns}
        rows={filteredStaff}
        getKey={(s) => s.id}
        loading={staff === null}
        emptyTitle={teamFiltersActive(applied) ? "No matching staff" : "No staff yet"}
        emptyHint={teamFiltersActive(applied) ? "Try clearing or widening your filters." : "Add your first team member."}
        onRowClick={(s) => setSelected(s)}
        quickActions={(s) => (
          <>
            <IconButton title="View details" onClick={() => setSelected(s)}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" /></svg>
            </IconButton>
            {can("team", "update") && (
              <IconButton title="Edit" onClick={() => openDraft(toDraft(s))}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </IconButton>
            )}
            {can("team", "delete") && (
              <IconButton title="Remove" danger onClick={() => remove(s)}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </IconButton>
            )}
          </>
        )}
        searchKeys={(s) => [s.name, s.email, s.role_name, s.department, s.office_name, s.emp_code]}
        searchPlaceholder="Search staff…"
        initialSearch={typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("q") ?? "" : ""}
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
      </div>
      </>
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
                <FieldRow label="Employee code" hint="Generated automatically — can't be edited.">
                  <input className={`${inputCls()} cursor-not-allowed bg-slate-50 text-slate-500`} value={draft.id ? draft.emp_code : "Auto-generated on save"} readOnly disabled />
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
                  <SearchSelect ariaLabel="Role" value={draft.role_id} onChange={onRoleChange} placeholder="— Select —" searchPlaceholder="Search roles…"
                    options={[{ value: "", label: "— None —" }, ...roles.map((o) => ({ value: String(o.id), label: o.name }))]} />
                </FieldRow>
                <FieldRow label="Reporting person">
                  <SearchSelect ariaLabel="Reporting person" value={draft.reports_to} onChange={set("reports_to")} placeholder="— Select —" searchPlaceholder="Search team…"
                    options={[{ value: "", label: "— None —" }, ...(staff ?? []).filter((s) => s.id !== draft.id).map((o) => ({ value: String(o.id), label: o.name }))]} />
                </FieldRow>
                <FieldRow label="Lead type">
                  <SearchSelect ariaLabel="Lead type" value={draft.lead_type_id} onChange={set("lead_type_id")} placeholder="— Select —" searchPlaceholder="Search…"
                    options={[{ value: "", label: "— None —" }, ...(lookups.lead_type ?? []).map((o) => ({ value: String(o.id), label: o.name }))]} />
                </FieldRow>
                <FieldRow label="User type" hint="Agents see only their reference's leads (no assignment); staff see their assigned leads." full>
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-sm font-medium">
                    {(["staff", "agent"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setDraft((d) => d && ({ ...d, staff_type: t, reference_id: t === "staff" ? "" : d.reference_id }))}
                        className={`rounded-md px-4 py-1.5 capitalize transition ${draft.staff_type === t ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </FieldRow>
                {draft.staff_type === "agent" && (
                  <FieldRow label="Reference" required error={errors.reference_id} hint="This agent will only see leads under this reference." full>
                    <SearchSelect ariaLabel="Reference" value={draft.reference_id} onChange={set("reference_id")} placeholder="— Select a reference —" searchPlaceholder="Search references…"
                      options={[{ value: "", label: "— Select a reference —" }, ...(lookups.reference ?? []).map((o) => ({ value: String(o.id), label: o.name }))]} />
                  </FieldRow>
                )}
                <FieldRow label="Office location">
                  <SearchSelect ariaLabel="Office location" value={draft.office_location_id} onChange={set("office_location_id")} placeholder="— Select —" searchPlaceholder="Search offices…"
                    options={[{ value: "", label: "— None —" }, ...(lookups.office_location ?? []).map((o) => ({ value: String(o.id), label: o.name }))]} />
                </FieldRow>
                <FieldRow label="Department">
                  <SearchSelect ariaLabel="Department" value={draft.department_id} onChange={set("department_id")} placeholder="— Select —" searchPlaceholder="Search departments…"
                    options={[{ value: "", label: "— None —" }, ...(lookups.department ?? []).map((o) => ({ value: String(o.id), label: o.name }))]} />
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
              {!draft.id && (
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={emailCreds} onChange={(e) => setEmailCreds(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                  Email login details to this member
                  <span className="text-xs text-slate-400">(needs Email Setup configured)</span>
                </label>
              )}
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

            {staffCustomFields.length > 0 && (
              <section>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Additional fields</h4>
                <CustomFieldInputs fields={staffCustomFields} values={draft.custom} onChange={(k, v) => setDraft((d) => d && { ...d, custom: { ...d.custom, [k]: v } })} errors={customErrors} className="" />
              </section>
            )}
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

      {/* Reassign-before-delete: transfer the member's leads first, then delete. */}
      <Modal open={!!delTarget} onClose={() => !(processing || deleting) && setDelTarget(null)} title={xferred ? "Delete team member" : "Transfer leads, then delete"}>
        {delTarget && (() => {
          // Agents (reference-scoped) are never lead assignees, so they can't
          // receive a departing member's leads.
          const targetOpts: SelectOption[] = (staff ?? [])
            .filter((m) => m.id !== delTarget.staff.id && (m.status ?? "active") === "active" && !m.reference_id)
            .map((m) => ({ value: String(m.id), label: m.name }));
          const statusOpts: SelectOption[] = [{ value: "", label: "— Don't change —" }, ...leadStatuses.map((s) => ({ value: String(s.id), label: s.name }))];
          const typeOpts: SelectOption[] = [{ value: "", label: "— Don't change —" }, ...leadTypes.map((t) => ({ value: String(t.id), label: t.name }))];
          const sourceOpts: SelectOption[] = [{ value: "", label: "— Don't change —" }, ...leadSources.map((s) => ({ value: String(s.id), label: s.name }))];

          // Phase 2 — leads already transferred; confirm the actual deletion.
          if (xferred) {
            return (
              <div className="space-y-4">
                <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
                  <svg className="mt-0.5 h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <span>Leads transferred — <b>{delTarget.staff.name}</b> no longer holds any leads.</span>
                </div>
                <p className="text-sm text-slate-600">Remove this member now? This archives them (kept for audit) and can be restored later.</p>
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setDelTarget(null)} disabled={deleting} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
                  <button onClick={doDelete} disabled={deleting} className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">{deleting ? "Removing…" : "Delete member"}</button>
                </div>
              </div>
            );
          }

          // Phase 1 — configure the transfer.
          return (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                <b>{delTarget.staff.name}</b> has <b>{delTarget.count}</b> lead{delTarget.count === 1 ? "" : "s"} assigned. Transfer {delTarget.count === 1 ? "it" : "them"} to other member{delTarget.count === 1 ? "" : "(s)"} first, then delete.
              </p>

              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium">
                {([["single", "Single member"], ["robin", "Round-robin"]] as const).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => { setXMode(v); setXTargets([]); }} className={`rounded-md px-3 py-1.5 transition ${xMode === v ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{l}</button>
                ))}
              </div>

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-600">{xMode === "single" ? "Transfer to" : "Distribute across"}</span>
                {xMode === "single"
                  ? <SearchSelect ariaLabel="Transfer to" value={xTargets[0] ?? ""} onChange={(v) => setXTargets(v ? [v] : [])} options={targetOpts} placeholder="— Select a member —" searchPlaceholder="Search team…" />
                  : <MultiSelect ariaLabel="Distribute across" value={xTargets} onChange={setXTargets} options={targetOpts} placeholder="Select members…" searchPlaceholder="Search team…" />}
                {xMode === "robin" && <span className="mt-1 block text-[11px] text-slate-400">Leads are split evenly (round-robin) across the selected members.</span>}
              </label>

              <div className="space-y-2.5 rounded-xl border border-slate-200 p-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={xDate} onChange={(e) => setXDate(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /> Update assignment date to today</label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={xNotify} onChange={(e) => setXNotify(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /> Notify the new assignee(s) — in-app &amp; web push</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <label className="block text-xs"><span className="mb-1 block font-medium text-slate-500">Change status</span><SearchSelect ariaLabel="Change status" value={xStatus} onChange={setXStatus} options={statusOpts} placeholder="Don't change" searchPlaceholder="Search…" /></label>
                  <label className="block text-xs"><span className="mb-1 block font-medium text-slate-500">Change type</span><SearchSelect ariaLabel="Change type" value={xType} onChange={setXType} options={typeOpts} placeholder="Don't change" searchPlaceholder="Search…" /></label>
                  <label className="block text-xs"><span className="mb-1 block font-medium text-slate-500">Change source</span><SearchSelect ariaLabel="Change source" value={xSource} onChange={setXSource} options={sourceOpts} placeholder="Don't change" searchPlaceholder="Search…" /></label>
                </div>
                <p className="text-[11px] text-slate-400">Status / type / source are only changed when you pick one — otherwise they stay as-is.</p>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setDelTarget(null)} disabled={processing} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
                <button onClick={doTransfer} disabled={processing || !xTargets.length} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{processing ? "Transferring…" : `Transfer ${delTarget.count} lead${delTarget.count === 1 ? "" : "s"}`}</button>
              </div>
            </div>
          );
        })()}
      </Modal>
    </>
  );
}
