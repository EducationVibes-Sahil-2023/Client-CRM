"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader, Card } from "../../admin/ui";
import { useClient } from "../ClientContext";
import { useToast } from "../../components/toast/ToastProvider";
import { getBackupSchedule, saveBackupSchedule, type BackupSchedule } from "../../lib/client";

const links = [
  { href: "/client/appearance", title: "Appearance & Branding", desc: "Brand colour, logo, menu order, theme & density", icon: "M12 2a10 10 0 100 20 2 2 0 002-2 2 2 0 00-.5-1.3 2 2 0 01-.5-1.2 2 2 0 012-2H19a3 3 0 003-3 8 8 0 00-8-8zM6.5 12a1 1 0 110-2 1 1 0 010 2zm3-4a1 1 0 110-2 1 1 0 010 2zm5 0a1 1 0 110-2 1 1 0 010 2z" },
  { href: "/client/roles", title: "Roles & Permissions", desc: "Define roles and CRUD access per module", icon: "M12 11a3 3 0 100-6 3 3 0 000 6zM4 21v-2a4 4 0 014-4h8a4 4 0 014 4v2" },
  { href: "/client/team", title: "Team & staff", desc: "Manage staff and the reporting hierarchy", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2" },
  { href: "/client/lead-statuses", title: "Lead statuses", desc: "Pipeline stages with colors and order", icon: "M3 6h18M3 6l2 13a1 1 0 001 1h12a1 1 0 001-1l2-13" },
  { href: "/client/email-config", title: "Email setup", desc: "Connect email for sending & alerts", icon: "M3 8l9 6 9-6M3 8v10a2 2 0 002 2h14a2 2 0 002-2V8M3 8l9-5 9 5" },
  { href: "/client/announcements", title: "Announcements", desc: "Broadcast updates to the team", icon: "M11 5L6 9H2v6h4l5 4V5z" },
  { href: "/client/activity", title: "Activity log", desc: "Audit trail of actions", icon: "M22 12h-4l-3 9L9 3l-3 9H2" },
];

const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";
const hourLabel = (h: number) => `${(h % 12) || 12}:00 ${h < 12 ? "AM" : "PM"}`;

export default function ClientSettingsPage() {
  const { hasFeature, isAdmin } = useClient();
  const toast = useToast();
  const showBackup = isAdmin && hasFeature("backup");

  const [sched, setSched] = useState<BackupSchedule | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!showBackup) return;
    getBackupSchedule().then((d) => setSched(d.schedule)).catch(() => {});
  }, [showBackup]);

  const set = <K extends keyof BackupSchedule>(k: K, v: BackupSchedule[K]) => setSched((s) => (s ? { ...s, [k]: v } : s));

  async function save() {
    if (!sched) return;
    setSaving(true);
    try {
      const d = await saveBackupSchedule(sched);
      setSched(d.schedule);
      toast.success("Backup schedule saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

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

      {/* Database backup schedule — only when the super admin has granted 'backup'.
          Clients choose WHEN their database is backed up; the backups run on the
          server and are managed by the platform admin (no direct download here). */}
      {showBackup && sched && (
        <Card className="mt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <div>
                <h3 className="font-semibold text-slate-900">Automatic database backup</h3>
                <p className="mt-1 text-sm text-slate-500">Choose how often and when your workspace data is backed up. Backups are kept securely on the server.</p>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <input type="checkbox" checked={sched.enabled} onChange={(e) => set("enabled", e.target.checked)} className="h-4 w-4 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
              <span className="font-medium text-slate-700">{sched.enabled ? "Enabled" : "Disabled"}</span>
            </label>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-600">Frequency</span>
              <select value={sched.frequency} onChange={(e) => set("frequency", e.target.value as BackupSchedule["frequency"])} className={inputCls}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-600">Time of day</span>
              <select value={sched.hour} onChange={(e) => set("hour", Number(e.target.value))} className={inputCls}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-600">Keep backups for (days)</span>
              <input type="number" min={1} max={365} value={sched.retention_days} onChange={(e) => set("retention_days", Number(e.target.value))} className={inputCls} />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? "Saving…" : "Save schedule"}</button>
            <span className="text-xs text-slate-400">
              {sched.last_run ? <>Last backup: <b className="text-slate-600">{sched.last_run}</b></> : "No backup has run yet"}
            </span>
          </div>
        </Card>
      )}
    </>
  );
}
