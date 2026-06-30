"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useClient } from "./ClientContext";
import { API_URL } from "../lib/api";
import { resolveLogoSize } from "../lib/theme";

export const icons: Record<string, string> = {
  dashboard: "M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 14h7v5H4z",
  leads: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8z",
  calls: "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z",
  followups: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11M12 8v4l3 2",
  team: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2M17 11h4m-2-2v4",
  roles: "M12 11a3 3 0 100-6 3 3 0 000 6zM4 21v-2a4 4 0 014-4h8a4 4 0 014 4v2M12 1l2.5 2.5L12 6 9.5 3.5z",
  tasks: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
  announcements: "M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 010 7M18 6a8 8 0 010 12",
  chat: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  notifications: "M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
  statuses: "M3 6h18M3 6l2 13a1 1 0 001 1h12a1 1 0 001-1l2-13M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2",
  email: "M3 8l9 6 9-6M3 8v10a2 2 0 002 2h14a2 2 0 002-2V8M3 8l9-5 9 5",
  config: "M10.3 4.3a2 2 0 013.4 0l.5.9 1-.2a2 2 0 012.4 2.4l-.2 1 .9.5a2 2 0 010 3.4l-.9.5.2 1a2 2 0 01-2.4 2.4l-1-.2-.5.9a2 2 0 01-3.4 0l-.5-.9-1 .2a2 2 0 01-2.4-2.4l.2-1-.9-.5a2 2 0 010-3.4l.9-.5-.2-1a2 2 0 012.4-2.4l1 .2z",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  reports: "M4 19V5m0 14h16M8 17v-5m4 5V8m4 9v-7",
  formsetup: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  assets: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-14L4 7m8 4v10M4 7v10l8 4",
  billing: "M3 10h18M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2zM7 15h3",
  departments: "M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01",
  office: "M3 21h18M5 21V5a2 2 0 012-2h6a2 2 0 012 2v16M17 21V9h2a2 2 0 012 2v10M9 7h2M9 11h2M9 15h2",
  orgchart: "M9 3h6v4H9zM3 17h6v4H3zm12 0h6v4h-6zM12 7v4M6 17v-2a1 1 0 011-1h10a1 1 0 011 1v2",
  palette: "M12 2a10 10 0 100 20 2 2 0 002-2 2 2 0 00-.5-1.3 2 2 0 01-.5-1.2 2 2 0 012-2H19a3 3 0 003-3 8 8 0 00-8-8zM6.5 12a1 1 0 110-2 1 1 0 010 2zm3-4a1 1 0 110-2 1 1 0 010 2zm5 0a1 1 0 110-2 1 1 0 010 2z",
  docs: "M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15zM9 7h7M9 11h7",
};

export interface NavItem {
  key: string;
  href: string;
  label: string;
  icon: string;
  exact?: boolean;
  feature?: string;
  /** Hidden from staff unless they have `view` on this permission module. */
  module?: string;
  /** Only the client admin sees this item (never staff). */
  adminOnly?: boolean;
}

// `feature` (when set) gates the item against the client's plan features.
// `key` is the stable id used for menu sequencing (branding.menu_order).
export const MAIN_NAV: NavItem[] = [
  { key: "dashboard", href: "/client", label: "Dashboard", icon: "dashboard", exact: true },
  { key: "leads", href: "/client/leads", label: "Leads", icon: "leads", feature: "leads", module: "leads" },
  { key: "calls", href: "/client/calls", label: "Call Tracking", icon: "calls", feature: "call_tracking", module: "calls" },
  { key: "followups", href: "/client/followups", label: "Follow Up Tracker", icon: "followups", feature: "followups", module: "followups" },
  { key: "team", href: "/client/team", label: "Team", icon: "team", feature: "team", module: "team" },
  { key: "org-chart", href: "/client/org-chart", label: "Org Chart", icon: "orgchart", feature: "team", module: "team" },
  { key: "assets", href: "/client/assets", label: "Assets", icon: "assets", feature: "assets", module: "assets" },
  { key: "tasks", href: "/client/tasks", label: "Task Management", icon: "tasks", feature: "tasks", module: "tasks" },
  { key: "reports", href: "/client/reports", label: "Reports", icon: "reports", feature: "reports", module: "reports" },
  { key: "announcements", href: "/client/announcements", label: "Announcements", icon: "announcements", feature: "announcements", module: "announcements" },
  { key: "chat", href: "/client/chat", label: "Chat", icon: "chat", feature: "chat", module: "chat" },
  { key: "notifications", href: "/client/notifications", label: "Notifications", icon: "notifications" },
  { key: "activity", href: "/client/activity", label: "Activity", icon: "activity" },
  { key: "docs", href: "/client/docs", label: "Documentation", icon: "docs" },
];

/** Reorder nav items by a saved list of keys; unlisted items keep default order at the end. */
export function orderNav(items: NavItem[], order: string[]): NavItem[] {
  if (!order || order.length === 0) return items;
  const byKey = new Map(items.map((i) => [i.key, i]));
  const seen = new Set<string>();
  const out: NavItem[] = [];
  for (const k of order) {
    const it = byKey.get(k);
    if (it && !seen.has(k)) { out.push(it); seen.add(k); }
  }
  for (const it of items) if (!seen.has(it.key)) out.push(it);
  return out;
}

