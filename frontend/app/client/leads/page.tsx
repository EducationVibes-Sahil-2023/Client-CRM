"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getLeads, createLead, updateLead, deleteLead, importLeads,
  getLeadsSetup, getStaff, getMe, getLeadAnalytics,
  getLeadDetail, createLeadReminder, deleteLeadReminder, createLeadNote, deleteLeadNote,
  type Lead, type LeadStatus, type LeadSource, type LeadType, type Staff, type LeadImportResult, type LeadDetail,
  type LeadAnalytics, type LeadCount,
} from "../../lib/client";
import { requestNotifyPermission } from "../../lib/notify";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import { Card, Drawer, Modal, PageHeader, Spinner, fmtDate, timeAgo } from "../../admin/ui";
import { DataTable, IconButton, type Column } from "../../admin/DataTable";
import { DonutSelect } from "../../admin/Charts";
import { MultiSelect, type SelectOption } from "../../admin/SearchSelect";
import { DateRangeFilter, inDateRange, rangeActive, EMPTY_RANGE, type DateRange } from "../../admin/dateFilter";
import { useHiddenPrefs, VisibilityMenu } from "../../admin/tableConfig";
import { FieldRow, inputCls, isEmail } from "../../admin/clients/formKit";
import { CallActivityItem } from "../../admin/CallActivity";

const PER_PAGE = 15;

// The full leads filter set. `draft` is what the user is editing; `applied` is
// what actually filters the table — they sync only when the user clicks Apply.
interface LeadFilters {
  status: string[];
  sub: string[];
  source: string[];
  assigned: string[];   // staff ids, plus the literal "unassigned"
  leadType: string[];
  followStatus: string[]; // follow-up flag: "upcoming" | "overdue" | "done"
  reference: string;
  created: DateRange;
  assignedDate: DateRange;
  follow: DateRange;
}
const BLANK_FILTERS: LeadFilters = {
  status: [], sub: [], source: [], assigned: [], leadType: [], followStatus: [], reference: "",
  created: EMPTY_RANGE, assignedDate: EMPTY_RANGE, follow: EMPTY_RANGE,
};

// Toggleable filter controls, in display order, for the per-user "Filters" menu.
const FILTER_DEFS: { id: string; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "sub", label: "Sub status" },
  { id: "source", label: "Source" },
  { id: "assigned", label: "Assigned to" },
  { id: "leadType", label: "Lead type" },
  { id: "followStatus", label: "Follow-up status" },
  { id: "reference", label: "Reference name" },
  { id: "created", label: "Date created" },
  { id: "assignedDate", label: "Assigned date" },
  { id: "follow", label: "Follow-up date" },
];

// Options for the follow-up status multi-select filter.
const FOLLOW_STATUS_OPTIONS: SelectOption[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "overdue", label: "Overdue" },
  { value: "done", label: "Done" },
];

// The lead-summary strip (between filters and table). Each dimension maps to the
// analytics series it reads and the table filter a clicked bar drives.
type SummaryDimKey = "status" | "sub" | "type" | "source";
const SUMMARY_DIMS: { key: SummaryDimKey; label: string; filterKey: "status" | "sub" | "leadType" | "source"; pick: (a: LeadAnalytics) => LeadCount[] }[] = [
  { key: "status", label: "Status", filterKey: "status", pick: (a) => a.by_status },
  { key: "sub", label: "Sub-status", filterKey: "sub", pick: (a) => a.by_sub_status },
  { key: "type", label: "Type", filterKey: "leadType", pick: (a) => a.by_lead_type },
  { key: "source", label: "Source", filterKey: "source", pick: (a) => a.by_source },
];

const filtersActive = (f: LeadFilters): boolean =>
  !!(f.status.length || f.sub.length || f.source.length || f.assigned.length || f.leadType.length ||
    f.followStatus.length || f.reference.trim() || rangeActive(f.created) || rangeActive(f.assignedDate) || rangeActive(f.follow));

interface Draft {
  id?: number;
  name: string; phone: string; alt_phone: string;
  status_id: string; sub_status_id: string; source_id: string;
  reference_name: string; email: string;
  assigned_to: string; assigned_date: string;
  city: string; state: string; follow_date: string; created_date: string;
}
const blank: Draft = {
  name: "", phone: "", alt_phone: "", status_id: "", sub_status_id: "", source_id: "",
  reference_name: "", email: "", assigned_to: "", assigned_date: "",
  city: "", state: "", follow_date: "", created_date: "",
};

const DOT: Record<string, string> = {
  indigo: "bg-indigo-500", violet: "bg-violet-500", emerald: "bg-emerald-500", amber: "bg-amber-500",
  rose: "bg-rose-500", sky: "bg-sky-500", teal: "bg-teal-500", pink: "bg-pink-500",
  orange: "bg-orange-500", lime: "bg-lime-500", cyan: "bg-cyan-500", slate: "bg-slate-500",
};
// Colors may be a named preset or a custom hex ("#16a34a").
const isHex = (c: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
const dotClass = (c: string) => (isHex(c) ? "" : DOT[c] ?? DOT.slate);
const dotStyle = (c: string): React.CSSProperties | undefined => (isHex(c) ? { backgroundColor: c } : undefined);
// Resolve a preset/hex colour to a concrete hex value (for the SVG donut).
const HEX: Record<string, string> = {
  indigo: "#6366f1", violet: "#8b5cf6", emerald: "#10b981", amber: "#f59e0b",
  rose: "#f43f5e", sky: "#0ea5e9", teal: "#14b8a6", pink: "#ec4899",
  orange: "#f97316", lime: "#84cc16", cyan: "#06b6d4", slate: "#94a3b8",
};
const toHex = (c: string) => (isHex(c) ? c : HEX[c] ?? HEX.slate);

function toDraft(l: Lead): Draft {
  return {
    id: l.id,
    name: l.name ?? "",
    phone: l.phone ?? "",
    alt_phone: l.alt_phone ?? "",
    status_id: l.status_id ? String(l.status_id) : "",
    sub_status_id: l.sub_status_id ? String(l.sub_status_id) : "",
    source_id: l.source_id ? String(l.source_id) : "",
    reference_name: l.reference_name ?? "",
    email: l.email ?? "",
    assigned_to: l.assigned_to ? String(l.assigned_to) : "",
    assigned_date: l.assigned_date ? l.assigned_date.slice(0, 10) : "",
    city: l.city ?? "",
    state: l.state ?? "",
    follow_date: l.follow_date ? l.follow_date.slice(0, 10) : "",
    created_date: l.created_date ? l.created_date.slice(0, 10) : "",
  };
}

// ---- CSV helpers -----------------------------------------------------------

/** Parse CSV text into a grid, honouring quoted fields and embedded commas. */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* ignore */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// Map a column header to one of the keys the backend understands.
const HEADER_ALIAS: Record<string, string> = {
  name: "name",
  phone: "phone", phone_number: "phone", phonenumber: "phone", mobile: "phone",
  alternative_phone: "alt_phone", alternative_phone_number: "alt_phone", alt_phone: "alt_phone", alternate_phone: "alt_phone",
  status: "status",
  sub_status: "sub_status", substatus: "sub_status",
  reference_name: "reference_name", reference: "reference_name", ref_name: "reference_name",
  email: "email", email_address: "email",
  assigned: "assigned", assigned_to: "assigned", assignee: "assigned",
  assigned_date: "assigned_date",
  city: "city", state: "state",
  follow_date: "follow_date", followup_date: "follow_date", follow_up_date: "follow_date",
  created_date: "created_date",
};
const normHeader = (h: string) => h.trim().toLowerCase().replace(/[\s./-]+/g, "_").replace(/^_+|_+$/g, "");

const TEMPLATE_HEADERS = [
  "name", "phone", "alternative phone", "status", "sub status", "reference name",
  "email", "assigned", "assigned date", "city", "state", "follow date", "created date",
];

/** Local "YYYY-MM-DDTHH:MM" for a datetime-local input's min/value. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** Human date+time, e.g. "5 Jun 2026, 3:30 PM". */
function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s.replace(" ", "T"));
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Render a date with its time stacked underneath (date<br>time). The time line
 * only shows when the value actually carries one — DATE-only fields (stored at
 * midnight) render just the date. Returns null for empty so the cell stays blank.
 */
