"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getActivity, type ActivityItem, type ActivityStats } from "../../lib/admin";
import { EmptyState, PageHeader, Spinner, fmtDate, fmtDateTime, timeAgo } from "../ui";
import { APP_TZ, parseServer } from "../../lib/datetime";

type Filter = "all" | "created" | "updated" | "deleted" | "login";

const PAGE_SIZE = 20;

// Per-action visuals for the timeline node + the inline "type" badge.
const actionMeta: Record<string, { node: string; badge: string; label: string; icon: string }> = {
  created: { node: "bg-emerald-100 text-emerald-600", badge: "bg-emerald-50 text-emerald-600 ring-emerald-100", label: "Created", icon: "M12 5v14M5 12h14" },
  updated: { node: "bg-amber-100 text-amber-600", badge: "bg-amber-50 text-amber-600 ring-amber-100", label: "Updated", icon: "M11 4h-5a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-5M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z" },
  deleted: { node: "bg-rose-100 text-rose-600", badge: "bg-rose-50 text-rose-600 ring-rose-100", label: "Deleted", icon: "M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m1 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" },
  login: { node: "bg-sky-100 text-sky-600", badge: "bg-sky-50 text-sky-600 ring-sky-100", label: "Login", icon: "M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" },
};
const fallbackMeta = { node: "bg-slate-100 text-slate-500", badge: "bg-slate-100 text-slate-500 ring-slate-200", label: "Event", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" };
const metaFor = (action: string) => actionMeta[action] ?? { ...fallbackMeta, label: action || "Event" };

const filters: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "created", label: "Created" },
  { key: "updated", label: "Updated" },
  { key: "deleted", label: "Deleted" },
  { key: "login", label: "Logins" },
];

/** Display the actor's name; if only an email is on record, drop the domain. */
function actorLabel(item: ActivityItem): string {
  const raw = (item.actor_name ?? "").trim();
  if (raw === "") return "Super Admin";
  const at = raw.indexOf("@");
  return at > 0 ? raw.slice(0, at) : raw;
}

// IST calendar-day key for grouping + "Today/Yesterday" headers.
function istDayKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: APP_TZ });
}
function dayHeading(key: string): string {
  const today = istDayKey(new Date());
  if (key === today) return "Today";
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (key === istDayKey(y)) return "Yesterday";
  return fmtDate(`${key}T12:00:00Z`);
}

function StatCard({ label, value, icon, tone }: { label: string; value: number; icon: string; tone: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${tone}`}>
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <div>
        <div className="text-2xl font-bold leading-tight text-slate-900">{value}</div>
        <div className="text-sm text-slate-500">{label}</div>
      </div>
    </div>
  );
}

export default function ActivityPage() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);   // initial / filter-change load
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);

  // Reset and load the first page whenever the action filter changes. The
  // synchronous resets are deliberate (show the spinner immediately).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setItems([]);
    setHasMore(false);
    getActivity({ limit: PAGE_SIZE, offset: 0, action: filter })
      .then((d) => {
        if (cancelled) return;
        setItems(d.activity);
        setHasMore(d.has_more);
        if (d.stats) setStats(d.stats);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [filter]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const loadMore = useCallback(() => {
    if (loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    getActivity({ limit: PAGE_SIZE, offset: items.length, action: filter })
      .then((d) => {
        setItems((prev) => [...prev, ...d.activity]);
        setHasMore(d.has_more);
      })
      .finally(() => setLoadingMore(false));
  }, [items.length, filter, hasMore, loadingMore, loading]);

  // Infinite scroll: fetch the next page when the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && loadMore(), { rootMargin: "240px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const tabCount = (key: Filter): number | null => {
    if (!stats) return null;
    if (key === "all") return stats.total;
    return stats.by_action?.[key] ?? 0;
  };

  // Group the loaded items into ordered IST day sections (newest first).
  const groups = useMemo(() => {
    const map = new Map<string, ActivityItem[]>();
    for (const i of items) {
      const d = parseServer(i.created_at);
      const k = d ? istDayKey(d) : "—";
      const arr = map.get(k);
      if (arr) arr.push(i);
      else map.set(k, [i]);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <>
      <PageHeader title="Activity" subtitle="A real-time audit log of what you and your fellow super admins do across the platform" />

      {/* KPI summary (super-admin activity) */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Today's activity" value={stats?.today ?? 0} tone="bg-indigo-50 text-indigo-600" icon="M22 12h-4l-3 9L9 3l-3 9H2" />
        <StatCard label="Active admins" value={stats?.active ?? 0} tone="bg-sky-50 text-sky-600" icon="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8z" />
        <StatCard label="Created (week)" value={stats?.created_week ?? 0} tone="bg-emerald-50 text-emerald-600" icon="M12 5v14M5 12h14" />
        <StatCard label="Deleted (week)" value={stats?.deleted_week ?? 0} tone="bg-rose-50 text-rose-600" icon="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m1 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
      </div>

      {/* Segmented filter */}
      <div className="mb-6 flex items-center gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
        {filters.map((f) => {
          const active = filter === f.key;
          const count = tabCount(f.key);
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`flex flex-shrink-0 items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {f.label}
              {count != null && count > 0 && (
                <span className={`rounded-full px-1.5 text-[11px] ${active ? "bg-slate-100 text-slate-500" : "bg-slate-200/70 text-slate-500"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title="No activity yet" hint="Actions performed by super admins will show up here." />
      ) : (
        <div className="space-y-8">
          {groups.map(([day, rows]) => (
            <section key={day}>
              <div className="mb-4 flex items-center gap-4">
                <h3 className="text-sm font-semibold text-slate-900">{dayHeading(day)}</h3>
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-xs text-slate-400">{rows.length} event{rows.length === 1 ? "" : "s"}</span>
              </div>

              <ol className="relative space-y-4 before:absolute before:bottom-4 before:left-[17px] before:top-4 before:w-px before:bg-slate-200">
                {rows.map((item) => {
                  const meta = metaFor(item.action);
                  const actor = actorLabel(item);
                  const title = item.description || `${meta.label} ${item.entity_type?.replace(/_/g, " ") ?? ""}`.trim();
                  return (
                    <li key={item.id} className="relative flex gap-4">
                      <span className={`relative z-10 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ring-4 ring-slate-50 ${meta.node}`}>
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={meta.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </span>

                      <div className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-start gap-3">
                          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-[11px] font-bold text-white shadow-sm">
                            {actor.slice(0, 2).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-[15px] font-semibold text-slate-900">{actor}</span>
                              <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ${meta.badge}`}>{meta.label}</span>
                              <span className="ml-auto flex-shrink-0 text-xs text-slate-400" title={fmtDateTime(item.created_at)}>{timeAgo(item.created_at)}</span>
                            </div>
                            <div className="mt-0.5 text-xs font-medium text-slate-500">{title}</div>

                            {(item.entity_type || item.entity_id != null) && (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                {item.entity_type && (
                                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                                    {item.entity_type.replace(/_/g, " ")}
                                  </span>
                                )}
                                {item.entity_id != null && (
                                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">#{item.entity_id}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}

          {/* Infinite-scroll sentinel + loader */}
          <div ref={sentinel} className="h-1" />
          {loadingMore && (
            <div className="flex justify-center py-2 text-slate-400">
              <svg className="h-5 w-5 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
              </svg>
            </div>
          )}
          {!hasMore && items.length > 0 && (
            <p className="py-2 text-center text-xs text-slate-400">You&apos;ve reached the end.</p>
          )}
        </div>
      )}
    </>
  );
}
