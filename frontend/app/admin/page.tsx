"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getOverview, type Overview } from "../lib/admin";
import { AreaChart, DonutChart, BarChart } from "./Charts";
import { Card, PageHeader, Spinner, Badge, fmtDate, EmptyState } from "./ui";

const planColors: Record<string, string> = {
  starter: "#94a3b8",
  growth: "#6366f1",
  enterprise: "#8b5cf6",
};
const statusColors: Record<string, string> = {
  active: "#10b981",
  trial: "#0ea5e9",
  suspended: "#ef4444",
  inactive: "#94a3b8",
};

function StatCard({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  icon: string;
  tone: string;
}) {
  return (
    <Card className="flex items-center gap-4">
      <span className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${tone}`}>
        <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <div>
        <div className="text-2xl font-bold text-slate-900">{value}</div>
        <div className="text-sm text-slate-500">{label}</div>
        {sub && <div className="mt-0.5 text-xs font-medium text-indigo-600">{sub}</div>}
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getOverview()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Card><EmptyState title="Couldn't load dashboard" hint={error} /></Card>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader title="Dashboard" subtitle="Overview of your platform" />
        <Card><Spinner /></Card>
      </>
    );
  }

  const s = data.stats;
  const planData = Object.entries(data.plans).map(([label, value]) => ({
    label,
    value,
    color: planColors[label] ?? "#cbd5e1",
  }));
  const statusData = Object.entries(data.client_status).map(([label, value]) => ({
    label,
    value,
    color: statusColors[label] ?? "#cbd5e1",
  }));

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Overview of your platform activity" />

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Clients" value={s.clients} icon="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8z" tone="bg-indigo-100 text-indigo-600" sub={`${s.clients_active} active · ${s.clients_new_30d} new (30d)`} />
        <StatCard label="Platform Users" value={s.users_total} icon="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" tone="bg-sky-100 text-sky-600" sub={`${s.client_admins} client admins`} />
        <StatCard label="Demo Requests" value={s.demo_total} icon="M15 10l4.5-2.5v9L15 14M4 6h9a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" tone="bg-violet-100 text-violet-600" sub={s.demo_new ? `${s.demo_new} new` : "all reviewed"} />
        <StatCard label="Contact Messages" value={s.contact_total} icon="M3 8l9 6 9-6M3 8v10a2 2 0 002 2h14a2 2 0 002-2V8M3 8l9-5 9 5" tone="bg-emerald-100 text-emerald-600" sub={s.contact_new ? `${s.contact_new} new` : "all reviewed"} />
      </div>

      {/* Charts */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Activity — last 14 days</h3>
          </div>
          <AreaChart
            data={data.series}
            series={[
              { key: "demos", color: "#6366f1", label: "Demo requests" },
              { key: "contacts", color: "#10b981", label: "Contact messages" },
            ]}
          />
        </Card>
        <Card>
          <h3 className="mb-4 font-semibold text-slate-900">Plan distribution</h3>
          {planData.length ? <DonutChart data={planData} /> : <EmptyState title="No clients yet" />}
        </Card>
      </div>

      {/* Recent clients — newest sign-ups across the platform */}
      <Card className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">Recent clients</h3>
          <Link href="/admin/clients" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">View all</Link>
        </div>
        {data.recent_clients.length === 0 ? (
          <EmptyState title="No clients yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4">Client</th>
                  <th className="py-2 pr-4">Plan</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Subdomain</th>
                  <th className="py-2">Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_clients.map((c) => (
                  <tr key={c.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 pr-4">
                      <div className="font-medium text-slate-800">{c.name}</div>
                      {c.email && <div className="text-xs text-slate-400">{c.email}</div>}
                    </td>
                    <td className="py-2 pr-4">
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-600">{c.plan || "starter"}</span>
                    </td>
                    <td className="py-2 pr-4"><Badge value={c.status} /></td>
                    <td className="py-2 pr-4 text-slate-500">{c.subdomain || "—"}</td>
                    <td className="py-2 text-slate-500">{fmtDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <h3 className="mb-4 font-semibold text-slate-900">Clients by status</h3>
          {statusData.length ? <BarChart data={statusData.map((d) => ({ label: d.label, value: d.value }))} /> : <EmptyState title="No data" />}
        </Card>

        {/* Recent demo requests */}
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Recent demos</h3>
            <Link href="/admin/demo-requests" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">View all</Link>
          </div>
          <ul className="space-y-3">
            {data.recent_demos.length === 0 && <li className="text-sm text-slate-400">No demo requests yet.</li>}
            {data.recent_demos.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800">{d.name}</div>
                  <div className="truncate text-xs text-slate-400">{d.company || d.email}</div>
                </div>
                <Badge value={d.status} />
              </li>
            ))}
          </ul>
        </Card>

        {/* Recent contacts */}
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Recent messages</h3>
            <Link href="/admin/contact-requests" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">View all</Link>
          </div>
          <ul className="space-y-3">
            {data.recent_contacts.length === 0 && <li className="text-sm text-slate-400">No messages yet.</li>}
            {data.recent_contacts.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800">{c.name}</div>
                  <div className="truncate text-xs text-slate-400">{fmtDate(c.created_at)}</div>
                </div>
                <Badge value={c.status} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
