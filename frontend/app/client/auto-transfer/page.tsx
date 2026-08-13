"use client";

import { useEffect, useState } from "react";
import {
  getAutoTransferConfig,
  saveAutoTransferConfig,
  runAutoTransferNow,
  type AutoTransferRun,
} from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import { PageHeader, Card, SkeletonText } from "../../admin/ui";

type Opt = { id: number; name: string };

const btnPrimary = "rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60";
const btnGhost = "rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60";
const numCls = "w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

/** A labelled number input with a trailing unit + helper line. */
function NumberField({ label, unit, help, value, onChange }: { label: string; unit: string; help: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <input type="number" min={0} value={value} onChange={(e) => onChange(e.target.value)} className={numCls} />
        <span className="text-sm text-slate-600">{unit}</span>
      </div>
      <p className="mt-1 text-sm font-medium text-slate-700">{label}</p>
      <p className="text-xs text-slate-400">{help}</p>
    </div>
  );
}

/** A chip-style multi-select over a list of options (statuses / counsellors). */
function ChipPicker({ options, selected, onToggle, empty }: { options: Opt[]; selected: number[]; onToggle: (id: number) => void; empty: string }) {
  if (options.length === 0) return <p className="text-sm text-slate-400">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onToggle(o.id)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${on ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
          >
            {o.name}
          </button>
        );
      })}
    </div>
  );
}

