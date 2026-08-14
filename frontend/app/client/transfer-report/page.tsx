"use client";

import { useEffect, useState } from "react";
import {
  getTransferReport, getTransferReportLogs,
  type TransferReport, type TransferLogRow, type TransferStat, type TransferReportFilters,
} from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";
import { fmtDateTime } from "../../admin/ui";

type Filt = { department_id: number; counselor_id: number; source_id: number; status_id: number; update_count: string; date_from: string; date_to: string };
const emptyFilt = (): Filt => ({ department_id: 0, counselor_id: 0, source_id: 0, status_id: 0, update_count: "", date_from: "", date_to: "" });

const selCls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";
const medal = (i: number) => (i < 3 ? ["🥇", "🥈", "🥉"][i] : `#${i + 1}`);

// ------------------------------------------------------------- subcomponents

function StatCard({ icon, label, value, sub }: { icon: string; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-slate-50 text-2xl">{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        <p className="truncate text-2xl font-bold text-slate-900">{value}</p>
        {sub && <p className="truncate text-xs text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

function BarChart({ data }: { data: TransferStat[] }) {
  if (!data.length) return <p className="py-16 text-center text-sm text-slate-400">No data for this view.</p>;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex h-72 items-stretch gap-2 overflow-x-auto pb-1">
      {data.map((d) => (
        <div key={d.id} className="flex h-full min-w-[34px] flex-col items-center justify-end">
          <span className="mb-1 text-xs font-bold text-slate-700">{d.count}</span>
          <div className="w-7 rounded-t bg-blue-400 transition-all" style={{ height: `${(d.count / max) * 90}%` }} title={`${d.name}: ${d.count}`} />
          <span className="mt-1 w-12 truncate text-center text-[10px] text-slate-500" title={d.name}>{d.name.split(" ")[0]}</span>
        </div>
      ))}
    </div>
  );
}

function RankPanel({ title, data, suffix }: { title: string; data: TransferStat[]; suffix?: string }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-bold text-slate-800">{title}</p>
      <div className="space-y-2.5">
        {data.length === 0 && <p className="text-sm text-slate-400">No data.</p>}
        {data.map((d, i) => (
          <div key={d.id}>
            <div className="flex justify-between gap-2 text-sm">
              <span className="truncate text-slate-700">{medal(i)} {d.name}</span>
              <span className="flex-shrink-0 text-slate-500">{d.count}{suffix ?? ""}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500" style={{ width: `${(d.count / max) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

const COLS: [string, keyof TransferLogRow][] = [
  ["ID", "id"], ["Name", "name"], ["Phone Number", "phone"], ["Source", "source"], ["Update Count", "update_count"],
  ["Sub Status", "sub_status"], ["Old Status", "old_status"], ["New Status", "new_status"], ["Current Status", "current_status"],
  ["Old Assigned", "old_assigned"], ["New Assigned", "new_assigned"], ["Transfer Date", "date"],
];

// --------------------------------------------------------------------- page

export default function TransferReportPage() {
  const toast = useToast();
  const [report, setReport] = useState<TransferReport | null>(null);
  const [logs, setLogs] = useState<TransferLogRow[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState("");
  const [chartMode, setChartMode] = useState<"transfer" | "assignation">("transfer");
  const [filters, setFilters] = useState<Filt>(emptyFilt());
  const [applied, setApplied] = useState<Filt>(emptyFilt());
  const [searchBox, setSearchBox] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [exporting, setExporting] = useState(false);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchBox); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchBox]);

  const query = (): TransferReportFilters => ({
    tab: tab || undefined,
    department_id: applied.department_id || undefined,
    counselor_id: applied.counselor_id || undefined,
    source_id: applied.source_id || undefined,
    status_id: applied.status_id || undefined,
    update_count: applied.update_count || undefined,
    date_from: applied.date_from || undefined,
    date_to: applied.date_to || undefined,
    search: search || undefined,
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const q = query();
    Promise.all([getTransferReport(q), getTransferReportLogs({ ...q, page, per_page: perPage })])
      .then(([rep, lg]) => {
        setReport(rep);
        setLogs(lg.rows);
        setLogsTotal(lg.total);
        setLoading(false);
        if (!tab && rep.tabs.length) setTab(rep.tabs[0].key);
      })
      .catch(() => { toast.error("Could not load the transfer report."); setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, applied, search, page, perPage]);

  function applyFilters() { setApplied(filters); setPage(1); }
  function resetFilters() { setFilters(emptyFilt()); setApplied(emptyFilt()); setSearchBox(""); setPage(1); }

  async function exportCsv() {
    setExporting(true);
    try {
      const q = query();
      const all: TransferLogRow[] = [];
      for (let p = 1; p <= 50 && all.length < logsTotal; p++) {
        const d = await getTransferReportLogs({ ...q, page: p, per_page: 200 });
        all.push(...d.rows);
        if (d.rows.length < 200) break;
      }
      const cell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const csv = [COLS.map((c) => c[0]).join(","), ...all.map((r) => COLS.map((c) => cell(r[c[1]])).join(","))].join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = "auto-transfer-report.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error("Export failed."); }
    setExporting(false);
  }

  const lastPage = Math.max(1, Math.ceil(logsTotal / perPage));
  const chartData = report ? report.chart[chartMode] : [];

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {(report?.tabs ?? []).map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); setPage(1); }}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${tab === t.key ? "bg-indigo-600 text-white shadow" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
            {t.label} <span className={`ml-1 rounded-full px-1.5 text-xs ${tab === t.key ? "bg-white/20" : "bg-slate-100 text-slate-500"}`}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon="⇄" label="Total Transfers" value={String(report?.summary.total ?? 0)} sub="in this view" />
        <StatCard icon="👥" label="Active Counselors" value={String(report?.summary.active_counselors ?? 0)} sub="with transfers" />
        <StatCard icon="🏆" label="Top Counselor" value={report?.summary.top_counselor?.name ?? "—"} sub={report?.summary.top_counselor ? `${report.summary.top_counselor.count} leads` : undefined} />
      </div>

      {/* Chart + rankings */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-bold text-slate-800">Counselor Performance</span>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {(["transfer", "assignation"] as const).map((m) => (
              <button key={m} onClick={() => setChartMode(m)} className={`rounded-md px-3 py-1 text-xs font-semibold transition ${chartMode === m ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                {m === "transfer" ? "Lead Transfer" : "Lead Assignation"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
          <BarChart data={chartData} />
          <div className="space-y-4">
            <RankPanel title="Sources Ranking" data={report?.ranking.sources ?? []} />
            <RankPanel title="Counselor Ranking" data={report?.ranking.counselors ?? []} suffix=" leads" />
          </div>
        </div>
      </div>

      {/* Advanced Filters */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-bold text-slate-800">Advanced Filters</p>
          <button onClick={resetFilters} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50">Reset All</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-500">Department</span>
            <select value={filters.department_id} onChange={(e) => setFilters({ ...filters, department_id: Number(e.target.value) })} className={selCls}>
              <option value={0}>All departments</option>
              {(report?.filters.departments ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></label>
          <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-500">Counselor</span>
            <select value={filters.counselor_id} onChange={(e) => setFilters({ ...filters, counselor_id: Number(e.target.value) })} className={selCls}>
              <option value={0}>All counselors</option>
              {(report?.filters.counselors ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></label>
          <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-500">Lead Source</span>
            <select value={filters.source_id} onChange={(e) => setFilters({ ...filters, source_id: Number(e.target.value) })} className={selCls}>
              <option value={0}>All sources</option>
              {(report?.filters.sources ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></label>
          <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-500">Current Status</span>
            <select value={filters.status_id} onChange={(e) => setFilters({ ...filters, status_id: Number(e.target.value) })} className={selCls}>
              <option value={0}>All status</option>
              {(report?.filters.statuses ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></label>
          <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-500">Update Count</span>
            <select value={filters.update_count} onChange={(e) => setFilters({ ...filters, update_count: e.target.value })} className={selCls}>
              <option value="">Any count</option>
              {["0", "1", "2", "3", "4"].map((n) => <option key={n} value={n}>{n}</option>)}
              <option value="5plus">5+</option>
            </select></label>
          <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-500">From date</span>
            <input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} className={selCls} /></label>
          <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-500">To date</span>
            <input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} className={selCls} /></label>
          <div className="flex items-end">
            <button onClick={applyFilters} className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Apply Filters</button>
          </div>
        </div>
      </div>

      {/* Log table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div><p className="text-sm font-bold text-slate-800">Leads Transfer Logs</p><p className="text-xs text-slate-400">{loading ? "Loading…" : `Showing ${logs.length} of ${logsTotal} records`}</p></div>
          <div className="ml-auto flex items-center gap-2">
            <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }} className={selCls + " w-auto"}>
              {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button onClick={exportCsv} disabled={exporting} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">{exporting ? "Exporting…" : "Export"}</button>
            <input value={searchBox} onChange={(e) => setSearchBox(e.target.value)} placeholder="Search name / phone…" className={selCls + " w-56"} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-left text-xs font-semibold uppercase tracking-wider text-white">
                {COLS.map((c) => <th key={c[0]} className="whitespace-nowrap px-4 py-3">{c[0]}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-500">{r.id}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-800">{r.name || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{r.phone}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{r.source}</td>
                  <td className="px-4 py-2.5 text-center text-slate-600">{r.update_count}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{r.sub_status}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{r.old_status}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{r.new_status}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{r.current_status}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{r.old_assigned}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-700">{r.new_assigned}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{r.date ? fmtDateTime(r.date) : "—"}</td>
                </tr>
              ))}
              {!loading && logs.length === 0 && (
                <tr><td colSpan={COLS.length} className="px-4 py-10 text-center text-sm text-slate-400">No transfers match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 p-4 text-sm">
          <span className="text-slate-400">Page {page} of {lastPage}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Previous</button>
            <button onClick={() => setPage((p) => Math.min(lastPage, p + 1))} disabled={page >= lastPage} className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
