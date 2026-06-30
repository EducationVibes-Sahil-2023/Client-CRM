"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getFollowupDashboard, getLeadsSetup, getStaff, getLookups,
  type FollowupDashboard, type FollowupRep, type FollowupOverview, type FollowupBucket, type GhostedLead, type LeadStatus, type LeadSource, type Staff, type LookupItem,
} from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";
import { useClient } from "../ClientContext";
import { Card, PageHeader, EmptyState, SkeletonStats, SkeletonBlock } from "../../admin/ui";
import { FilterRail, FilterToggle, FilterLabel, filterRailPad } from "../FilterRail";
import { DataTable, type Column } from "../../admin/DataTable";
import { DonutChart } from "../../admin/Charts";
import { MultiSelect, type SelectOption } from "../../admin/SearchSelect";
import { DateRangeFilter, resolveDateRange, rangeActive, EMPTY_RANGE, type DateRange } from "../../admin/dateFilter";

// ---- colour helpers ----
const HEX: Record<string, string> = {
  indigo: "#6366f1", violet: "#8b5cf6", emerald: "#10b981", amber: "#f59e0b",
  rose: "#f43f5e", sky: "#0ea5e9", teal: "#14b8a6", pink: "#ec4899",
  orange: "#f97316", lime: "#84cc16", cyan: "#06b6d4", slate: "#94a3b8",
};
const toHex = (c?: string) => (!c ? HEX.slate : c.startsWith("#") ? c : HEX[c] ?? HEX.slate);
const nf = (n: number) => n.toLocaleString("en-IN");
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayLabel = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return `${WD[d.getDay()]} ${d.getDate()}`; };
const isSubStatus = (s: LeadStatus) => (s.parent_ids?.length ?? 0) > 0 || !!s.parent_id;

// ---- presentational pieces ----
function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: string }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${tone}`} />
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1.5 bg-gradient-to-r ${tone} bg-clip-text text-2xl font-bold text-transparent`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

