"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getLeads, createLead, updateLead, deleteLead, importLeads, bulkUpdateLeads, getLeadImportSetup,
  getLeadsSetup, getStaff, getMe, getLeadAnalytics, getCallSyncStatus, getLeadCallSummary,
  getLeadDetail, createLeadReminder, updateLeadReminder, deleteLeadReminder, createLeadNote, updateLeadNote, deleteLeadNote,
  getLeadTransfers, getLeadAssignees, getVisitorSetup, getFormSetup, LEAD_REQUIRABLE_FIELDS, LEAD_FIELD_HINTS, LEAD_FORM_FIELDS,
  getConvertConfig, saveConvertConfig, convertLead,
  type Lead, type LeadStatus, type LeadSource, type LeadType, type LeadReference, type Staff, type LeadImportResult, type LeadDetail,
  type LeadAnalytics, type LeadCount, type State, type City, type VisitorType, type VisitorStatus, type CustomField,
  type LeadImportColumn, type LeadsQuery, type CallSyncStatus, type LeadCallSummary, type ConvertConfig, type ConvertField,
} from "../../lib/client";
import { requestNotifyPermission } from "../../lib/notify";
import { useClient } from "../ClientContext";
import { CustomFieldCell, customFieldErrors } from "../CustomFields";
import RichTextEditor from "../../admin/RichTextEditor";

/** Plain text from rich-text HTML — for "is it empty" checks before saving. */
const stripHtml = (h: string) => h.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
import TransfersTab from "./TransfersTab";
import TransferModal from "./TransferModal";
import VisitorsTab from "./VisitorsTab";
import VisitorModal, { visitorDraftFromLead, type VDraft } from "./VisitorModal";
import { FilterRail, FilterToggle, FilterLabel, filterRailPad } from "../FilterRail";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import { Card, Drawer, Modal, PageHeader, Spinner, fmtDate, timeAgo } from "../../admin/ui";
import { DataTable, IconButton, type Column, type SortState } from "../../admin/DataTable";
import { MultiSelect, SearchSelect, type SelectOption } from "../../admin/SearchSelect";
import { DateRangeFilter, rangeActive, resolveDateRange, EMPTY_RANGE, type DateRange } from "../../admin/dateFilter";
import { useHiddenPrefs, VisibilityMenu, useFilterLayout, FilterLayoutMenu, orderFilters } from "../../admin/tableConfig";
import { FieldRow, inputCls, isEmail } from "../../admin/clients/formKit";
import { INDIA_STATES, INDIA_CITIES } from "../../lib/india";
import { CallActivityItem } from "../../admin/CallActivity";
import { importTemplate } from "../excel/importEngine";

// The full leads filter set. `draft` is what the user is editing; `applied` is
// what actually filters the table — they sync only when the user clicks Apply.
interface LeadFilters {
  status: string[];
  sub: string[];
  source: string[];
  assigned: string[];   // staff ids, plus the literal "unassigned"
  reporting: string;    // Reporting Person: a single staff id whose OWN calls drive the person call columns (does not filter rows)
  leadType: string[];
  followStatus: string[]; // follow-up flag: "upcoming" | "overdue" | "done"
  reference: string[];    // reference names
  created: DateRange;
  assignedDate: DateRange;
  follow: DateRange;
  updated: DateRange;     // "Updated date" = filter by call date (call_start)
  connected: DateRange;   // "Connected date" = leads with a connected call in range
  noConnectAfter: string; // leads NOT connected after this date (stale)
  noUpdateAfter: string;  // leads NOT updated after this date (stale)
  // Ghosted: no connected call within the last H hours + M mins (gt = ghosted, lt = active).
  ghostOn: boolean; ghostHours: string; ghostMins: string; ghostOp: "gt" | "lt";
  // Assigned-user call-count range (min–max calls the lead's rep made to it).
  callsOn: boolean; callsMin: string; callsMax: string;
  // Call talk-time duration: a single H:M bound compared with ≤ (lte) or ≥ (gte).
  durOn: boolean; durOp: "lte" | "gte"; durHours: string; durMins: string;
}
const BLANK_FILTERS: LeadFilters = {
  status: [], sub: [], source: [], assigned: [], reporting: "", leadType: [], followStatus: [], reference: [],
  created: EMPTY_RANGE, assignedDate: EMPTY_RANGE, follow: EMPTY_RANGE, updated: EMPTY_RANGE, connected: EMPTY_RANGE,
  noConnectAfter: "", noUpdateAfter: "",
  ghostOn: false, ghostHours: "5", ghostMins: "", ghostOp: "gt",
  callsOn: false, callsMin: "", callsMax: "",
  durOn: false, durOp: "lte", durHours: "", durMins: "",
};
// Initial filters on first load: no date filter is pre-applied — the page opens
// on all leads (Any time). The user can pick an Updated-date (call date) range.
const INITIAL_FILTERS: LeadFilters = { ...BLANK_FILTERS };

// Toggleable filter controls, in display order, for the per-user "Filters" menu.
const FILTER_DEFS: { id: string; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "sub", label: "Sub status" },
  { id: "source", label: "Source" },
  { id: "reporting", label: "Reporting Person" },
  { id: "assigned", label: "Assigned to" },
  { id: "leadType", label: "Lead type" },
  { id: "followStatus", label: "Follow-up status" },
  { id: "reference", label: "Reference name" },
  { id: "created", label: "Date created" },
  { id: "assignedDate", label: "Assigned date" },
  { id: "follow", label: "Follow-up date" },
  { id: "updated", label: "Updated date" },
  { id: "connected", label: "Connected date" },
  { id: "noConnectAfter", label: "Last connect date" },
  { id: "noUpdateAfter", label: "Last update date" },
  { id: "ghost", label: "Ghosted leads" },
  { id: "calls", label: "Update Count Range" },
  { id: "duration", label: "Duration Filter" },
];

// Top-level filter blocks the admin can reorder/hide client-wide (the whole
// "Date filters" group counts as one unit, "dates"). Order here is the default.
const FILTER_LAYOUT_DEFS: { id: string; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "sub", label: "Sub status" },
  { id: "source", label: "Source" },
  { id: "reporting", label: "Reporting Person" },
  { id: "assigned", label: "Assigned to" },
  { id: "leadType", label: "Lead type" },
  { id: "followStatus", label: "Follow-up status" },
  { id: "reference", label: "Reference name" },
  { id: "dates", label: "Date filters" },
  { id: "ghost", label: "Ghosted leads" },
  { id: "calls", label: "Update Count Range" },
  { id: "duration", label: "Duration Filter" },
];

// Field key → label, for messages on admin-configured mandatory fields.
const LEAD_FIELD_LABELS: Record<string, string> = Object.fromEntries(
  LEAD_REQUIRABLE_FIELDS.map((f) => [f.key, f.label]),
);

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
  !!(f.status.length || f.sub.length || f.source.length || f.assigned.length || f.reporting || f.leadType.length ||
    f.followStatus.length || f.reference.length || rangeActive(f.created) || rangeActive(f.assignedDate) || rangeActive(f.follow) || rangeActive(f.updated) || rangeActive(f.connected) ||
    f.noConnectAfter || f.noUpdateAfter || f.ghostOn || (f.callsOn && (!!f.callsMin || !!f.callsMax)) ||
    (f.durOn && (!!f.durHours || !!f.durMins)));

// How many filter groups are active — drives the count badge on the Filters button.
const countActiveFilters = (f: LeadFilters): number =>
  [f.status.length, f.sub.length, f.source.length, f.assigned.length, !!f.reporting, f.leadType.length,
    f.followStatus.length, f.reference.length, rangeActive(f.created), rangeActive(f.assignedDate), rangeActive(f.follow), rangeActive(f.updated), rangeActive(f.connected),
    !!f.noConnectAfter, !!f.noUpdateAfter, f.ghostOn, f.callsOn && (!!f.callsMin || !!f.callsMax),
    f.durOn && (!!f.durHours || !!f.durMins)]
    .filter(Boolean).length;

