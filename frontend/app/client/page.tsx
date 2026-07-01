"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { getClientDashboard, getLeadsSetup, getLeadAnalytics, type ClientInfo, type ClientFeature, type Task, type TaskSummary, type LeadStatus, type LeadSource, type MarketingType, type ConversionType, type LeadAnalytics, type LeadCount } from "../lib/client";
import { BarChart, DonutChart } from "../admin/Charts";
import { SkeletonStats, SkeletonBlock } from "../admin/ui";
import { fmtDate } from "../lib/datetime";

// Map the config colour names (and pass-through hex values) to chart hex codes.
const HEX: Record<string, string> = {
  indigo: "#6366f1", violet: "#8b5cf6", emerald: "#10b981", amber: "#f59e0b",
  rose: "#f43f5e", sky: "#0ea5e9", teal: "#14b8a6", pink: "#ec4899",
  orange: "#f97316", lime: "#84cc16", cyan: "#06b6d4", slate: "#94a3b8",
};
const hex = (c?: string) => (!c ? HEX.slate : c.startsWith("#") ? c : HEX[c] ?? HEX.slate);

const isOn = (e: number | boolean) => e === 1 || e === true;

// ---- Dashboard presentational pieces (Modern gradient analytics) ----

/** A bold gradient KPI tile with a soft glow and decorative blobs. */
function GradientStat({ grad, shadow, value, label, sub, icon }: {
  grad: string; shadow: string; value: ReactNode; label: string; sub?: string; icon: string;
}) {
  return (
    <div className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${grad} p-5 text-white shadow-lg ${shadow} transition duration-200 hover:-translate-y-0.5 hover:shadow-xl`}>
      <div className="relative z-10">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
          <svg className="anim-ico h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <div className="mt-3 text-3xl font-bold leading-none tracking-tight">{value}</div>
        <div className="mt-1.5 truncate text-sm font-semibold text-white/90" title={label}>{label}</div>
        {sub && <div className="mt-0.5 text-xs text-white/70">{sub}</div>}
      </div>
      <div className="pointer-events-none absolute -right-7 -top-7 h-24 w-24 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-9 right-2 h-20 w-20 rounded-full bg-white/10" />
    </div>
  );
}

/** Polished horizontal bars with gradient fills, dots, value + % chips. */
function GradientBars({ data, total, badges }: {
  data: { label: string; value: number; color: string }[];
  total: number;
  badges?: Map<string, number>;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-3">
      {data.map((d, i) => {
        const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
        const badge = badges?.get(d.label);
        return (
          <div key={d.label}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 font-medium text-slate-600">
                <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: d.color }} />
                <span className="truncate" title={d.label}>{d.label}</span>
                {badge !== undefined && <span className="flex-shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">{badge}% win</span>}
              </span>
              <span className="flex-shrink-0 tabular-nums"><span className="font-semibold text-slate-800">{d.value}</span><span className="ml-1 text-slate-400">{pct}%</span></span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className="bar-grow h-full rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: `linear-gradient(90deg, ${d.color}b3, ${d.color})`, animationDelay: `${i * 70}ms` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function planValidity(end?: string | null) {
  if (!end) return { text: "No expiry", days: null as number | null, tone: "slate", expired: false };
  const endDate = new Date(`${end.slice(0, 10)}T23:59:59`);
  if (Number.isNaN(endDate.getTime())) return { text: "—", days: null, tone: "slate", expired: false };
  const days = Math.ceil((endDate.getTime() - Date.now()) / 86400000);
  if (days < 0) return { text: `Expired ${Math.abs(days)} days ago`, days, tone: "red", expired: true };
  if (days <= 7) return { text: days === 0 ? "Expires today" : `${days} days left`, days, tone: "amber", expired: false };
  return { text: `${days} days left`, days, tone: "emerald", expired: false };
}

const planBadge: Record<string, string> = {
  starter: "bg-slate-100 text-slate-600",
  growth: "bg-indigo-100 text-indigo-700",
  enterprise: "bg-violet-100 text-violet-700",
};

/** Percentage of the subscription window elapsed (0–100). */
function subscriptionPct(planStart: string, planEnd: string) {
  const start = new Date(`${planStart.slice(0, 10)}T00:00:00`).getTime();
  const end = new Date(`${planEnd.slice(0, 10)}T23:59:59`).getTime();
  const span = end - start;
  if (!Number.isFinite(span) || span <= 0) return 0; // equal/unparseable dates → avoid NaN width
  return Math.max(0, Math.min(100, ((Date.now() - start) / span) * 100));
}

const statCards = (s: Record<string, number>) => [
  { label: "Team Members", value: s.staff ?? 0, icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2", tone: "bg-emerald-100 text-emerald-600", bar: "from-emerald-400 to-teal-500", dot: "bg-emerald-300" },
  { label: "Roles", value: s.roles ?? 0, icon: "M12 11a3 3 0 100-6 3 3 0 000 6zM4 21v-2a4 4 0 014-4h8a4 4 0 014 4v2", tone: "bg-indigo-100 text-indigo-600", bar: "from-indigo-400 to-blue-500", dot: "bg-indigo-300" },
  { label: "Open Tasks", value: s.tasks_open ?? 0, icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11", tone: "bg-amber-100 text-amber-600", bar: "from-amber-400 to-orange-500", dot: "bg-amber-300" },
  { label: "Announcements", value: s.announcements ?? 0, icon: "M11 5L6 9H2v6h4l5 4V5z", tone: "bg-violet-100 text-violet-600", bar: "from-violet-400 to-purple-500", dot: "bg-violet-300" },
];

// Fixed heights for the decorative equalizer flourish on each stat card.
const SPARK = [9, 15, 11, 18, 13, 16];

export default function ClientDashboard() {
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [features, setFeatures] = useState<ClientFeature[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [taskSummary, setTaskSummary] = useState<TaskSummary | null>(null);
  const [upcoming, setUpcoming] = useState<Task[]>([]);
  const [leadStatuses, setLeadStatuses] = useState<LeadStatus[]>([]);
  const [leadSources, setLeadSources] = useState<LeadSource[]>([]);
  const [marketingTypes, setMarketingTypes] = useState<MarketingType[]>([]);
  const [conversionTypes, setConversionTypes] = useState<ConversionType[]>([]);
  const [leadAnalytics, setLeadAnalytics] = useState<LeadAnalytics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getLeadsSetup()
      .then((d) => { setLeadStatuses(d.lead_statuses); setLeadSources(d.lead_sources); setMarketingTypes(d.marketing_types); setConversionTypes(d.conversion_types); })
      .catch(() => {});
    getLeadAnalytics().then(setLeadAnalytics).catch(() => {});
  }, []);

  useEffect(() => {
    getClientDashboard()
      .then((d) => {
        setClient(d.client);
        setFeatures(d.features);
        setStats(d.stats ?? {});
        setTaskSummary(d.task_summary ?? null);
        setUpcoming(d.upcoming_tasks ?? []);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">{error}</div>;
  if (!client) return (
    <div className="space-y-6">
      <SkeletonStats count={4} />
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonBlock className="h-72" />
        <SkeletonBlock className="h-72" />
      </div>
      <SkeletonBlock className="h-64" />
    </div>
  );

  const enabled = features.filter((f) => f.enabled);
  const v = planValidity(client.plan_end);

  // Each conversion stage with the lead statuses (substatuses) it groups.
  const stageRows = conversionTypes
    .filter((c) => isOn(c.enabled))
    .map((c) => {
      const byId = new Map(leadStatuses.map((s) => [s.id, s] as const));
      return {
        id: c.id, name: c.name, color: c.color, pct: c.percentage ?? 0,
        statuses: (c.lead_status_ids ?? []).map((id) => byId.get(id)).filter(Boolean) as LeadStatus[],
      };
    });
  const stagesMapped = stageRows.filter((r) => r.statuses.length > 0);
  const assignedIds = new Set(stagesMapped.flatMap((r) => r.statuses.map((s) => s.id)));
  const unassigned = leadStatuses.filter((s) => isOn(s.enabled) && !assignedIds.has(s.id));

  const hasPipeline = leadStatuses.length > 0 || conversionTypes.length > 0 || leadSources.length > 0;

  // Resolve the backend's colour names/hex to chart hex codes.
  const toBars = (rows: LeadCount[]) => rows.map((r) => ({ label: r.label, value: r.value, color: hex(r.color) }));
  const la = leadAnalytics;
  const hasVolume = !!la && la.total > 0;
  const pctOf = (v: number) => (la && la.total > 0 ? Math.round((v / la.total) * 100) : 0);

  // Headline KPI tiles, derived purely from the sorted analytics arrays.
  const topType = la?.by_lead_type[0];
  const topChannel = la?.by_marketing[0];
  const topStatus = la?.by_status[0];
  const kpis = hasVolume && la ? [
    { grad: "from-indigo-500 to-violet-600", shadow: "shadow-indigo-500/30", value: la.total, label: "Total leads", sub: `${la.by_lead_type.length} types · ${la.by_marketing.length} channels`, icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2M17 11h4m-2-2v4" },
    { grad: "from-emerald-500 to-teal-600", shadow: "shadow-emerald-500/30", value: topType?.value ?? 0, label: topType?.label ?? "—", sub: `Top lead type · ${pctOf(topType?.value ?? 0)}%`, icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
    { grad: "from-amber-500 to-orange-600", shadow: "shadow-amber-500/30", value: topChannel?.value ?? 0, label: topChannel?.label ?? "—", sub: `Top channel · ${pctOf(topChannel?.value ?? 0)}%`, icon: "M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" },
    { grad: "from-sky-500 to-blue-600", shadow: "shadow-sky-500/30", value: topStatus?.value ?? 0, label: topStatus?.label ?? "—", sub: `Top status · ${pctOf(topStatus?.value ?? 0)}%`, icon: "M3 12h4l3 8 4-16 3 8h4" },
  ] : [];

  // Win % per conversion stage (from setup), keyed by stage name for the badge.
  const convPct = new Map(conversionTypes.map((c) => [c.name, c.percentage ?? 0]));
  const conversionBars = la ? toBars(la.by_conversion) : [];
  const marketingDonut = la ? toBars(la.by_marketing) : [];

  return (
    <div className="space-y-6">
      {/* Subscription warning */}
      {client.plan_end && v.tone !== "emerald" && (
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${v.expired ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
          <svg className="h-5 w-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10.3 3.9l-8 13.8A2 2 0 004 21h16a2 2 0 001.7-3.3l-8-13.8a2 2 0 00-3.4 0z" strokeLinejoin="round" /><path d="M12 9v4m0 4h.01" strokeLinecap="round" /></svg>
          <span>{v.expired ? `Your ${client.plan} plan expired on ${fmtDate(client.plan_end)}. Contact support to renew.` : `Your ${client.plan} plan ${v.text.toLowerCase()} (ends ${fmtDate(client.plan_end)}).`}</span>
        </div>
      )}

      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-emerald-600 to-teal-700 p-6 text-white shadow-lg shadow-emerald-600/20">
        <div className="relative z-10 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{client.name}</h1>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${planBadge[client.plan] ?? "bg-white/20"}`}>{client.plan} plan</span>
          </div>
          <p className="mt-1.5 text-emerald-50/90">Your dedicated CRM workspace</p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-medium">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Status: <span className="font-semibold capitalize">{client.status}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 backdrop-blur-sm">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 7V3m8 4V3M3 11h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {v.text}
            </span>
          </div>
        </div>
        <div className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-12 right-24 h-32 w-32 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute right-8 top-1/2 hidden h-28 w-28 -translate-y-1/2 rounded-full bg-white/5 sm:block" />
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards(stats).map((s) => (
          <div key={s.label} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${s.bar}`} />
            <div className="flex items-start justify-between">
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${s.tone}`}>
                <svg className="anim-ico h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={s.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <div className="flex items-end gap-0.5" aria-hidden>
                {SPARK.map((h, i) => <span key={i} className={`w-1 rounded-full ${s.dot} transition-all duration-300 group-hover:opacity-100 ${i === SPARK.length - 1 ? "opacity-100" : "opacity-50"}`} style={{ height: h }} />)}
              </div>
            </div>
            <div className="mt-4 text-3xl font-bold tracking-tight text-slate-900">{s.value.toLocaleString()}</div>
            <div className="mt-0.5 text-sm font-medium text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      {taskSummary && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:shadow-md lg:col-span-2">
            <h3 className="mb-4 flex items-center gap-2 font-semibold text-slate-900">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 19V5m0 14h16M8 17v-5m4 5V8m4 9v-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              Tasks by status
            </h3>
            {taskSummary.total === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">No tasks yet — create one to see the chart.</p>
            ) : (
              <BarChart
                data={[
                  { label: "Open", value: taskSummary.open },
                  { label: "In progress", value: taskSummary.in_progress },
                  { label: "Done", value: taskSummary.done },
                  { label: "Overdue", value: taskSummary.overdue },
                  { label: "Due today", value: taskSummary.due_today },
                ]}
                color="#10b981"
              />
            )}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:shadow-md">
            <h3 className="mb-4 flex items-center gap-2 font-semibold text-slate-900">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-100 text-sky-600">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-6.2-8.6M21 12a9 9 0 00-9-9v9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              Task distribution
            </h3>
            {taskSummary.total === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">No data yet.</p>
            ) : (
              <DonutChart
                data={[
                  { label: "Open", value: taskSummary.open, color: "#94a3b8" },
                  { label: "In progress", value: taskSummary.in_progress, color: "#0ea5e9" },
                  { label: "Done", value: taskSummary.done, color: "#10b981" },
                  { label: "Overdue", value: taskSummary.overdue, color: "#ef4444" },
                ]}
              />
            )}
          </div>
        </div>
      )}

      {/* Leads overview — Modern gradient analytics */}
      {hasPipeline && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Leads overview</h3>
              <p className="mt-0.5 text-xs text-slate-400">Lead volume across every pipeline dimension.</p>
            </div>
            <Link href="/client/leads-setup" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition hover:border-emerald-300 hover:text-emerald-700">Manage setup →</Link>
          </div>

          {hasVolume ? (
            <>
              {/* Gradient KPI tiles */}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {kpis.map((k) => (
                  <GradientStat key={k.label} grad={k.grad} shadow={k.shadow} value={k.value} label={k.label} sub={k.sub} icon={k.icon} />
                ))}
              </div>

              {/* Row A — status bars (wide) + channel donut */}
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="font-semibold text-slate-900">Leads by status</h4>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">{la!.by_status.length} statuses</span>
                  </div>
                  <GradientBars data={toBars(la!.by_status)} total={la!.total} />
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:shadow-md">
                  <h4 className="mb-4 font-semibold text-slate-900">By marketing channel</h4>
                  {marketingDonut.length > 0 ? (
                    <DonutChart data={marketingDonut} size={150} />
                  ) : (
                    <p className="py-10 text-center text-sm text-slate-400">No channel data.</p>
                  )}
                </div>
              </div>

              {/* Row B — lead type + conversion stage */}
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:shadow-md">
                  <h4 className="mb-4 font-semibold text-slate-900">By lead type</h4>
                  <GradientBars data={toBars(la!.by_lead_type)} total={la!.total} />
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:shadow-md">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="font-semibold text-slate-900">By conversion stage</h4>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">win % from setup</span>
                  </div>
                  {conversionBars.length > 0 ? (
                    <GradientBars data={conversionBars} total={la!.total} badges={convPct} />
                  ) : (
                    <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">Map statuses to conversion stages in <Link href="/client/leads-setup" className="font-medium text-emerald-600">Leads Setup</Link> to see stage volume.</p>
                  )}
                </div>
              </div>

              {/* Row C — sub-status (full width) */}
              {la!.by_sub_status.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:shadow-md">
                  <h4 className="mb-4 font-semibold text-slate-900">By sub-status</h4>
                  <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                    <GradientBars data={toBars(la!.by_sub_status.slice(0, Math.ceil(la!.by_sub_status.length / 2)))} total={la!.total} />
                    <GradientBars data={toBars(la!.by_sub_status.slice(Math.ceil(la!.by_sub_status.length / 2)))} total={la!.total} />
                  </div>
                </div>
              )}

              {/* Status composition per conversion stage (status → sub-status grouping) */}
              {stagesMapped.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:shadow-md">
                  <h4 className="font-semibold text-slate-900">Status composition by stage</h4>
                  <p className="mb-4 mt-0.5 text-xs text-slate-400">Which lead statuses make up each conversion stage.</p>
                  <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
                    {stagesMapped.map((r) => (
                      <div key={r.id}>
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="flex items-center gap-2 text-sm font-medium text-slate-700"><span className="h-2.5 w-2.5 rounded-full" style={{ background: hex(r.color) }} />{r.name}</span>
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{r.pct}% win</span>
                        </div>
                        <div className="flex h-6 overflow-hidden rounded-lg shadow-inner">
                          {r.statuses.map((s) => <span key={s.id} className="flex-1 transition hover:opacity-80" style={{ background: hex(s.color) }} title={s.name} />)}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
                          {r.statuses.map((s) => <span key={s.id} className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: hex(s.color) }} />{s.name}</span>)}
                        </div>
                      </div>
                    ))}
                  </div>
                  {unassigned.length > 0 && (
                    <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-400">{unassigned.length} unassigned status{unassigned.length === 1 ? "" : "es"}: {unassigned.map((s) => s.name).join(", ")}</p>
                  )}
                </div>
              )}
            </>
          ) : (
            /* No leads captured yet — keep the config-level snapshot + mapping hint */
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:shadow-md">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  { label: "Pipeline statuses", value: leadStatuses.length, tone: "text-emerald-600" },
                  { label: "Conversion stages", value: conversionTypes.length, tone: "text-indigo-600" },
                  { label: "Lead sources", value: leadSources.length, tone: "text-violet-600" },
                  { label: "Marketing channels", value: marketingTypes.length, tone: "text-amber-600" },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl bg-slate-50 p-4 text-center">
                    <div className={`text-2xl font-bold ${s.tone}`}>{s.value}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{s.label}</div>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-center text-sm text-slate-400">No leads captured yet — add leads to see volume charts here.</p>
            </div>
          )}
        </div>
      )}

      {/* Tasks overview */}
      {taskSummary && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:shadow-md">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold text-slate-900">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              Tasks
            </h3>
            <Link href="/client/tasks" className="text-sm font-medium text-emerald-600 hover:text-emerald-700">Manage tasks →</Link>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: "Total", value: taskSummary.total, tone: "text-slate-900", bg: "bg-slate-50" },
              { label: "Open", value: taskSummary.open, tone: "text-slate-700", bg: "bg-slate-100/70" },
              { label: "In Progress", value: taskSummary.in_progress, tone: "text-sky-700", bg: "bg-sky-50" },
              { label: "Done", value: taskSummary.done, tone: "text-emerald-700", bg: "bg-emerald-50" },
              { label: "Overdue", value: taskSummary.overdue, tone: "text-red-700", bg: "bg-red-50" },
            ].map((b) => (
              <div key={b.label} className={`rounded-xl ${b.bg} px-3 py-3 text-center transition hover:scale-[1.03]`}>
                <div className={`text-2xl font-bold ${b.tone}`}>{b.value}</div>
                <div className="text-xs font-medium text-slate-500">{b.label}</div>
              </div>
            ))}
          </div>

          {/* progress bar */}
          {taskSummary.total > 0 && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span>Completion</span>
                <span>{Math.round((taskSummary.done / taskSummary.total) * 100)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(taskSummary.done / taskSummary.total) * 100}%` }} />
              </div>
            </div>
          )}

          {/* upcoming / overdue list */}
          <div className="mt-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Upcoming &amp; overdue</div>
            {upcoming.length === 0 ? (
              <p className="py-3 text-sm text-slate-400">Nothing due — you&apos;re all caught up.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {upcoming.map((t) => {
                  const today = new Date().toISOString().slice(0, 10);
                  const d = t.due_date ? t.due_date.slice(0, 10) : "";
                  const overdue = !!d && d < today;
                  const dueToday = d === today;
                  return (
                    <li key={t.id} className="flex items-center gap-3 py-2.5">
                      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${overdue ? "bg-red-500" : dueToday ? "bg-amber-500" : "bg-slate-300"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">{t.title}</span>
                        <span className="text-xs text-slate-400">{t.assignee_name || "Unassigned"}</span>
                      </span>
                      <span className={`flex-shrink-0 text-xs font-medium ${overdue ? "text-red-600" : dueToday ? "text-amber-600" : "text-slate-500"}`}>
                        {overdue ? "Overdue · " : dueToday ? "Due today" : ""}{!dueToday && t.due_date ? fmtDate(t.due_date) : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Subscription */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:shadow-md">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-semibold text-slate-900">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-violet-600">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 10h18M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2zM7 15h3" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            Subscription
          </h3>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${v.tone === "red" ? "bg-red-100 text-red-700" : v.tone === "amber" ? "bg-amber-100 text-amber-700" : v.tone === "emerald" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{v.text}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div><div className="text-xs text-slate-400">Plan</div><div className="mt-0.5 font-semibold capitalize text-slate-800">{client.plan}</div></div>
          <div><div className="text-xs text-slate-400">Starts</div><div className="mt-0.5 font-semibold text-slate-800">{fmtDate(client.plan_start)}</div></div>
          <div><div className="text-xs text-slate-400">Ends</div><div className="mt-0.5 font-semibold text-slate-800">{fmtDate(client.plan_end)}</div></div>
        </div>
        {client.plan_start && client.plan_end && (() => {
          const pct = subscriptionPct(client.plan_start, client.plan_end);
          return (
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${v.expired ? "bg-red-500" : v.tone === "amber" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })()}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Company info */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="mb-4 font-semibold text-slate-900">Organization details</h3>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-slate-400">Email</dt><dd className="font-medium text-slate-800">{client.email || "—"}</dd></div>
            <div><dt className="text-slate-400">Phone</dt><dd className="font-medium text-slate-800">{client.phone || "—"}</dd></div>
            <div><dt className="text-slate-400">Workspace</dt><dd className="font-medium text-slate-800">{client.subdomain || "—"}</dd></div>
            <div><dt className="text-slate-400">Member since</dt><dd className="font-medium text-slate-800">{fmtDate(client.created_at)}</dd></div>
            <div><dt className="text-slate-400">Plan starts</dt><dd className="font-medium text-slate-800">{fmtDate(client.plan_start)}</dd></div>
            <div><dt className="text-slate-400">Plan ends</dt><dd className="font-medium text-slate-800">{fmtDate(client.plan_end)}</dd></div>
          </dl>
        </div>

        {/* Features */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:shadow-md">
          <h3 className="mb-4 font-semibold text-slate-900">Enabled features</h3>
          {enabled.length === 0 ? (
            <p className="text-sm text-slate-400">No add-on features enabled yet.</p>
          ) : (
            <ul className="space-y-2">
              {enabled.map((f) => (
                <li key={f.feature_key} className="flex items-center gap-2 text-sm text-slate-700">
                  <svg className="h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <span className="capitalize">{String(f.feature_key).replace(/[_-]/g, " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