/** Vertical bars; optional per-bar colour, else the max is highlighted. */
function VBars({ bars, height = 200 }: { bars: { label: string; value: number; color?: string }[]; height?: number }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const area = height - 34;
  if (!bars.some((b) => b.value > 0)) return <p className="py-10 text-center text-sm text-slate-400">No data</p>;
  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {bars.map((b, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
          <span className="text-[10px] font-semibold text-slate-600">{b.value || ""}</span>
          <div className="bar-grow w-full rounded-t" style={{ height: `${Math.max(b.value > 0 ? 3 : 0, (b.value / max) * area)}px`, background: b.color ?? (b.value === max ? "#10b981" : "#a7f3d0"), animationDelay: `${i * 35}ms` }} title={`${b.label}: ${b.value}`} />
          <span className="w-full truncate text-center text-[9px] text-slate-400">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

const pctChip = (p: number) => (p >= 70 ? "bg-emerald-50 text-emerald-700" : p >= 40 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700");

/** Follow-up volume per lead status — stacked (completed + pending) vertical bars
 *  with an ALL / COMPLETED / PENDING toggle and a colour-coded legend. */
function StatusVolumeChart({ data }: { data: { label: string; color: string; count: number; completed: number; pending: number }[] }) {
  const [mode, setMode] = useState<"all" | "completed" | "pending">("all");
  const valOf = (d: { count: number; completed: number; pending: number }) => (mode === "completed" ? d.completed : mode === "pending" ? d.pending : d.count);
  const max = Math.max(1, ...data.map(valOf));
  const H = 230, area = H - 26;
  const modes: [("all" | "completed" | "pending"), string, string][] = [["all", "ALL", "#0ea5e9"], ["completed", "COMPLETED", "#10b981"], ["pending", "PENDING", "#f97316"]];
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {data.map((d) => (
          <span key={d.label} className="inline-flex items-center gap-1 text-slate-500">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: toHex(d.color) }} />
            {d.label} <span className="text-slate-400">({d.count})</span>
          </span>
        ))}
      </div>
      <div className="mb-2 flex justify-end gap-1.5">
        {modes.map(([k, lbl, tone]) => (
          <button key={k} onClick={() => setMode(k)} className={`rounded-md px-3 py-1 text-[11px] font-bold tracking-wide transition ${mode === k ? "text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`} style={mode === k ? { background: tone } : undefined}>{lbl}</button>
        ))}
      </div>
      <div className="flex items-end gap-1.5" style={{ height: H }}>
        {data.map((d) => {
          const c = toHex(d.color);
          const comp = mode === "pending" ? 0 : d.completed;
          const pend = mode === "completed" ? 0 : d.pending;
          const sum = comp + pend;
          const v = valOf(d);
          return (
            <div key={d.label} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${d.label}: ${v}`}>
              <span className="text-[9px] font-semibold text-slate-600">{v || ""}</span>
              <div className="bar-grow flex w-full max-w-[26px] flex-col justify-end overflow-hidden rounded-t" style={{ height: `${Math.max(sum > 0 ? 3 : 0, (sum / max) * area)}px` }}>
                {pend > 0 && <div style={{ height: `${(pend / sum) * 100}%`, background: c }} title={`Pending: ${d.pending}`} />}
                {comp > 0 && <div style={{ height: `${(comp / sum) * 100}%`, background: `${c}59` }} title={`Completed: ${d.completed}`} />}
              </div>
              <span className="w-full truncate text-center text-[9px] text-slate-400" title={d.label}>{d.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const AGING_TONE: Record<string, { bar: string; badge: string; tag: string }> = {
  due_today: { bar: "#d97706", badge: "bg-amber-100 text-amber-700", tag: "Due" },
  d1: { bar: "#ea580c", badge: "bg-orange-100 text-orange-700", tag: "Urgent" },
  d2: { bar: "#e11d48", badge: "bg-rose-100 text-rose-600", tag: "Critical" },
  d3: { bar: "#9f1239", badge: "bg-rose-100 text-rose-700", tag: "Escalate" },
  d4plus: { bar: "#7f1d1d", badge: "bg-red-100 text-red-800", tag: "Lost?" },
};
/** Overdue aging — horizontal severity bars (Due today → 4+ days) with badges. */
function OverdueAging({ rows }: { rows: { key: string; label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-3.5 py-1">
      {rows.map((r) => {
        const t = AGING_TONE[r.key] ?? AGING_TONE.due_today;
        return (
          <div key={r.key} className="flex items-center gap-3">
            <span className="w-28 flex-shrink-0 text-xs font-semibold text-slate-600">{r.label}</span>
            <div className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full transition-all" style={{ width: `${(r.count / max) * 100}%`, background: t.bar }} />
            </div>
            <span className="w-10 flex-shrink-0 text-right text-sm font-bold tabular-nums text-slate-700">{nf(r.count)}</span>
            <span className={`w-16 flex-shrink-0 rounded-md px-2 py-0.5 text-center text-[11px] font-semibold ${t.badge}`}>{t.tag}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Ranked counsellor bars (Top 5 most missed / Least 5 created) with a tag. */
function RankBar({ rows, color, tag, tagTone }: { rows: { name: string; value: number }[]; color: string; tag: string; tagTone: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-8 text-center text-sm text-slate-400">No data</p>;
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="w-32 flex-shrink-0 truncate text-sm text-slate-600" title={r.name}>{r.name}</span>
          <div className="relative h-4 flex-1 overflow-hidden rounded bg-slate-100"><div className="h-full rounded" style={{ width: `${(r.value / max) * 100}%`, background: color }} /></div>
          <span className="w-7 flex-shrink-0 text-right text-sm font-bold tabular-nums text-slate-700">{nf(r.value)}</span>
          <span className={`w-12 flex-shrink-0 rounded-md px-2 py-0.5 text-center text-[11px] font-semibold ${tagTone}`}>{tag}</span>
        </div>
      ))}
    </div>
  );
}

/** Grid of per-status split cards (dot + label + coloured sub-line). */
function StatusSplitCards({ items }: { items: { label: string; color: string; sub: string; muted?: boolean }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="rounded-lg border border-slate-200 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ background: toHex(it.color) }} />
            <span className="truncate" title={it.label}>{it.label}</span>
          </div>
          <div className="mt-0.5 text-xs font-medium" style={{ color: it.muted ? "#94a3b8" : toHex(it.color) }}>{it.sub}</div>
        </div>
      ))}
    </div>
  );
}

/** Ghosted leads list (3+ attempts, no connection) with an Excel/CSV export. */
function GhostedLeads({ rows }: { rows: GhostedLead[] }) {
  const [now] = useState(() => Date.now());
  const daysAgo = (iso: string | null) => {
    if (!iso) return "No calls";
    const d = new Date(iso.replace(" ", "T"));
    if (isNaN(d.getTime())) return "—";
    const days = Math.floor((now - d.getTime()) / 86400000);
    return days <= 0 ? "Today" : `${days} day${days === 1 ? "" : "s"} ago`;
  };
  function exportCsv() {
    const head = ["Lead", "Counsellor", "Phone", "Status", "Attempts", "Last attempt"];
    const esc = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
    const csv = [head, ...rows.map((r) => [r.name ?? "", r.counsellor ?? "", r.phone ?? "", r.status ?? "", String(r.attempts), r.last_call ?? ""])]
      .map((row) => row.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url; a.download = "ghosted-leads.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-slate-400">{nf(rows.length)} lead{rows.length === 1 ? "" : "s"} flagged</span>
        <button onClick={exportCsv} disabled={!rows.length} className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Export Excel
        </button>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-400">No ghosted leads — every contacted lead has responded. 🎉</p>
        ) : (
          <ul className="max-h-[560px] divide-y divide-slate-100 overflow-auto">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50/60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-slate-800">{r.name || "Unnamed lead"}</span>
                  <span className="block truncate text-xs text-slate-400">{[r.counsellor, r.phone].filter(Boolean).join(" · ") || "—"}</span>
                </span>
                {r.status && <span className="hidden flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold sm:inline-block" style={{ background: `${toHex(r.color)}1f`, color: toHex(r.color) }}>{r.status}</span>}
                <span className="flex-shrink-0 rounded-md bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-600">{r.attempts} attempts</span>
                <span className="w-24 flex-shrink-0 text-right text-xs text-slate-400">{daysAgo(r.last_call)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A summary card with a coloured top accent + optional status chip. */
function SumCard({ accent, label, value, sub, chip, chipTone }: {
  accent: string; label: string; value: string; sub?: ReactNode; chip?: string; chipTone?: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="h-1" style={{ background: accent }} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
          {chip && <span className={`flex-shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${chipTone ?? "bg-slate-100 text-slate-500"}`}>{chip}</span>}
        </div>
        <div className="mt-1 text-3xl font-bold text-slate-800">{value}</div>
        {sub && <div className="mt-1 text-[11px] leading-relaxed text-slate-400">{sub}</div>}
      </div>
    </div>
  );
}

/** The top overview: overdue alert banner + summary cards (matches the brief). */
function FollowupSummary({ ov, pending, overdueBuckets }: {
  ov: FollowupOverview; pending: FollowupBucket[]; overdueBuckets: FollowupBucket[];
}) {
  const belowTarget = ov.completion < ov.target;
  return (
    <div className="space-y-3">
      {ov.overdue > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-rose-500 text-white">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-rose-700">{nf(ov.overdue)} follow-ups are overdue right now</div>
            {overdueBuckets.length > 0 && (
              <div className="text-[11px] font-medium text-rose-500">
                {overdueBuckets.map((b) => `${b.name}: ${nf(b.value)}`).join("   •   ")}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SumCard accent="#f97316" label="Total due" value={nf(ov.total_due)} sub="Across all counsellors" />
        <SumCard accent="#10b981" label="Completed" value={nf(ov.completed)} sub={`of ${nf(ov.scheduled)} scheduled`} chip={`${ov.completion}% done`} chipTone="bg-rose-50 text-rose-600" />
        <SumCard accent="#f43f5e" label="Overdue till now" value={nf(ov.overdue)} sub="Not actioned yet" chip="▲ Critical" chipTone="bg-rose-50 text-rose-600" />

        {pending.map((b) => (
          <SumCard
            key={b.id}
            accent={toHex(b.color)}
            label={`${b.name} pending`}
            value={nf(b.value)}
            sub={(b.breakdown ?? []).map((x) => `${x.label}: ${nf(x.value)}`).join("  •  ")}
          />
        ))}

        <SumCard accent="#6366f1" label="Team completion rate" value={`${ov.completion}%`} sub={`Target: ${ov.target}%`} chip={belowTarget ? "▼ Below target" : "On track"} chipTone={belowTarget ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"} />
        <SumCard accent="#94a3b8" label="Ghosted / no response" value={nf(ov.ghosted)} sub="3+ attempts, no reply" chip="Review needed" chipTone="bg-slate-100 text-slate-500" />
        <SumCard accent="#f43f5e" label="Future follow-ups" value={nf(ov.future)} />
      </div>
    </div>
  );
}

/** Counsellor health from completion %: On track ≥70, At risk ≥40, else Critical. */
function repHealth(pct: number) {
  if (pct >= 70) return { key: "on" as const, label: "On track", chip: "bg-emerald-50 text-emerald-600" };
  if (pct >= 40) return { key: "risk" as const, label: "At risk", chip: "bg-amber-50 text-amber-700" };
  return { key: "crit" as const, label: "Critical", chip: "bg-rose-50 text-rose-600" };
}

/** Counsellor follow-up workload & accountability — per-rep, with pending split
 *  by top-level status and an On track / At risk / Critical classification. */
const numPill = (n: number) => (
  <span className={`inline-flex min-w-7 justify-center rounded-full px-2 py-0.5 text-xs font-medium ${n > 0 ? "bg-slate-100 text-slate-600" : "text-slate-300"}`}>{n}</span>
);

function AccountabilityTable({ reps, topStatuses }: { reps: FollowupRep[]; topStatuses: { id: number; name: string; color: string }[] }) {
  const { defaultPageSize, isAdmin } = useClient();
  const [filter, setFilter] = useState<"all" | "on" | "risk" | "crit">("all");

  const rows = useMemo(() => reps
    .filter((r) => r.total > 0)
    .map((r) => {
      const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
      return { ...r, pending: r.total - r.done, pct, health: repHealth(pct) };
    })
    .sort((a, b) => a.pct - b.pct || b.total - a.total), [reps]);

  const counts = useMemo(() => ({
    all: rows.length,
    on: rows.filter((r) => r.health.key === "on").length,
    risk: rows.filter((r) => r.health.key === "risk").length,
    crit: rows.filter((r) => r.health.key === "crit").length,
  }), [rows]);
  const shown = filter === "all" ? rows : rows.filter((r) => r.health.key === filter);

  type Row = (typeof rows)[number];
  const columns = useMemo<Column<Row>[]>(() => [
    { key: "name", header: "Counsellor", lockVisible: true, width: 180, render: (x) => <span className="font-semibold text-slate-800">{x.name}</span> },
    { key: "total", header: "Assigned", align: "right", width: 100, render: (x) => <span className="font-semibold tabular-nums text-slate-800">{nf(x.total)}</span> },
    { key: "done", header: "Completed", align: "right", width: 110, render: (x) => <span className="tabular-nums text-emerald-600">{nf(x.done)}</span> },
    { key: "pending", header: "Pending", align: "right", width: 100, render: (x) => <span className={`tabular-nums ${x.pending > 0 ? "text-rose-500" : "text-slate-300"}`}>{nf(x.pending)}</span> },
    { key: "overdue", header: "Overdue", align: "center", width: 100, render: (x) => <span className={`inline-flex min-w-7 justify-center rounded-md px-2 py-0.5 text-xs font-semibold ${x.overdue > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-50 text-emerald-600"}`}>{x.overdue}</span> },
    ...topStatuses.map((t) => ({ key: `st_${t.id}`, header: t.name, align: "center" as const, width: 110, render: (x: Row) => numPill(x.buckets?.[String(t.id)] ?? 0) })),
    { key: "pct", header: "Completed %", align: "center", width: 120, render: (x) => <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${pctChip(x.pct)}`}>{x.pct}%</span> },
    { key: "health", header: "Status", width: 110, render: (x) => <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ${x.health.chip}`}>{x.health.label}</span> },
  ], [topStatuses]);

  const chip = (key: typeof filter, label: string, n: number, tone: string) => (
    <button
      onClick={() => setFilter(key)}
      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${filter === key ? tone : "bg-slate-50 text-slate-500 hover:bg-slate-100"}`}
    >
      {label} {n}
    </button>
  );

  return (
    <DataTable
      tableKey="followups"
      canRenameColumns={isAdmin}
      paginate
      defaultPageSize={defaultPageSize}
      columns={columns}
      rows={shown}
      getKey={(x) => x.id}
      nowrap
      pageAlign="right"
      searchKeys={(x) => [x.name]}
      searchPlaceholder="Search counsellors…"
      emptyTitle="No counsellors in this group"
      emptyHint="Try a different health filter."
      toolbar={
        <div className="flex flex-wrap items-center gap-1.5">
          {chip("all", "All", counts.all, "bg-slate-700 text-white")}
          {chip("on", "On track", counts.on, "bg-emerald-100 text-emerald-700")}
          {chip("risk", "At risk", counts.risk, "bg-amber-100 text-amber-700")}
          {chip("crit", "Critical", counts.crit, "bg-rose-100 text-rose-700")}
        </div>
      }
    />
  );
}

/** A labelled section: eyebrow + title (+ optional description / right slot). */
function Section({ eyebrow, title, desc, right, children }: { eyebrow: string; title: string; desc?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-600">{eyebrow}</div>
          <h2 className="text-[15px] font-bold tracking-tight text-slate-800">{title}</h2>
          {desc && <p className="mt-0.5 text-xs text-slate-400">{desc}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

const cardTitle = "text-sm font-semibold text-slate-700";

export default function ClientFollowups() {
  const toast = useToast();
  const [dash, setDash] = useState<FollowupDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  // Draft filters (what the user is editing) only take effect on "Apply" →
  // `applied`. The dashboard always fetches from `applied`.
  const [range, setRange] = useState<DateRange>(EMPTY_RANGE);
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [fSource, setFSource] = useState<string[]>([]);
  const [fDept, setFDept] = useState<string[]>([]);
  const [fOffice, setFOffice] = useState<string[]>([]);
  const [fAssign, setFAssign] = useState<string[]>([]);
  const BLANK = { range: EMPTY_RANGE as DateRange, status: [] as string[], source: [] as string[], dept: [] as string[], office: [] as string[], assign: [] as string[] };
  const [applied, setApplied] = useState(BLANK);
  const [filterOpen, setFilterOpen] = useState(false);

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

  const load = useCallback(() => {
    const { from, to } = resolveDateRange(applied.range);
    const params: Record<string, string | undefined> = {
      from: from || undefined,
      to: to || undefined,
      assign: applied.assign.join(",") || undefined,
      lead_status: applied.status.join(",") || undefined,
      lead_source: applied.source.join(",") || undefined,
      department: applied.dept.join(",") || undefined,
      office: applied.office.join(",") || undefined,
    };
    return getFollowupDashboard(params)
      .then((d) => setDash(d))
      .catch(() => toast.error("Could not load follow-up dashboard."))
      .finally(() => setLoading(false));
  }, [applied, toast]);
  useEffect(() => { load(); }, [load]);

  const statusOpts: SelectOption[] = useMemo(() => statuses.filter((s) => !isSubStatus(s)).map((s) => ({ value: String(s.id), label: s.name, prefix: <span className="h-2 w-2 rounded-full" style={{ background: toHex(s.color) }} /> })), [statuses]);
  const sourceOpts: SelectOption[] = useMemo(() => sources.map((s) => ({ value: String(s.id), label: s.name, prefix: <span className="h-2 w-2 rounded-full" style={{ background: toHex(s.color) }} /> })), [sources]);
  const deptOpts: SelectOption[] = useMemo(() => depts.map((d) => ({ value: String(d.id), label: d.name })), [depts]);
  const officeOpts: SelectOption[] = useMemo(() => offices.map((o) => ({ value: String(o.id), label: o.name })), [offices]);
  const assignOpts: SelectOption[] = useMemo(() => staff.map((s) => ({ value: String(s.id), label: s.name })), [staff]);

  // Any draft filter set (to show Reset); whether applied filters are active
  // (the "Active" pill); and whether the draft differs from what's applied.
  const draftSet = !!(rangeActive(range) || fStatus.length || fSource.length || fDept.length || fOffice.length || fAssign.length);
  const appliedActive = !!(rangeActive(applied.range) || applied.status.length || applied.source.length || applied.dept.length || applied.office.length || applied.assign.length);
  const dirty = useMemo(() => JSON.stringify({ range, status: fStatus, source: fSource, dept: fDept, office: fOffice, assign: fAssign }) !== JSON.stringify(applied), [range, fStatus, fSource, fDept, fOffice, fAssign, applied]);
  // How many applied filter groups are active — drives the badge on the Filters button.
  const appliedCount = [rangeActive(applied.range), applied.status.length, applied.source.length, applied.dept.length, applied.office.length, applied.assign.length].filter(Boolean).length;

  // Sync the draft inputs to what's applied, then open the drawer (so reopening
  // never shows stale, unapplied edits).
  function openFilters() {
    setRange(applied.range); setFStatus(applied.status); setFSource(applied.source);
    setFDept(applied.dept); setFOffice(applied.office); setFAssign(applied.assign);
    setFilterOpen(true);
  }
  function applyFilters() {
    setLoading(true);
    setApplied({ range, status: fStatus, source: fSource, dept: fDept, office: fOffice, assign: fAssign });
    setFilterOpen(false);
  }
  function resetFilters() {
    setRange(EMPTY_RANGE); setFStatus([]); setFSource([]); setFDept([]); setFOffice([]); setFAssign([]);
    if (appliedActive) { setLoading(true); setApplied(BLANK); }
  }
  const k = dash?.kpis;
  const flagDonut = useMemo(() => (dash?.by_flag ?? []).filter((f) => f.value > 0).map((f) => ({ label: f.label, value: f.value, color: f.color })), [dash]);

  // Volume per status — merge the live counts with the full top-level status
  // list so every status shows (incl. zero-volume ones), matching the legend.
  const statusVolume = useMemo(() => {
    const byLabel = new Map((dash?.by_status ?? []).map((s) => [s.label, s]));
    return statuses.filter((s) => !isSubStatus(s)).map((s) => {
      const m = byLabel.get(s.name);
      return { label: s.name, color: s.color, count: m?.count ?? 0, completed: m?.completed ?? 0, pending: m?.pending ?? 0, due_today: m?.due_today ?? 0, overdue: m?.overdue ?? 0 };
    });
  }, [statuses, dash]);

  // Derived data for the missed-by-counsellor + per-status split panels.
  const missedTop5 = useMemo(() => (dash?.reps ?? []).filter((r) => r.overdue > 0).sort((a, b) => b.overdue - a.overdue).slice(0, 5).map((r) => ({ name: r.name, value: r.overdue })), [dash]);
  const leastCreated5 = useMemo(() => (dash?.reps ?? []).filter((r) => r.total > 0).sort((a, b) => a.total - b.total).slice(0, 5).map((r) => ({ name: r.name, value: r.total })), [dash]);
  const completionCards = useMemo(() => statusVolume.map((s) => ({ label: s.label, color: s.color, sub: `${nf(s.completed)}/${nf(s.count)} done`, muted: s.count === 0 })), [statusVolume]);
  const overdueCards = useMemo(() => statusVolume.map((s) => { const open = s.due_today + s.overdue; return { label: s.label, color: s.color, sub: `${nf(s.overdue)}/${nf(open)} overdue`, muted: open === 0 }; }), [statusVolume]);

  return (
    <>
      <PageHeader title="Follow Up Tracker" subtitle="Stay on top of every lead follow-up — upcoming, due today, overdue and completed." />

      <div className={`space-y-6 ${filterRailPad(filterOpen)}`}>
        {/* Filters — a Filters toggle opens the right-side rail; nothing applies
            until “Apply”, mirroring the Announcements section. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterToggle open={filterOpen} count={appliedCount} onClick={() => { if (!filterOpen) openFilters(); else setFilterOpen(false); }} />
          {(draftSet || appliedActive) && (
            <button onClick={resetFilters} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Clear filters</button>
          )}
        </div>

        <FilterRail
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          dirty={dirty}
          onReset={() => { setRange(EMPTY_RANGE); setFStatus([]); setFSource([]); setFDept([]); setFOffice([]); setFAssign([]); }}
          resetDisabled={!draftSet}
          onApply={applyFilters}
          applyDisabled={loading}
          applying={loading}
        >
          <div className="space-y-1.5">
            <FilterLabel>Follow-up date</FilterLabel>
            <DateRangeFilter ariaLabel="Follow-up date range" value={range} onChange={setRange} future />
          </div>
          <div className="space-y-1.5"><FilterLabel>Lead source</FilterLabel><MultiSelect ariaLabel="Lead source" value={fSource} onChange={setFSource} options={sourceOpts} placeholder="All sources" searchPlaceholder="Search…" /></div>
          <div className="space-y-1.5"><FilterLabel>Lead status</FilterLabel><MultiSelect ariaLabel="Lead status" value={fStatus} onChange={setFStatus} options={statusOpts} placeholder="All statuses" searchPlaceholder="Search…" /></div>
          <div className="space-y-1.5"><FilterLabel>Department</FilterLabel><MultiSelect ariaLabel="Department" value={fDept} onChange={setFDept} options={deptOpts} placeholder="All" searchPlaceholder="Search…" /></div>
          <div className="space-y-1.5"><FilterLabel>Office</FilterLabel><MultiSelect ariaLabel="Office" value={fOffice} onChange={setFOffice} options={officeOpts} placeholder="All" searchPlaceholder="Search…" /></div>
          <div className="space-y-1.5"><FilterLabel>Assign</FilterLabel><MultiSelect ariaLabel="Assign" value={fAssign} onChange={setFAssign} options={assignOpts} placeholder="Everyone" searchPlaceholder="Search team…" /></div>
        </FilterRail>

        {loading && !dash ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => <SkeletonBlock key={i} className="h-24" />)}
            </div>
            <SkeletonStats count={4} />
            <SkeletonBlock className="h-72" />
          </div>
        ) : !k ? (
          <Card><EmptyState title="No follow-ups" hint="No leads have a follow-up date for these filters." /></Card>
        ) : (
          <>
            {/* Headline KPIs */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi label="Total follow-ups" value={nf(k.total)} tone="from-indigo-500 to-violet-600" />
              <Kpi label="Upcoming" value={nf(k.upcoming)} tone="from-amber-500 to-orange-600" />
              <Kpi label="Due today" value={nf(k.due_today)} tone="from-sky-500 to-blue-600" />
              <Kpi label="Overdue" value={nf(k.overdue)} tone="from-rose-500 to-red-600" />
              <Kpi label="Done" value={nf(k.done)} tone="from-emerald-500 to-teal-600" />
              <Kpi label="Completion" value={`${k.completion}%`} sub="done / actioned" tone="from-violet-500 to-purple-600" />
            </div>

            {/* Action centre — overdue banner + per-group pending cards */}
            {dash?.overview && (
              <Section eyebrow="Action centre" title="What needs attention" desc="Overdue alerts and pending follow-ups grouped by status.">
                <FollowupSummary ov={dash.overview} pending={dash.pending_buckets ?? []} overdueBuckets={dash.overdue_buckets ?? []} />
              </Section>
            )}

            {/* Analytics */}
            <Section eyebrow="Analytics" title="Pipeline & workload" desc="How follow-ups split by status, and what's coming up.">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card>
                  <h3 className={`mb-3 ${cardTitle}`}>Status mix</h3>
                  {flagDonut.length ? <DonutChart data={flagDonut} size={170} /> : <p className="py-10 text-center text-sm text-slate-400">No data</p>}
                </Card>
                <Card className="lg:col-span-2">
                  <h3 className={`mb-3 ${cardTitle}`}>Upcoming workload <span className="font-normal text-slate-400">· next 7 days</span></h3>
                  <VBars bars={(dash?.upcoming_days ?? []).map((d) => ({ label: dayLabel(d.date), value: d.count }))} />
                </Card>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <h3 className={`mb-3 ${cardTitle}`}>Volume by lead status</h3>
                  <StatusVolumeChart data={statusVolume} />
                </Card>
                <Card>
                  <h3 className={`mb-4 ${cardTitle}`}>Overdue aging</h3>
                  <OverdueAging rows={dash?.overdue_aging ?? []} />
                </Card>
              </div>
            </Section>

            {/* Split by lead status */}
            <Section eyebrow="By lead status" title="Completion & overdue split" desc="Done vs total, and overdue vs open, for each status.">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card>
                  <h3 className={`mb-3 ${cardTitle}`}>Completion split</h3>
                  <StatusSplitCards items={completionCards} />
                </Card>
                <Card>
                  <h3 className={`mb-3 ${cardTitle}`}>Pending / overdue split</h3>
                  <StatusSplitCards items={overdueCards} />
                </Card>
              </div>
            </Section>

            {/* Team performance */}
            <Section eyebrow="Team" title="Counsellor performance" desc="Who's missing follow-ups, who's carrying the load, and full accountability.">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><span className="h-2 w-2 rounded-full bg-rose-500" />Top 5 — most missed</h3>
                  <RankBar rows={missedTop5} color="#e11d48" tag="High" tagTone="bg-rose-100 text-rose-600" />
                </Card>
                <Card>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><span className="h-2 w-2 rounded-full bg-emerald-500" />Least 5 — created follow-ups</h3>
                  <RankBar rows={leastCreated5} color="#10b981" tag="Low" tagTone="bg-emerald-100 text-emerald-700" />
                </Card>
              </div>
              <AccountabilityTable reps={dash?.reps ?? []} topStatuses={dash?.top_statuses ?? []} />
            </Section>

            {/* Ghosted leads */}
            <Section eyebrow="Attention" title="Ghosted leads" desc="Open follow-ups with 3+ call attempts and no connection — worth escalating.">
              <GhostedLeads rows={dash?.ghosted_leads ?? []} />
            </Section>
          </>
        )}
      </div>
    </>
  );
}