interface Draft {
  id?: number;
  name: string; phone: string; alt_phone: string;
  status_id: string; sub_status_id: string; source_id: string; lead_type_id: string;
  reference_name: string; email: string;
  assigned_to: string; assigned_date: string;
  city: string; state: string; follow_date: string; created_date: string;
  description: string; // rich-text HTML
  // Latest reminder datetime (max remind_at) — the follow-up date shown read-only.
  last_reminder_at: string;
  custom: Record<string, string>;
}
const blank: Draft = {
  name: "", phone: "", alt_phone: "", status_id: "", sub_status_id: "", source_id: "", lead_type_id: "",
  reference_name: "", email: "", assigned_to: "", assigned_date: "",
  city: "", state: "", follow_date: "", created_date: "", description: "", last_reminder_at: "", custom: {},
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
    lead_type_id: l.lead_type_id ? String(l.lead_type_id) : "",
    reference_name: l.reference_name ?? "",
    email: l.email ?? "",
    assigned_to: l.assigned_to ? String(l.assigned_to) : "",
    // Keep the full date+time (read-only display); it's system-managed on save.
    assigned_date: l.assigned_date ?? "",
    city: l.city ?? "",
    state: l.state ?? "",
    follow_date: l.follow_date ? l.follow_date.slice(0, 10) : "",
    created_date: l.created_date ? l.created_date.slice(0, 10) : "",
    description: l.description ?? "",
    last_reminder_at: l.last_reminder_at ?? "",
    custom: { ...(l.custom_fields ?? {}) },
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


/** Local "YYYY-MM-DDTHH:MM" for a datetime-local input's min/value. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** Human working-duration, e.g. "47m 29s", "1h 5m", "1d 4h". "—" when unset. */
function fmtDuration(secs: number | string | null | undefined): string {
  if (secs === null || secs === undefined || secs === "") return "—";
  const s = Number(secs);
  if (Number.isNaN(s) || s < 0) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${m % 60}m`;
  return `${m}m ${s % 60}s`;
}

/** Human date+time, e.g. "5 Jun 2026, 3:30 PM". */
function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s.replace(" ", "T"));
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Seconds → "HH:MM:SS". */
function fmtHMS(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/**
 * Header strip: the all-time call total + duration and the last-synced time
 * (not scoped to today, so a quiet day doesn't read as 0). Loads on mount and
 * auto-refreshes every minute (also a manual refresh button). Shown regardless
 * of whether any leads exist.
 */
function CallSyncHeader() {
  const [data, setData] = useState<CallSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    getCallSyncStatus().then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000); // auto-refresh every 1 minute
    return () => clearInterval(t);
  }, [load]);

  const cell = (label: string, value: React.ReactNode) => (
    <div className="min-w-[110px] flex-1 text-center">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-base font-bold text-slate-800">{value}</div>
    </div>
  );

  return (
    <div className="mb-4 flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
      {cell("Total Calls", data ? (data.total_calls > 0 ? data.total_calls.toLocaleString("en-IN") : "No calls") : "—")}
      {cell("Total Duration", data ? fmtHMS(data.total_duration) : "—")}
      {cell("Last Call Sync", data?.last_sync ? fmtDateTime(data.last_sync) : "Not Sync")}
      <button
        type="button"
        onClick={load}
        disabled={loading}
        title="Refresh"
        aria-label="Refresh call sync"
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-sky-500 text-white transition hover:bg-sky-600 disabled:opacity-60"
      >
        <svg className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 2v6h-6M3 12a9 9 0 0115-6.7L21 8M3 22v-6h6M21 12a9 9 0 01-15 6.7L3 16" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );
}

/** Seconds → "12 Hrs : 25 Mins : 51 Sec". */
function fmtTalk(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 3600)} Hrs : ${Math.floor((s % 3600) / 60)} Mins : ${s % 60} Sec`;
}
/** Seconds → short "1m" / "45s". */
function fmtDurShort(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
}
const hourLabelOf = (h: number) => (h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`);

/** Compact vertical bar chart (hourly / by-status). `sub` overrides the top label. */
function MiniBars({ items, valueFmt }: { items: { label: string; value: number; sub?: string; color?: string }[]; valueFmt?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="py-8 text-center text-sm text-slate-400">No calls in this filter.</p>;
  return (
    <div className="flex items-end gap-2 overflow-x-auto pb-1" style={{ height: 200 }}>
      {items.map((it, i) => (
        <div key={i} className="flex min-w-[34px] flex-1 flex-col items-center justify-end gap-1">
          <span className="text-[10px] font-semibold text-slate-600">{it.sub ?? (valueFmt ? valueFmt(it.value) : it.value)}</span>
          <div className="w-full max-w-[28px] rounded-t" style={{ height: `${Math.max(it.value > 0 ? 3 : 0, (it.value / max) * 150)}px`, background: it.color ?? "#6366f1" }} title={`${it.label}: ${valueFmt ? valueFmt(it.value) : it.value}`} />
          <span className="w-full truncate text-center text-[9px] text-slate-400" title={it.label}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Stat-card grid for one lead dimension (Status / Sub-status / Type / Source):
 * a tile per value showing its count with the value's own colour, plus an
 * optional "Total Leads" tile. Clicking a tile filters the table by that value
 * (toggles off when it's the sole active filter). `activeIds` are the ids
 * currently filtering the table for this dimension, so the active tile is ringed.
 */
function SummaryGrid({ title, items, total, activeIds, onPick }: {
  title: string;
  items: LeadCount[];
  total?: number;
  activeIds: string[];
  onPick: (id: number) => void;
}) {
  return (
    <div className="mb-5 last:mb-0">
      <h3 className="mb-2.5 text-lg font-bold text-pink-600">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {items.map((it, i) => {
          // A bucket without an id (e.g. "Unknown Status") can't drive a filter,
          // so it renders as a plain, non-clickable tile.
          const clickable = it.id != null;
          const active = clickable && activeIds.length === 1 && activeIds[0] === String(it.id);
          const body = (
            <>
              <div className="text-2xl font-bold text-slate-800">{it.value.toLocaleString("en-IN")}</div>
              <div className="mt-1 truncate text-xs font-medium" style={{ color: toHex(it.color) }} title={it.label}>{it.label}</div>
            </>
          );
          const cls = `rounded-xl border bg-white px-3 py-4 text-center shadow-sm ${active ? "border-indigo-400 ring-2 ring-indigo-200" : "border-slate-200"}`;
          return clickable ? (
            <button key={it.id} type="button" onClick={() => onPick(it.id as number)} title={`Filter by ${it.label}`} className={`${cls} transition hover:shadow-md`}>
              {body}
            </button>
          ) : (
            <div key={`x-${i}`} className={cls}>{body}</div>
          );
        })}
        {total != null && (
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-center shadow-sm">
            <div className="text-2xl font-bold text-slate-800">{total.toLocaleString("en-IN")}</div>
            <div className="mt-1 text-xs font-medium text-sky-500">Total Leads</div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Dual-handle range slider. Each handle is its own small draggable element (not
 * a full-width overlaid <input>), so neither can ever block the other — both the
 * min and max thumbs are always independently draggable, and clicking the track
 * jumps the nearest handle. Values are clamped so min never crosses max. Arrow
 * keys nudge a focused handle.
 */
function DualRange({ min, max, step = 1, valueMin, valueMax, onChange }: {
  min: number; max: number; step?: number;
  valueMin: number; valueMax: number;
  onChange: (lo: number, hi: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const lo = Math.min(valueMin, valueMax);
  const hi = Math.max(valueMin, valueMax);
  const span = max - min || 1;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const pct = (v: number) => ((clamp(v) - min) / span) * 100;
  // Snap a clientX to a stepped value along the track.
  const valAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return min;
    const r = el.getBoundingClientRect();
    const ratio = r.width ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0;
    return clamp(Math.round((min + ratio * span) / step) * step);
  };
  const apply = (which: "lo" | "hi", v: number) =>
    which === "lo" ? onChange(Math.min(v, hi), hi) : onChange(lo, Math.max(v, lo));

  const startDrag = (which: "lo" | "hi") => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => apply(which, valAt(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // Click on the track → move whichever handle is nearer.
  const onTrackDown = (e: React.PointerEvent) => {
    const v = valAt(e.clientX);
    apply(Math.abs(v - lo) <= Math.abs(v - hi) ? "lo" : "hi", v);
  };
  const onKey = (which: "lo" | "hi", v: number) => (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step
      : e.key === "ArrowRight" || e.key === "ArrowUp" ? step : 0;
    if (!d) return;
    e.preventDefault();
    apply(which, clamp(v + d));
  };
  const thumb = "absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-pointer touch-none rounded-full border-2 border-emerald-600 bg-white shadow focus:outline-none focus:ring-2 focus:ring-emerald-500/40";

  return (
    <div ref={trackRef} className="relative h-5 w-full select-none">
      <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 cursor-pointer rounded-full bg-slate-200" onPointerDown={onTrackDown} />
      <div className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-emerald-500" style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }} />
      <div role="slider" tabIndex={0} aria-label="Minimum" aria-valuemin={min} aria-valuemax={max} aria-valuenow={lo}
        className={thumb} style={{ left: `${pct(lo)}%`, zIndex: lo >= (min + max) / 2 ? 6 : 5 }}
        onPointerDown={startDrag("lo")} onKeyDown={onKey("lo", lo)} />
      <div role="slider" tabIndex={0} aria-label="Maximum" aria-valuemin={min} aria-valuemax={max} aria-valuenow={hi}
        className={thumb} style={{ left: `${pct(hi)}%`, zIndex: 5 }}
        onPointerDown={startDrag("hi")} onKeyDown={onKey("hi", hi)} />
    </div>
  );
}
// Upper bound of the assigned-user call-count ("Update Count Range") slider; the
// max handle here means "no upper limit" (nothing above is filtered out).
const CALLS_SLIDER_MAX = 30;

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
  if (!s) return null; // guard against an unexpected flag value from the API
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

/** Icon + colour for an activity-timeline node, keyed by its action verb. */
// Pick a type-specific icon for a lead activity. The coarse `action` is mostly
// "updated", so we read the human `description` too ("Set a reminder",
// "Reassigned: …", "Source changed: …", etc.) to show the right icon. Order
// matters — more specific keywords are checked before the generic create/delete.
function activityStyle(action: string, description?: string | null): { ring: string; dot: string; icon: string } {
  const a = `${action} ${description ?? ""}`.toLowerCase();
  if (a.includes("transfer")) return { ring: "border-blue-200 bg-blue-50", dot: "text-blue-600", icon: "M7 16l-4-4 4-4M3 12h13M17 8l4 4-4 4M21 12H8" };
  if (a.includes("remind")) return { ring: "border-sky-200 bg-sky-50", dot: "text-sky-600", icon: "M12 8v4l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" };
  if (a.includes("note")) return { ring: "border-violet-200 bg-violet-50", dot: "text-violet-600", icon: "M4 5h16v10l-4 4H4zM16 19v-4h4" };
  if (a.includes("source")) return { ring: "border-cyan-200 bg-cyan-50", dot: "text-cyan-600", icon: "M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-7.2-7.2a2 2 0 01-.6-1.4V5a2 2 0 012-2h7a2 2 0 011.4.6l7.2 7.2a2 2 0 010 2.6zM7.5 7.5h.01" };
  if (a.includes("status") || a.includes("moved") || a.includes("stage")) return { ring: "border-amber-200 bg-amber-50", dot: "text-amber-600", icon: "M4 7h16M4 12h10M4 17h7M17 14l3 3-3 3" };
  if (a.includes("assign")) return { ring: "border-teal-200 bg-teal-50", dot: "text-teal-600", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2" };
  if (a.includes("delet") || a.includes("remov")) return { ring: "border-rose-200 bg-rose-50", dot: "text-rose-600", icon: "M6 7h12M9 7V5h6v2M10 11v6M14 11v6M5 7l1 13h12l1-13" };
  if (a.includes("creat") || a.includes("add") || a.includes("set")) return { ring: "border-emerald-200 bg-emerald-50", dot: "text-emerald-600", icon: "M12 5v14M5 12h14" };
  return { ring: "border-indigo-200 bg-indigo-50", dot: "text-indigo-600", icon: "M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" };
}

export default function ClientLeads() {
  const toast = useToast();
  const confirm = useConfirm();
  const { can, hasFeature, defaultPageSize, isAgent } = useClient();
  // The Calls tab/column needs both the plan feature AND the call-tracking
  // permission (admins implicitly hold it; staff must be granted it).
  const canViewCalls = hasFeature("call_tracking") && can("calls");
  // Lead transfer: the Transfers tab + the per-row "Transfer" action need the
  // plan feature AND the lead_transfer permission.
  const canTransfer = hasFeature("lead_transfer") && can("lead_transfer");
  const canVisitors = hasFeature("visitors") && can("visitors");
  // The per-row "Transfer" / "Log visitor" actions CREATE records, so they need
  // create permission (not just view) — otherwise they show but the action fails.
  const canCreateTransfer = hasFeature("lead_transfer") && can("lead_transfer", "create");
  const canCreateVisitor = hasFeature("visitors") && can("visitors", "create");
  const [leadTab, setLeadTab] = useState<"leads" | "transfers" | "visitors">("leads");
  const [transferLead, setTransferLead] = useState<{ id: number; name: string } | null>(null);
  const [transferMode, setTransferMode] = useState<"direct" | "approval">("approval");
  const [transferPending, setTransferPending] = useState(0); // pending count → Transfers tab badge
  // Per-lead "Log visitor" — opens the shared VisitorModal pre-filled from the lead.
  const [visitorDraft, setVisitorDraft] = useState<VDraft | null>(null);
  const [visitorTypes, setVisitorTypes] = useState<VisitorType[]>([]);
  const [visitorStatuses, setVisitorStatuses] = useState<VisitorStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false); // client admin → may rename columns
  const [myStaff, setMyStaff] = useState<{ id: number; name: string } | null>(null); // current user (for the assignee filter)
  const [myRef, setMyRef] = useState<{ id: number | null; name: string | null }>({ id: null, name: null }); // agent's own reference
  const [agentAssignees, setAgentAssignees] = useState<{ id: number; name: string }[]>([]); // reps owning the agent's visible leads
  const [leads, setLeads] = useState<Lead[]>([]);
  const [statuses, setStatuses] = useState<LeadStatus[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [leadTypes, setLeadTypes] = useState<LeadType[]>([]);
  const [references, setReferences] = useState<LeadReference[]>([]);
  const [states, setStates] = useState<State[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  // Lead-form fields the admin has marked mandatory (keys match Draft fields).
  const [requiredFields, setRequiredFields] = useState<Set<string>>(new Set());
  const [leadCustomFields, setLeadCustomFields] = useState<CustomField[]>([]);
  // Admin-customized field hints/taglines (per lead type; overrides the defaults).
  const [leadHints, setLeadHints] = useState<Record<string, string>>({});
  // Admin-defined field display order (keys); empty = the form's natural order.
  const [leadOrder, setLeadOrder] = useState<string[]>([]);

  // Lead-volume summary (counts by dimension) shown between filters and table.
  // Lazy: the analytics query only runs while the summary is open, so the table
  // isn't slowed by an extra fetch on every load / filter change.
  const [analytics, setAnalytics] = useState<LeadAnalytics | null>(null);
  const [callSummary, setCallSummary] = useState<LeadCallSummary | null>(null);
  // The Lead and Call summaries toggle independently, so both can show at once.
  // Both reflect the main leads filter (the FilterRail); no separate summary filter.
  const [showLead, setShowLead] = useState(false);
  const [showCall, setShowCall] = useState(false);

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
  // Inline reminder editing: the reminder id being edited + its working values.
  const [editingReminder, setEditingReminder] = useState<number | null>(null);
  const [editRemindAt, setEditRemindAt] = useState("");
  const [editReminderNote, setEditReminderNote] = useState("");
  const [editReminderErr, setEditReminderErr] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  // Inline note editing: the note id being edited + its working text.
  const [editingNote, setEditingNote] = useState<number | null>(null);
  const [editNoteBody, setEditNoteBody] = useState("");
  // Bumped after adding a note/reminder to remount (and clear) the rich editors.
  const [composerKey, setComposerKey] = useState(0);

  // Lead → Applicant conversion (admin-configurable button + form + external API).
  const [convertCfg, setConvertCfg] = useState<ConvertConfig | null>(null);
  const [convertTarget, setConvertTarget] = useState<Lead | null>(null);      // lead being converted
  const [convertValues, setConvertValues] = useState<Record<string, string>>({});
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [convSetupOpen, setConvSetupOpen] = useState(false);                   // admin config modal
  const [convDraft, setConvDraft] = useState<ConvertConfig | null>(null);
  const [convSaving, setConvSaving] = useState(false);
  const [convHeadersText, setConvHeadersText] = useState("");                  // "Name: value" per line
  const [convExtraText, setConvExtraText] = useState("");                      // static POST body fields
  useEffect(() => { getConvertConfig().then(setConvertCfg).catch(() => {}); }, []);

  // Search applies instantly; every other filter is staged in `filters` and
  // only takes effect (→ `appliedFilters`) when the user clicks Apply.
  // Seed from a global-search deep link (?q=...) when present.
  const [search, setSearch] = useState(() => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("q") ?? "" : ""));
  const [filters, setFilters] = useState<LeadFilters>(INITIAL_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<LeadFilters>(INITIAL_FILTERS);
  const [applying, setApplying] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [page, setPage] = useState(1);
  // Active column sort (admin whole-team default + user header clicks), reported
  // by the DataTable. Sorting is done in SQL: the key+dir are sent to getLeads so
  // the query returns rows already ordered.
  const [tableSort, setTableSort] = useState<SortState>(null);
  const [perPage, setPerPage] = useState(defaultPageSize);
  const filterPrefs = useHiddenPrefs("leads_filters");
  // Client-wide admin filter layout (order + hide + panel placement). Only the
  // admin can change it; everyone else reads it. Layered on top of the per-user
  // show/hide (filterPrefs) above.
  const filterLayout = useFilterLayout("leads_filters", isAdmin);
  // Map each top-level filter id → its position in the admin's order, applied as
  // CSS flex `order` so blocks reorder without moving the JSX.
  const filterOrderIndex = useMemo(() => {
    const m: Record<string, number> = {};
    orderFilters(FILTER_LAYOUT_DEFS, filterLayout.order).forEach((d, i) => { m[d.id] = i; });
    return m;
  }, [filterLayout.order]);
  const fo = (id: string): number => filterOrderIndex[id] ?? 0;
  // One updater for any single filter field.
  function setFilter<K extends keyof LeadFilters>(key: K, value: LeadFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  // A single "Date filters" checkbox collapses/expands the whole group of date
  // filters. It opens automatically if any date filter already holds a value.
  const anyDateActive = rangeActive(filters.created) || rangeActive(filters.assignedDate) || rangeActive(filters.follow) || rangeActive(filters.updated) || rangeActive(filters.connected) || !!filters.noConnectAfter || !!filters.noUpdateAfter;
  const [datesOpen, setDatesOpen] = useState(false);
  const datesShown = datesOpen || anyDateActive;

  // Bulk selection (lead ids) for batch actions like delete.
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Bulk-edit modal: per-field "change" toggles + values + assignment mode.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bChg, setBChg] = useState({ status: false, sub: false, source: false, type: false, reference: false, created: false, assign: false });
  const [bStatus, setBStatus] = useState("");
  const [bSub, setBSub] = useState("");
  const [bSource, setBSource] = useState("");
  const [bType, setBType] = useState("");
  const [bReference, setBReference] = useState("");
  const [bCreatedMode, setBCreatedMode] = useState<"new" | "keep">("new"); // new = stamp today
  const [bMode, setBMode] = useState<"single" | "robin">("single");
  const [bAssignees, setBAssignees] = useState<string[]>([]);
  const [bAssignedAt, setBAssignedAt] = useState(""); // assignment date+time (optional)
  const [bMassAssign, setBMassAssign] = useState(false); // wipe related data → fresh lead
  const [bNotify, setBNotify] = useState(true);
  const toggleChg = (k: keyof typeof bChg) => setBChg((c) => ({ ...c, [k]: !c[k] }));

  // Import modal
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<Record<string, string>[]>([]);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<LeadImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Admin-configured template columns + the batch choices applied to every row.
  const [importCols, setImportCols] = useState<LeadImportColumn[]>([]);
  const [iStatus, setIStatus] = useState("");
  const [iSub, setISub] = useState("");
  const [iSource, setISource] = useState("");
  const [iType, setIType] = useState("");
  const [iMode, setIMode] = useState<"single" | "robin">("single");
  const [iAssignees, setIAssignees] = useState<string[]>([]);
  const [iNotify, setINotify] = useState(true);

  // Total matching leads (from SQL) — drives the page bar.
  const [total, setTotal] = useState(0);
  // Bumped to force a page + summary refetch (after create/edit/delete/bulk/etc.).
  const [fetchTick, setFetchTick] = useState(0);
  const refresh = () => setFetchTick((t) => t + 1);

  // The shared filter query (applied filters + instant search) sent to BOTH the
  // paged list and the analytics summary, so both reflect the same set.
  const filterQuery = useMemo<LeadsQuery>(() => {
    // Resolve each date range (preset OR custom) to concrete from/to bounds so
    // presets like "Today"/"Last 7 days" filter server-side too — not just custom.
    const created = resolveDateRange(appliedFilters.created);
    const assignedD = resolveDateRange(appliedFilters.assignedDate);
    const follow = resolveDateRange(appliedFilters.follow);
    const updated = resolveDateRange(appliedFilters.updated);
    const connected = resolveDateRange(appliedFilters.connected);
    // Ghosted window: the Duration Filter's two inputs (hours + mins) → total
    // minutes for the backend. When BOTH are blank, fall back to the shown
    // placeholder default of 5h; once either is typed, a blank counts as 0.
    const gh = appliedFilters.ghostHours.trim();
    const gm = appliedFilters.ghostMins.trim();
    const ghostBlank = gh === "" && gm === "";
    const ghostMins = ghostBlank ? 300 : Math.max(0, Math.round((Number(gh) || 0) * 60 + (Number(gm) || 0)));
    // Call talk-time range: collapse each H:M bound to seconds. A bound is only
    // sent when at least one of its H/M fields is filled.
    const hmToSecs = (h: string, m: string): string | undefined =>
      (h.trim() === "" && m.trim() === "") ? undefined : String(Math.max(0, Math.round(((Number(h) || 0) * 60 + (Number(m) || 0)) * 60)));
    const durSecs = appliedFilters.durOn ? hmToSecs(appliedFilters.durHours, appliedFilters.durMins) : undefined;
    const talkMin = appliedFilters.durOp === "gte" ? durSecs : undefined; // ≥ → lower bound
    const talkMax = appliedFilters.durOp === "lte" ? durSecs : undefined; // ≤ → upper bound
    return {
      q: search.trim() || undefined,
      status: appliedFilters.status,
      sub: appliedFilters.sub,
      source: appliedFilters.source,
      lead_type: appliedFilters.leadType,
      reference: appliedFilters.reference,
      assigned: appliedFilters.assigned,
      report_person: appliedFilters.reporting || undefined,
      follow_status: appliedFilters.followStatus,
      created_from: created.from,
      created_to: created.to,
      assigned_from: assignedD.from,
      assigned_to_date: assignedD.to,
      follow_from: follow.from,
      follow_to: follow.to,
      updated_from: updated.from,
      updated_to: updated.to,
      connected_from: connected.from,
      connected_to: connected.to,
      no_connect_after: appliedFilters.noConnectAfter || undefined,
      no_update_after: appliedFilters.noUpdateAfter || undefined,
      ghost_minutes: appliedFilters.ghostOn && ghostMins > 0 ? String(ghostMins) : undefined,
      ghost_op: appliedFilters.ghostOn ? appliedFilters.ghostOp : undefined,
      acalls_min: appliedFilters.callsOn ? appliedFilters.callsMin || undefined : undefined,
      acalls_max: appliedFilters.callsOn ? appliedFilters.callsMax || undefined : undefined,
      talk_min: talkMin,
      talk_max: talkMax,
    };
  }, [search, appliedFilters]);

  // The call summary scans calls across the filtered leads, so it only runs when
  // a bounded date window ≤ 1 month is selected — the Updated date (call date) is
  // preferred, else the Created date. Wider / no range → "No data" (too heavy).
  const summaryDateOk = useMemo(() => {
    const u = resolveDateRange(appliedFilters.updated);
    const c = resolveDateRange(appliedFilters.created);
    const r = (u.from && u.to) ? u : ((c.from && c.to) ? c : null);
    if (!r || !r.from || !r.to) return true; // no range → the summary defaults to today
    const span = new Date(`${r.to}T00:00:00`).getTime() - new Date(`${r.from}T00:00:00`).getTime();
    return span >= 0 && span <= 31 * 86_400_000; // a selected window must be ≤ ~1 month
  }, [appliedFilters.updated, appliedFilters.created]);

  // Static reference data + staff directory (once). Best-effort — a user who can
  // view leads but lacks leads_setup/team still gets their leads.
  useEffect(() => {
    getLeadsSetup().then((setup) => {
      setStatuses(setup.lead_statuses ?? []);
      setSources(setup.lead_sources ?? []);
      setLeadTypes(setup.lead_types ?? []);
      setReferences(setup.references ?? []);
      setStates(setup.states ?? []);
      setCities(setup.cities ?? []);
      setRequiredFields(new Set(setup.required_fields ?? []));
    }).catch(() => {});
    getStaff().then((s) => setStaff(s.staff ?? [])).catch(() => {});
  }, []);

  // Fetch ONE page from SQL whenever the page/size/sort/filters change (debounced
  // so search-as-you-type doesn't spam the server). This is the real AJAX paging.
  useEffect(() => {
    const t = setTimeout(() => {
      setApplying(true);
      getLeads({ page, per_page: perPage, sort: tableSort?.key ?? null, dir: tableSort?.dir ?? null, ...filterQuery })
        .then((l) => { setLeads(l.leads ?? []); setTotal(l.total ?? 0); })
        .catch(() => toast.error("Could not load leads."))
        .finally(() => { setApplying(false); setLoading(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [page, perPage, tableSort, filterQuery, fetchTick, toast]);

  // Keep the page in range with the (possibly shrunken) result set. After a
  // delete, a bigger page size, or a filter that trims the matches, `page` can
  // point past the last page — the server then returns an empty window while
  // `total` still reports rows, so the table looks empty though data exists.
  // Snap back to the last real page; the fetch effect above re-runs on it.
  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(total / perPage));
    if (page > lastPage) setPage(lastPage);
  }, [total, perPage, page]);

  // Summary reflects the whole filtered set (server analytics with the same
  // filters) — but ONLY fetched while the summary panel is open (on demand).
  useEffect(() => {
    if (showLead) getLeadAnalytics(filterQuery).then(setAnalytics).catch(() => {});
    // Only compute the (heavier) call summary within a ≤1-month window.
    if (showCall && summaryDateOk) getLeadCallSummary(filterQuery).then(setCallSummary).catch(() => {});
    else if (!showCall || !summaryDateOk) setCallSummary(null);
  }, [showLead, showCall, filterQuery, fetchTick, summaryDateOk]);
  useEffect(() => { getMe().then((m) => { setIsAdmin(!!m.is_admin); if (m.user?.staff_id) setMyStaff({ id: m.user.staff_id, name: m.user.name || "Me" }); setMyRef({ id: m.reference_id ?? null, name: m.reference_name ?? null }); }).catch(() => {}); }, []);
  // Admin-defined custom fields for the lead form (Form Setup).
  useEffect(() => { getFormSetup("lead").then((d) => setLeadCustomFields(d.custom_fields)).catch(() => {}); }, []);
  // The lead form is customizable PER LEAD TYPE: whenever the form is open and its
  // lead type changes, load that type's effective required + custom fields (the
  // type's override, or the base "lead" config when it has none).
  const formOpen = !!draft;
  const formType = draft?.lead_type_id ?? "";
  useEffect(() => {
    if (!formOpen) return;
    getFormSetup("lead", { type: Number(formType) || undefined, effective: true })
      .then((d) => { setRequiredFields(new Set(d.required_fields)); setLeadCustomFields(d.custom_fields); setLeadHints(d.hints ?? {}); setLeadOrder(d.order ?? []); })
      .catch(() => {});
  }, [formOpen, formType]);
  // A field's hint: the admin override, else a contextual dynamic hint, else the
  // built-in default. Empty string → no hint shown.
  const LEAD_HINT_DEFAULTS = useMemo(() => Object.fromEntries(LEAD_FIELD_HINTS.map((f) => [f.key, f.default])), []);
  const hintOf = (key: string, dynamic?: string): string | undefined =>
    (leadHints[key]?.trim()) || dynamic || LEAD_HINT_DEFAULTS[key] || undefined;
  // Deep-link to a sub-tab (e.g. notifications link to ?tab=transfers).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "transfers" || t === "visitors") setLeadTab(t);
  }, []);
  // Know the transfer mode so the request modal shows the right wording.
  useEffect(() => { if (canTransfer) getLeadTransfers().then((d) => { setTransferMode(d.mode); setTransferPending((d.transfers ?? []).filter((t) => t.status === "pending").length); }).catch(() => {}); }, [canTransfer]);
  // Visitor types/statuses for the per-lead "Log visitor" modal.
  useEffect(() => { if (canVisitors) getVisitorSetup().then((d) => { setVisitorTypes(d.types ?? []); setVisitorStatuses(d.statuses ?? []); }).catch(() => {}); }, [canVisitors]);
  // Agents can't read the team list, so build their "Assigned to" filter from the
  // distinct reps that actually own their visible (reference) leads.
  useEffect(() => { if (isAgent) getLeadAssignees().then((d) => setAgentAssignees(d.assignees ?? [])).catch(() => {}); }, [isAgent]);

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
  // A sub-status may also be tied to a lead type: when one is picked, only show
  // sub-statuses for that type (or untyped/global ones).
  const draftStatusId = draft?.status_id;
  const draftLeadTypeId = draft?.lead_type_id;
  const subOptions = useMemo(
    () => (draftStatusId
      ? statuses.filter((s) => {
          const parentMatch = (s.parent_ids ?? []).map(String).includes(draftStatusId) || String(s.parent_id ?? "") === draftStatusId;
          if (!parentMatch) return false;
          if (!draftLeadTypeId) return true;
          const tids = (s.type_ids ?? []).map(String);
          return tids.length === 0 || tids.includes(draftLeadTypeId);
        })
      : []),
    [statuses, draftStatusId, draftLeadTypeId],
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

  // Assignee options list only real "staff" — reference-scoped agents are never
  // assignees (they see leads by reference, not assignment), so they're excluded
  // from every assign picker (create/edit, bulk, import, transfer).
  const buildAssignees = useCallback((withBlank: boolean): SelectOption[] => {
    const opts = staff
      .filter((s) => !s.reference_id)
      .map((s) => ({ value: String(s.id), label: s.name }));
    return withBlank ? [{ value: "", label: "— Unassigned —" }, ...opts] : opts;
  }, [staff]);
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
  // References by name (managed list + any legacy free-text values still on leads).
  const referenceFilterOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = references.map((r) => ({ value: r.name, label: r.name, prefix: statusDot(r.color) }));
    const known = new Set(references.map((r) => r.name));
    for (const l of leads) {
      const v = (l.reference_name ?? "").trim();
      if (v && !known.has(v)) { known.add(v); opts.push({ value: v, label: v }); }
    }
    return opts;
  }, [references, leads]);
  // Assignee filter options. An AGENT can only filter by their own assignation —
  // they don't get to see or filter by other staff. Everyone else sees the full
  // staff list (incl. agents, since leads can now be assigned to them).
  const assignedFilterOptions = useMemo<SelectOption[]>(() => {
    if (isAgent) {
      // Every rep that owns one of the agent's visible leads, so they can filter
      // their reference leads by whoever they're assigned to.
      const opts = agentAssignees.map((a) => ({
        value: String(a.id),
        label: myStaff && a.id === myStaff.id ? `${a.name} (me)` : a.name,
      }));
      if (myStaff && !opts.some((o) => o.value === String(myStaff.id))) {
        opts.unshift({ value: String(myStaff.id), label: `${myStaff.name} (me)` });
      }
      return [{ value: "unassigned", label: "Unassigned" }, ...opts];
    }
    const opts = staff.map((s) => ({ value: String(s.id), label: s.reference_id ? `${s.name} (agent)` : s.name }));
    if (myStaff && !opts.some((o) => o.value === String(myStaff.id))) {
      opts.push({ value: String(myStaff.id), label: `${myStaff.name} (me)` });
    }
    return [{ value: "unassigned", label: "Unassigned" }, ...opts];
  }, [staff, myStaff, isAgent, agentAssignees]);
  // Transfer / Log-visitor are limited, for an agent, to their REFERENCE leads —
  // not leads merely assigned to them. Non-agents keep normal visibility.
  const isMyRefLead = useCallback(
    (l: Lead) =>
      !isAgent ||
      (myRef.id != null && Number(l.reference_id) === myRef.id) ||
      (!!myRef.name && (l.reference_name ?? "") === myRef.name),
    [isAgent, myRef],
  );
  // Suggest a single "reporting person" — the team leader (reports_to) — for the
  // picked assignees, surfaced at the top of the Reporting Person dropdown but NOT
  // auto-selected. Works for one OR several selected counsellors: it tallies each
  // rep's leader and offers the MOST COMMON one, so a single parent is shown even
  // when a rep has no leader set or the reps span more than one. Ids are coerced
  // (CI4 returns them as strings) so the match never fails on string-vs-number.
  const suggestedLeader = useMemo(() => {
    const picked = filters.assigned.filter((a) => a !== "unassigned");
    if (picked.length === 0) return null;
    const tally = new Map<number, number>();
    for (const id of picked) {
      const a = staff.find((s) => String(s.id) === id);
      const p = a?.reports_to != null ? Number(a.reports_to) : 0;
      if (p) tally.set(p, (tally.get(p) ?? 0) + 1);
    }
    if (tally.size === 0) return null; // none of the picked reps has a team leader
    const leaderId = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const leader = staff.find((s) => Number(s.id) === leaderId && !s.reference_id);
    return leader ? { id: leader.id, name: leader.name } : null;
  }, [filters.assigned, staff]);

  // A "reporting person" is a team leader — someone other staff report up to.
  // The Reporting Person filter is limited to admins, agents and these leaders;
  // an individual-contributor staff member (nobody reports to them) doesn't see it.
  const isTeamLeader = useMemo(
    () => !!myStaff && staff.some((s) => Number(s.reports_to) === myStaff.id),
    [staff, myStaff],
  );
  const canSeeReporting = isAdmin || isAgent || isTeamLeader;

  // Reporting Person options: ONLY the single reporting person of the selected
  // assignee(s) — their common team leader — plus the default that falls back to
  // each lead's own assigned rep. We deliberately do NOT list the whole team;
  // the field exists to see that one leader's calls in the Call Count/Duration
  // columns once you've filtered by their reps.
  const reportingOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [{ value: "", label: "— Assigned rep (default) —" }];
    if (suggestedLeader) opts.push({ value: String(suggestedLeader.id), label: `${suggestedLeader.name} (team leader)` });
    return opts;
  }, [suggestedLeader]);

  // Options for the searchable selects in the Add/Edit lead form. These differ
  // from the filter options: each carries a blank "none" row and the form's
  // sub-status list is narrowed to the status picked in the draft.
  const formSubOptions = useMemo<SelectOption[]>(
    () => [{ value: "", label: "— None —" }, ...subOptions.map((s) => ({ value: String(s.id), label: s.name, prefix: statusDot(s.color) }))],
    [subOptions],
  );
  const formSourceOptions = useMemo<SelectOption[]>(
    () => [{ value: "", label: "— None —" }, ...sources.map((s) => ({ value: String(s.id), label: s.marketing_type ? `${s.name} · ${s.marketing_type}` : s.name, prefix: statusDot(s.color) }))],
    [sources],
  );
  const formAssignedOptions = useMemo<SelectOption[]>(
    () => buildAssignees(true),
    [buildAssignees],
  );
  const formLeadTypeOptions = useMemo<SelectOption[]>(
    () => [{ value: "", label: "— None —" }, ...leadTypes.map((t) => ({ value: String(t.id), label: t.name, prefix: statusDot(t.color) }))],
    [leadTypes],
  );
  // References store the reference NAME on the lead (back-compat + name-based
  // scoping). A legacy free-text value not in the managed list is kept as an
  // option so editing a lead never silently drops it.
  const formReferenceOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = references.map((r) => ({ value: r.name, label: r.name, prefix: statusDot(r.color) }));
    const cur = (draft?.reference_name ?? "").trim();
    if (cur && !references.some((r) => r.name === cur)) opts.unshift({ value: cur, label: `${cur} (existing)` });
    return [{ value: "", label: "— None —" }, ...opts];
  }, [references, draft?.reference_name]);
  // Bulk-edit: sub-statuses under the chosen bulk status; team members for round-robin.
  const bulkSubOptions = useMemo<SelectOption[]>(
    () => [{ value: "", label: "— None —" }, ...allSubStatuses
      .filter((s) => !bStatus || (s.parent_ids ?? []).map(String).includes(bStatus) || String(s.parent_id ?? "") === bStatus)
      .map((s) => ({ value: String(s.id), label: s.name, prefix: statusDot(s.color) }))],
    [allSubStatuses, bStatus],
  );
  // Bulk modal assignee lists, reference-aware to the selected leads' reference.
  const bulkAssignOptions = useMemo<SelectOption[]>(() => buildAssignees(true), [buildAssignees]);
  const robinOptions = useMemo<SelectOption[]>(() => buildAssignees(false), [buildAssignees]);
  // Lead options for the per-lead "Log visitor" modal's optional lead link.
  const leadVisitorOpts = useMemo<SelectOption[]>(
    () => [{ value: "", label: "— Not linked —" }, ...leads.map((l) => ({ value: String(l.id), label: l.name?.trim() || l.phone }))],
    [leads],
  );
  // State/City selects store the chosen NAME (kept in the lead's city/state text).
  // City is cascaded: only cities under the selected state show. A legacy/free-text
  // value not in the managed lists is preserved as its own option so editing never
  // silently drops it.
  // City/State are creatable: the datalists below suggest all-India states +
  // cities, merged with this client's configured lookups and any values already
  // used on existing leads (so a freshly-typed value is "remembered" next time).
  // Free typing is always accepted — the lead just stores the text.
  const leadStateValues = useMemo(
    () => Array.from(new Set(leads.map((l) => (l.state ?? "").trim()).filter(Boolean))),
    [leads],
  );
  const leadCitiesByState = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of leads) {
      const city = (l.city ?? "").trim();
      if (!city) continue;
      const st = (l.state ?? "").trim();
      if (!m.has(st)) m.set(st, new Set());
      m.get(st)!.add(city);
    }
    return m;
  }, [leads]);
  const stateSuggestions = useMemo(
    () => Array.from(new Set([...INDIA_STATES, ...states.map((s) => s.name), ...leadStateValues])).sort((a, b) => a.localeCompare(b)),
    [states, leadStateValues],
  );
  const citySuggestions = useMemo(() => {
    const st = (draft?.state ?? "").trim();
    const set = new Set<string>();
    if (st) {
      (INDIA_CITIES[st] ?? []).forEach((c) => set.add(c));
      cities.filter((c) => c.state === st).forEach((c) => set.add(c.name));
      (leadCitiesByState.get(st) ?? new Set<string>()).forEach((c) => set.add(c));
    } else {
      cities.forEach((c) => set.add(c.name));
      leadCitiesByState.forEach((s) => s.forEach((c) => set.add(c)));
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [draft?.state, cities, leadCitiesByState]);

  // Filtering, sorting and paging all happen in SQL now — `leads` IS the current
  // page of matching rows, and `total` is the full matching count.

  // Keep the selection in step with the data — drop ids that no longer exist.
  const selectedLeads = useMemo(() => leads.filter((l) => selectedIds.has(l.id)), [leads, selectedIds]);

  const draftDirty = useMemo(() => JSON.stringify(filters) !== JSON.stringify(appliedFilters), [filters, appliedFilters]);
  const activeFilters = !!search || filtersActive(appliedFilters);
  const appliedFilterCount = useMemo(() => countActiveFilters(appliedFilters), [appliedFilters]);

  // Commit the staged filters — the fetch effect refetches page 1 (and shows the
  // `applying` loader). The rail stays open so the table updates beside it.
  function applyFilters() {
    setAppliedFilters(filters);
    setPage(1);
    setSelectedIds(new Set());
  }
  function clearFilters() {
    setSearch("");
    setFilters(BLANK_FILTERS);
    setAppliedFilters(BLANK_FILTERS);
    setDatesOpen(false); // collapse the date filters
    setPage(1);
    setSelectedIds(new Set());
  }
  function onSearchChange(v: string) {
    setSearch(v);
    setPage(1);
    setSelectedIds(new Set());
  }

  // ---- lead summary ----
  // Card-grid click: filter the table by one value of the given dimension
  // (toggles off when it's already the sole active filter for that dimension).
  function pickDimId(fk: "status" | "sub" | "leadType" | "source", id: number) {
    const next = (cur: string[]) => (cur.length === 1 && cur[0] === String(id) ? [] : [String(id)]);
    setFilters((f) => ({ ...f, [fk]: next(f[fk]) }));
    setAppliedFilters((f) => ({ ...f, [fk]: next(f[fk]) }));
    setPage(1);
    setSelectedIds(new Set());
  }

  function openNew() { setErrors({}); setDraft({ ...blank }); }
  function openEdit(l: Lead) {
    if (l.converted_at) { toast.error("This lead is converted to an applicant and is locked — it can't be edited."); return; }
    setErrors({}); setDraft(toDraft(l));
  }

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

  // ---- Lead → Applicant conversion ----
  function openConvert(l: Lead) {
    // Pre-fill a convert field from the matching lead field — mapping common
    // aliases (e.g. a field keyed "phonenumber"/"mobile" fills from the lead's phone).
    const ALIAS: Record<string, string> = {
      phonenumber: "phone", mobile: "phone", contact: "phone", phone_number: "phone",
      full_name: "name", customer_name: "name", applicant_name: "name",
      email_id: "email", emailaddress: "email",
    };
    const rec = l as unknown as Record<string, unknown>;
    const seed: Record<string, string> = {};
    for (const f of convertCfg?.fields ?? []) {
      const v = rec[f.key] ?? rec[ALIAS[f.key] ?? ""];
      if (typeof v === "string" || typeof v === "number") seed[f.key] = String(v);
    }
    setConvertValues(seed);
    setConvertError(null);
    setConvertTarget(l);
  }
  async function submitConvert() {
    if (!convertTarget || !convertCfg) return;
    const missing = convertCfg.fields.filter((f) => f.required && !(convertValues[f.key] ?? "").trim());
    if (missing.length) { toast.error(`Please fill: ${missing.map((f) => f.label).join(", ")}`); return; }
    setConverting(true);
    setConvertError(null);
    try {
      await convertLead(convertTarget.id, convertValues);
      toast.success("Lead converted to applicant.");
      setConvertTarget(null);
      closeView();
      refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not convert the lead.";
      setConvertError(msg);   // full detail (URL + reason) shown inline in the modal
      toast.error(msg);
    } finally {
      setConverting(false);
    }
  }
  const emptyConvert: ConvertConfig = { enabled: false, label: "Convert to Applicant", status_id: 0, fields: [], api_url: "", api_method: "POST", api_type: "json", api_headers: {}, api_key_header: "X-Api-Key", has_api_key: false, api_key: "" };
  function openConvSetup() {
    setConvDraft(convertCfg ? { ...emptyConvert, ...convertCfg, fields: [...(convertCfg.fields ?? [])] } : emptyConvert);
    // Headers edited as "Name: value" lines (admin-managed — CSRF token, auth, etc.).
    setConvHeadersText(Object.entries(convertCfg?.api_headers ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n"));
    setConvExtraText(Object.entries(convertCfg?.extra_fields ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n"));
    setConvSetupOpen(true);
  }
  async function saveConvSetup() {
    if (!convDraft) return;
    // The API endpoint is only needed in 'shared' mode; 'own' mode writes to the applicant table.
    const ownMode = convertCfg?.applicant_mode === "own";
    if (convDraft.enabled && !ownMode && !(convDraft.api_url ?? "").trim()) { toast.error("Enter the API endpoint URL."); return; }
    // Parse the "Name: value" textareas → maps (headers + static body fields).
    const parseLines = (text: string): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const line of text.split("\n")) {
        const idx = line.indexOf(":");
        if (idx < 1) continue;
        const k = line.slice(0, idx).trim();
        if (k) out[k] = line.slice(idx + 1).trim();
      }
      return out;
    };
    setConvSaving(true);
    try {
      const saved = await saveConvertConfig({ ...convDraft, api_headers: parseLines(convHeadersText), extra_fields: parseLines(convExtraText) });
      setConvertCfg(saved);
      setConvSetupOpen(false);
      toast.success("Conversion settings saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setConvSaving(false);
    }
  }

  async function addReminder() {
    if (!viewing) return;
    setReminderErr("");
    if (!remindAt) { setReminderErr("Pick a date and time."); return; }
    if (new Date(remindAt).getTime() <= Date.now()) { setReminderErr("Choose a future date and time."); return; }
    if (!stripHtml(reminderNote).trim()) { setReminderErr("Add a note for this reminder."); return; }
    setSavingReminder(true);
    try {
      await createLeadReminder(viewing.id, { remind_at: remindAt, note: reminderNote });
      requestNotifyPermission(); // so the alert can fire when it's due
      setRemindAt(followReminderDefault(viewing)); setReminderNote(""); setComposerKey((k) => k + 1);
      toast.success("Reminder set.");
      await loadDetail(viewing.id);
      refresh(); // follow-up date is reminder-driven — refresh the table too
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
      refresh(); // keep the reminder-driven follow-up date in sync in the table
      toast.success("Reminder removed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove reminder.");
    }
  }

  function startEditReminder(r: { id: number; remind_at: string; note: string | null }) {
    setEditingReminder(r.id);
    setEditRemindAt(toLocalInput(new Date(r.remind_at.replace(" ", "T"))));
    setEditReminderNote(r.note ?? "");
    setEditReminderErr("");
  }
  function cancelEditReminder() {
    setEditingReminder(null);
    setEditRemindAt("");
    setEditReminderNote("");
    setEditReminderErr("");
  }
  async function saveEditReminder(rid: number) {
    setEditReminderErr("");
    if (!editRemindAt) { setEditReminderErr("Pick a date and time."); return; }
    setSavingReminder(true);
    try {
      await updateLeadReminder(rid, { remind_at: editRemindAt, note: stripHtml(editReminderNote) ? editReminderNote : undefined });
      cancelEditReminder();
      if (viewing) await loadDetail(viewing.id);
      refresh();
      toast.success("Reminder updated.");
    } catch (e) {
      setEditReminderErr(e instanceof Error ? e.message : "Could not update reminder.");
    } finally {
      setSavingReminder(false);
    }
  }

  async function addNote() {
    if (!viewing || !stripHtml(noteBody)) return;
    setSavingNote(true);
    try {
      await createLeadNote(viewing.id, noteBody);
      setNoteBody(""); setComposerKey((k) => k + 1);
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

  function startEditNote(n: { id: number; body: string }) {
    setEditingNote(n.id);
    setEditNoteBody(n.body);
  }
  function cancelEditNote() {
    setEditingNote(null);
    setEditNoteBody("");
  }
  async function saveEditNote(nid: number) {
    if (!stripHtml(editNoteBody)) return;
    setSavingNote(true);
    try {
      await updateLeadNote(nid, editNoteBody);
      cancelEditNote();
      if (viewing) await loadDetail(viewing.id);
      toast.success("Note updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update note.");
    } finally {
      setSavingNote(false);
    }
  }

  function setField<K extends keyof Draft>(key: K) {
    return (v: string) =>
      setDraft((d) => {
        if (!d) return d;
        const next = { ...d, [key]: v };
        // A sub-status is scoped by both status and lead type, so changing
        // either may invalidate the chosen sub-status — clear it.
        if (key === "status_id" || key === "lead_type_id") next.sub_status_id = "";
        // Changing state clears a city that belonged to the previous state.
        if (key === "state") next.city = "";
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
    // Admin-configured mandatory fields (Leads Setup → Required Fields).
    for (const key of requiredFields) {
      if (e[key]) continue; // a format error already covers this field
      // Skip the assignee requirement whenever the field is masked: agents never
      // see it, and on create a staff member's lead is auto-assigned to them.
      if (key === "assigned_to" && (isAgent || (!isAdmin && !draft.id))) continue;
      const val = (draft as unknown as Record<string, unknown>)[key];
      if (typeof val === "string" ? !val.trim() : !val) {
        e[key] = `${LEAD_FIELD_LABELS[key] ?? key} is required.`;
      }
    }
    Object.assign(e, customFieldErrors(leadCustomFields, draft.custom));
    setErrors(e);
    if (Object.keys(e).length) return;

    setSaving(true);
    try {
      // Persist the reference's stable id (resolved from the chosen name) so the
      // lead stays linked even if the reference is renamed later. Legacy free-text
      // values that map to no reference send 0 and keep their name.
      const referenceId = references.find((r) => r.name === draft.reference_name)?.id ?? 0;
      const body = { ...draft, reference_id: referenceId, phone: digits, alt_phone: altDigits, custom_fields: draft.custom };
      if (draft.id) await updateLead(draft.id, body);
      else await createLead(body);
      toast.success(draft.id ? "Lead updated." : "Lead added.");
      setDraft(null);
      refresh();
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
      refresh();
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
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete leads.");
    } finally {
      setBulkBusy(false);
    }
  }

  function openBulk() {
    setBChg({ status: false, sub: false, source: false, type: false, reference: false, created: false, assign: false });
    setBStatus(""); setBSub(""); setBSource(""); setBType(""); setBReference(""); setBCreatedMode("new");
    setBMode("single"); setBAssignees([]); setBAssignedAt(""); setBMassAssign(false); setBNotify(true);
    setBulkOpen(true);
  }

  async function applyBulk() {
    const ids = selectedLeads.map((l) => l.id);
    if (!ids.length) return;
    if (!Object.values(bChg).some(Boolean) && !bMassAssign) { toast.warning("Tick at least one field to change."); return; }
    if (bChg.status && !bStatus) { toast.warning("Pick a status to apply."); return; }
    if (bChg.assign && bMode === "robin" && bAssignees.length < 2) { toast.warning("Pick 2+ members for round-robin."); return; }
    setBulkSaving(true);
    try {
      const body: Record<string, unknown> = {
        ids,
        change_status: bChg.status, status_id: bStatus,
        change_sub_status: bChg.sub, sub_status_id: bSub,
        change_source: bChg.source, source_id: bSource,
        change_type: bChg.type, lead_type_id: bType,
        change_reference: bChg.reference, reference_id: references.find((r) => r.name === bReference)?.id ?? 0, reference_name: bReference,
        change_created: bChg.created, created_mode: bCreatedMode,
        change_assignee: bChg.assign, assign_mode: bMode, assignees: bMode === "single" ? (bAssignees[0] ? [bAssignees[0]] : []) : bAssignees,
        assigned_at: bAssignedAt || undefined,
        mass_assign: bMassAssign,
        notify: bNotify,
      };
      const res = await bulkUpdateLeads(body);
      toast.success(res.message);
      setBulkOpen(false);
      setSelectedIds(new Set());
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk update failed.");
    } finally {
      setBulkSaving(false);
    }
  }

  // ---- import ----
  function openImport() {
    setImportResult(null); setImportRows([]); setImportInfo(null);
    setIStatus(""); setISub(""); setISource(""); setIType(""); setIMode("single"); setIAssignees([]); setINotify(true);
    getLeadImportSetup().then((d) => setImportCols(d.columns)).catch(() => {});
    setImportOpen(true);
  }
  function pickFile() { setImportResult(null); fileRef.current?.click(); }

  // The headers the sheet may use → our column keys (built-ins + custom labels/keys).
  const headerAlias = useMemo(() => {
    const m: Record<string, string> = { ...HEADER_ALIAS };
    importCols.forEach((c) => { m[normHeader(c.label)] = c.key; m[normHeader(c.key)] = c.key; });
    return m;
  }, [importCols]);

  function gridToRows(grid: string[][]) {
    if (grid.length < 2) { setImportRows([]); setImportInfo("The file has a header but no data rows."); return; }
    const headers = grid[0].map((h) => headerAlias[normHeader(String(h))] ?? normHeader(String(h)));
    const rows = grid.slice(1).map((cells) => {
      const obj: Record<string, string> = {};
      headers.forEach((key, idx) => { obj[key] = String(cells[idx] ?? "").trim(); });
      return obj;
    });
    setImportRows(rows);
    setImportInfo(`${rows.length} row${rows.length === 1 ? "" : "s"} found.`);
  }

  async function onFile(file: File) {
    setImportResult(null);
    const isCsv = /\.csv$/i.test(file.name);
    if (isCsv) {
      const reader = new FileReader();
      reader.onload = () => gridToRows(parseCSV(String(reader.result ?? "")));
      reader.readAsText(file);
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "", raw: false, blankrows: false });
      gridToRows(grid as unknown as string[][]);
    } catch {
      toast.error("Could not read that file. Upload a .xlsx or .csv.");
    }
  }

  // Client-side preview of which rows will be skipped (server re-validates).
  const importIssues = useMemo(() => {
    const req = importCols.filter((c) => c.required && c.key !== "phone");
    const out: { row: number; message: string }[] = [];
    importRows.forEach((r, i) => {
      const line = i + 2;
      const phone = (r.phone ?? "").replace(/\D/g, "");
      if (!phone) { out.push({ row: line, message: "Contact (phone) is required." }); return; }
      if (phone.length !== 10) { out.push({ row: line, message: "Phone must be exactly 10 digits." }); return; }
      const email = (r.email ?? "").trim();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { out.push({ row: line, message: "Invalid email address." }); return; }
      const miss = req.filter((c) => !(r[c.key] ?? "").trim()).map((c) => c.label);
      if (miss.length) out.push({ row: line, message: `${miss.join(", ")} ${miss.length > 1 ? "are" : "is"} required.` });
    });
    return out;
  }, [importRows, importCols]);
  const readyCount = importRows.length - importIssues.length;

  const importSubOptions = useMemo<SelectOption[]>(() => {
    if (!iStatus) return [];
    // parent_ids come back as ints but iStatus is a string — compare as strings
    // (and keep the legacy single parent_id fallback), matching the other pickers.
    return statuses
      .filter((s) => (s.parent_ids ?? []).map(String).includes(iStatus) || String(s.parent_id ?? "") === iStatus)
      .map((s) => ({ value: String(s.id), label: s.name, prefix: statusDot(s.color) }));
  }, [statuses, iStatus]);
  const staffOptions = useMemo<SelectOption[]>(() => buildAssignees(false), [buildAssignees]);

  async function runImport() {
    if (!importRows.length) return;
    if (!iStatus) { toast.warning("Pick a status to apply to the imported leads."); return; }
    if (iMode === "robin" && iAssignees.length < 2) { toast.warning("Round-robin needs at least 2 members."); return; }
    setImporting(true); setImportResult(null);
    try {
      const assignees = (iMode === "single" ? iAssignees.slice(0, 1) : iAssignees).map(Number).filter(Boolean);
      const r = await importLeads(importRows, {
        status_id: Number(iStatus),
        sub_status_id: iSub ? Number(iSub) : null,
        source_id: iSource ? Number(iSource) : null,
        lead_type_id: iType ? Number(iType) : null,
        assign_mode: iMode,
        assignees,
        notify: iNotify,
      });
      setImportResult(r);
      if (r.inserted) {
        toast.success(`Imported ${r.inserted} lead${r.inserted === 1 ? "" : "s"}.`);
        refresh();
      } else {
        toast.warning("No leads were imported.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  // Template = only the columns the admin chose to include.
  function downloadTemplateCsv() {
    const { headers, rows } = importTemplate(importCols);
    const csv = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url; a.download = "leads-import-template.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  async function downloadTemplateXlsx() {
    const { headers, rows } = importTemplate(importCols);
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Leads");
    XLSX.writeFile(wb, "leads-import-template.xlsx");
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

  const allColumns: Column<Lead>[] = [
    { key: "name", header: "Name", width: 180, lockVisible: true, render: (l) => <span className="font-medium text-slate-800">{l.name?.trim() || dash}</span> },
    { key: "phone", header: "Phone", width: 130, render: (l) => (l.phone ? <a href={`tel:${l.phone}`} onClick={(e) => e.stopPropagation()} title={`Call ${l.phone}`} className="tabular-nums text-emerald-700 hover:underline">{l.phone}</a> : dash) },
    { key: "status", header: "Status", width: 210, render: statusChip },
    { key: "lead_type", header: "Type", width: 140, render: typeChip },
    { key: "source", header: "Source", width: 140, render: sourceChip },
    { key: "assigned", header: "Assigned", width: 150, sortAccessor: (l) => l.assigned_to_name, render: (l) => l.assigned_to_name ?? dash },
    { key: "city", header: "City", width: 120, render: (l) => l.city ?? dash },
    // Follow-up shows the lead's latest reminder (date over time); blank if none.
    { key: "follow_date", header: "Follow-up", width: 140, sortAccessor: (l) => l.last_reminder_at, render: (l) => stackedDateTime(l.last_reminder_at) },
    // Latest call of any status (connected or not) to this lead's phone.
    { key: "last_call", header: "Last call", width: 150, sortAccessor: (l) => l.last_call_at ?? null, render: (l) => stackedDateTime(l.last_call_at) },
    // Latest connected (answered) call.
    { key: "last_connected", header: "Last connected", width: 150, sortAccessor: (l) => l.last_connected_at ?? null, render: (l) => stackedDateTime(l.last_connected_at) },
    // Total calls to this lead's number (any staff).
    { key: "call_count", header: "Total calls", width: 110, align: "right", sortAccessor: (l) => l.call_count ?? 0, render: (l) => <span className="tabular-nums text-slate-700">{l.call_count ?? 0}</span> },
    // Reporting-person columns: the Call Count & Duration reflect the Reporting
    // Person filter's own calls (or the assigned rep when none is selected) — this
    // "Call Count" already covers the assigned rep, so no separate "Assigned calls".
    { key: "person_call_count", header: "Call Count", width: 120, align: "right", sortAccessor: (l) => l.person_call_count ?? 0, render: (l) => <span className="tabular-nums text-slate-700">{l.person_call_count ?? 0}</span> },
    { key: "total_duration", header: "Total Duration", width: 130, align: "right", sortAccessor: (l) => l.total_duration ?? 0, render: (l) => <span className="tabular-nums text-slate-700">{l.total_duration ? fmtDuration(l.total_duration) : dash}</span> },
    { key: "person_call_duration", header: "Duration", width: 120, align: "right", sortAccessor: (l) => l.person_call_duration ?? 0, render: (l) => <span className="tabular-nums text-slate-600">{l.person_call_duration ? fmtDuration(l.person_call_duration) : dash}</span> },
    // Follow-up status flag (orange upcoming / red overdue / green done), server-computed.
    { key: "follow_flag", header: "Follow-up status", width: 150, render: (l) => followFlagBadge(l.follow_flag) ?? dash },
    // First-response SLA: working time from assignment → first connected call by the assigned user.
    { key: "first_response", header: "First response", width: 130, sortAccessor: (l) => (l.first_response_seconds == null ? null : Number(l.first_response_seconds)), render: (l) => <span className="tabular-nums text-slate-600">{fmtDuration(l.first_response_seconds)}</span> },
    { key: "assigned_date", header: "Assigned date", width: 140, render: (l) => stackedDateTime(l.assigned_date) },
    { key: "created_date", header: "Created", width: 150, sortAccessor: (l) => l.created_at, render: (l) => stackedDateTime(l.created_at) },
    { key: "updated_at", header: "Last updated", width: 150, render: (l) => stackedDateTime(l.updated_at) },
    // Available via the Columns menu, hidden until the user opts in.
    { key: "email", header: "Email", width: 210, defaultHidden: true, render: (l) => (l.email ? <span className="text-slate-600">{l.email}</span> : dash) },
    { key: "alt_phone", header: "Alt. phone", width: 130, defaultHidden: true, render: (l) => (l.alt_phone ? <a href={`tel:${l.alt_phone}`} onClick={(e) => e.stopPropagation()} title={`Call ${l.alt_phone}`} className="tabular-nums text-emerald-700 hover:underline">{l.alt_phone}</a> : dash) },
    { key: "sub_status", header: "Sub status", width: 150, defaultHidden: true, render: (l) => l.sub_status ?? dash },
    { key: "reference_name", header: "Reference", width: 150, defaultHidden: true, render: (l) => l.reference_name ?? dash },
    { key: "state", header: "State", width: 120, defaultHidden: true, render: (l) => l.state ?? dash },
  ];
  // Hide the "Last call" column only for users without the call-tracking
  // permission. Reference-scoped agents now see every column (incl. assignment)
  // over their own reference-scoped leads.
  const hiddenColKeys = new Set<string>([
    ...(canViewCalls ? [] : ["last_call", "last_connected", "total_duration", "person_call_count", "person_call_duration"]),
  ]);
  const columns = hiddenColKeys.size ? allColumns.filter((c) => !hiddenColKeys.has(c.key)) : allColumns;

  // Server paginates: `leads` is already the current page (filtered + sorted in
  // SQL); `total` is the full matching count. Clamp the page defensively.
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, totalPages);
  const pageRows = leads;

  const selCls = "rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15";

  // Leads | Transfers | Visitors tab bar (only when those features are enabled).
  const leadSubTabs: [typeof leadTab, string][] = [["leads", "Leads"]];
  if (canTransfer) leadSubTabs.push(["transfers", "Transfers"]);
  if (canVisitors) leadSubTabs.push(["visitors", "Visitors"]);
  const leadTabsBar = leadSubTabs.length > 1 ? (
    <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1">
      {leadSubTabs.map(([v, lbl]) => (
        <button key={v} onClick={() => setLeadTab(v)} className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition ${leadTab === v ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>
          {lbl}
          {v === "transfers" && transferPending > 0 && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${leadTab === v ? "bg-white/25 text-white" : "bg-amber-500 text-white"}`}>{transferPending}</span>
          )}
        </button>
      ))}
    </div>
  ) : null;

  // Sub-tabs render standalone so the heavy leads UI stays untouched.
  if (canTransfer && leadTab === "transfers") {
    return (
      <>
        <PageHeader title="Leads" subtitle="Transfer requests — request, approve and track lead hand-offs." />
        {leadTabsBar}
        <TransfersTab onPendingChange={setTransferPending} />
      </>
    );
  }
  if (canVisitors && leadTab === "visitors") {
    return (
      <>
        <PageHeader title="Leads" subtitle="Visitor requests — log office / seminar / other visits and track their status." />
        {leadTabsBar}
        <VisitorsTab />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Your leads database — add, assign and track every lead."
        action={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button onClick={openConvSetup} title="Configure the Convert-to-Applicant button, form and API" className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Convert setup
              </button>
            )}
            {can("data_import", "create") && (
              <button onClick={openImport} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3v12m0-12L8 7m4-4l4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Import
              </button>
            )}
            {can("leads", "create") && (
              <button onClick={openNew} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
                Add lead
              </button>
            )}
          </div>
        }
      />

      {leadTabsBar}

      {/* Filters open a full-height right rail (shared FilterRail); this slim bar
          toggles it and shows what's applied. The table search stays instant. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FilterToggle open={filterDrawerOpen} count={appliedFilterCount} onClick={() => { if (!filterDrawerOpen) setFilters(appliedFilters); setFilterDrawerOpen((o) => !o); }} />
          {isAdmin && <FilterLayoutMenu api={filterLayout} defs={FILTER_LAYOUT_DEFS} />}
          {/* Two independent summary toggles — Lead and Call can show together. */}
          {([["Lead Summary", showLead, setShowLead], ["Call Summary", showCall, setShowCall]] as [string, boolean, (u: (s: boolean) => boolean) => void][]).map(([label, on, set]) => (
            <button
              key={label}
              type="button"
              onClick={() => set((s) => !s)}
              aria-pressed={on}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${on ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              <svg className="h-4 w-4 text-indigo-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 19V5m0 14h16M8 17v-5m4 5V8m4 9v-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-slate-400">
            {total.toLocaleString()} lead{total === 1 ? "" : "s"}{activeFilters ? " match your filters" : ""}.
          </p>
          {activeFilters && (
            <button onClick={clearFilters} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Clear filters</button>
          )}
        </div>
      </div>

      <FilterRail
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        dirty={draftDirty}
        onReset={() => { setFilters(BLANK_FILTERS); setDatesOpen(false); }}
        resetDisabled={!filtersActive(filters)}
        onApply={applyFilters}
        applying={applying}
        placement={filterLayout.placement}
      >
        {isAdmin && (
          <div className="flex items-center justify-end" style={{ order: -1 }}>
            <VisibilityMenu api={filterPrefs} items={FILTER_DEFS} buttonLabel="Customize" title="Show / hide filters" />
          </div>
        )}

        {!filterPrefs.isHidden("status") && !filterLayout.isHidden("status") && (
          <label className="flex flex-col gap-1" style={{ order: fo("status") }}>
            <FilterLabel>Status</FilterLabel>
            <MultiSelect ariaLabel="Filter by status" value={filters.status}
              onChange={(v) => setFilters((f) => ({ ...f, status: v, sub: v.length ? f.sub.filter((id) => allSubStatuses.some((s) => String(s.id) === id && ((s.parent_ids ?? []).map(String).some((p) => v.includes(p)) || v.includes(String(s.parent_id ?? ""))))) : f.sub }))}
              options={statusFilterOptions} placeholder="All statuses" searchPlaceholder="Search status…" />
          </label>
        )}

        {!filterPrefs.isHidden("sub") && !filterLayout.isHidden("sub") && (
          <label className="flex flex-col gap-1" style={{ order: fo("sub") }}>
            <FilterLabel>Sub status</FilterLabel>
            <MultiSelect ariaLabel="Filter by sub status" value={filters.sub} onChange={(v) => setFilter("sub", v)} options={subFilterOptions} placeholder="All sub statuses" searchPlaceholder="Search sub status…" />
          </label>
        )}

        {!filterPrefs.isHidden("source") && !filterLayout.isHidden("source") && (
          <label className="flex flex-col gap-1" style={{ order: fo("source") }}>
            <FilterLabel>Source</FilterLabel>
            <MultiSelect ariaLabel="Filter by source" value={filters.source} onChange={(v) => setFilter("source", v)} options={sourceFilterOptions} placeholder="All sources" searchPlaceholder="Search source…" />
          </label>
        )}

        {canSeeReporting && filters.assigned.length > 0 && !filterPrefs.isHidden("reporting") && !filterLayout.isHidden("reporting") && (
          <label className="flex flex-col gap-1" style={{ order: fo("reporting") }}>
            <FilterLabel>Reporting Person</FilterLabel>
            <SearchSelect ariaLabel="Reporting person for call columns" value={filters.reporting} onChange={(v) => setFilter("reporting", v)} options={reportingOptions} placeholder="— Assigned rep (default) —" searchPlaceholder="Search team…" />
            <span className="text-[11px] text-slate-400">Sets whose calls the <b>Call Count</b> &amp; <b>Duration</b> columns show. Doesn&apos;t filter the list. {suggestedLeader ? <>Reporting person: <b>{suggestedLeader.name}</b> (team leader of the selected reps).</> : "The selected reps don't share one team leader."}</span>
          </label>
        )}

        {!filterPrefs.isHidden("assigned") && !filterLayout.isHidden("assigned") && (
          <label className="flex flex-col gap-1" style={{ order: fo("assigned") }}>
            <FilterLabel>Assigned to</FilterLabel>
            <MultiSelect ariaLabel="Filter by assignee" value={filters.assigned} onChange={(v) => { setFilter("assigned", v); if (v.length === 0) setFilter("reporting", ""); }} options={assignedFilterOptions} placeholder="Anyone" searchPlaceholder="Search team…" />
          </label>
        )}

        {!filterPrefs.isHidden("leadType") && !filterLayout.isHidden("leadType") && (
          <label className="flex flex-col gap-1" style={{ order: fo("leadType") }}>
            <FilterLabel>Lead type</FilterLabel>
            <MultiSelect ariaLabel="Filter by lead type" value={filters.leadType} onChange={(v) => setFilter("leadType", v)} options={leadTypeFilterOptions} placeholder="All types" searchPlaceholder="Search type…" />
          </label>
        )}

        {!filterPrefs.isHidden("followStatus") && !filterLayout.isHidden("followStatus") && (
          <label className="flex flex-col gap-1" style={{ order: fo("followStatus") }}>
            <FilterLabel>Follow-up status</FilterLabel>
            <MultiSelect ariaLabel="Filter by follow-up status" value={filters.followStatus} onChange={(v) => setFilter("followStatus", v)} options={FOLLOW_STATUS_OPTIONS} placeholder="Any status" searchPlaceholder="Search status…" />
          </label>
        )}

        {!isAgent && !filterPrefs.isHidden("reference") && !filterLayout.isHidden("reference") && (
          <label className="flex flex-col gap-1" style={{ order: fo("reference") }}>
            <FilterLabel>Reference</FilterLabel>
            <MultiSelect ariaLabel="Filter by reference" value={filters.reference} onChange={(v) => setFilter("reference", v)} options={referenceFilterOptions} placeholder="All references" searchPlaceholder="Search reference…" />
          </label>
        )}

        {/* Single "Date filters" checkbox collapses/expands all the date filters. */}
        {!filterLayout.isHidden("dates") && (
        <div className="flex flex-col gap-4" style={{ order: fo("dates") }}>
        <label className="flex cursor-pointer items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date filters</span>
          <input type="checkbox" checked={datesShown} onChange={(e) => setDatesOpen(e.target.checked)} className="h-4 w-4 flex-shrink-0 cursor-pointer rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
        </label>

        {datesShown && <>
          {!filterPrefs.isHidden("created") && (
            <label className="flex flex-col gap-1">
              <FilterLabel>Date created</FilterLabel>
              <DateRangeFilter ariaLabel="Date created" value={filters.created} onChange={(v) => setFilter("created", v)} />
            </label>
          )}

          {!filterPrefs.isHidden("assignedDate") && (
            <label className="flex flex-col gap-1">
              <FilterLabel>Assigned date</FilterLabel>
              <DateRangeFilter ariaLabel="Assigned date" value={filters.assignedDate} onChange={(v) => setFilter("assignedDate", v)} />
            </label>
          )}

          {!filterPrefs.isHidden("follow") && (
            <label className="flex flex-col gap-1">
              <FilterLabel>Follow-up date</FilterLabel>
              <DateRangeFilter ariaLabel="Follow-up date" value={filters.follow} onChange={(v) => setFilter("follow", v)} />
            </label>
          )}

          {!filterPrefs.isHidden("updated") && (
            <label className="flex flex-col gap-1">
              <FilterLabel>Updated date <span className="font-normal normal-case text-slate-400">· by call date</span></FilterLabel>
              <DateRangeFilter ariaLabel="Updated date" value={filters.updated} onChange={(v) => setFilter("updated", v)} />
            </label>
          )}

          {!filterPrefs.isHidden("connected") && (
            <label className="flex flex-col gap-1">
              <FilterLabel>Connected date <span className="font-normal normal-case text-slate-400">· has a connected call in range</span></FilterLabel>
              <DateRangeFilter ariaLabel="Connected date" value={filters.connected} onChange={(v) => setFilter("connected", v)} />
            </label>
          )}

          {!filterPrefs.isHidden("noConnectAfter") && (
            <label className="flex flex-col gap-1">
              <FilterLabel>Last connect date <span className="font-normal normal-case text-slate-400">· not connected after</span></FilterLabel>
              <input type="date" value={filters.noConnectAfter} onChange={(e) => setFilter("noConnectAfter", e.target.value)} className={selCls} />
              <span className="text-[11px] text-slate-400">Leads with no connected call after this date.</span>
            </label>
          )}

          {!filterPrefs.isHidden("noUpdateAfter") && (
            <label className="flex flex-col gap-1">
              <FilterLabel>Last update date <span className="font-normal normal-case text-slate-400">· not updated after</span></FilterLabel>
              <input type="date" value={filters.noUpdateAfter} onChange={(e) => setFilter("noUpdateAfter", e.target.value)} className={selCls} />
              <span className="text-[11px] text-slate-400">Leads not updated after this date.</span>
            </label>
          )}
        </>}
        </div>
        )}

        {!filterPrefs.isHidden("ghost") && !filterLayout.isHidden("ghost") && (
          <div className="flex flex-col gap-1" style={{ order: fo("ghost") }}>
            <div className="flex items-center gap-2">
              <label className="flex flex-1 cursor-pointer items-center gap-2">
                <input type="checkbox" checked={filters.ghostOn} onChange={(e) => setFilter("ghostOn", e.target.checked)} className="h-4 w-4 flex-shrink-0 cursor-pointer rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                <FilterLabel>Ghosted Leads</FilterLabel>
              </label>
              {filters.ghostOn && (
                <input type="number" min={1} placeholder="5" value={filters.ghostHours} onChange={(e) => setFilter("ghostHours", e.target.value)} title="Hours since last connection" className={`${selCls} w-16 flex-shrink-0`} />
              )}
            </div>
            {filters.ghostOn && (
              <span className="text-[11px] text-slate-400">Leads not connected in the last {filters.ghostHours || "5"} hour{(filters.ghostHours || "5") === "1" ? "" : "s"}.</span>
            )}
          </div>
        )}

        {!filterPrefs.isHidden("calls") && !filterLayout.isHidden("calls") && (
          <div className="flex flex-col gap-1" style={{ order: fo("calls") }}>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={filters.callsOn} onChange={(e) => setFilter("callsOn", e.target.checked)} className="h-4 w-4 flex-shrink-0 cursor-pointer rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
              <FilterLabel>Update Count Range</FilterLabel>
            </label>
            {filters.callsOn && <>
              <div className="px-1.5 pt-1">
                <DualRange
                  min={0}
                  max={CALLS_SLIDER_MAX}
                  valueMin={filters.callsMin === "" ? 0 : Number(filters.callsMin)}
                  valueMax={filters.callsMax === "" ? CALLS_SLIDER_MAX : Number(filters.callsMax)}
                  onChange={(lo, hi) => {
                    setFilter("callsMin", lo <= 0 ? "" : String(lo));
                    setFilter("callsMax", hi >= CALLS_SLIDER_MAX ? "" : String(hi));
                  }}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <input
                  type="number" min={0} max={CALLS_SLIDER_MAX} placeholder="0"
                  value={filters.callsMin}
                  onChange={(e) => setFilter("callsMin", e.target.value)}
                  className={`${selCls} w-16`} aria-label="Minimum calls"
                />
                <input
                  type="number" min={0} max={CALLS_SLIDER_MAX} placeholder={String(CALLS_SLIDER_MAX)}
                  value={filters.callsMax}
                  onChange={(e) => setFilter("callsMax", e.target.value)}
                  className={`${selCls} w-16 text-right`} aria-label="Maximum calls"
                />
              </div>
              <span className="text-[11px] text-slate-400">Leads whose assigned rep called them this many times. Drag the handles or type a range ({CALLS_SLIDER_MAX} = no upper limit).</span>
            </>}
          </div>
        )}

        {!filterPrefs.isHidden("duration") && !filterLayout.isHidden("duration") && (
          <div className="flex flex-col gap-1" style={{ order: fo("duration") }}>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={filters.durOn} onChange={(e) => setFilter("durOn", e.target.checked)} className="h-4 w-4 flex-shrink-0 cursor-pointer rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
              <FilterLabel>Duration Filter</FilterLabel>
            </label>
            {filters.durOn && <>
              <div className="flex items-center gap-1.5">
                <select value={filters.durOp} onChange={(e) => setFilter("durOp", e.target.value as "lte" | "gte")} className={`${selCls} w-16 flex-shrink-0`} title={filters.durOp === "lte" ? "At most this long" : "At least this long"}>
                  <option value="lte">≤</option>
                  <option value="gte">≥</option>
                </select>
                <input type="number" min={0} placeholder="Hours" value={filters.durHours} onChange={(e) => setFilter("durHours", e.target.value)} className={`${selCls} w-full`} />
                <input type="number" min={0} max={59} placeholder="Minutes" value={filters.durMins} onChange={(e) => setFilter("durMins", e.target.value)} className={`${selCls} w-full`} />
              </div>
              <span className="text-[11px] text-slate-400">Leads whose total call talk-time is {filters.durOp === "lte" ? "at most" : "at least"} the entered hours &amp; minutes.</span>
            </>}
          </div>
        )}
      </FilterRail>

      <div className={filterRailPad(filterDrawerOpen, filterLayout.placement)}>
      {/* Today's call totals + last sync — auto-refreshes every minute. */}
      {can("calls", "view") && <CallSyncHeader />}

      {/* Lead/Call summary panel — toggled by the Summary button on the filter bar.
          Lazy: analytics only fetch while it's open (keeps the table fast). */}
      <div className="mb-4">
        {/* The Call and Lead summaries render independently — the two buttons on
            the filter bar toggle each, so both can be open at the same time. */}
        {showCall && (
        <Card className="mt-3">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-700">Call Summary</h3>
        </div>

        {(
          /* ---- Call Summary — KPIs + charts for the filtered lead set. Only
             calls to leads in the set (matched by contact); unique = distinct.
             Guarded to a ≤1-month date window (Updated/Created) to avoid heavy scans. */
          !summaryDateOk ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-10 text-center text-sm text-slate-500">
              The selected date range is more than <b>1 month</b> — narrow the <b>Updated date</b> or <b>Created</b> filter to ≤ 1 month to see the call summary. (No filter shows <b>today</b>.)
            </div>
          ) : !callSummary ? (
            <div className="py-8 text-center text-sm text-slate-400">Loading call summary…</div>
          ) : (
            <div>
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {([
                  ["Total Calls", callSummary.kpis.total_calls.toLocaleString("en-IN"), "border-l-indigo-400"],
                  ["Total Unique Calls", callSummary.kpis.unique_calls.toLocaleString("en-IN"), "border-l-sky-400"],
                  ["Avg Call Duration", fmtDurShort(callSummary.kpis.avg_sec), "border-l-emerald-400"],
                  ["Connect Rate", `${callSummary.kpis.connected} (${callSummary.kpis.connect_rate}%)`, "border-l-amber-400"],
                  ["Total Talk Time", fmtTalk(callSummary.kpis.talk_sec), "border-l-violet-400"],
                ] as [string, string, string][]).map(([label, value, br]) => (
                  <div key={label} className={`rounded-xl border border-l-4 ${br} border-slate-200 bg-white px-4 py-3`}>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
                    <div className="mt-0.5 text-lg font-bold text-slate-800">{value}</div>
                  </div>
                ))}
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 p-3">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Hourly Call Distribution</h4>
                  <MiniBars items={callSummary.hourly.map((h) => ({ label: hourLabelOf(h.hour), value: h.calls }))} />
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Call Duration by Lead Status <span className="font-normal normal-case text-slate-400">· bar = talk time, number = leads</span></h4>
                  <MiniBars items={callSummary.by_status.map((s) => ({ label: s.label, value: s.talk_sec, sub: String(s.leads), color: toHex(s.color) }))} valueFmt={fmtDurShort} />
                </div>
              </div>
            </div>
          )
        )}
        </Card>
        )}

        {showLead && (
        <Card className="mt-3">
        {/* ---- Lead Summary — a stat-card grid per dimension; click a tile to filter. */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-700">Lead Summary</h3>
          {analytics && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{analytics.total.toLocaleString("en-IN")} leads</span>}
          {activeFilters && <span className="text-xs text-slate-400">reflects the current filters</span>}
        </div>

        {!analytics ? (
          <div className="py-8 text-center text-sm text-slate-400">Loading summary…</div>
        ) : (
          <>
            {SUMMARY_DIMS.map((d) => {
              const items = d.pick(analytics);
              if (!items.length) return null;
              return (
                <SummaryGrid
                  key={d.key}
                  title={`Lead ${d.label}`}
                  items={items}
                  total={d.key === "status" ? analytics.total : undefined}
                  activeIds={appliedFilters[d.filterKey]}
                  onPick={(id) => pickDimId(d.filterKey, id)}
                />
              );
            })}
            <p className="mt-1 text-xs text-slate-400">Click a card to filter the table by that value; click it again to clear.</p>
          </>
        )}
        </Card>
        )}
      </div>

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
            {can("leads", "update") && (
              <button
                onClick={openBulk}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Bulk edit / assign
              </button>
            )}
            {can("leads", "delete") && (
              <button
                onClick={bulkRemove}
                disabled={bulkBusy}
                className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
                {bulkBusy ? "Deleting…" : `Delete selected`}
              </button>
            )}
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
          <div className="flex w-full max-w-md items-center gap-2">
            <div className="relative flex-1">
              <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
              <input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search name, phone, email, city…" className={`${selCls} w-full pl-9`} />
            </div>
            <button
              type="button"
              onClick={refresh}
              disabled={loading || applying}
              title="Refresh"
              aria-label="Refresh leads"
              className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 transition hover:bg-slate-50 disabled:opacity-60"
            >
              <svg className={`h-4 w-4 ${loading || applying ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 2v6h-6M3 12a9 9 0 0115-6.7L21 8M3 22v-6h6M21 12a9 9 0 01-15 6.7L3 16" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        }
        nowrap
        selectable
        selectedKeys={selectedIds}
        onSelectionChange={setSelectedIds}
        emptyTitle={activeFilters ? "No matching leads" : "No leads yet"}
        emptyHint={activeFilters ? "Try clearing or widening your filters." : "Add your first lead or import a CSV file."}
        onRowClick={(l) => openView(l)}
        serverSorted
        onSortChange={(s) => { setTableSort(s); setPage(1); }}
        page={safePage}
        totalPages={totalPages}
        onPage={setPage}
        total={total}
        pageSize={perPage}
        onPageSize={(n) => { setPerPage(n); setPage(1); }}
        pageAlign="right"
        quickActions={(l) => (
          <>
            <IconButton title="View details" onClick={() => openView(l)}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" /></svg>
            </IconButton>
            {can("leads", "update") && (l.converted_at ? (
              <IconButton title="Converted — locked" onClick={() => openEdit(l)}>
                <svg className="h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 10V8a6 6 0 1112 0v2M5 10h14v10H5z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </IconButton>
            ) : (
              <IconButton title="Edit" onClick={() => openEdit(l)}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </IconButton>
            ))}
            {canCreateTransfer && isMyRefLead(l) && (
              <IconButton title="Transfer to another rep" onClick={() => setTransferLead({ id: l.id, name: l.name?.trim() || l.phone })}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 3l4 4-4 4M20 7H8M8 21l-4-4 4-4M4 17h12" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </IconButton>
            )}
            {canCreateVisitor && isMyRefLead(l) && (
              <IconButton title="Log a visitor for this lead" onClick={() => setVisitorDraft(visitorDraftFromLead(l, visitorTypes, visitorStatuses))}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-1a6 6 0 0112 0v1M19 8v6M22 11h-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </IconButton>
            )}
            {can("leads", "delete") && (
              <IconButton title="Delete" danger onClick={() => remove(l)}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </IconButton>
            )}
          </>
        )}
      />
      </div>

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
            {(() => {
              // Each built-in field as a keyed node; conditionally-hidden ones are
              // null. They render in the admin's saved order (Form Setup → Arrange),
              // falling back to the natural order for any field not listed.
              const nodes: Record<string, React.ReactNode> = {
                name: (
                  <FieldRow key="name" label="Name" required={requiredFields.has("name")} error={errors.name} hint={hintOf("name")}>
                    <input className={inputCls(errors.name)} placeholder="Lead name" value={draft.name} onChange={(e) => setField("name")(e.target.value)} />
                  </FieldRow>
                ),
                reference_name: (
                  <FieldRow key="reference_name" label="Reference" required={requiredFields.has("reference_name")} error={errors.reference_name} hint={hintOf("reference_name")}>
                    <SearchSelect ariaLabel="Reference" value={draft.reference_name} onChange={setField("reference_name")} options={formReferenceOptions} placeholder="— None —" searchPlaceholder="Search references…" />
                  </FieldRow>
                ),
                phone: (
                  <FieldRow key="phone" label="Phone" required error={errors.phone} hint={hintOf("phone")}>
                    <input className={inputCls(errors.phone)} inputMode="numeric" maxLength={10} placeholder="10-digit mobile (no +91)" value={draft.phone} onChange={(e) => setField("phone")(e.target.value.replace(/\D/g, "").slice(0, 10))} />
                  </FieldRow>
                ),
                alt_phone: (
                  <FieldRow key="alt_phone" label="Alternative phone" required={requiredFields.has("alt_phone")} error={errors.alt_phone} hint={hintOf("alt_phone", requiredFields.has("alt_phone") ? "10 digits, without +91" : undefined)}>
                    <input className={inputCls(errors.alt_phone)} inputMode="numeric" maxLength={10} placeholder="10-digit mobile (no +91)" value={draft.alt_phone} onChange={(e) => setField("alt_phone")(e.target.value.replace(/\D/g, "").slice(0, 10))} />
                  </FieldRow>
                ),
                lead_type_id: (
                  <FieldRow key="lead_type_id" label="Lead type" required={requiredFields.has("lead_type_id")} error={errors.lead_type_id} hint={hintOf("lead_type_id")}>
                    <SearchSelect ariaLabel="Select lead type" value={draft.lead_type_id} onChange={setField("lead_type_id")} options={formLeadTypeOptions} placeholder="— None —" searchPlaceholder="Search type…" className={errors.lead_type_id ? "ring-2 ring-red-500/30" : ""} />
                  </FieldRow>
                ),
                status_id: (
                  <FieldRow key="status_id" label="Status" required error={errors.status_id} hint={hintOf("status_id")}>
                    <SearchSelect ariaLabel="Select status" value={draft.status_id} onChange={setField("status_id")} options={statusFilterOptions} placeholder="— Select —" searchPlaceholder="Search status…" className={errors.status_id ? "ring-2 ring-red-500/30" : ""} />
                  </FieldRow>
                ),
                sub_status_id: (
                  <FieldRow key="sub_status_id" label="Sub status" required={requiredFields.has("sub_status_id")} error={errors.sub_status_id} hint={draft.status_id ? (subOptions.length ? hintOf("sub_status_id") : "No sub-statuses for this status/type") : "Pick a status first"}>
                    {subOptions.length ? (
                      <SearchSelect ariaLabel="Select sub status" value={draft.sub_status_id} onChange={setField("sub_status_id")} options={formSubOptions} placeholder="— None —" searchPlaceholder="Search sub status…" className={errors.sub_status_id ? "ring-2 ring-red-500/30" : ""} />
                    ) : (
                      <div className={readonlyCls}>—</div>
                    )}
                  </FieldRow>
                ),
                source_id: (
                  <FieldRow key="source_id" label="Lead source" required={requiredFields.has("source_id")} error={errors.source_id} hint={hintOf("source_id")}>
                    <SearchSelect ariaLabel="Select lead source" value={draft.source_id} onChange={setField("source_id")} options={formSourceOptions} placeholder="— None —" searchPlaceholder="Search source…" className={errors.source_id ? "ring-2 ring-red-500/30" : ""} />
                  </FieldRow>
                ),
                email: (
                  <FieldRow key="email" label="Email" required={requiredFields.has("email")} error={errors.email} hint={hintOf("email")}>
                    <input className={inputCls(errors.email)} type="email" placeholder="lead@example.com" value={draft.email} onChange={(e) => setField("email")(e.target.value)} />
                  </FieldRow>
                ),
                // Assignee is masked on create — a new lead is auto-assigned to whoever
                // captures it. Admins (who aren't staff) still pick explicitly; on edit
                // the field stays available to non-agents.
                assigned_to: (!isAgent && (isAdmin || draft.id)) ? (
                  <FieldRow key="assigned_to" label="Assigned to" required={requiredFields.has("assigned_to")} error={errors.assigned_to} hint={hintOf("assigned_to")}>
                    <SearchSelect ariaLabel="Select assignee" value={draft.assigned_to} onChange={setField("assigned_to")} options={formAssignedOptions} placeholder="— Unassigned —" searchPlaceholder="Search team…" className={errors.assigned_to ? "ring-2 ring-red-500/30" : ""} />
                  </FieldRow>
                ) : null,
                assigned_date: !isAgent ? (
                  <FieldRow key="assigned_date" label="Assigned date" hint="Set automatically when the lead is assigned"><div className={readonlyCls}>{draft.assigned_date ? fmtDateTime(draft.assigned_date) : "—"}</div></FieldRow>
                ) : null,
                follow_up_date: (
                  <FieldRow key="follow_up_date" label="Follow-up date" hint="The lead's latest reminder date & time"><div className={readonlyCls}>{draft.last_reminder_at ? fmtDateTime(draft.last_reminder_at) : "—"}</div></FieldRow>
                ),
                state: (
                  <FieldRow key="state" label="State" required={requiredFields.has("state")} error={errors.state} hint={hintOf("state")}>
                    <input list="lead-state-list" value={draft.state} onChange={(e) => setDraft((d) => d && { ...d, state: e.target.value })} placeholder="Start typing a state…" autoComplete="off" className={inputCls(errors.state)} />
                    <datalist id="lead-state-list">{stateSuggestions.map((s) => <option key={s} value={s} />)}</datalist>
                  </FieldRow>
                ),
                city: (
                  <FieldRow key="city" label="City" required={requiredFields.has("city")} error={errors.city} hint={hintOf("city")}>
                    <input list="lead-city-list" value={draft.city} onChange={(e) => setField("city")(e.target.value)} placeholder="Start typing a city…" autoComplete="off" className={inputCls(errors.city)} />
                    <datalist id="lead-city-list">{citySuggestions.map((c) => <option key={c} value={c} />)}</datalist>
                  </FieldRow>
                ),
                created_date: (
                  <FieldRow key="created_date" label="Created date" hint="Set automatically when the lead is created"><div className={readonlyCls}>{draft.created_date ? fmtDate(draft.created_date) : draft.id ? "—" : "Today"}</div></FieldRow>
                ),
                description: (
                  <div key="description" className="sm:col-span-2">
                    <FieldRow label="Description" required={requiredFields.has("description")} error={errors.description} hint={hintOf("description")}>
                      <RichTextEditor key={`lead-desc-${draft.id ?? "new"}`} initialHTML={draft.description} onChange={(html) => setDraft((d) => d && { ...d, description: html })} placeholder="Add a description for this lead…" minHeight={120} />
                    </FieldRow>
                  </div>
                ),
              };
              // Custom fields become nodes too, so the admin's arranged order can
              // place them anywhere among the built-ins. A custom key never
              // overwrites a built-in (built-ins added first).
              for (const f of leadCustomFields) {
                if (f.key in nodes) continue;
                nodes[f.key] = (
                  <CustomFieldCell
                    key={`cf-${f.key}`}
                    field={f}
                    value={draft.custom[f.key] ?? ""}
                    onChange={(v) => setDraft((d) => d && { ...d, custom: { ...d.custom, [f.key]: v } })}
                    error={errors[`custom_${f.key}`]}
                  />
                );
              }
              const natural = [...LEAD_FORM_FIELDS.map((f) => f.key), ...leadCustomFields.map((f) => f.key)];
              const ordered = [...leadOrder.filter((k) => k in nodes), ...natural.filter((k) => k in nodes && !leadOrder.includes(k))];
              return ordered.map((k) => nodes[k]).filter(Boolean);
            })()}
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
            {viewing?.converted_at ? (
              // Converted → locked: no convert, no edit.
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Converted &amp; locked
              </span>
            ) : (
              <>
                {convertCfg?.enabled && can("leads", "update") && (
                  <button onClick={() => viewing && openConvert(viewing)} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    {convertCfg.label}
                  </button>
                )}
                <button onClick={() => { const l = viewing!; closeView(); openEdit(l); }} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Edit
                </button>
              </>
            )}
          </div>
        }
      >
        {viewing && (() => {
          // Merge so the detail response's resolved fields win, but any field it
          // omits falls back to the list row (avoids blank "—" while detail loads
          // or if the endpoint doesn't resolve a field).
          const lead = detail?.lead ? { ...viewing, ...detail.lead } : viewing;
          return (
            <div className="space-y-5">
              {/* Tab bar */}
              <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                {(([
                  ["info", "Information", null],
                  ["reminders", "Reminders", detail?.reminders.length ?? 0],
                  ["notes", "Notes", detail?.notes.length ?? 0],
                  // Calls tab only for users with the call-tracking permission.
                  ...(canViewCalls ? [["calls", "Calls", detail?.calls.length ?? 0]] : []),
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
                    ["Lead type", lead.lead_type || "—"],
                    ["Reference name", lead.reference_name || "—"],
                    ["Email", lead.email || "—"],
                    ["Assigned to", lead.assigned_to_name || "Unassigned"],
                    ["Assigned date", lead.assigned_date ? fmtDateTime(lead.assigned_date) : "—"],
                    ["First response", lead.first_response_at ? `${fmtDuration(lead.first_response_seconds)} · ${fmtDateTime(lead.first_response_at)}` : "—"] as [string, React.ReactNode],
                    ["City", lead.city || "—"],
                    ["State", lead.state || "—"],
                    ["Follow-up date", lead.last_reminder_at ? fmtDateTime(lead.last_reminder_at) : "—"],
                    ["Created date", fmtDateTime(lead.created_at ?? lead.created_date)],
                  ] as [string, React.ReactNode][])
                    .map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
                      <dd className="mt-0.5 text-sm text-slate-800">{value}</dd>
                    </div>
                  ))}
                </dl>
                {stripHtml(lead.description ?? "") && (
                  <div className="mt-4">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Description</div>
                    <div className="rte-content mt-1 text-sm text-slate-700" dangerouslySetInnerHTML={{ __html: lead.description ?? "" }} />
                  </div>
                )}
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
                  <div className="mt-2"><RichTextEditor key={`rem-${viewing?.id ?? "x"}-${composerKey}`} initialHTML={reminderNote} onChange={setReminderNote} placeholder="Note (required) — e.g. Call back about pricing" minHeight={80} /></div>
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
                      {editingReminder === r.id ? (
                        <div className="min-w-0 flex-1">
                          <input type="datetime-local" value={editRemindAt} onChange={(e) => setEditRemindAt(e.target.value)} className={inputCls(editReminderErr)} />
                          <div className="mt-2"><RichTextEditor key={`rem-edit-${r.id}`} initialHTML={r.note ?? ""} onChange={setEditReminderNote} placeholder="Optional note" minHeight={70} /></div>
                          {editReminderErr && <p className="mt-1 text-xs text-rose-600">{editReminderErr}</p>}
                          <div className="mt-2 flex justify-end gap-2">
                            <button onClick={cancelEditReminder} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                            <button onClick={() => saveEditReminder(r.id)} disabled={savingReminder} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{savingReminder ? "Saving…" : "Save"}</button>
                          </div>
                        </div>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-slate-800">{fmtDateTime(r.remind_at)}</div>
                          {stripHtml(r.note ?? "") && <div className="rte-content text-xs text-slate-500" dangerouslySetInnerHTML={{ __html: r.note ?? "" }} />}
                          <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">{r.notified_at ? "Notified" : r.due ? "Due" : "Upcoming"}</div>
                        </div>
                      )}
                      {r.can_edit && editingReminder !== r.id && (
                        <div className="flex items-center gap-1">
                          <button onClick={() => startEditReminder(r)} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-emerald-50 hover:text-emerald-600" aria-label="Edit reminder">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                          <button onClick={() => removeReminder(r.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500" aria-label="Delete reminder">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                        </div>
                      )}
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
                  <div className="flex-1"><RichTextEditor key={`note-${viewing?.id ?? "x"}-${composerKey}`} initialHTML={noteBody} onChange={setNoteBody} placeholder="Add a note about this lead…" minHeight={90} /></div>
                  <button onClick={addNote} disabled={savingNote || !stripHtml(noteBody)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{savingNote ? "Adding…" : "Add"}</button>
                </div>
                <ul className="mt-3 space-y-2">
                  {(detail?.notes ?? []).map((n) => (
                    <li key={n.id} className="rounded-lg border border-slate-200 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-600">{n.author_name || "Someone"}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-400">{fmtDateTime(n.created_at)}</span>
                          {/* Edit/delete only for the author, a team leader or an admin. */}
                          {n.can_edit && editingNote !== n.id && (
                            <button onClick={() => startEditNote(n)} className="text-slate-400 hover:text-emerald-600" aria-label="Edit note">
                              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </button>
                          )}
                          {n.can_edit && (
                            <button onClick={() => removeNote(n.id)} className="text-slate-400 hover:text-rose-500" aria-label="Delete note">
                              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </button>
                          )}
                        </div>
                      </div>
                      {editingNote === n.id ? (
                        <div className="mt-2">
                          <RichTextEditor key={`note-edit-${n.id}`} initialHTML={n.body} onChange={setEditNoteBody} placeholder="Edit note…" minHeight={90} />
                          <div className="mt-2 flex justify-end gap-2">
                            <button onClick={cancelEditNote} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                            <button onClick={() => saveEditNote(n.id)} disabled={savingNote || !stripHtml(editNoteBody)} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{savingNote ? "Saving…" : "Save"}</button>
                          </div>
                        </div>
                      ) : (
                        <div className="rte-content mt-1 text-sm text-slate-700" dangerouslySetInnerHTML={{ __html: n.body }} />
                      )}
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
                      const s = activityStyle(a.action, a.description);
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

      {/* Bulk edit / assign selected leads */}
      <Modal open={bulkOpen} onClose={() => !bulkSaving && setBulkOpen(false)} title={`Bulk edit ${selectedLeads.length} lead${selectedLeads.length === 1 ? "" : "s"}`} width="max-w-5xl">
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Tick a field to change it on all selected leads. Unticked fields are left as they are.</p>

          {/* Status + Sub-status */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <BulkField checked={bChg.status} onToggle={() => toggleChg("status")} label="Status">
              <SearchSelect ariaLabel="Status" value={bStatus} onChange={(v) => { setBStatus(v); setBSub(""); }} options={statusFilterOptions} placeholder="— Select —" searchPlaceholder="Search status…" />
            </BulkField>
            <BulkField checked={bChg.sub} onToggle={() => toggleChg("sub")} label="Sub status">
              <SearchSelect ariaLabel="Sub status" value={bSub} onChange={setBSub} options={bulkSubOptions} placeholder="— None —" searchPlaceholder="Search…" />
            </BulkField>
            <BulkField checked={bChg.source} onToggle={() => toggleChg("source")} label="Source">
              <SearchSelect ariaLabel="Source" value={bSource} onChange={setBSource} options={formSourceOptions} placeholder="— None —" searchPlaceholder="Search source…" />
            </BulkField>
            <BulkField checked={bChg.type} onToggle={() => toggleChg("type")} label="Lead type">
              <SearchSelect ariaLabel="Lead type" value={bType} onChange={setBType} options={formLeadTypeOptions} placeholder="— None —" searchPlaceholder="Search type…" />
            </BulkField>
            <BulkField checked={bChg.reference} onToggle={() => toggleChg("reference")} label="Reference name">
              <SearchSelect ariaLabel="Reference" value={bReference} onChange={setBReference} options={formReferenceOptions} placeholder="— None —" searchPlaceholder="Search references…" />
            </BulkField>
            <BulkField checked={bChg.created} onToggle={() => toggleChg("created")} label="Created date">
              <select value={bCreatedMode} onChange={(e) => setBCreatedMode(e.target.value as "new" | "keep")} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15">
                <option value="new">Set to today (new)</option>
                <option value="keep">Keep the old created date</option>
              </select>
            </BulkField>
          </div>

          {/* Assignment */}
          <BulkField checked={bChg.assign} onToggle={() => toggleChg("assign")} label="Assignment">
            <div className="space-y-2">
              <div className="flex gap-2">
                {([["single", "Single user"], ["robin", "Round-robin"]] as const).map(([m, lbl]) => (
                  <button key={m} type="button" onClick={() => setBMode(m)} className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${bMode === m ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>{lbl}</button>
                ))}
              </div>
              {bMode === "single" ? (
                <SearchSelect ariaLabel="Assign to" value={bAssignees[0] ?? ""} onChange={(v) => setBAssignees(v ? [v] : [])} options={bulkAssignOptions} placeholder="— Unassigned —" searchPlaceholder="Search team…" />
              ) : (
                <>
                  <MultiSelect ariaLabel="Round-robin members" value={bAssignees} onChange={setBAssignees} options={robinOptions} placeholder="Pick 2 or more members" searchPlaceholder="Search team…" />
                  <p className="text-xs text-slate-400">Selected leads are split evenly across these members, in order.</p>
                </>
              )}
              <div>
                <span className="mb-1 block text-xs font-medium text-slate-500">Assignment date &amp; time <span className="font-normal text-slate-400">· optional, defaults to now</span></span>
                <input type="datetime-local" value={bAssignedAt} onChange={(e) => setBAssignedAt(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15" />
              </div>
            </div>
          </BulkField>

          {/* Mass assignation — reset the lead so the new assignee starts fresh */}
          <label className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5 text-sm">
            <span>
              <span className="font-medium text-amber-800">Mass assignation (fresh lead)</span>
              <span className="mt-0.5 block text-xs text-amber-700">Removes this lead&apos;s reminders, notes, follow-up, first-response &amp; description so the new assignee starts clean. The lead itself, its status and calls are kept.</span>
            </span>
            <input type="checkbox" checked={bMassAssign} onChange={(e) => setBMassAssign(e.target.checked)} className="mt-0.5 h-5 w-5 flex-shrink-0 cursor-pointer accent-amber-600" />
          </label>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm">
            <span>
              <span className="font-medium text-slate-700">Notify assigned member(s)</span>
              <span className="block text-xs text-slate-400">In-app + web-push when assignment changes.</span>
            </span>
            <input type="checkbox" checked={bNotify} onChange={(e) => setBNotify(e.target.checked)} className="h-5 w-5 flex-shrink-0 cursor-pointer accent-emerald-600" />
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setBulkOpen(false)} disabled={bulkSaving} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
            <button onClick={applyBulk} disabled={bulkSaving} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{bulkSaving ? "Applying…" : `Apply to ${selectedLeads.length} lead${selectedLeads.length === 1 ? "" : "s"}`}</button>
          </div>
        </div>
      </Modal>

      {/* Import from Excel / CSV */}
      <Modal open={importOpen} onClose={closeImport} title="Import leads from Excel / CSV">
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Upload an <b>.xlsx</b> or <b>.csv</b> file. The choices below (status, source, type, assignment) are the <b>default</b> — a row&apos;s own Status/Source/Type/Assigned-to column (if enabled in Leads Setup → Import) overrides them, matched by name. Every row needs a valid <b>10-digit phone</b>; emails are validated. Invalid rows are skipped and reported.
          </p>

          <div className="flex flex-wrap gap-4 text-sm font-medium text-emerald-600">
            <button onClick={downloadTemplateXlsx} className="inline-flex items-center gap-1.5 hover:text-emerald-700">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Excel template
            </button>
            <button onClick={downloadTemplateCsv} className="inline-flex items-center gap-1.5 hover:text-emerald-700">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              CSV template
            </button>
          </div>

          <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <button onClick={pickFile} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Choose .xlsx / .csv file</button>
            {importInfo && <p className="mt-2 text-sm text-slate-500">{importInfo}</p>}
          </div>

          {importRows.length > 0 && !importResult && (
            <>
              <div className={`rounded-lg p-3 text-sm ${importIssues.length ? "bg-amber-50" : "bg-emerald-50"}`}>
                <p className="font-medium text-slate-700">{readyCount} ready · {importIssues.length} will be skipped</p>
                {importIssues.length > 0 && (
                  <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs text-amber-700">
                    {importIssues.slice(0, 30).map((er, i) => <li key={i}>Row {er.row}: {er.message}</li>)}
                  </ul>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Status <span className="text-red-500">*</span></span>
                  <SearchSelect ariaLabel="Status" value={iStatus} onChange={(v) => { setIStatus(v); setISub(""); }} options={statusFilterOptions} placeholder="— Select —" searchPlaceholder="Search status…" /></label>
                <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Sub status</span>
                  <SearchSelect ariaLabel="Sub status" value={iSub} onChange={setISub} options={[{ value: "", label: "— None —" }, ...importSubOptions]} placeholder={iStatus ? "— None —" : "Pick a status first"} searchPlaceholder="Search…" /></label>
                <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Source</span>
                  <SearchSelect ariaLabel="Source" value={iSource} onChange={setISource} options={formSourceOptions} placeholder="— None —" searchPlaceholder="Search source…" /></label>
                <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Type</span>
                  <SearchSelect ariaLabel="Type" value={iType} onChange={setIType} options={formLeadTypeOptions} placeholder="— None —" searchPlaceholder="Search type…" /></label>
              </div>

              <div className="space-y-2">
                <span className="block text-sm font-medium text-slate-600">Assignment</span>
                <div className="flex gap-2">
                  {([["single", "Single user"], ["robin", "Round-robin"]] as const).map(([m, lbl]) => (
                    <button key={m} type="button" onClick={() => setIMode(m)} className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${iMode === m ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>{lbl}</button>
                  ))}
                </div>
                {iMode === "single" ? (
                  <SearchSelect ariaLabel="Assign to" value={iAssignees[0] ?? ""} onChange={(v) => setIAssignees(v ? [v] : [])} options={[{ value: "", label: "— Unassigned —" }, ...staffOptions]} placeholder="— Unassigned —" searchPlaceholder="Search team…" />
                ) : (
                  <>
                    <MultiSelect ariaLabel="Round-robin members" value={iAssignees} onChange={setIAssignees} options={staffOptions} placeholder="Pick 2 or more members" searchPlaceholder="Search team…" />
                    <p className="text-xs text-slate-400">Leads are split evenly across the selected members, in order.</p>
                  </>
                )}
              </div>

              <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm">
                <span>
                  <span className="font-medium text-slate-700">Notify assigned member(s)</span>
                  <span className="block text-xs text-slate-400">Send an in-app + web-push notification about their new leads.</span>
                </span>
                <input type="checkbox" checked={iNotify} onChange={(e) => setINotify(e.target.checked)} className="h-5 w-5 flex-shrink-0 cursor-pointer accent-emerald-600" />
              </label>
            </>
          )}

          {importResult && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className={importResult.inserted ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>
                Imported {importResult.inserted} · Skipped {importResult.failed}
              </p>
              {importResult.assigned && Object.keys(importResult.assigned).length > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  Assigned: {Object.entries(importResult.assigned).map(([sid, n]) => `${staff.find((s) => String(s.id) === sid)?.name ?? "Member"} (${n})`).join(", ")}
                </p>
              )}
              {importResult.errors.length > 0 && (
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-amber-700">
                  {importResult.errors.map((er, i) => <li key={i}>Row {er.row}: {er.message}</li>)}
                </ul>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={closeImport} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Close</button>
            {!importResult && (
              <button onClick={runImport} disabled={importing || !readyCount || !iStatus} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                {importing ? "Importing…" : `Import ${readyCount || ""} lead${readyCount === 1 ? "" : "s"}`.trim()}
              </button>
            )}
          </div>
        </div>
      </Modal>

      {/* Transfer a lead to another rep (request or direct, per the client's mode) */}
      <TransferModal
        open={!!transferLead}
        lead={transferLead}
        staff={staff}
        mode={transferMode}
        onClose={() => setTransferLead(null)}
        onDone={() => { setTransferLead(null); refresh(); }}
      />

      {/* Log a visitor pre-filled from a lead (shared with the Visitors tab) */}
      <VisitorModal
        draft={visitorDraft}
        setDraft={setVisitorDraft}
        types={visitorTypes}
        statuses={visitorStatuses}
        staff={staff}
        leadOpts={leadVisitorOpts}
        canManage={isAdmin}
        onDone={() => setVisitorDraft(null)}
      />

      {/* Convert-to-Applicant form (fields configured by the admin) */}
      <Modal open={!!convertTarget} title={convertCfg?.label || "Convert to Applicant"} onClose={() => setConvertTarget(null)}>
        <div className="space-y-3">
          <p className="text-xs text-slate-500">Fill the form to convert <b>{convertTarget?.name?.trim() || convertTarget?.phone}</b>. On success it's sent to the configured system and the lead's status is updated.</p>
          {(convertCfg?.fields ?? []).length === 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">No form fields configured yet.</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(convertCfg?.fields ?? []).map((f) => (
              <label key={f.key} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
                <span className="mb-1 block text-sm font-medium text-slate-700">{f.label}{f.required && <span className="text-rose-500"> *</span>}</span>
                {f.type === "textarea" ? (
                  <textarea value={convertValues[f.key] ?? ""} onChange={(e) => setConvertValues((v) => ({ ...v, [f.key]: e.target.value }))} rows={3} className={`${selCls} w-full`} />
                ) : f.type === "select" ? (
                  <select value={convertValues[f.key] ?? ""} onChange={(e) => setConvertValues((v) => ({ ...v, [f.key]: e.target.value }))} className={`${selCls} w-full`}>
                    <option value="">— Select —</option>
                    {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "email" ? "email" : f.type === "tel" ? "tel" : "text"} value={convertValues[f.key] ?? ""} onChange={(e) => setConvertValues((v) => ({ ...v, [f.key]: e.target.value }))} className={`${selCls} w-full`} />
                )}
              </label>
            ))}
          </div>
          {convertError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <span className="font-semibold">Conversion failed.</span> <span className="break-all">{convertError}</span>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setConvertTarget(null)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={submitConvert} disabled={converting} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
              {converting ? "Converting…" : (convertCfg?.label || "Convert")}
            </button>
          </div>
        </div>
      </Modal>

      {/* Admin: configure the Convert-to-Applicant button, form fields & API */}
      <Modal open={convSetupOpen} title="Convert-to-Applicant setup" onClose={() => setConvSetupOpen(false)}>
        {convDraft && (
        <div className="space-y-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={convDraft.enabled} onChange={(e) => setConvDraft({ ...convDraft, enabled: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
            <span className="text-sm font-medium text-slate-700">Enable the button on leads</span>
          </label>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Set an <b>API endpoint URL</b> below and converting a lead <b>POSTs the form to that URL</b> (works in any Applicant mode).
            {convertCfg?.applicant_mode === "own" && <> Leave the URL blank to instead save a record in <b>your own applicant table</b>.</>}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-sm font-medium text-slate-700">Button text</span>
              <input value={convDraft.label} onChange={(e) => setConvDraft({ ...convDraft, label: e.target.value })} maxLength={40} placeholder="Convert to Applicant" className={`${selCls} w-full`} />
            </label>
            <label>
              <span className="mb-1 block text-sm font-medium text-slate-700">Status after convert</span>
              <select value={convDraft.status_id} onChange={(e) => setConvDraft({ ...convDraft, status_id: Number(e.target.value) })} className={`${selCls} w-full`}>
                <option value={0}>— No change —</option>
                {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-sm font-medium text-slate-700">API endpoint URL <span className="font-normal text-slate-400">· where the converted lead is sent</span></span>
              <input value={convDraft.api_url ?? ""} onChange={(e) => setConvDraft({ ...convDraft, api_url: e.target.value })} placeholder="https://crm.educationvibes.in/cron/convert-to-applicant" className={`${selCls} w-full`} />
              <span className="mt-1 block text-[11px] text-slate-400">The CRM <b>POSTs</b> the converted lead here when you click Convert. Leave blank only if you want to write into your own applicant table (Own-table mode).</span>
            </label>
            <label>
              <span className="mb-1 block text-sm font-medium text-slate-700">Method</span>
              <select value={convDraft.api_method ?? "POST"} onChange={(e) => setConvDraft({ ...convDraft, api_method: e.target.value })} className={`${selCls} w-full`}>
                <option>POST</option><option>PUT</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-sm font-medium text-slate-700">Body format</span>
              <select value={convDraft.api_type ?? "json"} onChange={(e) => setConvDraft({ ...convDraft, api_type: e.target.value })} className={`${selCls} w-full`}>
                <option value="json">JSON</option><option value="form">Form data</option>
              </select>
            </label>
            {/* API key auth — sent as a header so a CSRF-excluded cron can authenticate the call. */}
            <label>
              <span className="mb-1 block text-sm font-medium text-slate-700">API key header</span>
              <input value={convDraft.api_key_header ?? "X-Api-Key"} onChange={(e) => setConvDraft({ ...convDraft, api_key_header: e.target.value })} placeholder="X-Api-Key" className={`${selCls} w-full`} />
            </label>
            <label>
              <span className="mb-1 block text-sm font-medium text-slate-700">API key {convDraft.has_api_key && <span className="font-normal text-emerald-600">· saved</span>}</span>
              <div className="flex gap-1.5">
                <input type="password" value={convDraft.api_key ?? ""} onChange={(e) => setConvDraft({ ...convDraft, api_key: e.target.value, api_key_clear: false })} placeholder={convDraft.has_api_key ? "•••••• (unchanged)" : "Secret key"} className={`${selCls} w-full`} autoComplete="new-password" />
                {convDraft.has_api_key && <button type="button" onClick={() => setConvDraft({ ...convDraft, api_key: "", api_key_clear: true, has_api_key: false })} className="flex-shrink-0 rounded-lg border border-slate-300 px-2 text-xs text-slate-500 hover:bg-slate-50">Clear</button>}
              </div>
              <span className="mt-1 block text-[11px] text-slate-400">Sent as the header above. Your cron validates it; leave blank to keep the saved key.</span>
            </label>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Custom headers <span className="font-normal text-slate-400">· one per line, &quot;Name: value&quot;</span></span>
            <textarea
              value={convHeadersText}
              onChange={(e) => setConvHeadersText(e.target.value)}
              rows={3}
              placeholder={"Authorization: Bearer xxxxx\nX-CSRF-Token: xxxxx\nContent-Language: en"}
              className={`${selCls} w-full font-mono text-xs`}
            />
            <p className="mt-1 text-[11px] text-slate-400">Any extra headers to send with the convert POST (auth token, etc.). The API key above is added automatically.</p>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Extra POST fields <span className="font-normal text-slate-400">· one per line, &quot;name: value&quot;</span></span>
            <textarea
              value={convExtraText}
              onChange={(e) => setConvExtraText(e.target.value)}
              rows={2}
              placeholder={"csrf_token_name: 6d8578d80d5356ef08320659b1ab0c5c"}
              className={`${selCls} w-full font-mono text-xs`}
            />
            <p className="mt-1 text-[11px] text-slate-400">Fixed values added to the POST body (e.g. a CI3 <b>CSRF token</b> field). Sent alongside the lead fields below.</p>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Form fields</span>
            <p className="mb-2 text-xs text-slate-400">These fields appear in the convert form and are sent to the API using their key.</p>
            <div className="space-y-1.5">
              {convDraft.fields.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input value={f.label} onChange={(e) => setConvDraft({ ...convDraft, fields: convDraft.fields.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} placeholder="Label" className={`${selCls} min-w-0 flex-1`} />
                  <input value={f.key} onChange={(e) => setConvDraft({ ...convDraft, fields: convDraft.fields.map((x, j) => j === i ? { ...x, key: e.target.value.replace(/[^a-z0-9_]/gi, "") } : x) })} placeholder="api_key" className={`${selCls} w-28`} />
                  <select value={f.type} onChange={(e) => setConvDraft({ ...convDraft, fields: convDraft.fields.map((x, j) => j === i ? { ...x, type: e.target.value } : x) })} className={`${selCls} w-24`}>
                    {["text", "email", "number", "date", "tel", "textarea"].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-slate-500"><input type="checkbox" checked={f.required} onChange={(e) => setConvDraft({ ...convDraft, fields: convDraft.fields.map((x, j) => j === i ? { ...x, required: e.target.checked } : x) })} className="h-3.5 w-3.5" />req</label>
                  <button type="button" onClick={() => setConvDraft({ ...convDraft, fields: convDraft.fields.filter((_, j) => j !== i) })} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setConvDraft({ ...convDraft, fields: [...convDraft.fields, { key: "", label: "", type: "text", required: false } as ConvertField] })} className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-700">+ Add field</button>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setConvSetupOpen(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={saveConvSetup} disabled={convSaving} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{convSaving ? "Saving…" : "Save"}</button>
          </div>
        </div>
        )}
      </Modal>
    </>
  );
}

/** One bulk-edit field: a checkbox to enable the change + the control (dimmed when off). */
function BulkField({ checked, onToggle, label, children }: { checked: boolean; onToggle: () => void; label: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border p-3 transition ${checked ? "border-emerald-300 bg-emerald-50/30" : "border-slate-200"}`}>
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={checked} onChange={onToggle} className="h-4 w-4 cursor-pointer rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
        <span className="text-sm font-medium text-slate-700">{label}</span>
      </label>
      <div className={`mt-2 ${checked ? "" : "pointer-events-none opacity-40"}`}>{children}</div>
    </div>
  );
}