function RunSummary({ res, dryRun }: { res: AutoTransferRun; dryRun: boolean }) {
  if (res.reason) {
    return <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-700">Nothing ran: {res.reason}</p>;
  }
  const verb = dryRun ? "would be transferred" : "transferred";
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Scanned <b>{res.scanned}</b> lead(s) — <b className="text-emerald-700">{res.transferred}</b> {verb}.
        {" "}Skipped: {res.skipped_calls} (enough calls), {res.skipped_updates} (too many updates), {res.skipped_cap} (transfer cap), {res.skipped_pool} (no counsellor).
      </p>
      {res.details.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
          {res.details.map((d) => (
            <li key={d.lead_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="truncate text-slate-700">{d.lead}</span>
              <span className="flex-shrink-0 text-slate-400">{d.from ?? "Unassigned"} <span className="text-slate-300">→</span> <span className="font-medium text-slate-600">{d.to}</span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AutoTransferPage() {
  const toast = useToast();
  const confirm = useConfirm();

  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState<Opt[]>([]);
  const [staff, setStaff] = useState<Opt[]>([]);

  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState("4");
  const [daysCreated, setDaysCreated] = useState("0");
  const [maxCalls, setMaxCalls] = useState("4");
  const [connectedOnly, setConnectedOnly] = useState(false);
  const [maxUpdates, setMaxUpdates] = useState("0");
  const [statusIds, setStatusIds] = useState<number[]>([]);
  const [maxTransfers, setMaxTransfers] = useState("3");
  const [targetIds, setTargetIds] = useState<number[]>([]);

  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runRes, setRunRes] = useState<{ res: AutoTransferRun; dryRun: boolean } | null>(null);

  useEffect(() => {
    getAutoTransferConfig()
      .then((d) => {
        setStatuses(d.statuses);
        setStaff(d.staff);
        const c = d.config;
        setEnabled(c.enabled);
        setDays(String(c.days_since_assigned));
        setDaysCreated(String(c.days_since_created));
        setMaxCalls(String(c.max_calls));
        setConnectedOnly(c.count_connected_only);
        setMaxUpdates(String(c.max_updates));
        setStatusIds(c.status_ids);
        setMaxTransfers(String(c.max_transfers));
        setTargetIds(c.target_staff_ids);
        setLoading(false);
      })
      .catch(() => {
        toast.error("Could not load auto-transfer settings.");
        setLoading(false);
      });
  }, [toast]);

  const toggle = (list: number[], set: (v: number[]) => void, id: number) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const payload = () => ({
    enabled,
    days_since_assigned: Math.max(0, Number(days) || 0),
    days_since_created: Math.max(0, Number(daysCreated) || 0),
    max_calls: Math.max(0, Number(maxCalls) || 0),
    count_connected_only: connectedOnly,
    max_updates: Math.max(0, Number(maxUpdates) || 0),
    status_ids: statusIds,
    max_transfers: Math.max(1, Number(maxTransfers) || 1),
    target_staff_ids: targetIds,
  });

  // Persist the current form. Returns false (and toasts) on validation/save error,
  // so Preview/Run can bail before touching any leads.
  async function persist(): Promise<boolean> {
    if (enabled && statusIds.length === 0) {
      toast.warning("Select at least one trigger status before enabling.");
      return false;
    }
    try {
      await saveAutoTransferConfig(payload());
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save settings.");
      return false;
    }
  }

  async function save() {
    setSaving(true);
    if (await persist()) toast.success("Auto-transfer settings saved.", { title: "Saved" });
    setSaving(false);
  }

  // Preview/Run always operate on what's on screen: save the form first, then the
  // backend applies the (now-saved) config — so the result matches the settings shown.
  async function run(dryRun: boolean) {
    if (statusIds.length === 0) {
      toast.warning("Select a trigger status first.");
      return;
    }
    if (!dryRun) {
      const ok = await confirm({
        title: "Run auto-transfer now?",
        message: "Your current settings will be saved, then matching leads are reassigned to another counsellor immediately. Continue?",
        confirmLabel: "Yes, transfer now",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
    }
    setRunning(true);
    setRunRes(null);
    try {
      if (!(await persist())) {
        setRunning(false);
        return;
      }
      const d = await runAutoTransferNow(dryRun);
      setRunRes({ res: d.result, dryRun });
      if (!dryRun) toast.success(`${d.result.transferred} lead(s) transferred.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not run auto-transfer.");
    }
    setRunning(false);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Auto Lead Transfer"
        subtitle="Automatically hand a lead to another counsellor when it goes cold — no response within your set window. A background job applies these rules; you can also run them on demand below."
      />

      {loading ? (
        <Card><SkeletonText lines={6} /></Card>
      ) : (
        <>
          <Card className="space-y-6">
            {/* Master switch */}
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
              <span>
                <span className="block text-sm font-semibold text-slate-800">Enable automatic transfers</span>
                <span className="block text-xs text-slate-400">When off, the cron skips this workspace. You can still use “Run now / Preview”.</span>
              </span>
            </label>

            <div className="grid gap-6 sm:grid-cols-3">
              <NumberField label="Wait after assignment" unit="days" help="Only transfer once the lead has sat this long with its current counsellor." value={days} onChange={setDays} />
              <NumberField label="Aged since created" unit="days" help="0 = ignore. Only leads created at least this many days ago qualify (e.g. 7 = a week old)." value={daysCreated} onChange={setDaysCreated} />
              <NumberField label="Fewer than this many calls" unit="calls" help="Transfer only if the assigned rep has dialled fewer than this since the assignment." value={maxCalls} onChange={setMaxCalls} />
              <NumberField label="At most this many updates" unit="updates" help="0 = ignore. Counts activity on the lead (assign, status changes, notes, reminders, calls). Low = barely-worked leads." value={maxUpdates} onChange={setMaxUpdates} />
              <NumberField label="Stop after" unit="transfers" help="A lead is auto-transferred at most this many times, then left alone." value={maxTransfers} onChange={setMaxTransfers} />
            </div>

            <label className="flex items-center gap-2">
              <input type="checkbox" checked={connectedOnly} onChange={(e) => setConnectedOnly(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
              <span className="text-sm text-slate-700">Count only <b>connected</b> calls (ignore missed / unanswered attempts)</span>
            </label>

            <div>
              <p className="mb-1 text-sm font-semibold text-slate-800">Trigger status <span className="font-normal text-slate-400">(required)</span></p>
              <p className="mb-2 text-xs text-slate-400">Only leads currently in one of these statuses are considered (e.g. “Not Reachable”).</p>
              <ChipPicker options={statuses} selected={statusIds} onToggle={(id) => toggle(statusIds, setStatusIds, id)} empty="No lead statuses configured yet." />
            </div>

            <div>
              <p className="mb-1 text-sm font-semibold text-slate-800">Reassign among <span className="font-normal text-slate-400">(optional)</span></p>
              <p className="mb-2 text-xs text-slate-400">Leave all unchecked to round-robin across every active counsellor. Pick some to restrict the pool. The lead’s current owner is always skipped.</p>
              <ChipPicker options={staff} selected={targetIds} onToggle={(id) => toggle(targetIds, setTargetIds, id)} empty="No active team members." />
            </div>

            <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-5">
              <button onClick={save} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save settings"}</button>
              <button onClick={() => run(true)} disabled={running} className={btnGhost}>{running ? "Working…" : "Preview matches"}</button>
              <button onClick={() => run(false)} disabled={running} className={btnGhost}>Run now</button>
            </div>
          </Card>

          {runRes && (
            <Card className="space-y-2">
              <p className="text-sm font-semibold text-slate-800">{runRes.dryRun ? "Preview (nothing changed)" : "Run result"}</p>
              <RunSummary res={runRes.res} dryRun={runRes.dryRun} />
            </Card>
          )}

          <p className="px-1 text-xs text-slate-400">
            Automation runs via the <code className="rounded bg-slate-100 px-1 py-0.5">leadtransfer:auto</code> cron on the server. “Preview” shows what would move without changing anything; “Run now” applies it immediately with your saved settings.
          </p>
        </>
      )}
    </div>
  );
}
