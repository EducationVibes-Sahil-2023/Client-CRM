"use client";

import Link from "next/link";
import { PageHeader, Card } from "../ui";

const links = [
  { href: "/admin/profile", title: "Profile & security", desc: "Update your name, email, photo and password", icon: "M20 21a8 8 0 10-16 0M12 11a4 4 0 100-8 4 4 0 000 8z" },
  { href: "/admin/integrations", title: "Email inbox", desc: "Connect a Gmail account for the admin Inbox", icon: "M3 8l9 6 9-6M3 8v10a2 2 0 002 2h14a2 2 0 002-2V8M3 8l9-5 9 5" },
  { href: "/admin/landing", title: "Landing page", desc: "Brand, logo and public site content", icon: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2zM9 22V12h6v10" },
  { href: "/admin/plans", title: "Plans & subscription", desc: "Pricing plans shown to visitors", icon: "M3 10h18M3 6h18v12a2 2 0 01-2 2H5a2 2 0 01-2-2z" },
  { href: "/admin/reviews", title: "Customer reviews", desc: "Testimonials on your landing page", icon: "M11 3l2.5 5 5.5.8-4 3.9 1 5.5L11 21l-5-2.9 1-5.5-4-3.9 5.5-.8z" },
  { href: "/admin/calendar", title: "Calendar", desc: "Demos, reminders and meetings", icon: "M8 3v4M16 3v4M4 9h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" },
  { href: "/admin/clients", title: "Clients", desc: "Tenant organizations", icon: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8z" },
];

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Manage your platform configuration" />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => (
          <Link key={l.href} href={l.href}>
            <Card className="h-full transition hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
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
