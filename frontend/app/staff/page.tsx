"use client";

import { useEffect, useState } from "react";
import { useStaff } from "./StaffContext";
import { MODULE_META, moduleLabel } from "./modules";
import { getStaffDashboard, type StaffDashboard } from "../lib/staff";
import { Badge, Card, PageHeader, SkeletonStats, SkeletonCards, fmtDate } from "../admin/ui";

const toneClasses: Record<string, string> = {
  sky: "bg-sky-100 text-sky-600",
  indigo: "bg-indigo-100 text-indigo-600",
  amber: "bg-amber-100 text-amber-600",
  emerald: "bg-emerald-100 text-emerald-600",
};
function StatCard({ label, value, icon, tone }: { label: string; value: number; icon: string; tone: keyof typeof toneClasses }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <span className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${toneClasses[tone]}`}>
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  );
}

function PermChip({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${on ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-400 line-through"}`}>{label}</span>
  );
}

export default function StaffDashboardPage() {
  const { me, can } = useStaff();
  const [data, setData] = useState<StaffDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStaffDashboard()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const allowed = me.modules.filter((m) => m !== "dashboard" && me.permissions[m]?.view);

  return (
    <>
      <PageHeader title={`Hello, ${me.user.name} 👋`} subtitle={me.client ? `${me.client.name} · Staff portal` : "Staff portal"} />

      {loading ? (
        <div className="space-y-6">
          <SkeletonStats count={4} />
          <SkeletonCards count={6} />
        </div>
      ) : allowed.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <svg className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
            </span>
            <p className="font-medium text-slate-600">No modules assigned yet</p>
            <p className="text-sm text-slate-400">Your administrator hasn’t granted you access to anything yet. Check back soon.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* KPI cards — only for permitted modules with stats */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {can("tasks") && <StatCard label="My open tasks" value={data?.stats.my_tasks ?? 0} tone="sky" icon="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />}
            {can("tasks") && <StatCard label="Open tasks (team)" value={data?.stats.tasks_open ?? 0} tone="amber" icon="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />}
            {can("team") && <StatCard label="Team members" value={data?.stats.team ?? 0} tone="indigo" icon="M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2" />}
            {can("roles") && <StatCard label="Roles" value={data?.stats.roles ?? 0} tone="emerald" icon="M12 11a3 3 0 100-6 3 3 0 000 6zM4 21v-2a4 4 0 014-4h8a4 4 0 014 4v2" />}
          </div>

          {/* My tasks */}
          {can("tasks") && (
            <Card>
              <h3 className="mb-3 font-semibold text-slate-900">My tasks</h3>
              {(data?.my_tasks.length ?? 0) === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">No tasks assigned to you.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data!.my_tasks.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 py-2.5">
                      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${t.status === "open" ? "bg-amber-500" : "bg-emerald-500"}`} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{t.title}</span>
                      {t.due_date && <span className="text-xs text-slate-400">{fmtDate(t.due_date)}</span>}
                      <Badge value={t.priority} />
                      <Badge value={t.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {/* Announcements */}
          {can("announcements") && (
            <Card>
              <h3 className="mb-3 font-semibold text-slate-900">Announcements</h3>
              {(data?.announcements.length ?? 0) === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">No announcements yet.</p>
              ) : (
                <ul className="space-y-3">
                  {data!.announcements.map((a) => (
                    <li key={a.id} className="rounded-xl border border-slate-100 p-3">
                      <div className="flex items-center gap-2">
                        {a.pinned ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">PINNED</span> : null}
                        <span className="font-medium text-slate-800">{a.title}</span>
                        <span className="ml-auto text-[11px] text-slate-400">{fmtDate(a.created_at)}</span>
                      </div>
                      {a.body && <div className="rte-content mt-1 text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: a.body }} />}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {/* Your access — every module the staff can view, with granted actions */}
          <div>
            <h3 className="mb-3 font-semibold text-slate-900">Your access</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {allowed.map((m) => {
                const meta = MODULE_META[m] ?? { label: moduleLabel(m), icon: MODULE_META.dashboard.icon };
                const p = me.permissions[m];
                return (
                  <div key={m} id={`mod-${m}`} className="scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={meta.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </span>
                      <span className="font-semibold text-slate-900">{meta.label}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <PermChip on label="View" />
                      <PermChip on={!!p?.create} label="Create" />
                      <PermChip on={!!p?.update} label="Edit" />
                      <PermChip on={!!p?.delete} label="Delete" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
