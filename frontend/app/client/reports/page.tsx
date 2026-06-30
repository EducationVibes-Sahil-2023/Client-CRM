"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getLeadsSetup, getStaff,
  getReportLeadsBy, getReportPipeline, getReportRepPerformance,
  type LeadStatus, type LeadSource, type LeadType, type Staff,
} from "../../lib/client";
import { exportCsv } from "../../lib/export";
import { useToast } from "../../components/toast/ToastProvider";
import { Card, PageHeader, EmptyState, SkeletonStats, SkeletonBlock } from "../../admin/ui";
import { DataTable, type Column } from "../../admin/DataTable";
import { MultiSelect, type SelectOption } from "../../admin/SearchSelect";
import { FilterRail, FilterToggle, FilterLabel, filterRailPad } from "../FilterRail";

// ---- colour helpers ----
const HEX: Record<string, string> = {
  indigo: "#6366f1", violet: "#8b5cf6", emerald: "#10b981", amber: "#f59e0b",
  rose: "#f43f5e", sky: "#0ea5e9", teal: "#14b8a6", pink: "#ec4899",
  orange: "#f97316", lime: "#84cc16", cyan: "#06b6d4", slate: "#94a3b8",
};
const toHex = (c?: string) => (!c ? HEX.slate : c.startsWith("#") ? c : HEX[c] ?? HEX.slate);
const nf = (n: number) => n.toLocaleString("en-IN");
const isSubStatus = (s: LeadStatus) => (s.parent_ids?.length ?? 0) > 0 || !!s.parent_id;

type Row = Record<string, string | number>;
interface ReportView { columns: Column<Row>[]; rows: Row[]; kpis: { label: string; value: string }[]; csv: { headers: string[]; rows: (string | number)[][] }; filename: string }

// Each report in the Sales & Leads pack. `cat` groups them on the landing grid.
type ReportKey = "leads_source" | "leads_status" | "leads_type" | "leads_rep" | "leads_month" | "pipeline" | "rep_performance";
const REPORTS: { key: ReportKey; label: string; desc: string }[] = [
  { key: "leads_source", label: "Leads by Source", desc: "Volume & share per lead source / marketing channel." },
  { key: "leads_status", label: "Leads by Status", desc: "How leads are distributed across pipeline statuses." },
  { key: "leads_type", label: "Leads by Type", desc: "Volume per lead type (e.g. Buyer, Seller)." },
  { key: "leads_rep", label: "Leads by Rep", desc: "Leads assigned per team member." },
  { key: "leads_month", label: "Lead Volume Trend", desc: "New leads created per month." },
  { key: "pipeline", label: "Sales Pipeline", desc: "Leads per conversion stage, win % and weighted value." },
  { key: "rep_performance", label: "Rep Performance", desc: "Total leads, won and conversion rate per team member." },
];
// Coming in later passes — shown as disabled cards so the roadmap is visible.
const COMING_SOON = ["Assets", "Calls & Follow-ups", "Team & Tasks"];

const dot = (c?: string) => <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: toHex(c) }} />;

/** A right-aligned percentage cell with a thin proportional bar. */
function pctCell(p: number) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
        <span className="absolute inset-y-0 left-0 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, p)}%` }} />
      </span>
      <span className="tabular-nums text-slate-600">{p}%</span>
    </span>
  );
}

const BLANK = { from: "", to: "", status: [] as string[], source: [] as string[], type: [] as string[], assign: [] as string[] };
type Filters = typeof BLANK;

