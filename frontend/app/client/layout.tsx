"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API_URL } from "../lib/api";
import { useToast } from "../components/toast/ToastProvider";
import { ClientProvider, useClient } from "./ClientContext";
import ClientSidebar from "./ClientSidebar";
import ChatLauncher from "../components/chat/ChatLauncher";
import type { AppNotification } from "../lib/chat";
import { timeAgo } from "../lib/datetime";
import { brandCssVars } from "../lib/theme";

interface ClientUser {
  id: number;
  email: string;
  role: string;
  name?: string;
}


/** Icon + tint per notification type. */
function notifStyle(type: string): { tone: string; path: string } {
  if (type === "task_completed") return { tone: "bg-emerald-100 text-emerald-600", path: "M5 13l4 4L19 7" };
  if (type === "task_due") return { tone: "bg-red-100 text-red-600", path: "M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" };
  if (type === "task_assigned") return { tone: "bg-sky-100 text-sky-600", path: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2" };
  if (type === "task_deleted") return { tone: "bg-slate-100 text-slate-500", path: "M6 7h12M9 7V5h6v2m-1 0 .8 13H8.2L9 7" };
  if (type === "chat_message") return { tone: "bg-violet-100 text-violet-600", path: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" };
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

function Topbar() {
  const { toggleCollapsed, setMobileOpen, user } = useClient();
  const initials = (user.name || user.email).slice(0, 1).toUpperCase();
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
      <button onClick={toggleCollapsed} className="hidden h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:flex" aria-label="Toggle sidebar">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" /></svg>
      </button>
      <button onClick={() => setMobileOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" /></svg>
      </button>
      <div className="text-sm font-semibold text-slate-500">Welcome back, <span className="text-slate-900">{user.name || "Client Admin"}</span></div>
      <div className="ml-auto flex items-center gap-2">
        <NotificationBell />
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-sm font-bold text-white">{initials}</span>
      </div>
    </header>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { collapsed, branding } = useClient();

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
  const style = brandCssVars(branding.brand_color);

  // Mirror the brand scale + density onto the document root while the client
  // panel is mounted, so the *window* scrollbar (which belongs to the root, not
  // the .client-shell div) can also adopt the brand colour. Cleared on unmount
  // so the super-admin / staff panels keep the neutral scrollbar.
  useEffect(() => {
    const root = document.documentElement;
    const vars = brandCssVars(branding.brand_color) as Record<string, string>;
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.style.setProperty("--scrollbar-size", branding.density === "compact" ? "10px" : "13px");
    root.dataset.clientPanel = dark ? "dark" : "light";
    return () => {
      Object.keys(vars).forEach((k) => root.style.removeProperty(k));
      root.style.removeProperty("--scrollbar-size");
      delete root.dataset.clientPanel;
    };
  }, [branding.brand_color, branding.density, dark]);

  return (
    <div
      className={`client-shell min-h-screen bg-slate-50 ${dark ? "dark" : ""}`}
      data-density={branding.density}
      data-sidebar={branding.sidebar_style}
      style={style}
    >
      <ClientSidebar />
      <div className={`transition-all duration-300 ${collapsed ? "lg:ml-20" : "lg:ml-64"}`}>
        <Topbar />
        <main className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>
      </div>
      <ChatLauncher area="client" />
    </div>
  );
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [user, setUser] = useState<ClientUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/auth/me`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return;
        if (data.user?.role !== "client_admin" && data.user?.role !== "staff") {
          toast.error("Client access required.", { title: "Access denied" });
          router.replace("/login");
          return;
        }
        setUser(data.user);
      })
      .catch(() => { if (!cancelled) router.replace("/login"); })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-400">
        <svg className="h-8 w-8 animate-spin text-emerald-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>
      </div>
    );
  }

  return (
    <ClientProvider user={user}>
      <Shell>{children}</Shell>
    </ClientProvider>
  );
}
