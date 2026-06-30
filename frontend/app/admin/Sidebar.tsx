"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAdmin } from "./AdminContext";

const icons: Record<string, string> = {
  dashboard: "M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 14h7v5H4z",
  demo: "M15 10l4.5-2.5v9L15 14M4 6h9a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z",
  contact: "M3 8l9 6 9-6M3 8v10a2 2 0 002 2h14a2 2 0 002-2V8M3 8l9-5 9 5",
  inbox: "M3 13h4l2 3h6l2-3h4M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z",
  chat: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  notifications: "M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
  activity: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  calendar: "M8 3v4M16 3v4M4 9h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z",
  landing: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2zM9 22V12h6v10",
  plans: "M3 10h18M7 15h2M3 6h18a0 0 0 010 0v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6z",
  reviews: "M11 3l2.5 5 5.5.8-4 3.9 1 5.5L11 21l-5-2.9 1-5.5-4-3.9 5.5-.8z",
  clients: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8z",
  database: "M4 6c0-1.66 3.58-3 8-3s8 1.34 8 3-3.58 3-8 3-8-1.34-8-3zM4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6",
  settings: "M10.3 4.3a2 2 0 013.4 0l.5.9 1-.2a2 2 0 012.4 2.4l-.2 1 .9.5a2 2 0 010 3.4l-.9.5.2 1a2 2 0 01-2.4 2.4l-1-.2-.5.9a2 2 0 01-3.4 0l-.5-.9-1 .2a2 2 0 01-2.4-2.4l.2-1-.9-.5a2 2 0 010-3.4l.9-.5-.2-1a2 2 0 012.4-2.4l1 .2z",
  profile: "M20 21a8 8 0 10-16 0M12 11a4 4 0 100-8 4 4 0 000 8z",
};

const mainNav = [
  { href: "/admin", label: "Overview", icon: "dashboard", exact: true },
  { href: "/admin/activity", label: "Activity", icon: "activity" },
  { href: "/admin/inbox", label: "Inbox", icon: "inbox" },
  { href: "/admin/demo-requests", label: "Demo Requests", icon: "demo" },
  { href: "/admin/contact-requests", label: "Contact Requests", icon: "contact" },
  { href: "/admin/calendar", label: "Calendar", icon: "calendar" },
  { href: "/admin/chat", label: "Chat", icon: "chat" },
  { href: "/admin/notifications", label: "Notifications", icon: "notifications" },
  { href: "/admin/clients", label: "Clients", icon: "clients" },
  { href: "/admin/database", label: "Database", icon: "database" },
];

const adminNav = [
  { href: "/admin/landing", label: "Landing Page", icon: "landing" },
  { href: "/admin/plans", label: "Plans", icon: "plans" },
  { href: "/admin/reviews", label: "Reviews", icon: "reviews" },
  { href: "/admin/integrations", label: "Email Inbox", icon: "contact" },
  { href: "/admin/settings", label: "Settings", icon: "settings" },
];

export default function Sidebar() {
  const { collapsed, mobileOpen, setMobileOpen, user, logout } = useAdmin();
  const pathname = usePathname();

  const initials = (user?.name || user?.email || "A").slice(0, 1).toUpperCase();

  const Item = ({ item }: { item: (typeof mainNav)[number] }) => {
    const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
    return (
      <Link
        href={item.href}
        title={collapsed ? item.label : undefined}
        onClick={() => setMobileOpen(false)}
        className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
          active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100"
        } ${collapsed ? "justify-center" : ""}`}
      >
        {active && <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-indigo-600" />}
        <svg className={`anim-ico h-5 w-5 flex-shrink-0 ${active ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-600"}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d={icons[item.icon]} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    );
  };

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200 bg-white transition-all duration-300 ${
          collapsed ? "w-20" : "w-64"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 px-5">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path d="M3 3v18h18M9 17V9m4 8V5m4 12v-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          {!collapsed && (
            <div className="leading-tight">
              <div className="font-bold text-slate-900">LeadFlow</div>
              <div className="text-xs text-slate-400">Admin Suite</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="no-scrollbar flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {mainNav.map((item) => <Item key={item.href} item={item} />)}

          {!collapsed && (
            <div className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Admin
            </div>
          )}
          {collapsed && <div className="my-3 border-t border-slate-100" />}
          {adminNav.map((item) => <Item key={item.href} item={item} />)}
        </nav>

        {/* User card */}
        <div className="border-t border-slate-100 p-3">
          <div className={`flex items-center gap-3 rounded-lg px-2 py-2 ${collapsed ? "justify-center" : ""}`}>
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white">
              {initials}
            </span>
            {!collapsed && (
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-sm font-semibold text-slate-800">{user?.name || "Super Admin"}</div>
                <div className="truncate text-xs text-slate-400">Admin</div>
              </div>
            )}
          </div>
          <button
            onClick={logout}
            title={collapsed ? "Sign out" : undefined}
            className={`mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-600 ${collapsed ? "justify-center" : ""}`}
          >
            <svg className="h-5 w-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {!collapsed && "Sign out"}
          </button>
        </div>
      </aside>
    </>
  );
}
