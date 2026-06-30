"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { ClientProvider, useClient } from "./ClientContext";
import ClientSidebar, { MAIN_NAV, setupNav } from "./ClientSidebar";
import ChatLauncher from "../components/chat/ChatLauncher";
import type { AppNotification } from "../lib/chat";
import { globalSearch, type SearchGroup } from "../lib/client";
import { timeAgo } from "../lib/datetime";
import { brandCssVars, fontStack, fontSizePx } from "../lib/theme";
import { API_URL } from "../lib/api";

/** Icon + tint per notification type. */
function notifStyle(type: string): { tone: string; path: string } {
  if (type === "task_completed") return { tone: "bg-emerald-100 text-emerald-600", path: "M5 13l4 4L19 7" };
  if (type === "task_due") return { tone: "bg-red-100 text-red-600", path: "M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" };
  if (type === "task_assigned") return { tone: "bg-sky-100 text-sky-600", path: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2" };
  if (type === "task_deleted") return { tone: "bg-slate-100 text-slate-500", path: "M6 7h12M9 7V5h6v2m-1 0 .8 13H8.2L9 7" };
  if (type === "chat_message") return { tone: "bg-violet-100 text-violet-600", path: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" };
  if (type === "lead_assigned" || type === "lead_transfer") return { tone: "bg-indigo-100 text-indigo-600", path: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8z" };
  return { tone: "bg-emerald-100 text-emerald-600", path: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" };
}

function NotificationBell() {
  const { notifications, unread, markRead, markAllRead, refreshNotifications } = useClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function toggle() {
    setOpen((o) => {
      if (!o) refreshNotifications();
      return !o;
    });
  }

  function openItem(n: AppNotification) {
    if (!n.read_at) markRead(n.id);
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} className="relative flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100" aria-label="Notifications">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold text-slate-900">Notifications</span>
            {unread > 0 && <button onClick={markAllRead} className="text-xs font-medium text-emerald-600 hover:text-emerald-700">Mark all read</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-400">You&apos;re all caught up 🎉</div>
            ) : (
              notifications.slice(0, 12).map((n) => {
                const s = notifStyle(n.type);
                return (
                  <button key={n.id} onClick={() => openItem(n)} className={`flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50 ${n.read_at ? "" : "bg-emerald-50/40"}`}>
                    <span className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${s.tone}`}>
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={s.path} strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={`truncate text-sm ${n.read_at ? "font-medium text-slate-600" : "font-semibold text-slate-900"}`}>{n.title}</span>
                        <span className="flex-shrink-0 text-[11px] text-slate-400">{timeAgo(n.created_at)}</span>
                      </span>
                      {n.body && <span className="mt-0.5 block truncate text-xs text-slate-500">{n.body}</span>}
                    </span>
                    {!n.read_at && <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-emerald-500" />}
                  </button>
                );
              })
            )}
          </div>
          <Link href="/client/notifications" onClick={() => setOpen(false)} className="block border-t border-slate-100 px-4 py-2.5 text-center text-sm font-medium text-emerald-600 hover:bg-slate-50">
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}

/** Tint + icon per search result group. */
function groupIcon(key: string): string {
  switch (key) {
    case "leads": return "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8z";
    case "team": return "M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2";
    case "tasks": return "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11";
    case "assets": return "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-14L4 7m8 4v10M4 7v10l8 4";
    default: return "M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z";
  }
}

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Debounced query — only the latest response is allowed to land (reqId guard).
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++reqId.current;
    const t = setTimeout(() => {
      globalSearch(term)
        .then((d) => { if (id === reqId.current) { setGroups(d.groups); setOpen(true); } })
        .catch(() => { if (id === reqId.current) setGroups([]); })
        .finally(() => { if (id === reqId.current) setLoading(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function go(href: string) {
    setOpen(false);
    setQ("");
    setGroups([]);
    router.push(href);
  }

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="relative w-full max-w-md" ref={ref}>
      <div className="relative">
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => { if (total > 0) setOpen(true); }}
          onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); (e.target as HTMLInputElement).blur(); } }}
          placeholder="Search leads, team, tasks…"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-8 text-sm text-slate-700 transition focus:border-emerald-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
        />
        {q && (
          <button onClick={() => { setQ(""); setGroups([]); setOpen(false); }} className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Clear">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
          </button>
        )}
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
          {loading && total === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-400">Searching…</div>
          ) : total === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-400">No matches for “{q.trim()}”.</div>
          ) : (
            groups.map((g) => (
              <div key={g.key} className="border-b border-slate-50 last:border-0">
                <div className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</div>
                {g.items.map((it) => (
                  <button key={`${g.key}-${it.id}`} onClick={() => go(it.href)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50">
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={groupIcon(g.key)} strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800">{it.title}</span>
                      {it.subtitle && <span className="block truncate text-xs text-slate-400">{it.subtitle}</span>}
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initials = (user.name || user.email || "C").slice(0, 1).toUpperCase();

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-full transition hover:opacity-90" aria-label="Account menu">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-sm font-bold text-white">{initials}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-sm font-bold text-white">{initials}</span>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold text-slate-900">{user.name || "Client Admin"}</div>
              <div className="truncate text-xs text-slate-400">{user.email}</div>
            </div>
          </div>
          <div className="p-1.5">
            <button
              onClick={() => { setOpen(false); router.push("/client/profile"); }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            >
              <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              My Profile
            </button>
            <button
              onClick={() => { setOpen(false); logout(); }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-red-50 hover:text-red-600"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AnnouncementBell() {
  const { announcementsUnread, markAnnouncementsRead, hasFeature, can } = useClient();
  const router = useRouter();
  if (!hasFeature("announcements") || !can("announcements")) return null;

  function open() {
    if (announcementsUnread > 0) markAnnouncementsRead();
    router.push("/client/announcements");
  }

  return (
    <button onClick={open} className="relative flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100" aria-label="Announcements" title="Announcements">
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 010 7M18 6a8 8 0 010 12" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {announcementsUnread > 0 && (
        <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{announcementsUnread > 9 ? "9+" : announcementsUnread}</span>
      )}
    </button>
  );
}

function Topbar() {
  const { toggleCollapsed, setMobileOpen, user } = useClient();
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
      <button onClick={toggleCollapsed} className="hidden h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:flex" aria-label="Toggle sidebar">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" /></svg>
      </button>
      <button onClick={() => setMobileOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" /></svg>
      </button>
      <div className="hidden shrink-0 text-sm font-semibold text-slate-500 xl:block">Welcome back, <span className="text-slate-900">{user.name || "Client Admin"}</span></div>
      <div className="mx-auto flex w-full max-w-md flex-1 justify-center px-2">
        <GlobalSearch />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <AnnouncementBell />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}

/** Full-page "no access" state shown when a user opens a route they lack rights to. */
function AccessDenied() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-500">
        <svg className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-7a2 2 0 00-2-2H6a2 2 0 00-2 2v7a2 2 0 002 2zM8 11V7a4 4 0 118 0v4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <h1 className="mt-5 text-xl font-bold text-slate-900">Access denied</h1>
      <p className="mt-1.5 max-w-sm text-sm text-slate-500">You don&apos;t have permission to view this page. If you think this is a mistake, ask your administrator to grant you access.</p>
      <Link href="/client" className="mt-5 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Back to dashboard</Link>
    </div>
  );
}

/**
 * Page-level permission gate. Maps the current path to its nav entry (which
 * already declares the required `feature` / `module` / `adminOnly`) and blocks
 * direct-URL access the sidebar would otherwise only hide. Routes with no nav
 * entry (dashboard, profile, notifications, activity) are open.
 */
function RouteGuard({ children }: { children: React.ReactNode }) {
  const { can, isAdmin, hasFeature } = useClient();
  const pathname = usePathname();

  // Most specific matching nav item: longest href that the path equals or sits under.
  const match = [...MAIN_NAV, ...setupNav]
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];

  if (match) {
    const denied =
      (match.adminOnly && !isAdmin) ||
      (match.feature && !hasFeature(match.feature)) ||
      (match.module && !can(match.module, "view"));
    if (denied) return <AccessDenied />;
  }

  return <>{children}</>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const { collapsed, contentFull, branding, hasFeature, can, impersonation, exitImpersonation } = useClient();
  // The floating chat launcher follows the same gate as the Chat nav item:
  // the chat plan-feature must be on AND the user granted the chat permission.
  const showChat = hasFeature("chat") && can("chat");

  // Recolour the whole panel from the brand hex (overrides Tailwind's emerald
  // CSS variables) and react to OS theme changes when mode is "system".
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const dark = branding.theme_mode === "dark" || (branding.theme_mode === "system" && systemDark);
  const style = { ...brandCssVars(branding.brand_color), "--app-font": fontStack(branding.font_family) } as React.CSSProperties;

  // Mirror the brand scale + density onto the document root while the client
  // panel is mounted, so the *window* scrollbar (which belongs to the root, not
  // the .client-shell div) can also adopt the brand colour. Cleared on unmount
  // so the super-admin / staff panels keep the neutral scrollbar.
  useEffect(() => {
    const root = document.documentElement;
    const vars = brandCssVars(branding.brand_color) as Record<string, string>;
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.style.setProperty("--scrollbar-size", branding.density === "compact" ? "10px" : "13px");
    // Base font-size scales every rem-based size in the panel; set on <html> so
    // it actually affects rem units (rem is relative to the root, not the shell).
    root.style.fontSize = fontSizePx(branding.font_size);
    root.dataset.clientPanel = dark ? "dark" : "light";
    return () => {
      Object.keys(vars).forEach((k) => root.style.removeProperty(k));
      root.style.removeProperty("--scrollbar-size");
      root.style.removeProperty("font-size");
      delete root.dataset.clientPanel;
    };
  }, [branding.brand_color, branding.density, branding.font_size, dark]);

  // Swap the browser-tab favicon to the client's while the panel is mounted
  // (favicon_url if set, else fall back to the logo). Restored on unmount.
  useEffect(() => {
    const src = branding.favicon_url || branding.logo_url;
    if (!src) return;
    const href = src.startsWith("http") ? src : `${API_URL}${src}`;
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    let created = false;
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
      created = true;
    }
    const prev = link.getAttribute("href");
    link.setAttribute("href", href);
    return () => {
      if (created) link!.remove();
      else if (prev !== null) link!.setAttribute("href", prev);
    };
  }, [branding.favicon_url, branding.logo_url]);

  return (
    <div
      className={`client-shell min-h-screen bg-slate-50 ${dark ? "dark" : ""}`}
      data-density={branding.density}
      data-sidebar={branding.sidebar_style}
      style={style}
    >
      <ClientSidebar />
      <div className={`transition-all duration-300 ${collapsed ? "lg:ml-20" : "lg:ml-64"}`}>
        {impersonation && (
          <div className="flex flex-wrap items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white">
            <span>
              You&apos;re viewing <b>{impersonation.client ?? "this client"}</b> as admin{impersonation.name ? ` (${impersonation.name})` : ""}.
            </span>
            <button onClick={exitImpersonation} className="rounded-md bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30">
              Exit to admin panel
            </button>
          </div>
        )}
        <Topbar />
        <main className={`mx-auto p-4 transition-[max-width] duration-200 sm:p-6 ${contentFull ? "max-w-none" : "max-w-7xl"}`}><RouteGuard>{children}</RouteGuard></main>
      </div>
      {showChat && <ChatLauncher area="client" />}
    </div>
  );
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  // The provider resolves the user (/client/me), branding and features in
  // parallel and shows its own boot spinner until all are ready, then renders
  // the shell fully populated. Auth/redirect is handled there too.
  return (
    <ClientProvider>
      <Shell>{children}</Shell>
    </ClientProvider>
  );
}
