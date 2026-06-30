"use client";

import { Card } from "../../admin/ui";
import { BarChart } from "../../admin/Charts";

/** A KPI tile with a gradient value. */
function Kpi({ label, value, sub, tone, icon }: { label: string; value: string; sub?: string; tone: string; icon: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${tone}`} />
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${tone} text-white`}>
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
          <div className="truncate text-xl font-bold text-slate-800">{value}</div>
          {sub && <div className="truncate text-[11px] text-slate-400">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * Performance summary for the Transfers / Visitors tabs: three KPI tiles (total,
 * active people, top performer) + a per-person ranked bar chart. `rows` is a
 * count-per-person list (we filter to >0 and sort descending). Computed from the
 * already-filtered records, so it respects the active date/other filters.
 */
export function PerfSummary({
  title, totalLabel, totalSub, activeLabel, topLabel, unit = "leads", rows, color = "#6366f1",
}: {
  title: string;
  totalLabel: string;
  totalSub?: string;
  activeLabel: string;
  topLabel: string;
  unit?: string;
  rows: { name: string; value: number }[];
  color?: string;
}) {
  const sorted = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const total = rows.reduce((n, r) => n + r.value, 0);
  const top = sorted[0];

  return (
    <div className="mb-4 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label={totalLabel} value={String(total)} sub={totalSub} tone="from-sky-500 to-blue-600" icon="M4 7h16M4 12h16M4 17h10" />
        <Kpi label={activeLabel} value={String(sorted.length)} sub="With activity" tone="from-emerald-500 to-teal-600" icon="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8z" />
        <Kpi label={topLabel} value={top?.name ?? "—"} sub={top ? `${top.value} ${unit}` : ""} tone="from-amber-500 to-orange-600" icon="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM5 6H3v1a3 3 0 003 3M19 6h2v1a3 3 0 01-3 3" />
      </div>
      {sorted.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-slate-700">{title}</h3>
          <div className="overflow-x-auto pb-1">
            <div style={{ minWidth: Math.max(360, sorted.length * 46) }}>
              <BarChart data={sorted.map((r) => ({ label: r.name.split(" ")[0], value: r.value }))} color={color} height={220} />
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
