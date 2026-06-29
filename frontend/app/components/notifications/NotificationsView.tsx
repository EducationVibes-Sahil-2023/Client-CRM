"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getNotifications,
  readAllNotifications,
  readNotification,
  type AppNotification,
  type ChatArea,
  type NotificationFilter,
} from "../../lib/chat";
import { PageHeader, Card, EmptyState, Spinner, timeAgo } from "../../admin/ui";

// Accent per area (matches each shell's theme).
const THEME: Record<ChatArea, { pill: string; dot: string; unreadBg: string; tabText: string }> = {
  superadmin: { pill: "bg-indigo-600", dot: "bg-indigo-500", unreadBg: "bg-indigo-50/50", tabText: "text-indigo-700" },
  client: { pill: "bg-emerald-600", dot: "bg-emerald-500", unreadBg: "bg-emerald-50/50", tabText: "text-emerald-700" },
  staff: { pill: "bg-sky-600", dot: "bg-sky-500", unreadBg: "bg-sky-50/50", tabText: "text-sky-700" },
};

// Icon glyph + tint per notification type.
function iconFor(type: string): { tone: string; path: string } {
  switch (type) {
    case "chat_message":
      return { tone: "bg-violet-100 text-violet-600", path: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" };
    case "task_completed":
      return { tone: "bg-emerald-100 text-emerald-600", path: "M5 13l4 4L19 7" };
    case "task_due":
      return { tone: "bg-red-100 text-red-600", path: "M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" };
    case "task_assigned":
      return { tone: "bg-sky-100 text-sky-600", path: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2" };
    case "task_updated":
      return { tone: "bg-amber-100 text-amber-600", path: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4 9.5-9.5z" };
    case "task_deleted":
      return { tone: "bg-slate-100 text-slate-500", path: "M6 7h12M9 7V5h6v2m-1 0 .8 13H8.2L9 7" };
    default:
      return { tone: "bg-slate-100 text-slate-500", path: "M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" };
  }
}

const TABS: { key: NotificationFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "read", label: "Read" },
];
const PAGE = 20;
const POLL_MS = 15_000;

/**
 * Polished, infinite-scrolling notifications feed shared by the super-admin and
 * client (and staff) areas. Each area is scoped to its own recipient by the
 * backend, so everyone only ever sees their own notifications.
 */
export default function NotificationsView({ area }: { area: ChatArea }) {
  const router = useRouter();
  const theme = THEME[area];

  const [items, setItems] = useState<AppNotification[]>([]);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const maxIdRef = useRef(0);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // (Re)load the first page on mount and whenever the area/filter changes. The
  // load runs inside an async closure so every setState lands after an await —
  // never synchronously in the effect body. Loading is switched on by the
  // initial state and by the tab click handler.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await getNotifications(area, { filter, limit: PAGE });
        if (cancelled) return;
        setItems(d.notifications);
        setUnread(d.unread);
        setHasMore(d.has_more);
        hasMoreRef.current = d.has_more;
        maxIdRef.current = d.notifications.length ? d.notifications[0].id : 0;
      } catch {
        /* transient */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [area, filter]);

  // Append the next page (older notifications).
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current || items.length === 0) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const before = items[items.length - 1].id;
    try {
      const d = await getNotifications(area, { filter, before, limit: PAGE });
      setItems((cur) => {
        const seen = new Set(cur.map((c) => c.id));
        return [...cur, ...d.notifications.filter((n) => !seen.has(n.id))];
      });
      setHasMore(d.has_more);
      hasMoreRef.current = d.has_more;
      setUnread(d.unread);
    } catch {
      /* transient */
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [area, filter, items]);

  // Infinite scroll: load more as the sentinel nears the viewport.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      (entries) => entries[0]?.isIntersecting && loadMore(),
      { rootMargin: "240px" },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [loadMore]);

  // Light poll: keep the unread count fresh and surface brand-new items on top.
  useEffect(() => {
    const tick = async () => {
      try {
        const d = await getNotifications(area, { filter, limit: PAGE });
        setUnread(d.unread);
        const fresh = d.notifications.filter((n) => n.id > maxIdRef.current);
        if (fresh.length) {
          setItems((cur) => {
            const seen = new Set(cur.map((c) => c.id));
            return [...fresh.filter((n) => !seen.has(n.id)), ...cur];
          });
          maxIdRef.current = d.notifications[0].id;
        }
      } catch {
        /* keep polling */
      }
    };
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [area, filter]);

  async function open(n: AppNotification) {
    if (!n.read_at) {
      readNotification(area, n.id).catch(() => {});
      setUnread((u) => Math.max(0, u - 1));
      setItems((list) =>
        filter === "unread"
          ? list.filter((x) => x.id !== n.id)
          : list.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)),
      );
    }
    if (n.link) router.push(n.link);
  }

  async function markAll() {
    readAllNotifications(area).catch(() => {});
    setUnread(0);
    if (filter === "unread") {
      setItems([]);
    } else {
      setItems((list) => list.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
    }
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Stay up to date with your latest alerts and messages."
        action={
          <button
            onClick={markAll}
            disabled={unread === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 13l3 3 6-7M11 16l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Mark all as read
          </button>
        }
      />

      <Card className="p-4 sm:p-5">
        {/* Card header: count + filter tabs */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-slate-900">All Notifications</h2>
            {unread > 0 && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold text-white ${theme.pill}`}>{unread} unread</span>
            )}
          </div>
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => { if (tab.key !== filter) { setLoading(true); setFilter(tab.key); } }}
                className={`rounded-md px-3 py-1 text-sm font-medium transition ${filter === tab.key ? `bg-white shadow-sm ${theme.tabText}` : "text-slate-500 hover:text-slate-700"}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-10"><Spinner /></div>
        ) : items.length === 0 ? (
          <EmptyState
            title={filter === "unread" ? "No unread notifications" : filter === "read" ? "No read notifications yet" : "You're all caught up"}
            hint="New messages and alerts will appear here."
          />
        ) : (
          <div className="space-y-1">
            {items.map((n) => {
              const ic = iconFor(n.type);
              return (
                <button
                  key={n.id}
                  onClick={() => open(n)}
                  className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-slate-50 ${n.read_at ? "" : theme.unreadBg}`}
                >
                  <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${ic.tone}`}>
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={ic.path} strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={`text-sm ${n.read_at ? "font-medium text-slate-700" : "font-semibold text-slate-900"}`}>{n.title}</span>
                      {!n.read_at && <span className={`h-2 w-2 flex-shrink-0 rounded-full ${theme.dot}`} />}
                    </span>
                    {n.body && <span className="mt-0.5 block text-sm text-slate-500">{n.body}</span>}
                    <span className="mt-1 block text-xs text-slate-400">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              );
            })}

            {/* Infinite-scroll sentinel + loader */}
            <div ref={sentinelRef} />
            {loadingMore && <div className="py-3 text-center text-xs text-slate-400">Loading more…</div>}
            {!hasMore && items.length > PAGE && <div className="py-3 text-center text-xs text-slate-300">You&apos;ve reached the end</div>}
          </div>
        )}
      </Card>
    </>
  );
}
