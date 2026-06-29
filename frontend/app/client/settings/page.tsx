"use client";

import Link from "next/link";
import { PageHeader, Card } from "../../admin/ui";

const links = [
  { href: "/client/appearance", title: "Appearance & Branding", desc: "Brand colour, logo, menu order, theme & density", icon: "M12 2a10 10 0 100 20 2 2 0 002-2 2 2 0 00-.5-1.3 2 2 0 01-.5-1.2 2 2 0 012-2H19a3 3 0 003-3 8 8 0 00-8-8zM6.5 12a1 1 0 110-2 1 1 0 010 2zm3-4a1 1 0 110-2 1 1 0 010 2zm5 0a1 1 0 110-2 1 1 0 010 2z" },
  { href: "/client/roles", title: "Roles & Permissions", desc: "Define roles and CRUD access per module", icon: "M12 11a3 3 0 100-6 3 3 0 000 6zM4 21v-2a4 4 0 014-4h8a4 4 0 014 4v2" },
  { href: "/client/team", title: "Team & staff", desc: "Manage staff and the reporting hierarchy", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2" },
  { href: "/client/lead-statuses", title: "Lead statuses", desc: "Pipeline stages with colors and order", icon: "M3 6h18M3 6l2 13a1 1 0 001 1h12a1 1 0 001-1l2-13" },
  { href: "/client/email-config", title: "Email setup", desc: "Connect email for sending & alerts", icon: "M3 8l9 6 9-6M3 8v10a2 2 0 002 2h14a2 2 0 002-2V8M3 8l9-5 9 5" },
  { href: "/client/announcements", title: "Announcements", desc: "Broadcast updates to the team", icon: "M11 5L6 9H2v6h4l5 4V5z" },
  { href: "/client/activity", title: "Activity log", desc: "Audit trail of actions", icon: "M22 12h-4l-3 9L9 3l-3 9H2" },
];

export default function ClientSettingsPage() {
  return (
    <>
      <PageHeader title="Dashboard Configuration" subtitle="Set up and configure your CRM workspace" />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => (
          <Link key={l.href} href={l.href}>
            <Card className="h-full transition hover:-translate-y-1 hover:border-emerald-200 hover:shadow-lg">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={l.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <h3 className="mt-3 font-semibold text-slate-900">{l.title}</h3>
              <p className="mt-1 text-sm text-slate-500">{l.desc}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