export default function ReportsPage() {
  const toast = useToast();
  const [report, setReport] = useState<ReportKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<ReportView | null>(null);

  // Draft (in the rail) vs applied (what's fetched).
  const [draft, setDraft] = useState<Filters>(BLANK);
  const [applied, setApplied] = useState<Filters>(BLANK);
  const [railOpen, setRailOpen] = useState(false);

  // Filter option sources.
  const [statuses, setStatuses] = useState<LeadStatus[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [types, setTypes] = useState<LeadType[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  useEffect(() => {
    getLeadsSetup().then((d) => { setStatuses(d.lead_statuses ?? []); setSources(d.lead_sources ?? []); setTypes(d.lead_types ?? []); }).catch(() => {});
    getStaff().then((d) => setStaff(d.staff ?? [])).catch(() => {});
  }, []);

  const statusOpts: SelectOption[] = useMemo(() => statuses.filter((s) => !isSubStatus(s)).map((s) => ({ value: String(s.id), label: s.name, prefix: dot(s.color) })), [statuses]);
  const sourceOpts: SelectOption[] = useMemo(() => sources.map((s) => ({ value: String(s.id), label: s.name, prefix: dot(s.color) })), [sources]);
  const typeOpts: SelectOption[] = useMemo(() => types.map((t) => ({ value: String(t.id), label: t.name, prefix: dot(t.color) })), [types]);
  const assignOpts: SelectOption[] = useMemo(() => staff.map((s) => ({ value: String(s.id), label: s.name })), [staff]);

  const params = useMemo(() => ({
    from: applied.from || undefined,
    to: applied.to || undefined,
    lead_status: applied.status.join(",") || undefined,
    lead_source: applied.source.join(",") || undefined,
    lead_type: applied.type.join(",") || undefined,
    assign: applied.assign.join(",") || undefined,
  }), [applied]);

  // Build the table for the active report from the API response.
  const load = useCallback(async (key: ReportKey) => {
    setLoading(true);
    try {
      const def = REPORTS.find((r) => r.key === key)!;
      if (key === "pipeline") {
        const d = await getReportPipeline(params);
        setView({
          filename: "sales-pipeline",
          kpis: [{ label: "Leads in pipeline", value: nf(d.total) }, { label: "Weighted value", value: nf(Math.round(d.weighted_total)) }],
          columns: [
            { key: "label", header: "Stage", width: 180, render: (r) => <span className="inline-flex items-center gap-2 font-medium text-slate-800">{dot(String(r.color))}{r.label}</span> },
            { key: "statuses", header: "Statuses", width: 220, render: (r) => <span className="text-slate-500">{r.statuses || "—"}</span> },
            { key: "count", header: "Leads", width: 90, align: "right", render: (r) => <span className="tabular-nums font-semibold text-slate-700">{nf(Number(r.count))}</span> },
            { key: "pct", header: "Share", width: 160, render: (r) => pctCell(Number(r.pct)) },
            { key: "win_pct", header: "Win %", width: 90, align: "right", render: (r) => <span className="tabular-nums text-slate-600">{r.win_pct}%</span> },
            { key: "weighted", header: "Weighted", width: 110, align: "right", render: (r) => <span className="tabular-nums font-semibold text-emerald-700">{nf(Number(r.weighted))}</span> },
          ],
          rows: d.rows as unknown as Row[],
          csv: { headers: ["Stage", "Statuses", "Leads", "Share %", "Win %", "Weighted"], rows: d.rows.map((r) => [r.label, r.statuses, r.count, r.pct, r.win_pct, r.weighted]) },
        });
      } else if (key === "rep_performance") {
        const d = await getReportRepPerformance(params);
        const totalLeads = d.rows.reduce((n, r) => n + r.total, 0);
        const totalWon = d.rows.reduce((n, r) => n + r.won, 0);
        setView({
          filename: "rep-performance",
          kpis: [
            { label: "Team members", value: nf(d.rows.filter((r) => r.id !== 0).length) },
            { label: "Total leads", value: nf(totalLeads) },
            { label: "Overall conversion", value: `${totalLeads > 0 ? Math.round(totalWon / totalLeads * 100) : 0}%` },
          ],
          columns: [
            { key: "name", header: "Team member", width: 200, render: (r) => <span className="font-medium text-slate-800">{r.name}</span> },
            { key: "total", header: "Total leads", width: 120, align: "right", render: (r) => <span className="tabular-nums font-semibold text-slate-700">{nf(Number(r.total))}</span> },
            { key: "won", header: "Won", width: 100, align: "right", render: (r) => <span className="tabular-nums text-slate-600">{nf(Number(r.won))}</span> },
            { key: "won_pct", header: "Conversion", width: 170, render: (r) => pctCell(Number(r.won_pct)) },
          ],
          rows: d.rows as unknown as Row[],
          csv: { headers: ["Team member", "Total leads", "Won", "Conversion %"], rows: d.rows.map((r) => [r.name, r.total, r.won, r.won_pct]) },
        });
      } else {
        const group = { leads_source: "source", leads_status: "status", leads_type: "type", leads_rep: "assigned", leads_month: "month" }[key];
        const d = await getReportLeadsBy(group, params);
        const firstHeader = key === "leads_rep" ? "Team member" : key === "leads_month" ? "Month" : def.label.replace("Leads by ", "");
        setView({
          filename: def.label.toLowerCase().replace(/\s+/g, "-"),
          kpis: [{ label: "Total leads", value: nf(d.total) }, { label: key === "leads_month" ? "Months" : "Groups", value: nf(d.rows.length) }],
          columns: [
            { key: "label", header: firstHeader, width: 220, render: (r) => <span className="inline-flex items-center gap-2 font-medium text-slate-800">{key === "leads_month" || key === "leads_rep" ? null : dot(String(r.color))}{r.label}</span> },
            { key: "count", header: "Leads", width: 110, align: "right", render: (r) => <span className="tabular-nums font-semibold text-slate-700">{nf(Number(r.count))}</span> },
            { key: "pct", header: "Share", width: 200, render: (r) => pctCell(Number(r.pct)) },
          ],
          rows: d.rows as unknown as Row[],
          csv: { headers: [firstHeader, "Leads", "Share %"], rows: d.rows.map((r) => [r.label, r.count, r.pct]) },
        });
      }
    } catch {
      toast.error("Could not load this report.");
      setView(null);
    } finally {
      setLoading(false);
    }
  }, [params, toast]);

  // (Re)load whenever the selected report or applied filters change.
  useEffect(() => { if (report) load(report); }, [report, load]);

  const draftSet = !!(draft.from || draft.to || draft.status.length || draft.source.length || draft.type.length || draft.assign.length);
  const appliedCount = [applied.from || applied.to, applied.status.length, applied.source.length, applied.type.length, applied.assign.length].filter(Boolean).length;
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(applied), [draft, applied]);
  const setF = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((d) => ({ ...d, [k]: v }));

  function openReport(key: ReportKey) { setReport(key); }
  function back() { setReport(null); setView(null); setRailOpen(false); }

  // ---- Landing grid (no report selected) ----
  if (!report) {
    return (
      <>
        <PageHeader title="Reports" subtitle="Build, view and export reports across your CRM data." />
        <section className="mb-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Sales &amp; Leads</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {REPORTS.map((r) => (
              <button key={r.key} onClick={() => openReport(r.key)} className="group flex flex-col items-start rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 19V5m0 14h16M8 17v-5m4 5V8m4 9v-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <span className="mt-3 text-sm font-semibold text-slate-800">{r.label}</span>
                <span className="mt-1 text-xs text-slate-400">{r.desc}</span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3 className="mb-3 text-sm font-semibold text-slate-700">More report packs</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {COMING_SOON.map((c) => (
              <div key={c} className="flex items-center justify-between rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
                <span className="text-sm font-medium text-slate-500">{c}</span>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Coming soon</span>
              </div>
            ))}
          </div>
        </section>
      </>
    );
  }

  // ---- Report view ----
  const def = REPORTS.find((r) => r.key === report)!;
  return (
    <div className={filterRailPad(railOpen)}>
      <PageHeader
        title={def.label}
        subtitle={def.desc}
        action={
          <div className="flex items-center gap-2">
            <button onClick={back} className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              All reports
            </button>
            <FilterToggle open={railOpen} count={appliedCount} onClick={() => { setDraft(applied); setRailOpen(true); }} />
            <button
              onClick={() => view && exportCsv(view.filename, view.csv.headers, view.csv.rows)}
              disabled={!view || view.rows.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Export
            </button>
          </div>
        }
      />

      {loading && !view ? (
        <div className="space-y-4"><SkeletonStats count={3} /><SkeletonBlock className="h-80" /></div>
      ) : (
        <>
          {view && view.kpis.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {view.kpis.map((k) => (
                <Card key={k.label} className="!p-4">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{k.label}</div>
                  <div className="mt-1 text-2xl font-bold text-slate-800">{k.value}</div>
                </Card>
              ))}
            </div>
          )}

          {view && view.rows.length === 0 ? (
            <EmptyState title="No data" hint="No records match the current filters. Try widening the date range or clearing filters." />
          ) : (
            <DataTable
              tableKey={`report_${report}`}
              columns={view?.columns ?? []}
              rows={view?.rows ?? []}
              getKey={(r) => String(r.id ?? r.label)}
              loading={loading}
              nowrap
              paginate
              defaultPageSize={25}
            />
          )}
        </>
      )}

      <FilterRail
        open={railOpen}
        onClose={() => setRailOpen(false)}
        dirty={dirty}
        onReset={() => setDraft(BLANK)}
        resetDisabled={!draftSet}
        onApply={() => { setApplied(draft); setRailOpen(false); }}
        applyDisabled={!dirty}
      >
        <div>
          <FilterLabel>Created date</FilterLabel>
          <div className="mt-1 flex items-end gap-2">
            <input type="date" value={draft.from} max={draft.to || undefined} onChange={(e) => setF("from", e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15" />
            <span className="pb-2 text-slate-300">→</span>
            <input type="date" value={draft.to} min={draft.from || undefined} onChange={(e) => setF("to", e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15" />
          </div>
        </div>
        <label className="flex flex-col gap-1"><FilterLabel>Lead status</FilterLabel><MultiSelect ariaLabel="Lead status" value={draft.status} onChange={(v) => setF("status", v)} options={statusOpts} placeholder="All statuses" searchPlaceholder="Search…" /></label>
        <label className="flex flex-col gap-1"><FilterLabel>Lead source</FilterLabel><MultiSelect ariaLabel="Lead source" value={draft.source} onChange={(v) => setF("source", v)} options={sourceOpts} placeholder="All sources" searchPlaceholder="Search…" /></label>
        <label className="flex flex-col gap-1"><FilterLabel>Lead type</FilterLabel><MultiSelect ariaLabel="Lead type" value={draft.type} onChange={(v) => setF("type", v)} options={typeOpts} placeholder="All types" searchPlaceholder="Search…" /></label>
        <label className="flex flex-col gap-1"><FilterLabel>Assigned to</FilterLabel><MultiSelect ariaLabel="Assigned to" value={draft.assign} onChange={(v) => setF("assign", v)} options={assignOpts} placeholder="Everyone" searchPlaceholder="Search team…" /></label>
      </FilterRail>
    </div>
  );
}
