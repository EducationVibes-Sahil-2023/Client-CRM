"use client";

import { useEffect, useState } from "react";
import {
  getBackupSettings,
  saveBackupSettings,
  runBackupNow,
  downloadBackupFile,
  type BackupSettings,
  type BackupFile,
} from "../../lib/admin";
import { useToast } from "../../components/toast/ToastProvider";

const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const FREQ_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

/** Super-admin panel: configure scheduled backups + run/download stored ones. */
export default function AutoBackupPanel() {
  const toast = useToast();
  const [cfg, setCfg] = useState<BackupSettings | null>(null);
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    getBackupSettings()
      .then((d) => { setCfg(d.settings); setFiles(d.files); })
      .catch(() => toast.error("Could not load backup settings."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = <K extends keyof BackupSettings>(k: K, v: BackupSettings[K]) => setCfg((c) => (c ? { ...c, [k]: v } : c));

  async function save() {
    if (!cfg) return;
    setSaving(true);
    try {
      const d = await saveBackupSettings(cfg);
      setCfg(d.settings); setFiles(d.files);
      toast.success("Backup schedule saved.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
    finally { setSaving(false); }
  }

  async function runNow() {
    setRunning(true);
    try {
      const d = await runBackupNow(cfg?.scope);
      setCfg(d.settings); setFiles(d.files);
      if (d.errors?.length) toast.warning(`Backup finished with issues: ${d.status}`);
      else toast.success(`Backup complete — ${d.status}.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Backup failed"); }
    finally { setRunning(false); }
  }

  async function download(name: string) {
    setDownloading(name);
    try { await downloadBackupFile(name); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Download failed"); }
    finally { setDownloading(null); }
  }

  if (!cfg) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="h-32 animate-pulse rounded-lg bg-slate-100" /></div>;
  }

  const cron = "0 2 * * *  cd /path/to/backend && php spark backup:run >> writable/logs/backup.log 2>&1";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">Automatic backups</h3>
          <p className="mt-0.5 text-sm text-slate-500">Schedule for the <b>main</b> database (kept on the server). Each client sets their own DB schedule in their workspace. The scope below applies to “Run now”.</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => set("enabled", e.target.checked)} className="h-4 w-4 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
          <span className="font-medium text-slate-700">{cfg.enabled ? "Enabled" : "Disabled"}</span>
        </label>
      </div>

      {/* Schedule controls */}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Frequency</span>
          <select value={cfg.frequency} onChange={(e) => set("frequency", e.target.value as BackupSettings["frequency"])} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15">
            {(["daily", "weekly", "monthly"] as const).map((f) => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Keep for (days)</span>
          <input type="number" min={1} max={365} value={cfg.retention_days} onChange={(e) => set("retention_days", Number(e.target.value))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Scope</span>
          <select value={cfg.scope} onChange={(e) => set("scope", e.target.value as BackupSettings["scope"])} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15">
            <option value="all">Main + all client DBs</option>
            <option value="main">Main DB only</option>
          </select>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? "Saving…" : "Save schedule"}</button>
        <button onClick={runNow} disabled={running} className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">
          <svg className={`h-4 w-4 ${running ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 2v6h-6M3 12a9 9 0 0115-6.7L21 8M3 22v-6h6M21 12a9 9 0 01-15 6.7L3 16" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {running ? "Backing up…" : "Run now"}
        </button>
        <span className="text-xs text-slate-400">
          {cfg.last_run ? <>Last run: <b className="text-slate-600">{cfg.last_run}</b>{cfg.last_status ? ` · ${cfg.last_status}` : ""}</> : "Never run yet"}
        </span>
      </div>

      {/* Cron hint */}
      <div className="mt-4 rounded-lg bg-slate-900 px-3 py-2.5 text-[11px] text-slate-300">
        <div className="mb-1 font-semibold text-slate-400">Add this to your server crontab (runs daily; the schedule above decides when it actually backs up):</div>
        <code className="block overflow-x-auto whitespace-pre font-mono text-emerald-300">{cron}</code>
      </div>

      {/* Stored files */}
      <div className="mt-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Stored backups ({files.length})</div>
        {files.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">No backups on disk yet. Click “Run now” or wait for the schedule.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {files.map((f) => (
              <li key={f.name} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <svg className="h-4 w-4 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700">{f.name}</span>
                <span className="flex-shrink-0 text-xs text-slate-400">{fmtBytes(f.size)}</span>
                <span className="hidden flex-shrink-0 text-xs text-slate-400 sm:block">{f.created}</span>
                <button onClick={() => download(f.name)} disabled={downloading === f.name} className="flex-shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                  {downloading === f.name ? "…" : "Download"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
