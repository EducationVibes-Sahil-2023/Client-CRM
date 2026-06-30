"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getCallDashboard, getCalls, getLeadsSetup, getStaff, getLookups,
  type CallDashboard, type CallRep, type CallLog, type LeadStatus, type LeadSource, type Staff, type LookupItem,
} from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";
import { useClient } from "../ClientContext";
import { Card, PageHeader, Spinner, EmptyState, SkeletonStats, SkeletonBlock, fmtDateTime } from "../../admin/ui";
import { FilterRail, FilterToggle, FilterLabel, filterRailPad } from "../FilterRail";
import { DataTable, Pagination, Avatar, type Column } from "../../admin/DataTable";
import { MultiSelect, type SelectOption } from "../../admin/SearchSelect";
import { DateRangeFilter, inDateRange, rangeActive, EMPTY_RANGE, type DateRange } from "../../admin/dateFilter";
import { CallActivityList } from "../../admin/CallActivity";
import { CALL_TYPE_LABEL, CALL_SOURCE_LABEL, CALL_STATUSES, callTypeChip, statusMeta, normalizeStatusKey, formatDuration } from "../../lib/calls";

// ---- colour + format helpers -------------------------------------------------
const HEX: Record<string, string> = {
  indigo: "#6366f1", violet: "#8b5cf6", emerald: "#10b981", amber: "#f59e0b",
  rose: "#f43f5e", sky: "#0ea5e9", teal: "#14b8a6", pink: "#ec4899",
  orange: "#f97316", lime: "#84cc16", cyan: "#06b6d4", slate: "#94a3b8",
};
const toHex = (c?: string) => (!c ? HEX.slate : c.startsWith("#") ? c : HEX[c] ?? HEX.slate);
const nf = (n: number) => n.toLocaleString("en-IN");
/** Seconds → "44h 24m" / "16m" / "0m". */
const fmtHM = (sec: number) => {
  const m = Math.round((sec || 0) / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
};
/** Seconds → "1m 31s" / "45s" / "0s". */
const fmtMS = (sec: number) => {
  const s = Math.round(sec || 0);
  if (s <= 0) return "0s";
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dLabel = (iso: string) => { const [, m, d] = iso.split("-"); return `${MON[+m - 1]} ${+d}`; };
const hourLabel = (h: number) => (h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`);

// ---- presentational pieces ---------------------------------------------------

/** A KPI tile with a coloured value and a vs-yesterday delta chip. */
function Kpi({ label, value, sub, delta, tone }: { label: string; value: string; sub?: string; delta: number | null; tone: string }) {
  const up = (delta ?? 0) >= 0;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 bg-gradient-to-r ${tone} bg-clip-text text-2xl font-bold text-transparent`}>{value}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px]">
        {delta == null ? (
          <span className="text-slate-400">{sub ?? "—"}</span>
        ) : (
          <>
            <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold ${up ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
              <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d={up ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} strokeLinecap="round" strokeLinejoin="round" /></svg>
              {Math.abs(delta)}%
            </span>
            <span className="text-slate-400">vs yesterday</span>
          </>
        )}
      </div>
    </div>
  );
}