function stackedDateTime(value: string | null | undefined): React.ReactNode {
  if (!value) return null;
  const d = new Date(value.replace(" ", "T"));
  if (isNaN(d.getTime())) return value;
  const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
  return (
    <span className="block leading-tight text-slate-600">
      {date}
      {hasTime && (
        <>
          <br />
          <span className="text-[11px] text-slate-400">{d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
        </>
      )}
    </span>
  );
}

/** Muted, input-shaped box for read-only date fields the form can't edit. */
const readonlyCls = "w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500";

/** Default reminder datetime from a lead's follow-up date (09:00 local), else "". */
function followReminderDefault(l: Lead | null | undefined): string {
  const d = l?.follow_date?.slice(0, 10);
  return d ? `${d}T09:00` : "";
}

/** Visual style for the follow-up status flag (computed server-side). */
const FOLLOW_FLAG: Record<NonNullable<Lead["follow_flag"]>, { label: string; dot: string; pill: string }> = {
  upcoming: { label: "Upcoming", dot: "bg-orange-500", pill: "bg-orange-50 text-orange-700 ring-orange-200" },
  overdue:  { label: "Overdue",  dot: "bg-rose-500",   pill: "bg-rose-50 text-rose-700 ring-rose-200" },
  done:     { label: "Done",     dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
};
function followFlagBadge(flag: Lead["follow_flag"]): React.ReactNode {
  if (!flag) return null;
  const s = FOLLOW_FLAG[flag];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

/** Icon + colour for an activity-timeline node, keyed by its action verb. */
function activityStyle(action: string): { ring: string; dot: string; icon: string } {
  const a = action.toLowerCase();
  if (a.includes("creat")) return { ring: "border-emerald-200 bg-emerald-50", dot: "text-emerald-600", icon: "M12 5v14M5 12h14" };
  if (a.includes("assign")) return { ring: "border-teal-200 bg-teal-50", dot: "text-teal-600", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2" };
  if (a.includes("status") || a.includes("moved") || a.includes("stage")) return { ring: "border-amber-200 bg-amber-50", dot: "text-amber-600", icon: "M4 7h16M4 12h10M4 17h7M17 14l3 3-3 3" };
  if (a.includes("note")) return { ring: "border-violet-200 bg-violet-50", dot: "text-violet-600", icon: "M4 5h16v10l-4 4H4zM16 19v-4h4" };
  if (a.includes("remind")) return { ring: "border-sky-200 bg-sky-50", dot: "text-sky-600", icon: "M12 8v4l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" };
  if (a.includes("delet") || a.includes("remov")) return { ring: "border-rose-200 bg-rose-50", dot: "text-rose-600", icon: "M6 7h12M9 7V5h6v2M10 11v6M14 11v6M5 7l1 13h12l1-13" };
  return { ring: "border-indigo-200 bg-indigo-50", dot: "text-indigo-600", icon: "M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" };
}

export default function ClientLeads() {
  const toast = useToast();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false); // client admin → may rename columns
  const [leads, setLeads] = useState<Lead[]>([]);
  const [statuses, setStatuses] = useState<LeadStatus[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [leadTypes, setLeadTypes] = useState<LeadType[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);

  // Lead-volume summary (counts by dimension) shown between filters and table.
  const [analytics, setAnalytics] = useState<LeadAnalytics | null>(null);
  const [summaryDim, setSummaryDim] = useState<SummaryDimKey>("status");

  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<Lead | null>(null);

  // Lead detail (reminders, notes, activity) for the view drawer
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [viewTab, setViewTab] = useState<"info" | "reminders" | "notes" | "calls" | "activity">("info");
  const [remindAt, setRemindAt] = useState("");
  const [reminderNote, setReminderNote] = useState("");
  const [reminderErr, setReminderErr] = useState("");
  const [savingReminder, setSavingReminder] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // Search applies instantly; every other filter is staged in `filters` and
  // only takes effect (→ `appliedFilters`) when the user clicks Apply.
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<LeadFilters>(BLANK_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<LeadFilters>(BLANK_FILTERS);
  const [applying, setApplying] = useState(false);
  const [page, setPage] = useState(1);
  const filterPrefs = useHiddenPrefs("leads_filters");
  // One updater for any single filter field.
  function setFilter<K extends keyof LeadFilters>(key: K, value: LeadFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  // Bulk selection (lead ids) for batch actions like delete.
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Import modal
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<Record<string, string>[]>([]);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<LeadImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    // The summary counts load in parallel and refresh after any change.
    getLeadAnalytics().then(setAnalytics).catch(() => {});
    return Promise.all([getLeads(), getLeadsSetup(), getStaff()])
      .then(([l, setup, s]) => {
        setLeads(l.leads ?? []);
        setStatuses(setup.lead_statuses ?? []);
        setSources(setup.lead_sources ?? []);
        setLeadTypes(setup.lead_types ?? []);
        setStaff(s.staff ?? []);
      })
      .catch(() => toast.error("Could not load leads."))
      .finally(() => setLoading(false));
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { getMe().then((m) => setIsAdmin(!!m.is_admin)).catch(() => {}); }, []);

  // A sub-status has one or more parents; top-level statuses have none.
  const isSub = (s: LeadStatus) => (s.parent_ids?.length ?? 0) > 0 || !!s.parent_id;
  const topStatuses = useMemo(() => statuses.filter((s) => !isSub(s)), [statuses]);
  const statusById = useMemo(() => {
    const m: Record<number, LeadStatus> = {};
    statuses.forEach((s) => { m[s.id] = s; });
    return m;
  }, [statuses]);
  const sourceById = useMemo(() => {
    const m: Record<number, LeadSource> = {};
    sources.forEach((s) => { m[s.id] = s; });
    return m;
  }, [sources]);
  const typeById = useMemo(() => {
    const m: Record<number, LeadType> = {};
    leadTypes.forEach((t) => { m[t.id] = t; });
    return m;
  }, [leadTypes]);
  // Sub-statuses available for the chosen status — a sub-status can list this
  // status among its parents (multi-parent), with a legacy single-parent fallback.
  const draftStatusId = draft?.status_id;
  const subOptions = useMemo(
    () => (draftStatusId
      ? statuses.filter((s) => (s.parent_ids ?? []).map(String).includes(draftStatusId) || String(s.parent_id ?? "") === draftStatusId)
      : []),
    [statuses, draftStatusId],
  );

  // Sub-status options for the filter bar — narrowed to the statuses currently
  // staged in the filter draft (or all sub-statuses when none are chosen).
  const allSubStatuses = useMemo(() => statuses.filter(isSub), [statuses]);
  const filterSubStatuses = useMemo(
    () => (filters.status.length
      ? allSubStatuses.filter((s) => (s.parent_ids ?? []).map(String).some((p) => filters.status.includes(p)) || filters.status.includes(String(s.parent_id ?? "")))
      : allSubStatuses),
    [allSubStatuses, filters.status],
  );

  // Options for the searchable filter dropdowns. Status/sub-status carry a
  // colour dot so they read the same as the table chips.
  const statusDot = (color?: string) => <span className={`h-2 w-2 rounded-full ${dotClass(color ?? "slate")}`} style={dotStyle(color ?? "slate")} />;
  const statusFilterOptions = useMemo<SelectOption[]>(
    () => topStatuses.map((s) => ({ value: String(s.id), label: s.name, prefix: statusDot(s.color) })),
    [topStatuses],
  );
  const subFilterOptions = useMemo<SelectOption[]>(
    () => filterSubStatuses.map((s) => ({ value: String(s.id), label: s.name, prefix: statusDot(s.color) })),
    [filterSubStatuses],
  );
  const sourceFilterOptions = useMemo<SelectOption[]>(
    () => sources.map((s) => ({ value: String(s.id), label: s.name, prefix: statusDot(s.color) })),
    [sources],
  );
  const leadTypeFilterOptions = useMemo<SelectOption[]>(
    () => leadTypes.map((t) => ({ value: String(t.id), label: t.name, prefix: statusDot(t.color) })),
    [leadTypes],
  );
  const assignedFilterOptions = useMemo<SelectOption[]>(
    () => [{ value: "unassigned", label: "Unassigned" }, ...staff.map((s) => ({ value: String(s.id), label: s.name }))],
    [staff],
  );

  // Apply search (instant) + the applied filter set, then paginate.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const f = appliedFilters;
    const ref = f.reference.trim().toLowerCase();
    return leads.filter((l) => {
      if (q && ![l.name, l.phone, l.email, l.city, l.state, l.status, l.sub_status, l.assigned_to_name]
        .some((v) => (v ?? "").toLowerCase().includes(q))) return false;
      if (f.status.length && !f.status.includes(String(l.status_id ?? ""))) return false;
      if (f.sub.length && !f.sub.includes(String(l.sub_status_id ?? ""))) return false;
      if (f.source.length && !f.source.includes(String(l.source_id ?? ""))) return false;
      if (f.leadType.length && !f.leadType.includes(String(l.lead_type_id ?? ""))) return false;
      if (f.followStatus.length && !f.followStatus.includes(l.follow_flag ?? "")) return false;
      if (f.assigned.length) {
        const byId = l.assigned_to ? f.assigned.includes(String(l.assigned_to)) : false;
        const byUnassigned = !l.assigned_to && f.assigned.includes("unassigned");
        if (!byId && !byUnassigned) return false;
      }
      if (ref && !(l.reference_name ?? "").toLowerCase().includes(ref)) return false;
      if (!inDateRange(l.created_date ?? l.created_at, f.created)) return false;
      if (!inDateRange(l.assigned_date, f.assignedDate)) return false;
      if (!inDateRange(l.follow_date, f.follow)) return false;
      return true;
    });
  }, [leads, search, appliedFilters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  // Clamp the page in render (no effect needed) so a shrinking result set never
  // strands the user on an empty page.
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE), [filtered, safePage]);

  // Keep the selection in step with the data — drop ids that no longer exist.
  const selectedLeads = useMemo(() => leads.filter((l) => selectedIds.has(l.id)), [leads, selectedIds]);

  const draftDirty = useMemo(() => JSON.stringify(filters) !== JSON.stringify(appliedFilters), [filters, appliedFilters]);
  const activeFilters = !!search || filtersActive(appliedFilters);

  // Commit the staged filters with a brief loader so the change reads as work.
  function applyFilters() {
    setApplying(true);
    setTimeout(() => {
      setAppliedFilters(filters);
      setPage(1);
      setSelectedIds(new Set());
      setApplying(false);
    }, 250);
  }
  function clearFilters() {
    setSearch("");
    setFilters(BLANK_FILTERS);
    setAppliedFilters(BLANK_FILTERS);
    setPage(1);
    setSelectedIds(new Set());
  }
  function onSearchChange(v: string) {
    setSearch(v);
    setPage(1);
    setSelectedIds(new Set());
  }

  // ---- lead summary strip ----
  const activeDim = SUMMARY_DIMS.find((d) => d.key === summaryDim) ?? SUMMARY_DIMS[0];
  const summaryBars = analytics ? activeDim.pick(analytics) : [];
  // Donut data: resolve preset colour names to hex for the SVG slices.
  const summaryDonut = summaryBars.map((b) => ({ id: b.id, label: b.label, value: b.value, color: toHex(b.color) }));
  // The id currently filtering the table for this dimension (single-select), if any.
  const summaryActiveId = appliedFilters[activeDim.filterKey].length === 1 ? appliedFilters[activeDim.filterKey][0] : null;

  // Click a slice/legend → filter the table to that value (toggle off if active).
  function pickSummaryId(id: number) {
    const fk = activeDim.filterKey;
    const next = summaryActiveId === String(id) ? [] : [String(id)];
    setFilters((f) => ({ ...f, [fk]: next }));
    setAppliedFilters((f) => ({ ...f, [fk]: next }));
    setPage(1);
    setSelectedIds(new Set());
  }
  function clearSummary() {
    const fk = activeDim.filterKey;
    setFilters((f) => ({ ...f, [fk]: [] }));
    setAppliedFilters((f) => ({ ...f, [fk]: [] }));
    setPage(1);
    setSelectedIds(new Set());
  }

  function openNew() { setErrors({}); setDraft({ ...blank }); }
  function openEdit(l: Lead) { setErrors({}); setDraft(toDraft(l)); }

  // ---- view detail (reminders / notes / activity) ----
  const loadDetail = useCallback((id: number) => {
    setDetailLoading(true);
    return getLeadDetail(id)
      .then((d) => setDetail(d))
      .catch(() => toast.error("Could not load lead details."))
      .finally(() => setDetailLoading(false));
  }, [toast]);

  function openView(l: Lead) {
    setViewing(l); setDetail(null); setViewTab("info");
    // Pre-fill the reminder date with the lead's follow-up date (09:00).
    setRemindAt(followReminderDefault(l)); setReminderNote(""); setReminderErr(""); setNoteBody("");
    loadDetail(l.id);
  }
  function closeView() { setViewing(null); setDetail(null); }

  async function addReminder() {
    if (!viewing) return;
    setReminderErr("");
    if (!remindAt) { setReminderErr("Pick a date and time."); return; }
    if (new Date(remindAt).getTime() <= Date.now()) { setReminderErr("Choose a future date and time."); return; }
    setSavingReminder(true);
    try {
      await createLeadReminder(viewing.id, { remind_at: remindAt, note: reminderNote.trim() || undefined });
      requestNotifyPermission(); // so the alert can fire when it's due
      setRemindAt(followReminderDefault(viewing)); setReminderNote("");
      toast.success("Reminder set.");
      await loadDetail(viewing.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not set reminder.");
    } finally {
      setSavingReminder(false);
    }
  }

  async function removeReminder(rid: number) {
    const ok = await confirm({
      danger: true, title: "Delete reminder?",
      message: <>This removes the reminder (kept for audit) and can be restored later.</>,
      confirmLabel: "Yes, delete", cancelLabel: "No, keep it",
    });
    if (!ok) return;
    try {
      await deleteLeadReminder(rid);
      if (viewing) await loadDetail(viewing.id);
      toast.success("Reminder removed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove reminder.");
    }
  }

  async function addNote() {
    if (!viewing || !noteBody.trim()) return;
    setSavingNote(true);
    try {
      await createLeadNote(viewing.id, noteBody.trim());
      setNoteBody("");
      toast.success("Note added.");
      await loadDetail(viewing.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add note.");
    } finally {
      setSavingNote(false);
    }
  }

  async function removeNote(nid: number) {
    const ok = await confirm({
      danger: true, title: "Delete note?",
      message: <>This removes the note (kept for audit) and can be restored later.</>,
      confirmLabel: "Yes, delete", cancelLabel: "No, keep it",
    });
    if (!ok) return;
    try {
      await deleteLeadNote(nid);
      if (viewing) await loadDetail(viewing.id);
      toast.success("Note removed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove note.");
    }
  }

  function setField<K extends keyof Draft>(key: K) {
    return (v: string) =>
      setDraft((d) => {
        if (!d) return d;
        const next = { ...d, [key]: v };
        // Changing status invalidates a sub-status that no longer belongs to it.
        if (key === "status_id") next.sub_status_id = "";
        return next;
      });
  }

  async function save() {
    if (!draft) return;
    const e: Record<string, string> = {};
    const digits = draft.phone.replace(/\D/g, "");
    const altDigits = draft.alt_phone.replace(/\D/g, "");
    if (digits.length !== 10) e.phone = "Enter a 10-digit phone number (without +91).";
    if (altDigits.length > 0 && altDigits.length !== 10) e.alt_phone = "Enter a 10-digit phone number (without +91).";
    if (!draft.status_id) e.status_id = "Status is required.";
    if (draft.email.trim() && !isEmail(draft.email)) e.email = "Enter a valid email address.";
    setErrors(e);
    if (Object.keys(e).length) return;

    setSaving(true);
    try {
      const body = { ...draft, phone: digits, alt_phone: altDigits };
      if (draft.id) await updateLead(draft.id, body);
      else await createLead(body);
      toast.success(draft.id ? "Lead updated." : "Lead added.");
      setDraft(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save lead.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(l: Lead) {
    const label = l.name?.trim() || l.phone;
    const ok = await confirm({
      danger: true,
      title: `Delete lead “${label}”?`,
      message: <>This archives the lead (kept for audit) and hides it from your list. It can be restored later — no data is destroyed.</>,
      confirmLabel: "Yes, delete",
      cancelLabel: "No, keep it",
    });
    if (!ok) return;
    try {
      await deleteLead(l.id);
      toast.success("Lead deleted.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete lead.");
    }
  }

  // Soft-delete every selected lead after a single confirmation.
  async function bulkRemove() {
    const targets = selectedLeads;
    if (!targets.length) return;
    const ok = await confirm({
      danger: true,
      title: `Delete ${targets.length} selected lead${targets.length === 1 ? "" : "s"}?`,
      message: <>This archives {targets.length === 1 ? "the lead" : "these leads"} (kept for audit) and hides {targets.length === 1 ? "it" : "them"} from your list. They can be restored later — no data is destroyed.</>,
      confirmLabel: "Yes, delete",
      cancelLabel: "No, keep them",
    });
    if (!ok) return;
    setBulkBusy(true);
    try {
      const results = await Promise.allSettled(targets.map((l) => deleteLead(l.id)));
      const failed = results.filter((r) => r.status === "rejected").length;
      const ok2 = targets.length - failed;
      if (ok2) toast.success(`Deleted ${ok2} lead${ok2 === 1 ? "" : "s"}.`);
      if (failed) toast.error(`Could not delete ${failed} lead${failed === 1 ? "" : "s"}.`);
      setSelectedIds(new Set());
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete leads.");
    } finally {
      setBulkBusy(false);
    }
  }

  // ---- import ----
  function pickFile() { setImportResult(null); fileRef.current?.click(); }

  function onFile(file: File) {
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const grid = parseCSV(String(reader.result ?? ""));
      if (grid.length < 2) {
        setImportRows([]); setImportInfo("The file has a header but no data rows.");
        return;
      }
      const headers = grid[0].map((h) => HEADER_ALIAS[normHeader(h)] ?? normHeader(h));
      const rows = grid.slice(1).map((cells) => {
        const obj: Record<string, string> = {};
        headers.forEach((key, idx) => { obj[key] = (cells[idx] ?? "").trim(); });
        return obj;
      });
      setImportRows(rows);
      const missing = ["phone", "status"].filter((k) => !headers.includes(k));
      setImportInfo(
        `${rows.length} row${rows.length === 1 ? "" : "s"} found` +
        (missing.length ? `. ⚠ Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}` : "."),
      );
    };
    reader.readAsText(file);
  }

  async function runImport() {
    if (!importRows.length) return;
    setImporting(true); setImportResult(null);
    try {
      const r = await importLeads(importRows);
      setImportResult(r);
      if (r.inserted) {
        toast.success(`Imported ${r.inserted} lead${r.inserted === 1 ? "" : "s"}.`);
        await load();
      } else {
        toast.warning("No leads were imported.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  function downloadTemplate() {
    const example = ["John Doe", "9876543210", "", topStatuses[0]?.name ?? "New", "", "Website", "john@example.com", "", "", "Mumbai", "Maharashtra", "", ""];
    const csv = TEMPLATE_HEADERS.join(",") + "\n" + example.map(csvCell).join(",") + "\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url; a.download = "leads-import-template.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function closeImport() {
    setImportOpen(false); setImportRows([]); setImportInfo(null); setImportResult(null);
  }

  const statusChip = (l: Lead) => {
    if (!l.status_id) return <span className="text-slate-400">—</span>;
    const color = statusById[l.status_id]?.color ?? "slate";
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${dotClass(color)}`} style={dotStyle(color)} />
        <span className="text-slate-700">{l.status ?? "—"}</span>
        {l.sub_status && <span className="text-slate-400">· {l.sub_status}</span>}
      </span>
    );
  };

  const dash = <span className="text-slate-400">—</span>;

  // Source chip tinted with the source's own colour (hex or named preset).
  const sourceChip = (l: Lead) => {
    if (!l.source) return dash;
    const color = (l.source_id ? sourceById[l.source_id]?.color : "") || "slate";
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
        <span className={`h-2 w-2 rounded-full ${dotClass(color)}`} style={dotStyle(color)} />
        {l.source}
      </span>
    );
  };

  // Type chip tinted with the lead type's own colour (hex or named preset).
  const typeChip = (l: Lead) => {
    if (!l.lead_type) return dash;
    const color = (l.lead_type_id ? typeById[l.lead_type_id]?.color : "") || "slate";
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
        <span className={`h-2 w-2 rounded-full ${dotClass(color)}`} style={dotStyle(color)} />
        {l.lead_type}
      </span>
    );
  };

  const columns: Column<Lead>[] = [
    { key: "name", header: "Name", width: 180, lockVisible: true, render: (l) => <span className="font-medium text-slate-800">{l.name?.trim() || dash}</span> },
    { key: "phone", header: "Phone", width: 130, render: (l) => <span className="tabular-nums text-slate-600">{l.phone}</span> },
    { key: "status", header: "Status", width: 210, render: statusChip },
    { key: "lead_type", header: "Type", width: 140, render: typeChip },
    { key: "source", header: "Source", width: 140, render: sourceChip },
    { key: "assigned", header: "Assigned", width: 150, render: (l) => l.assigned_to_name ?? dash },
    { key: "city", header: "City", width: 120, render: (l) => l.city ?? dash },
    // Follow-up shows the lead's latest reminder (date over time); blank if none.
    { key: "follow_date", header: "Follow-up", width: 140, render: (l) => stackedDateTime(l.last_reminder_at) },
    // Latest connected (answered) call to this lead's phone.
    { key: "last_call", header: "Last call", width: 150, render: (l) => stackedDateTime(l.last_call_at) ?? dash },
    // Follow-up status flag (orange upcoming / red overdue / green done), server-computed.
    { key: "follow_flag", header: "Follow-up status", width: 150, render: (l) => followFlagBadge(l.follow_flag) ?? dash },
    { key: "assigned_date", header: "Assigned date", width: 140, render: (l) => stackedDateTime(l.assigned_date) ?? dash },
    { key: "created_date", header: "Created", width: 150, render: (l) => stackedDateTime(l.created_at) ?? dash },
    { key: "updated_at", header: "Last updated", width: 150, render: (l) => stackedDateTime(l.updated_at) ?? dash },
    // Available via the Columns menu, hidden until the user opts in.
    { key: "email", header: "Email", width: 210, defaultHidden: true, render: (l) => (l.email ? <span className="text-slate-600">{l.email}</span> : dash) },
    { key: "alt_phone", header: "Alt. phone", width: 130, defaultHidden: true, render: (l) => (l.alt_phone ? <span className="tabular-nums text-slate-600">{l.alt_phone}</span> : dash) },
    { key: "sub_status", header: "Sub status", width: 150, defaultHidden: true, render: (l) => l.sub_status ?? dash },
    { key: "reference_name", header: "Reference", width: 150, defaultHidden: true, render: (l) => l.reference_name ?? dash },
    { key: "state", header: "State", width: 120, defaultHidden: true, render: (l) => l.state ?? dash },
  ];

  const selCls = "rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15";

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Your leads database — add, assign and track every lead."
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => { setImportResult(null); setImportRows([]); setImportInfo(null); setImportOpen(true); }} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3v12m0-12L8 7m4-4l4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Import
            </button>
            <button onClick={openNew} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
              Add lead
            </button>
          </div>
        }
      />

      {/* Filters — apply on “Apply”; the search above the table stays instant. */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-start gap-3">
          {!filterPrefs.isHidden("status") && (
            <label className="flex w-44 flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Status</span>
              <MultiSelect ariaLabel="Filter by status" value={filters.status}
                onChange={(v) => setFilters((f) => ({ ...f, status: v, sub: v.length ? f.sub.filter((id) => allSubStatuses.some((s) => String(s.id) === id && ((s.parent_ids ?? []).map(String).some((p) => v.includes(p)) || v.includes(String(s.parent_id ?? ""))))) : f.sub }))}
                options={statusFilterOptions} placeholder="All statuses" searchPlaceholder="Search status…" />
            </label>
          )}

          {!filterPrefs.isHidden("sub") && (
            <label className="flex w-44 flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Sub status</span>
              <MultiSelect ariaLabel="Filter by sub status" value={filters.sub} onChange={(v) => setFilter("sub", v)} options={subFilterOptions} placeholder="All sub statuses" searchPlaceholder="Search sub status…" />
            </label>
          )}

          {!filterPrefs.isHidden("source") && (
            <label className="flex w-44 flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Source</span>
              <MultiSelect ariaLabel="Filter by source" value={filters.source} onChange={(v) => setFilter("source", v)} options={sourceFilterOptions} placeholder="All sources" searchPlaceholder="Search source…" />
            </label>
          )}

          {!filterPrefs.isHidden("assigned") && (
            <label className="flex w-44 flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Assigned to</span>
              <MultiSelect ariaLabel="Filter by assignee" value={filters.assigned} onChange={(v) => setFilter("assigned", v)} options={assignedFilterOptions} placeholder="Anyone" searchPlaceholder="Search team…" />
            </label>
          )}

          {!filterPrefs.isHidden("leadType") && (
            <label className="flex w-44 flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Lead type</span>
              <MultiSelect ariaLabel="Filter by lead type" value={filters.leadType} onChange={(v) => setFilter("leadType", v)} options={leadTypeFilterOptions} placeholder="All types" searchPlaceholder="Search type…" />
            </label>
          )}

          {!filterPrefs.isHidden("followStatus") && (
            <label className="flex w-44 flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Follow-up status</span>
              <MultiSelect ariaLabel="Filter by follow-up status" value={filters.followStatus} onChange={(v) => setFilter("followStatus", v)} options={FOLLOW_STATUS_OPTIONS} placeholder="Any status" searchPlaceholder="Search status…" />
            </label>
          )}

          {!filterPrefs.isHidden("reference") && (
            <label className="flex w-44 flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Reference name</span>
              <input value={filters.reference} onChange={(e) => setFilter("reference", e.target.value)} placeholder="Reference…" className={`${selCls} w-full`} />
            </label>
          )}

          {!filterPrefs.isHidden("created") && (
            <label className="flex w-44 flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Date created</span>
              <DateRangeFilter ariaLabel="Date created" value={filters.created} onChange={(v) => setFilter("created", v)} />
            </label>
          )}

          {!filterPrefs.isHidden("assignedDate") && (
            <label className="flex w-44 flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Assigned date</span>
              <DateRangeFilter ariaLabel="Assigned date" value={filters.assignedDate} onChange={(v) => setFilter("assignedDate", v)} />
            </label>
          )}

          {!filterPrefs.isHidden("follow") && (
            <label className="flex w-44 flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Follow-up date</span>
              <DateRangeFilter ariaLabel="Follow-up date" value={filters.follow} onChange={(v) => setFilter("follow", v)} />
            </label>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-400">
            {filtered.length} of {leads.length} lead{leads.length === 1 ? "" : "s"}{activeFilters ? " match your filters" : ""}.
            {draftDirty && <span className="ml-1 font-medium text-amber-600">Unapplied changes — click Apply.</span>}
          </p>
          <div className="flex items-center gap-2">
            <VisibilityMenu api={filterPrefs} items={FILTER_DEFS} buttonLabel="Filters" title="Show filters" />
            {(activeFilters || draftDirty) && (
              <button onClick={clearFilters} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Clear</button>
            )}
            <button
              onClick={applyFilters}
              disabled={!draftDirty || applying}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applying && <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>}
              {applying ? "Applying…" : "Apply filters"}
            </button>
          </div>
        </div>
      </Card>

      {/* Lead summary — counts by dimension; click a bar to filter the table */}
      <Card className="mb-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-700">Lead summary</h3>
            {analytics && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{analytics.total} leads</span>}
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium">
            {SUMMARY_DIMS.map((d) => (
              <button key={d.key} onClick={() => setSummaryDim(d.key)} className={`rounded-md px-3 py-1.5 transition ${summaryDim === d.key ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {!analytics ? (
          <div className="py-8 text-center text-sm text-slate-400">Loading summary…</div>
        ) : summaryDonut.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">No {activeDim.label.toLowerCase()} data yet.</div>
        ) : (
          <DonutSelect
            data={summaryDonut}
            total={analytics.total}
            activeId={summaryActiveId != null ? Number(summaryActiveId) : null}
            onSelect={pickSummaryId}
          />
        )}

        <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          {summaryActiveId ? (
            <>
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-indigo-500" />
              Table filtered by {activeDim.label.toLowerCase()}.
              <button onClick={clearSummary} className="font-medium text-indigo-600 hover:text-indigo-700">Clear</button>
            </>
          ) : (
            <span className="text-slate-400">Click a slice or legend row to filter the table by {activeDim.label.toLowerCase()}.</span>
          )}
        </p>
      </Card>

      {selectedLeads.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5">
          <span className="text-sm font-medium text-indigo-800">
            {selectedLeads.length} lead{selectedLeads.length === 1 ? "" : "s"} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Clear
            </button>
            <button
              onClick={bulkRemove}
              disabled={bulkBusy}
              className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {bulkBusy ? "Deleting…" : `Delete selected`}
            </button>
          </div>
        </div>
      )}

      <DataTable
        tableKey="leads"
        canRenameColumns={isAdmin}
        columns={columns}
        rows={pageRows}
        getKey={(l) => l.id}
        loading={loading || applying}
        toolbar={
          <div className="relative w-full max-w-sm">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
            <input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search name, phone, email, city…" className={`${selCls} w-full pl-9`} />
          </div>
        }
        nowrap
        selectable
        selectedKeys={selectedIds}
        onSelectionChange={setSelectedIds}
        emptyTitle={activeFilters ? "No matching leads" : "No leads yet"}
        emptyHint={activeFilters ? "Try clearing or widening your filters." : "Add your first lead or import a CSV file."}
        onRowClick={(l) => openView(l)}
        page={safePage}
        totalPages={totalPages}
        onPage={setPage}
        total={filtered.length}
        pageAlign="right"
        quickActions={(l) => (
          <>
            <IconButton title="View details" onClick={() => openView(l)}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" /></svg>
            </IconButton>
            <IconButton title="Edit" onClick={() => openEdit(l)}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </IconButton>
            <IconButton title="Delete" danger onClick={() => remove(l)}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </IconButton>
          </>
        )}
      />

      {/* Create / edit — right-side drawer */}
      <Drawer
        open={!!draft}
        onClose={() => !saving && setDraft(null)}
        title={draft?.id ? "Edit lead" : "Add lead"}
        subtitle={draft?.id ? "Update this lead's details" : "Capture a new lead"}
        width="max-w-2xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setDraft(null)} disabled={saving} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
            <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
              {saving && <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>}
              {saving ? "Saving…" : draft?.id ? "Save changes" : "Save lead"}
            </button>
          </div>
        }
      >
        {draft && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldRow label="Name"><input className={inputCls()} placeholder="Lead name" value={draft.name} onChange={(e) => setField("name")(e.target.value)} /></FieldRow>
            <FieldRow label="Reference name"><input className={inputCls()} value={draft.reference_name} onChange={(e) => setField("reference_name")(e.target.value)} /></FieldRow>

            <FieldRow label="Phone" required error={errors.phone} hint="10 digits, without +91">
              <input className={inputCls(errors.phone)} inputMode="numeric" maxLength={10} placeholder="10-digit mobile (no +91)" value={draft.phone} onChange={(e) => setField("phone")(e.target.value.replace(/\D/g, "").slice(0, 10))} />
            </FieldRow>
            <FieldRow label="Alternative phone" error={errors.alt_phone} hint="Optional · 10 digits, without +91">
              <input className={inputCls(errors.alt_phone)} inputMode="numeric" maxLength={10} placeholder="10-digit mobile (no +91)" value={draft.alt_phone} onChange={(e) => setField("alt_phone")(e.target.value.replace(/\D/g, "").slice(0, 10))} />
            </FieldRow>

            <FieldRow label="Status" required error={errors.status_id}>
              <select className={inputCls(errors.status_id)} value={draft.status_id} onChange={(e) => setField("status_id")(e.target.value)}>
                <option value="">— Select —</option>
                {topStatuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </FieldRow>
            <FieldRow label="Sub status" hint={draft.status_id ? (subOptions.length ? undefined : "No sub-statuses for this status") : "Pick a status first"}>
              <select className={inputCls()} value={draft.sub_status_id} disabled={!subOptions.length} onChange={(e) => setField("sub_status_id")(e.target.value)}>
                <option value="">— None —</option>
                {subOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </FieldRow>

            <FieldRow label="Lead source" hint="Where this lead came from. Manage sources in Leads Setup.">
              <select className={inputCls()} value={draft.source_id} onChange={(e) => setField("source_id")(e.target.value)}>
                <option value="">— None —</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.marketing_type ? `${s.name} · ${s.marketing_type}` : s.name}</option>)}
              </select>
            </FieldRow>

            <FieldRow label="Email" error={errors.email}>
              <input className={inputCls(errors.email)} type="email" placeholder="lead@example.com" value={draft.email} onChange={(e) => setField("email")(e.target.value)} />
            </FieldRow>
            <FieldRow label="Assigned to">
              <select className={inputCls()} value={draft.assigned_to} onChange={(e) => setField("assigned_to")(e.target.value)}>
                <option value="">— Unassigned —</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </FieldRow>

            <FieldRow label="Assigned date" hint="Set automatically when the lead is assigned"><div className={readonlyCls}>{draft.assigned_date ? fmtDate(draft.assigned_date) : "—"}</div></FieldRow>
            <FieldRow label="Follow-up date" hint="Set from the lead's reminders"><div className={readonlyCls}>{draft.follow_date ? fmtDate(draft.follow_date) : "—"}</div></FieldRow>

            <FieldRow label="City"><input className={inputCls()} value={draft.city} onChange={(e) => setField("city")(e.target.value)} /></FieldRow>
            <FieldRow label="State"><input className={inputCls()} value={draft.state} onChange={(e) => setField("state")(e.target.value)} /></FieldRow>

            <FieldRow label="Created date" hint="Set automatically when the lead is created"><div className={readonlyCls}>{draft.created_date ? fmtDate(draft.created_date) : draft.id ? "—" : "Today"}</div></FieldRow>
          </div>
        )}
      </Drawer>

      {/* View details — reminders, notes & activity */}
      <Drawer
        open={!!viewing}
        onClose={closeView}
        title={viewing?.name?.trim() || viewing?.phone || "Lead"}
        subtitle="Details, reminders, notes & activity"
        width="max-w-2xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button onClick={closeView} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Close</button>
            <button onClick={() => { const l = viewing!; closeView(); openEdit(l); }} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Edit
            </button>
          </div>
        }
      >
        {viewing && (() => {
          const lead = detail?.lead ?? viewing;
          return (
            <div className="space-y-5">
              {/* Tab bar */}
              <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                {(([
                  ["info", "Information", null],
                  ["reminders", "Reminders", detail?.reminders.length ?? 0],
                  ["notes", "Notes", detail?.notes.length ?? 0],
                  ["calls", "Calls", detail?.calls.length ?? 0],
                  ["activity", "Activity", detail?.activity.length ?? 0],
                ] as [typeof viewTab, string, number | null][])).map(([key, label, count]) => (
                  <button key={key} onClick={() => setViewTab(key)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition ${viewTab === key ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                    {label}
                    {count !== null && count > 0 && <span className={`rounded-full px-1.5 text-[10px] font-bold ${viewTab === key ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>{count}</span>}
                  </button>
                ))}
              </div>

              {/* Information */}
              {viewTab === "info" && (
              <section>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                  {([
                    ["Name", lead.name?.trim() || "—"],
                    ["Phone", lead.phone],
                    ["Alternative phone", lead.alt_phone || "—"],
                    ["Status", lead.status || "—"],
                    ["Sub status", lead.sub_status || "—"],
                    ["Lead source", lead.source || "—"],
                    ["Reference name", lead.reference_name || "—"],
                    ["Email", lead.email || "—"],
                    ["Assigned to", lead.assigned_to_name || "Unassigned"],
                    ["Assigned date", lead.assigned_date ? fmtDate(lead.assigned_date) : "—"],
                    ["City", lead.city || "—"],
                    ["State", lead.state || "—"],
                    ["Follow-up date", lead.follow_date ? fmtDate(lead.follow_date) : "—"],
                    ["Created date", fmtDateTime(lead.created_at ?? lead.created_date)],
                  ] as [string, React.ReactNode][]).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
                      <dd className="mt-0.5 text-sm text-slate-800">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              )}

              {/* Reminders */}
              {viewTab === "reminders" && (
              <section>
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex-1">
                      <span className="mb-1 block text-xs font-medium text-slate-600">Remind me at</span>
                      <input type="datetime-local" min={toLocalInput(new Date())} value={remindAt} onChange={(e) => setRemindAt(e.target.value)} className={inputCls(reminderErr)} />
                    </label>
                    <button onClick={addReminder} disabled={savingReminder} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{savingReminder ? "Setting…" : "Set reminder"}</button>
                  </div>
                  <input value={reminderNote} onChange={(e) => setReminderNote(e.target.value)} placeholder="Optional note (e.g. Call back about pricing)" className={`${inputCls()} mt-2`} />
                  {reminderErr && <p className="mt-1 text-xs text-rose-600">{reminderErr}</p>}
                  <p className="mt-1 text-xs text-slate-400">
                    {lead.follow_date ? <>Pre-filled from this lead&apos;s follow-up date ({fmtDate(lead.follow_date)}) — adjust if needed. </> : null}
                    A desktop notification fires at the chosen time while the app is open.
                  </p>
                </div>

                <ul className="mt-3 space-y-2">
                  {(detail?.reminders ?? []).map((r) => (
                    <li key={r.id} className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2">
                      <span className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${r.notified_at ? "bg-slate-100 text-slate-400" : r.due ? "bg-amber-100 text-amber-600" : "bg-indigo-100 text-indigo-600"}`}>
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-800">{fmtDateTime(r.remind_at)}</div>
                        {r.note && <div className="text-xs text-slate-500">{r.note}</div>}
                        <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">{r.notified_at ? "Notified" : r.due ? "Due" : "Upcoming"}</div>
                      </div>
                      <button onClick={() => removeReminder(r.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500" aria-label="Delete reminder">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                    </li>
                  ))}
                  {detail && detail.reminders.length === 0 && <li className="text-sm text-slate-400">No reminders yet.</li>}
                </ul>
              </section>
              )}

              {/* Notes */}
              {viewTab === "notes" && (
              <section>
                <div className="flex items-start gap-2">
                  <textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} rows={2} placeholder="Add a note about this lead…" className={inputCls()} />
                  <button onClick={addNote} disabled={savingNote || !noteBody.trim()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{savingNote ? "Adding…" : "Add"}</button>
                </div>
                <ul className="mt-3 space-y-2">
                  {(detail?.notes ?? []).map((n) => (
                    <li key={n.id} className="rounded-lg border border-slate-200 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-600">{n.author_name || "Someone"}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-400">{fmtDateTime(n.created_at)}</span>
                          <button onClick={() => removeNote(n.id)} className="text-slate-400 hover:text-rose-500" aria-label="Delete note">
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                        </div>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{n.body}</p>
                    </li>
                  ))}
                  {detail && detail.notes.length === 0 && <li className="text-sm text-slate-400">No notes yet.</li>}
                </ul>
              </section>
              )}

              {/* Calls — read-only log synced from the call-tracking app */}
              {viewTab === "calls" && (
              <section>
                {detailLoading && !detail ? (
                  <Spinner />
                ) : (detail?.calls ?? []).length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">No calls logged for this lead yet.</div>
                ) : (
                  <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                    {(detail?.calls ?? []).map((c) => (
                      <li key={c.id}><CallActivityItem call={c} /></li>
                    ))}
                  </ul>
                )}
              </section>
              )}

              {/* Activity — vertical timeline */}
              {viewTab === "activity" && (
              <section>
                {detailLoading && !detail ? (
                  <Spinner />
                ) : (detail?.activity ?? []).length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">No activity recorded yet.</div>
                ) : (
                  <ol className="relative ml-3 space-y-4 border-l-2 border-slate-100 pl-6">
                    {(detail?.activity ?? []).map((a) => {
                      const s = activityStyle(a.action);
                      return (
                        <li key={a.id} className="relative">
                          <span className={`absolute -left-[2.18rem] top-0.5 flex h-7 w-7 items-center justify-center rounded-full border ${s.ring}`}>
                            <svg className={`h-3.5 w-3.5 ${s.dot}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={s.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </span>
                          <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm transition hover:border-slate-300">
                            <p className="text-sm font-medium text-slate-800">{a.description || a.action}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                              <span className="inline-flex items-center gap-1 font-medium text-slate-500">
                                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-[8px] font-bold text-slate-500">{(a.actor_name ?? "—").slice(0, 1).toUpperCase()}</span>
                                {a.actor_name ?? "System"}
                              </span>
                              <span>·</span>
                              <span>{fmtDateTime(a.created_at)}</span>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
              )}
            </div>
          );
        })()}
      </Drawer>

      {/* Import from CSV */}
      <Modal open={importOpen} onClose={closeImport} title="Import leads from CSV">
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Upload a CSV (export your Excel sheet as <b>.csv</b>). Each row must have a <b>10-digit phone</b> and a <b>status</b> matching one of your lead statuses; email is validated when present. Invalid rows are skipped and reported.
          </p>

          <button onClick={downloadTemplate} className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Download CSV template
          </button>

          <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <button onClick={pickFile} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Choose CSV file</button>
            {importInfo && <p className="mt-2 text-sm text-slate-500">{importInfo}</p>}
          </div>

          {importResult && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className={importResult.inserted ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>
                Imported {importResult.inserted} · Skipped {importResult.failed}
              </p>
              {importResult.errors.length > 0 && (
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-amber-700">
                  {importResult.errors.map((er, i) => <li key={i}>Row {er.row}: {er.message}</li>)}
                </ul>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={closeImport} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Close</button>
            <button onClick={runImport} disabled={importing || !importRows.length} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
              {importing ? "Importing…" : `Import ${importRows.length || ""} lead${importRows.length === 1 ? "" : "s"}`.trim()}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
