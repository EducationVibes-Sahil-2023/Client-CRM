"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAdmin } from "./AdminContext";
import { API_URL } from "../lib/api";
import type { NotificationItem } from "../lib/admin";
import { timeAgo } from "../lib/datetime";

function useClickOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return ref;
}

export default function Topbar() {
  const {
    user,
    toggleCollapsed,
    setMobileOpen,
    notifications,
    dismissNotification,
    clearAllNotifications,
    logout,
  } = useAdmin();
  const router = useRouter();
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const notifRef = useClickOutside(() => setNotifOpen(false));
  const profileRef = useClickOutside(() => setProfileOpen(false));

  const initials = (user?.name || user?.email || "A").slice(0, 1).toUpperCase();

  function openNotification(n: NotificationItem) {
    dismissNotification(n);
    setNotifOpen(false);
    router.push(n.type === "demo" ? "/admin/demo-requests" : "/admin/contact-requests");
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
      <button onClick={toggleCollapsed} className="hidden h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:flex" aria-label="Toggle sidebar">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" /></svg>
      </button>
      <button onClick={() => setMobileOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" /></svg>
      </button>

      {/* Search */}
      <div className="relative flex-1 max-w-xl">
        <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
        <input
          placeholder="Search…"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-14 text-sm text-slate-700 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-400 sm:flex">
          ⌘K
        </kbd>
      </div>

      <div className="ml-auto flex items-center gap-1">
        {/* Public site / docs */}
        <Link href="/" target="_blank" title="View public site" className="hidden h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 sm:flex">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </Link>

        {/* Notifications */}
        <div ref={notifRef} className="relative">
          <button onClick={() => setNotifOpen((o) => !o)} className="relative flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100" aria-label="Notifications">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {notifications.length > 0 && (
              <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {notifications.length > 9 ? "9+" : notifications.length}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="animate-fade-up absolute right-0 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <span className="font-semibold text-slate-900">Notifications</span>
                {notifications.length > 0 && (
                  <button onClick={clearAllNotifications} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Mark all read</button>
                )}
              </div>
              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-slate-400">
                    <svg className="h-8 w-8 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    You&apos;re all caught up
                  </div>
                ) : (
                  notifications.map((n) => (
                    <button key={`${n.type}-${n.id}`} onClick={() => openNotification(n)} className="flex w-full items-start gap-3 border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50">
                      <span className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${n.type === "demo" ? "bg-indigo-100 text-indigo-600" : "bg-emerald-100 text-emerald-600"}`}>
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={n.type === "demo" ? "M15 10l4.5-2.5v9L15 14M4 6h9a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" : "M3 8l9 6 9-6M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z"} strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-900">{n.title}</span>
                        <span className="block truncate text-xs text-slate-500">{n.name} · {n.email}</span>
                        <span className="mt-0.5 block text-[11px] text-slate-400">{timeAgo(n.created_at)}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Profile chip */}
        <div ref={profileRef} className="relative ml-1">
          <button onClick={() => setProfileOpen((o) => !o)} className="flex items-center gap-2 rounded-xl border border-slate-200 py-1 pl-1 pr-2.5 transition hover:bg-slate-50">
            {user?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${API_URL}${user.avatar}`} alt="" className="h-8 w-8 rounded-lg object-cover" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white">{initials}</span>
            )}
            <span className="hidden max-w-32 truncate text-sm font-semibold text-slate-700 sm:block">{user?.name || "Super Admin"}</span>
            <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>

          {profileOpen && (
            <div className="animate-fade-up absolute right-0 mt-2 w-60 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="font-semibold text-slate-900">{user?.name || "Super Admin"}</div>
                <div className="truncate text-xs text-slate-500">{user?.email}</div>
                <span className="mt-1.5 inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600">Super Admin</span>
              </div>
              <div className="p-1.5">
                <Link href="/admin/profile" onClick={() => setProfileOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 21a8 8 0 10-16 0M12 11a4 4 0 100-8 4 4 0 000 8z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  My Profile
                </Link>
                <Link href="/admin/settings" onClick={() => setProfileOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-2.82 1.17V21a2 2 0 01-4 0v-.09A1.65 1.65 0 007 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 14a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 7.6l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6h.09A1.65 1.65 0 0010 3.09V3a2 2 0 014 0v.09A1.65 1.65 0 0017 4.6l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Settings
                </Link>
                <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Log out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