export const setupNav: NavItem[] = [
  { key: "billing", href: "/client/billing", label: "Billing", icon: "billing", feature: "billing", adminOnly: true },
  { key: "roles", href: "/client/roles", label: "Roles & Permissions", icon: "roles", feature: "roles", module: "roles" },
  { key: "departments", href: "/client/departments", label: "Departments", icon: "departments", feature: "team", module: "team" },
  { key: "office-locations", href: "/client/office-locations", label: "Office Locations", icon: "office", feature: "team", module: "team" },
  { key: "leads-setup", href: "/client/leads-setup", label: "Leads Setup", icon: "statuses", feature: "leads", module: "leads_setup" },
  { key: "form-setup", href: "/client/form-setup", label: "Form Setup", icon: "formsetup", adminOnly: true },
  { key: "email-config", href: "/client/email-config", label: "Email Setup", icon: "email", feature: "email_config", adminOnly: true },
  { key: "appearance", href: "/client/appearance", label: "Appearance", icon: "palette", adminOnly: true },
  { key: "settings", href: "/client/settings", label: "Dashboard Config", icon: "config", adminOnly: true },
];

export default function ClientSidebar() {
  const { collapsed, mobileOpen, setMobileOpen, user, hasFeature, branding, can, isAdmin, featuresLoaded, permissionsLoaded } = useClient();
  const pathname = usePathname();
  const initials = (user.name || user.email || "C").slice(0, 1).toUpperCase();
  const solid = branding.sidebar_style === "solid";

  // Hide nav entries the user can't reach: plan feature off, admin-only (for
  // staff), or a permission module the staff member has no `view` on.
  // Gated items stay hidden until their source data has loaded, so a restricted
  // item is never briefly shown then hidden — we reveal only once confirmed.
  const gate = (items: NavItem[]) =>
    items.filter((i) =>
      (!i.feature || (featuresLoaded && hasFeature(i.feature)))
      && (!i.adminOnly || (permissionsLoaded && isAdmin))
      && (!i.module || (permissionsLoaded && can(i.module, "view"))),
    );

  const Item = ({ item }: { item: NavItem }) => {
    const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
    const activeCls = solid ? "bg-emerald-600 text-white shadow-sm shadow-emerald-600/30" : "bg-emerald-50 text-emerald-700";
    const iconCls = active ? (solid ? "text-white" : "text-emerald-600") : "text-slate-400 group-hover:text-slate-600";
    // Admin overrides (Appearance → Menu): custom label + icon per nav key.
    const label = branding.menu_labels?.[item.key] || item.label;
    const iconPath = icons[branding.menu_icons?.[item.key] ?? ""] ?? icons[item.icon];
    return (
      <Link
        href={item.href}
        title={collapsed ? label : undefined}
        onClick={() => setMobileOpen(false)}
        className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${active ? activeCls : "text-slate-600 hover:bg-slate-100"} ${collapsed ? "justify-center" : ""}`}
      >
        {active && !solid && <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-emerald-600" />}
        <svg className={`anim-ico h-5 w-5 flex-shrink-0 ${iconCls}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={iconPath} strokeLinecap="round" strokeLinejoin="round" /></svg>
        {!collapsed && <span className="truncate">{label}</span>}
      </Link>
    );
  };

  const logoSrc = branding.logo_url
    ? (branding.logo_url.startsWith("http") ? branding.logo_url : `${API_URL}${branding.logo_url}`)
    : "";

  // Configured logo box — `object-contain` keeps wide/short logos un-cropped.
  // While the rail is collapsed (w-20) cap the width so it still fits.
  const logoSize = resolveLogoSize(branding.logo_width, branding.logo_height);
  const logoBoxW = collapsed ? Math.min(logoSize.width, 44) : logoSize.width;

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200 bg-white transition-all duration-300 ${collapsed ? "w-20" : "w-64"} ${mobileOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}>
        <div className="flex h-16 items-center gap-3 px-5">
          {logoSrc ? (
            <img src={logoSrc} alt={branding.app_name} className="flex-shrink-0 rounded-xl object-contain" style={{ width: logoBoxW, height: logoSize.height }} />
          ) : (
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path d="M3 3v18h18M9 17V9m4 8V5m4 12v-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
          )}
          {!collapsed && <div className="min-w-0 leading-tight"><div className="truncate font-bold text-slate-900">{branding.app_name}</div>{branding.app_tagline && <div className="truncate text-xs text-slate-400">{branding.app_tagline}</div>}</div>}
        </div>

        <nav className="no-scrollbar flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {gate(orderNav(MAIN_NAV, branding.menu_order)).map((i) => <Item key={i.key} item={i} />)}
          {(() => {
            const setup = gate(setupNav);
            if (setup.length === 0) return null;
            return (
              <>
                {!collapsed && <div className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Setup</div>}
                {collapsed && <div className="my-3 border-t border-slate-100" />}
                {setup.map((i) => <Item key={i.key} item={i} />)}
              </>
            );
          })()}
        </nav>

        {/* Account (email + sign out) now lives in the top navbar user menu; this
            keeps a quick profile shortcut with the user's name. */}
        <div className="border-t border-slate-100 p-3">
          <Link
            href="/client/profile"
            title={collapsed ? "My Profile" : undefined}
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-slate-100 ${collapsed ? "justify-center" : ""} ${pathname.startsWith("/client/profile") ? "bg-slate-100" : ""}`}
          >
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-sm font-bold text-white">{initials}</span>
            {!collapsed && <div className="min-w-0 leading-tight"><div className="truncate text-sm font-semibold text-slate-800">{user.name || "Client Admin"}</div><div className="truncate text-xs text-slate-400">My Profile</div></div>}
          </Link>
        </div>
      </aside>
    </>
  );
}