/** Vertical bars (hourly / by-status). Optional per-bar colour; else highlight the max. */
function VBars({ bars, height = 210 }: { bars: { label: string; value: number; color?: string }[]; height?: number }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const barArea = height - 34;
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {bars.map((b, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
          <span className="text-[10px] font-semibold text-slate-600">{b.value || ""}</span>
          <div
            className="bar-grow w-full rounded-t"
            style={{ height: `${Math.max(b.value > 0 ? 3 : 0, (b.value / max) * barArea)}px`, background: b.color ?? (b.value === max ? "#4f46e5" : "#c7d2fe"), animationDelay: `${i * 35}ms` }}
            title={`${b.label}: ${b.value}`}
          />
          <span className="w-full truncate text-center text-[9px] text-slate-400">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

/** A small "Top 3" side panel. */
function Top3({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="w-36 flex-shrink-0 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <div className="mb-2 text-[11px] font-semibold text-slate-500">{title}</div>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="text-[11px]">
            <span className="flex items-center gap-1.5 font-medium text-slate-600">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color ?? "#6366f1" }} />
              <span className="truncate">{r.label}</span>
            </span>
            <span className="ml-3 text-slate-400">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ranked horizontal mini-bars (Top 5 / Least 5). */
function RankList({ rows, color, fmt }: { rows: { name: string; value: number }[]; color: string; fmt: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-6 text-center text-xs text-slate-400">No data</p>;
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-3 text-[11px] font-semibold text-slate-400">{i + 1}</span>
          <span className="w-20 flex-shrink-0 truncate text-xs font-medium text-slate-600" title={r.name}>{r.name}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </div>
          <span className="w-12 flex-shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-700">{fmt(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Attempts (light) vs Connects (green) per rep — paired vertical bars. */
function AttemptsConnects({ reps }: { reps: { name: string; attempts: number; connects: number }[] }) {
  const max = Math.max(1, ...reps.map((r) => r.attempts));
  const H = 170;
  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-max items-end gap-3 px-1" style={{ height: H + 46 }}>
        {reps.map((r, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className="flex items-end gap-0.5" style={{ height: H }}>
              <div className="w-3.5 rounded-t bg-sky-200" style={{ height: `${(r.attempts / max) * H}px` }} title={`${r.attempts} attempts`} />
              <div className="w-3.5 rounded-t bg-emerald-500" style={{ height: `${(r.connects / max) * H}px` }} title={`${r.connects} connects`} />
            </div>
            <span className="h-10 w-12 origin-top -rotate-45 truncate text-[9px] text-slate-400" title={r.name}>{r.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 7-day trend: call-count bars + avg-duration line (dual scale). */
function TrendChart({ trend }: { trend: { date: string; calls: number; avg_sec: number }[] }) {
  const W = 640, H = 210, pad = { l: 30, r: 30, t: 18, b: 26 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const maxCalls = Math.max(1, ...trend.map((t) => t.calls));
  const maxAvg = Math.max(1, ...trend.map((t) => t.avg_sec)) * 1.15;
  const x = (i: number) => pad.l + (trend.length <= 1 ? iw / 2 : (i / (trend.length - 1)) * iw);
  const yAvg = (v: number) => pad.t + ih - (v / maxAvg) * ih;
  const line = trend.map((t, i) => `${i ? "L" : "M"} ${x(i)} ${yAvg(t.avg_sec)}`).join(" ");
  const area = `${line} L ${x(trend.length - 1)} ${pad.t + ih} L ${x(0)} ${pad.t + ih} Z`;
  const bw = 22;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 230 }}>
      <defs>
        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity="0.28" /><stop offset="100%" stopColor="#6366f1" stopOpacity="0" /></linearGradient>
      </defs>
      {trend.map((t, i) => { const h = (t.calls / maxCalls) * ih; return <rect key={i} x={x(i) - bw / 2} y={pad.t + ih - h} width={bw} height={h} rx={3} fill="#e0e7ff" />; })}
      {trend.map((t, i) => <text key={`c${i}`} x={x(i)} y={pad.t + ih - (t.calls / maxCalls) * ih - 4} textAnchor="middle" className="fill-indigo-300 text-[9px] font-semibold">{t.calls}</text>)}
      <path d={area} fill="url(#trendGrad)" />
      <path d={line} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {trend.map((t, i) => (
        <g key={`p${i}`}>
          <circle cx={x(i)} cy={yAvg(t.avg_sec)} r="3.5" fill="#fff" stroke="#6366f1" strokeWidth="2" />
          <text x={x(i)} y={yAvg(t.avg_sec) - 8} textAnchor="middle" className="fill-slate-500 text-[9px] font-semibold">{fmtMS(t.avg_sec)}</text>
          <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-slate-400 text-[10px]">{dLabel(t.date)}</text>
        </g>
      ))}
    </svg>
  );
}

const pctChip = (p: number) => (p >= 50 ? "bg-emerald-50 text-emerald-700" : p >= 30 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700");

/** The dense per-rep performance table. */
function RepTable({ reps }: { reps: CallRep[] }) {
  const cols: { h: string; r: (x: CallRep, i: number) => ReactNode; right?: boolean }[] = [
    { h: "#", r: (_x, i) => <span className="text-slate-400">{i + 1}</span> },
    { h: "Staff name", r: (x) => <span className="flex items-center gap-2"><Avatar name={x.name} color="from-indigo-500 to-violet-600" /><span className="font-medium text-slate-700">{x.name}</span></span> },
    { h: "Total Calls", right: true, r: (x) => <span className="font-semibold tabular-nums text-slate-800">{nf(x.total)}</span> },
    { h: "Unique Calls", right: true, r: (x) => <span className="tabular-nums text-slate-600">{nf(x.unique)}</span> },
    { h: "Connected", right: true, r: (x) => <span className="tabular-nums text-slate-600">{nf(x.connected)}</span> },
    { h: "Talk Time", right: true, r: (x) => <span className="tabular-nums text-slate-600">{fmtHM(x.talk_sec)}</span> },
    { h: "Avg Duration", right: true, r: (x) => <span className="tabular-nums text-slate-600">{fmtMS(x.avg_sec)}</span> },
    { h: "Fresh Calls", right: true, r: (x) => <span className="tabular-nums text-slate-600">{nf(x.fresh)}</span> },
    { h: "Fresh Connected", right: true, r: (x) => <span className="tabular-nums text-slate-600">{nf(x.fresh_connected)}</span> },
    { h: "Fresh Talk Time", right: true, r: (x) => <span className="tabular-nums text-slate-600">{fmtHM(x.fresh_talk_sec)}</span> },
    { h: "Connect %", right: true, r: (x) => <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${pctChip(x.connect_pct)}`}>{x.connect_pct}%</span> },
  ];
  return (
    <div className="max-h-[640px] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
          <tr>{cols.map((c) => <th key={c.h} className={`whitespace-nowrap px-3 py-2.5 font-medium ${c.right ? "text-right" : "text-left"}`}>{c.h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {reps.map((x, i) => (
            <tr key={x.id} className="hover:bg-slate-50/60">
              {cols.map((c) => <td key={c.h} className={`whitespace-nowrap px-3 py-2 ${c.right ? "text-right" : "text-left"}`}>{c.r(x, i)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const isSubStatus = (s: LeadStatus) => (s.parent_ids?.length ?? 0) > 0 || !!s.parent_id;

// =============================================================================


export default function ClientCalls() {
  const toast = useToast();
  const { defaultPageSize } = useClient();
  const [tab, setTab] = useState<"dashboard" | "log">("dashboard");

  // ---- dashboard state ----
  const [dash, setDash] = useState<CallDashboard | null>(null);
  const [dashLoading, setDashLoading] = useState(true);
  const [date, setDate] = useState(""); // "" → server's today
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [fSource, setFSource] = useState<string[]>([]);
  const [fDept, setFDept] = useState<string[]>([]);
  const [fOffice, setFOffice] = useState<string[]>([]);
  const [fAssign, setFAssign] = useState<string[]>([]);

  // ---- filter option sources ----
  const [statuses, setStatuses] = useState<LeadStatus[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [depts, setDepts] = useState<LookupItem[]>([]);
  const [offices, setOffices] = useState<LookupItem[]>([]);

  useEffect(() => {
    getLeadsSetup().then((d) => { setStatuses(d.lead_statuses ?? []); setSources(d.lead_sources ?? []); }).catch(() => {});
    getStaff().then((d) => setStaff(d.staff ?? [])).catch(() => {});
    getLookups().then((d) => { setDepts(d.lookups?.department ?? []); setOffices(d.lookups?.office_location ?? []); }).catch(() => {});
  }, []);

  const loadDash = useCallback(() => {
    const params: Record<string, string | undefined> = {
      date: date || undefined,
      assign: fAssign.join(",") || undefined,
      lead_status: fStatus.join(",") || undefined,
      lead_source: fSource.join(",") || undefined,
      department: fDept.join(",") || undefined,
      office: fOffice.join(",") || undefined,
    };
    return getCallDashboard(params)
      .then((d) => { setDash(d); setDate((cur) => cur || d.date); })
      .catch(() => toast.error("Could not load call dashboard."))
      .finally(() => setDashLoading(false));
  }, [date, fAssign, fStatus, fSource, fDept, fOffice, toast]);
  useEffect(() => { loadDash(); }, [loadDash]);

  const statusOpts: SelectOption[] = useMemo(() => statuses.filter((s) => !isSubStatus(s)).map((s) => ({ value: String(s.id), label: s.name, prefix: <span className="h-2 w-2 rounded-full" style={{ background: toHex(s.color) }} /> })), [statuses]);
  const sourceOpts: SelectOption[] = useMemo(() => sources.map((s) => ({ value: String(s.id), label: s.name, prefix: <span className="h-2 w-2 rounded-full" style={{ background: toHex(s.color) }} /> })), [sources]);
  const deptOpts: SelectOption[] = useMemo(() => depts.map((d) => ({ value: String(d.id), label: d.name })), [depts]);
  const officeOpts: SelectOption[] = useMemo(() => offices.map((o) => ({ value: String(o.id), label: o.name })), [offices]);
  const assignOpts: SelectOption[] = useMemo(() => staff.map((s) => ({ value: String(s.id), label: s.name })), [staff]);

  const filtersActive = !!(fStatus.length || fSource.length || fDept.length || fOffice.length || fAssign.length);
  function clearDashFilters() { setFStatus([]); setFSource([]); setFDept([]); setFOffice([]); setFAssign([]); }
  // Slide-in Filters drawer (shared across both tabs — only one is visible at a
  // time). Counts drive the badge on each tab's Filters button.
  const [filterOpen, setFilterOpen] = useState(false);
  const dashCount = [fSource.length, fStatus.length, fDept.length, fOffice.length, fAssign.length].filter(Boolean).length;

  // Derived dashboard slices.
  const k = dash?.kpis.today;
  const delta = dash?.kpis.delta;
  const hourly = useMemo(() => dash?.hourly ?? [], [dash]);
  const byStatus = useMemo(() => dash?.by_status ?? [], [dash]);
  const reps = useMemo(() => dash?.reps ?? [], [dash]);

  const top3Hours = useMemo(() => [...hourly].sort((a, b) => b.calls - a.calls).slice(0, 3)
    .map((h) => ({ label: hourLabel(h.hour), value: `${h.calls} leads · ${fmtHM(h.talk_sec)}` })), [hourly]);
  const top3Status = useMemo(() => [...byStatus].sort((a, b) => b.calls - a.calls).slice(0, 3)
    .map((s) => ({ label: s.label, color: toHex(s.color), value: `${s.calls} leads · ${fmtHM(s.talk_sec)}` })), [byStatus]);

  const rankByCalls = useMemo(() => [...reps].sort((a, b) => b.total - a.total), [reps]);
  const rankByTalk = useMemo(() => [...reps].sort((a, b) => b.talk_sec - a.talk_sec), [reps]);
  const rankByRate = useMemo(() => [...reps].filter((r) => r.total >= 3).sort((a, b) => b.connect_pct - a.connect_pct), [reps]);
  const top = <T,>(a: T[]) => a.slice(0, 5);
  const least = <T,>(a: T[]) => a.slice(-5).reverse();
  const attempts = useMemo(() => rankByCalls.slice(0, 18).map((r) => ({ name: r.name.split(" ")[0], attempts: r.total, connects: r.connected })), [rankByCalls]);

  // =============================== CALL LOG (secondary view) ==================
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [logLoaded, setLogLoaded] = useState(false);
  const [logView, setLogView] = useState<"table" | "feed">("table");
  const [search, setSearch] = useState("");
  const [lType, setLType] = useState<string[]>([]);
  const [lSource, setLSource] = useState<string[]>([]);
  const [lStatus, setLStatus] = useState<string[]>([]);
  const [lConn, setLConn] = useState<string[]>([]);
  const [lDate, setLDate] = useState<DateRange>(EMPTY_RANGE);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(defaultPageSize);

  useEffect(() => {
    if (tab !== "log" || logLoaded) return;
    getCalls().then((r) => { setCalls(r.calls ?? []); setLogLoaded(true); }).catch(() => toast.error("Could not load calls."));
  }, [tab, logLoaded, toast]);

  const logFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const set = new Set(lStatus);
    return calls.filter((c) => {
      if (q && ![c.lead_name, c.staff_name, c.contact, c.staff_contact, c.call_status].some((v) => (v ?? "").toLowerCase().includes(q))) return false;
      if (lType.length && !(c.type && lType.includes(c.type))) return false;
      if (lSource.length && !(c.source && lSource.includes(c.source))) return false;
      if (set.size && !set.has(normalizeStatusKey(c.call_status))) return false;
      if (lConn.length && !lConn.includes(c.connected ? "yes" : "no")) return false;
      if (!inDateRange(c.call_start, lDate)) return false;
      return true;
    });
  }, [calls, search, lType, lSource, lStatus, lConn, lDate]);
  const logPages = Math.max(1, Math.ceil(logFiltered.length / perPage));
  const logSafe = Math.min(page, logPages);
  const logRows = useMemo(() => logFiltered.slice((logSafe - 1) * perPage, logSafe * perPage), [logFiltered, logSafe, perPage]);
  const logActive = !!(search || lType.length || lSource.length || lStatus.length || lConn.length || rangeActive(lDate));
  // Active filter groups (search lives in the toolbar, so it's excluded here).
  const logCount = [lType.length, lSource.length, lStatus.length, lConn.length, rangeActive(lDate)].filter(Boolean).length;
  function clearLogFilters() { setLType([]); setLSource([]); setLStatus([]); setLConn([]); setLDate(EMPTY_RANGE); setPage(1); }

  const dash2 = <span className="text-slate-400">—</span>;
  const logCols: Column<CallLog>[] = [
    { key: "lead", header: "Lead", width: 170, lockVisible: true, render: (c) => (c.lead_name ? <span className="font-medium text-slate-800">{c.lead_name}</span> : <span className="text-slate-400">Unmatched</span>) },
    { key: "contact", header: "Number", width: 130, render: (c) => <span className="tabular-nums text-slate-600">{c.contact ?? "—"}</span> },
    { key: "type", header: "Type", width: 110, render: (c) => <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${callTypeChip(c.type)}`}>{c.type ? CALL_TYPE_LABEL[c.type] : "—"}</span> },
    { key: "source", header: "Source", width: 100, render: (c) => (c.source ? <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{CALL_SOURCE_LABEL[c.source]}</span> : dash2) },
    { key: "status", header: "Status", width: 150, render: (c) => { const m = statusMeta(c.call_status); return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${m.chip}`}>{m.label}</span>; } },
    { key: "connected", header: "Connected", width: 110, render: (c) => <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${c.connected ? "text-emerald-600" : "text-slate-400"}`}><span className={`h-2 w-2 rounded-full ${c.connected ? "bg-emerald-500" : "bg-slate-300"}`} />{c.connected ? "Yes" : "No"}</span> },
    { key: "duration", header: "Duration", width: 100, render: (c) => <span className="tabular-nums text-slate-600">{formatDuration(c.duration)}</span> },
    { key: "staff", header: "Staff", width: 150, render: (c) => c.staff_name ?? dash2 },
    { key: "call_start", header: "When", width: 170, render: (c) => <span className="text-slate-600">{fmtDateTime(c.call_start)}</span> },
  ];
  const TYPE_OPTS: SelectOption[] = [{ value: "incoming", label: "Incoming" }, { value: "outgoing", label: "Outgoing" }, { value: "missed", label: "Missed" }];
  const SRC_OPTS: SelectOption[] = [{ value: "ivr", label: "IVR" }, { value: "phone", label: "Phone" }];
  const CONN_OPTS: SelectOption[] = [{ value: "yes", label: "Connected" }, { value: "no", label: "Not connected" }];
  const CSTATUS_OPTS: SelectOption[] = CALL_STATUSES.map((s) => ({ value: s.key, label: s.label, prefix: <span className="h-2 w-2 rounded-full" style={{ background: s.color }} /> }));

  const selCls = "rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15";

  return (
    <>
      <PageHeader title="Sales Call Tracker" subtitle="Real-time team call performance — calls, connects, talk time and per-rep output." />

      {/* View toggle */}
      <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1">
        {([["dashboard", "Dashboard"], ["log", "Call log"]] as const).map(([v, lbl]) => (
          <button key={v} onClick={() => setTab(v)} className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === v ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>{lbl}</button>
        ))}
      </div>

      {tab === "dashboard" ? (
        <div className={`space-y-4 ${filterRailPad(filterOpen)}`}>
          {/* Filters — Date + Refresh stay in the bar; the rest live in the right-side rail. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FilterToggle open={filterOpen} count={dashCount} onClick={() => setFilterOpen((o) => !o)} />
            </div>
            <div className="flex items-center gap-2">
              {filtersActive && <button onClick={clearDashFilters} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Clear filters</button>}
              <button onClick={() => { setDashLoading(true); loadDash(); }} title="Refresh" className="flex h-[38px] w-[38px] items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-slate-50">
                <svg className={`h-4 w-4 ${dashLoading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 2v6h-6M3 12a9 9 0 0115-6.7L21 8M3 22v-6h6M21 12a9 9 0 01-15 6.7L3 16" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
          </div>

          <FilterRail
            open={tab === "dashboard" && filterOpen}
            onClose={() => setFilterOpen(false)}
            onReset={clearDashFilters}
            resetDisabled={!filtersActive}
            onApply={() => setFilterOpen(false)}
            applyLabel="Done"
          >
            <div className="space-y-1.5"><FilterLabel>Date</FilterLabel><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${selCls} w-full`} /></div>
            <div className="space-y-1.5"><FilterLabel>Lead source</FilterLabel><MultiSelect ariaLabel="Lead source" value={fSource} onChange={setFSource} options={sourceOpts} placeholder="All sources" searchPlaceholder="Search…" /></div>
            <div className="space-y-1.5"><FilterLabel>Lead status</FilterLabel><MultiSelect ariaLabel="Lead status" value={fStatus} onChange={setFStatus} options={statusOpts} placeholder="All statuses" searchPlaceholder="Search…" /></div>
            <div className="space-y-1.5"><FilterLabel>Department</FilterLabel><MultiSelect ariaLabel="Department" value={fDept} onChange={setFDept} options={deptOpts} placeholder="All" searchPlaceholder="Search…" /></div>
            <div className="space-y-1.5"><FilterLabel>Office</FilterLabel><MultiSelect ariaLabel="Office" value={fOffice} onChange={setFOffice} options={officeOpts} placeholder="All" searchPlaceholder="Search…" /></div>
            <div className="space-y-1.5"><FilterLabel>Assign</FilterLabel><MultiSelect ariaLabel="Assign" value={fAssign} onChange={setFAssign} options={assignOpts} placeholder="Everyone" searchPlaceholder="Search team…" /></div>
          </FilterRail>

          {dashLoading && !dash ? (
            <div className="space-y-4">
              <SkeletonStats count={4} />
              <div className="grid gap-4 lg:grid-cols-2">
                <SkeletonBlock className="h-64" />
                <SkeletonBlock className="h-64" />
              </div>
            </div>
          ) : !k ? (
            <Card><EmptyState title="No call data" hint="No calls match these filters for the selected date." /></Card>
          ) : (
            <>
              {/* KPI strip */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Kpi label="Total calls" value={nf(k.total)} delta={delta?.total ?? null} tone="from-indigo-500 to-violet-600" />
                <Kpi label="Unique calls" value={nf(k.unique)} delta={delta?.unique ?? null} tone="from-sky-500 to-blue-600" />
                <Kpi label="Avg call duration" value={fmtMS(k.avg_sec)} delta={delta?.avg_sec ?? null} tone="from-violet-500 to-purple-600" />
                <Kpi label="Connect rate" value={`${k.connect_rate}% (${nf(k.connected)})`} delta={delta?.connect_rate ?? null} tone="from-emerald-500 to-teal-600" />
                <Kpi label="Total talk time" value={fmtHM(k.talk_sec)} delta={delta?.talk_sec ?? null} tone="from-amber-500 to-orange-600" />
              </div>

              {/* Hourly + by-status */}
              <Card>
                <h3 className="mb-3 text-sm font-semibold text-slate-700">Hourly call distribution <span className="font-normal text-slate-400">· office hours</span></h3>
                <div className="flex gap-4">
                  <div className="min-w-0 flex-1"><VBars bars={hourly.map((h) => ({ label: hourLabel(h.hour), value: h.calls }))} /></div>
                  <Top3 title="Top 3 hours" rows={top3Hours} />
                </div>
              </Card>

              <Card>
                <h3 className="mb-3 text-sm font-semibold text-slate-700">Call volume by lead status</h3>
                <div className="flex gap-4">
                  <div className="min-w-0 flex-1"><VBars bars={byStatus.map((s) => ({ label: s.label, value: s.calls, color: toHex(s.color) }))} /></div>
                  <Top3 title="Top 3 status" rows={top3Status} />
                </div>
              </Card>

              {/* Top / Least 5 */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <Card><h3 className="mb-3 text-sm font-semibold text-slate-700">Top 5 — Calls made</h3><RankList rows={top(rankByCalls).map((r) => ({ name: r.name, value: r.total }))} color="#6366f1" fmt={nf} /></Card>
                <Card><h3 className="mb-3 text-sm font-semibold text-slate-700">Top 5 — Talk time</h3><RankList rows={top(rankByTalk).map((r) => ({ name: r.name, value: r.talk_sec }))} color="#10b981" fmt={fmtHM} /></Card>
                <Card><h3 className="mb-3 text-sm font-semibold text-slate-700">Top 5 — Connect rate</h3><RankList rows={top(rankByRate).map((r) => ({ name: r.name, value: r.connect_pct }))} color="#f97316" fmt={(n) => `${n}%`} /></Card>
                <Card><h3 className="mb-3 text-sm font-semibold text-slate-700">Least 5 — Calls made</h3><RankList rows={least(rankByCalls).map((r) => ({ name: r.name, value: r.total }))} color="#818cf8" fmt={nf} /></Card>
                <Card><h3 className="mb-3 text-sm font-semibold text-slate-700">Least 5 — Talk time</h3><RankList rows={least(rankByTalk).map((r) => ({ name: r.name, value: r.talk_sec }))} color="#34d399" fmt={fmtHM} /></Card>
                <Card><h3 className="mb-3 text-sm font-semibold text-slate-700">Least 5 — Connect rate</h3><RankList rows={least(rankByRate).map((r) => ({ name: r.name, value: r.connect_pct }))} color="#fb923c" fmt={(n) => `${n}%`} /></Card>
              </div>

              {/* Trend + Attempts/Connects */}
              <Card>
                <h3 className="mb-1 text-sm font-semibold text-slate-700">7-day call trend</h3>
                <p className="mb-2 flex items-center gap-4 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-indigo-200" />Call count</span>
                  <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-indigo-500" />Avg duration</span>
                </p>
                <TrendChart trend={dash!.trend} />
              </Card>

              <Card>
                <h3 className="mb-1 text-sm font-semibold text-slate-700">Attempts vs connects — per rep</h3>
                <p className="mb-3 flex items-center gap-4 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-sky-200" />Attempts</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-emerald-500" />Connects</span>
                </p>
                <AttemptsConnects reps={attempts} />
              </Card>

              {/* Rep table */}
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-700">Rep performance — {dLabel(dash!.date)} <span className="font-normal text-slate-400">· {reps.length} reps</span></h3>
                <RepTable reps={reps} />
              </div>
            </>
          )}
        </div>
      ) : (
        // ============================ CALL LOG VIEW ============================
        <div className={`space-y-4 ${filterRailPad(filterOpen)}`}>
          {/* Filters — a Filters toggle opens the right-side rail; the search stays instant. */}
          <FilterRail
            open={filterOpen}
            onClose={() => setFilterOpen(false)}
            onReset={clearLogFilters}
            resetDisabled={!(lType.length || lSource.length || lStatus.length || lConn.length || rangeActive(lDate))}
            onApply={() => setFilterOpen(false)}
            applyLabel="Done"
          >
            <div className="space-y-1.5"><FilterLabel>Status</FilterLabel><MultiSelect ariaLabel="Status" value={lStatus} onChange={(v) => { setLStatus(v); setPage(1); }} options={CSTATUS_OPTS} placeholder="All statuses" searchPlaceholder="Search…" /></div>
            <div className="space-y-1.5"><FilterLabel>Type</FilterLabel><MultiSelect ariaLabel="Type" value={lType} onChange={(v) => { setLType(v); setPage(1); }} options={TYPE_OPTS} placeholder="All types" searchPlaceholder="Search…" /></div>
            <div className="space-y-1.5"><FilterLabel>Source</FilterLabel><MultiSelect ariaLabel="Source" value={lSource} onChange={(v) => { setLSource(v); setPage(1); }} options={SRC_OPTS} placeholder="All sources" searchPlaceholder="Search…" /></div>
            <div className="space-y-1.5"><FilterLabel>Connected</FilterLabel><MultiSelect ariaLabel="Connected" value={lConn} onChange={(v) => { setLConn(v); setPage(1); }} options={CONN_OPTS} placeholder="Any" searchPlaceholder="Search…" /></div>
            <div className="space-y-1.5"><FilterLabel>Call date</FilterLabel><DateRangeFilter ariaLabel="Call date" value={lDate} onChange={(v) => { setLDate(v); setPage(1); }} /></div>
          </FilterRail>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-1 items-center gap-2">
              <div className="flex-shrink-0"><FilterToggle open={filterOpen} count={logCount} onClick={() => setFilterOpen((o) => !o)} /></div>
              <div className="relative w-full max-w-sm">
                <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
                <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search lead, number, staff…" className={`${selCls} w-full pl-9`} />
              </div>
              {logActive && <button onClick={() => { setSearch(""); clearLogFilters(); }} className="flex-shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Clear</button>}
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-slate-400 sm:block">{logFiltered.length} call{logFiltered.length === 1 ? "" : "s"}</span>
              <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
                {(["table", "feed"] as const).map((v) => (
                  <button key={v} onClick={() => setLogView(v)} className={`flex h-8 items-center rounded-md px-3 text-sm font-medium transition ${logView === v ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-100"}`}>{v === "table" ? "Table" : "Activity"}</button>
                ))}
              </div>
            </div>
          </div>

          {logView === "table" ? (
            <DataTable
              tableKey="calls" columns={logCols} rows={logRows} getKey={(c) => c.id} loading={!logLoaded} nowrap pageAlign="right"
              emptyTitle={logActive ? "No matching calls" : "No calls yet"}
              emptyHint={logActive ? "Try clearing or widening your filters." : "Calls appear here once your call-tracking app starts syncing."}
              page={logSafe} totalPages={logPages} onPage={setPage} total={logFiltered.length}
              pageSize={perPage} onPageSize={(n) => { setPerPage(n); setPage(1); }}
            />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {!logLoaded ? <Spinner /> : logRows.length === 0 ? (
                <EmptyState title={logActive ? "No matching calls" : "No calls yet"} hint={logActive ? "Try clearing or widening your filters." : "Calls appear here once your call-tracking app starts syncing."} />
              ) : (
                <>
                  <CallActivityList calls={logRows} />
                  {logPages > 1 && <Pagination page={logSafe} totalPages={logPages} onPage={setPage} total={logFiltered.length} align="right" pageSize={perPage} onPageSize={(n) => { setPerPage(n); setPage(1); }} />}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
