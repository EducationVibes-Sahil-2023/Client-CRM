"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStaff } from "./StaffContext";
import { MODULE_META } from "./modules";

export default function StaffSidebar() {
  const { me, collapsed, mobileOpen, setMobileOpen, logout, permissions } = useStaff();
  const pathname = usePathname();
  const initials = (me.user.name || me.user.email || "S").slice(0, 1).toUpperCase();
  const chatActive = pathname?.startsWith("/staff/chat") ?? false;
  const annActive = pathname?.startsWith("/staff/announcements") ?? false;

  // Modules the staff can view (excluding dashboard, which is always shown).
  const allowed = me.modules.filter((m) => m !== "dashboard" && permissions[m]?.view);

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200 bg-white transition-all duration-300 ${collapsed ? "w-20" : "w-64"} ${mobileOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}>
        <div className="flex h-16 items-center gap-3 px-5">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-lg shadow-sky-500/30">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path d="M3 3v18h18M9 17V9m4 8V5m4 12v-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          {!collapsed && <div className="leading-tight"><div className="font-bold text-slate-900">{me.client?.name ?? "Workspace"}</div><div className="text-xs text-slate-400">Staff Portal</div></div>}
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          <Link
            href="/staff"
            onClick={() => setMobileOpen(false)}
            className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${pathname === "/staff" ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-100"} ${collapsed ? "justify-center" : ""}`}
          >
            {pathname === "/staff" && <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-sky-600" />}
            <svg className={`h-5 w-5 flex-shrink-0 ${pathname === "/staff" ? "text-sky-600" : "text-slate-400 group-hover:text-slate-600"}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={MODULE_META.dashboard.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
            {!collapsed && "Dashboard"}
          </Link>

          {/* Chat is available to every staff member (team room + direct messages). */}
          <Link
            href="/staff/chat"
            onClick={() => setMobileOpen(false)}
            title={collapsed ? "Chat" : undefined}
            className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${chatActive ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-100"} ${collapsed ? "justify-center" : ""}`}
          >
            {chatActive && <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-sky-600" />}
            <svg className={`h-5 w-5 flex-shrink-0 ${chatActive ? "text-sky-600" : "text-slate-400 group-hover:text-slate-600"}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={MODULE_META.chat.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
            {!collapsed && "Chat"}
          </Link>

          {/* Announcements — broadcast to every staff member (targeted server-side). */}
          <Link
            href="/staff/announcements"
            onClick={() => setMobileOpen(false)}
            title={collapsed ? "Announcements" : undefined}
            className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${annActive ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-100"} ${collapsed ? "justify-center" : ""}`}
          >
            {annActive && <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-sky-600" />}
            <svg className={`h-5 w-5 flex-shrink-0 ${annActive ? "text-sky-600" : "text-slate-400 group-hover:text-slate-600"}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={MODULE_META.announcements.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
            {!collapsed && "Announcements"}
          </Link>

          {allowed.length > 0 && (
            <>
              {!collapsed && <div className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Your access</div>}
              {collapsed && <div className="my-3 border-t border-slate-100" />}
              {allowed.map((m) => {
                const meta = MODULE_META[m] ?? { label: m, icon: MODULE_META.dashboard.icon };
                // Pages for individual modules aren't part of the staff portal yet,
                // so these anchor to the matching dashboard section.
                return (
                  <a
                    key={m}
                    href={`/staff#mod-${m}`}
                    onClick={() => setMobileOpen(false)}
                    title={collapsed ? meta.label : undefined}
                    className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 ${collapsed ? "justify-center" : ""}`}
                  >
                    <svg className="h-5 w-5 flex-shrink-0 text-slate-400 group-hover:text-slate-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={meta.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
                    {!collapsed && <span className="truncate">{meta.label}</span>}
                  </a>
                );
              })}
            </>
          )}
        </nav>

        <div className="border-t border-slate-100 p-3">
          <div className={`flex items-center gap-3 px-2 py-2 ${collapsed ? "justify-center" : ""}`}>
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-blue-600 text-sm font-bold text-white">{initials}</span>
            {!collapsed && <div className="min-w-0 leading-tight"><div className="truncate text-sm font-semibold text-slate-800">{me.user.name}</div><div className="truncate text-xs text-slate-400">Staff</div></div>}
          </div>
          <button onClick={logout} title={collapsed ? "Sign out" : undefined} className={`mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-600 ${collapsed ? "justify-center" : ""}`}>
            <svg className="h-5 w-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {!collapsed && "Sign out"}
          </button>
        </div>
      </aside>
    </>
  );
}
