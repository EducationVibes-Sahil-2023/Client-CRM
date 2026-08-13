"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  getAutoTransferRules,
  saveAutoTransferRule,
  deleteAutoTransferRule,
  runAutoTransferNow,
  type AutoTransferBundle,
  type AutoTransferRule,
  type AutoTransferRuleConfig,
  type AutoTransferRuleType,
  type AutoTransferRunResult,
  type IdName,
} from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import { PageHeader, Card, Drawer, SkeletonText } from "../../admin/ui";

const btnPrimary = "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60";
const btnGhost = "rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60";
const chipBtn = "rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50";
const numCls = "w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";
const textCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

/** A rule's editable draft (rule fields + flat criteria). */
type Draft = {
  id?: number;
  name: string;
  rule_type: AutoTransferRuleType;
  enabled: boolean;
  sequence: number;
} & AutoTransferRuleConfig;

const blankConfig = (): AutoTransferRuleConfig => ({
  status_ids: [], lead_type_ids: [], source_ids: [],
  exclude_mass_assigned: false, created_after: "", days_since_created: 0,
  max_calls: 0, count_connected_only: false, max_updates: 0,
  assign_age_op: "gte", assign_age_value: 0, assign_age_unit: "calendar",
  max_transfers: 3, include_staff_ids: [], exclude_staff_ids: [], target_staff_ids: [],
});
const newDraft = (): Draft => ({ name: "", rule_type: "transfer", enabled: false, sequence: 0, ...blankConfig() });
const ruleToDraft = (r: AutoTransferRule): Draft => ({ id: r.id, name: r.name, rule_type: r.rule_type, enabled: r.enabled, sequence: r.sequence, ...r.config });

const toggleId = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
const names = (ids: number[], opts: IdName[]) => ids.map((id) => opts.find((o) => o.id === id)?.name).filter(Boolean).join(", ");

// ---------------------------------------------------------------- primitives

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!on)} aria-pressed={on}
      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition ${on ? "bg-emerald-600" : "bg-slate-300"} disabled:opacity-50`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function Chips({ options, selected, onToggle, empty, scroll }: { options: IdName[]; selected: number[]; onToggle: (id: number) => void; empty: string; scroll?: boolean }) {
  if (!options.length) return <p className="text-sm text-slate-400">{empty}</p>;
  return (
    <div className={`flex flex-wrap gap-2 ${scroll ? "max-h-44 overflow-y-auto rounded-lg border border-slate-100 p-2" : ""}`}>
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button key={o.id} type="button" onClick={() => onToggle(o.id)}
            className={`rounded-full border px-3 py-1 text-sm font-medium transition ${on ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
            {o.name}
          </button>
        );
      })}
    </div>
  );
}

function NumberField({ label, help, value, onChange, unit, min = 0 }: { label: string; help?: string; value: number; onChange: (v: number) => void; unit?: string; min?: number }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <input type="number" min={min} value={value === 0 ? "" : String(value)} placeholder={String(min)}
          onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))} className={numCls} />
        {unit && <span className="text-sm text-slate-600">{unit}</span>}
      </div>
      <p className="mt-1 text-sm font-medium text-slate-700">{label}</p>
      {help && <p className="text-xs text-slate-400">{help}</p>}
    </div>
  );
}

function Field({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {hint && <p className="mb-2 text-xs text-slate-400">{hint}</p>}
      {!hint && <div className="mb-2" />}
      {children}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const dist = type === "distribute";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${dist ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700"}`}>
      {dist ? "Distribute" : "Transfer"}
    </span>
  );
}

// --------------------------------------------------------------------- card

function RuleCard({ rule, lk, busy, onEdit, onToggle, onDelete, onPreview, onRun }: {
  rule: AutoTransferRule; lk: AutoTransferBundle; busy: boolean;
  onEdit: () => void; onToggle: (on: boolean) => void; onDelete: () => void; onPreview: () => void; onRun: () => void;
}) {
  const c = rule.config;
  const rows: { label: string; value: ReactNode }[] = [];
  if (c.status_ids.length) rows.push({ label: "Status", value: names(c.status_ids, lk.statuses) });
  if (c.lead_type_ids.length) rows.push({ label: "Lead Type", value: names(c.lead_type_ids, lk.types) });
  if (c.source_ids.length) rows.push({ label: "Lead Source", value: names(c.source_ids, lk.sources) });
  if (c.created_after) rows.push({ label: "Created After", value: c.created_after });
  if (c.days_since_created > 0) rows.push({ label: "Created Age", value: `≥ ${c.days_since_created} days` });
  if (c.max_updates > 0) rows.push({ label: "Updates", value: `≤ ${c.max_updates}` });
  if (rule.rule_type === "transfer") {
    if (c.max_calls > 0) rows.push({ label: "Call Count", value: `Less than ${c.max_calls}${c.count_connected_only ? " connected" : ""} calls` });
    if (c.assign_age_value > 0) rows.push({ label: "Assignment Age", value: `${c.assign_age_op === "lt" ? "Less than" : "At least"} ${c.assign_age_value} ${c.assign_age_unit} day(s)` });
    rows.push({ label: "Stop After", value: `${c.max_transfers} transfer(s)` });
    if (c.exclude_mass_assigned) rows.push({ label: "Exclude", value: "Mass-assigned leads" });
    if (c.include_staff_ids.length) rows.push({ label: "Only assigned to", value: `${c.include_staff_ids.length} staff` });
    if (c.exclude_staff_ids.length) rows.push({ label: "Never move from", value: `${c.exclude_staff_ids.length} staff` });
  }
  rows.push({ label: "Reassign among", value: c.target_staff_ids.length ? `${c.target_staff_ids.length} counsellor(s)` : "All active staff" });

  return (
    <Card className={`space-y-4 ${rule.enabled ? "" : "opacity-75"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="truncate text-base font-bold text-slate-900">{rule.name}</span>
          <TypeBadge type={rule.rule_type} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-400">{rule.enabled ? "On" : "Off"}</span>
          <Toggle on={rule.enabled} onChange={onToggle} disabled={busy} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        {rows.map((r) => (
          <div key={r.label}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{r.label}</p>
            <p className="mt-0.5 text-sm text-slate-800">{r.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        <button onClick={onEdit} className={chipBtn}>Edit</button>
        <button onClick={onPreview} disabled={busy} className={chipBtn}>Preview</button>
        <button onClick={onRun} disabled={busy} className={chipBtn}>Run now</button>
        <button onClick={onDelete} className={`${chipBtn} text-rose-600 hover:bg-rose-50`}>Delete</button>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------- editor

function RuleEditor({ initial, lk, saving, onClose, onSave }: {
  initial: Draft; lk: AutoTransferBundle; saving: boolean; onClose: () => void; onSave: (d: Draft) => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const up = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
  const isTransfer = d.rule_type === "transfer";

  return (
    <Drawer
      open onClose={onClose}
      title={d.id ? "Edit rule" : "New rule"}
      subtitle="Leads must satisfy all conditions to enter this rule"
      width="max-w-2xl"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={() => onSave(d)} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save rule"}</button>
        </div>
      }
    >
      <div className="space-y-6">
        <Field title="Rule name">
          <input value={d.name} onChange={(e) => up({ name: e.target.value })} placeholder="e.g. Not Reachable" className={textCls} />
        </Field>

        <Field title="What this rule does">
          <div className="flex gap-2">
            {(["transfer", "distribute"] as AutoTransferRuleType[]).map((t) => (
              <button key={t} type="button" onClick={() => up({ rule_type: t })}
                className={`flex-1 rounded-lg border px-3 py-2.5 text-left text-sm transition ${d.rule_type === t ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:bg-slate-50"}`}>
                <span className="block font-semibold text-slate-800">{t === "transfer" ? "Transfer" : "Distribute"}</span>
                <span className="block text-xs text-slate-500">{t === "transfer" ? "Reassign already-assigned leads to another counsellor" : "First-assign unassigned (or mass-assigned) leads"}</span>
              </button>
            ))}
          </div>
        </Field>

        <label className="flex items-center gap-3">
          <Toggle on={d.enabled} onChange={(v) => up({ enabled: v })} />
          <span className="text-sm text-slate-700">Enabled — the cron applies this rule automatically</span>
        </label>

        <hr className="border-slate-100" />

        <Field title="Status" hint="Only leads currently in one of these statuses qualify.">
          <Chips options={lk.statuses} selected={d.status_ids} onToggle={(id) => up({ status_ids: toggleId(d.status_ids, id) })} empty="No lead statuses configured." scroll />
        </Field>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field title="Lead type" hint="Optional.">
            <Chips options={lk.types} selected={d.lead_type_ids} onToggle={(id) => up({ lead_type_ids: toggleId(d.lead_type_ids, id) })} empty="No lead types." scroll />
          </Field>
          <Field title="Lead source" hint="Optional.">
            <Chips options={lk.sources} selected={d.source_ids} onToggle={(id) => up({ source_ids: toggleId(d.source_ids, id) })} empty="No lead sources." scroll />
          </Field>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field title="Created after" hint="Absolute cutoff — only leads created after this date.">
            <input type="date" value={d.created_after} onChange={(e) => up({ created_after: e.target.value })} className={textCls} />
          </Field>
          <NumberField label="Created at least ago" unit="days" help="0 = ignore. Relative age since creation." value={d.days_since_created} onChange={(v) => up({ days_since_created: v })} />
        </div>

        <NumberField label="At most this many updates" unit="updates" help="0 = ignore. Activity entries on the lead (assign, status, notes, calls). Low = barely-worked." value={d.max_updates} onChange={(v) => up({ max_updates: v })} />

        {isTransfer && (
          <>
            <hr className="border-slate-100" />
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Transfer conditions</p>

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <NumberField label="Fewer than this many calls" unit="calls" help="Assigned rep's calls since assignment. 0 = ignore." value={d.max_calls} onChange={(v) => up({ max_calls: v })} />
                <label className="mt-2 flex items-center gap-2">
                  <input type="checkbox" checked={d.count_connected_only} onChange={(e) => up({ count_connected_only: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                  <span className="text-sm text-slate-600">Count only connected calls</span>
                </label>
              </div>
              <NumberField label="Stop after" unit="transfers" help="Max auto-transfers per lead, then leave it alone." value={d.max_transfers} onChange={(v) => up({ max_transfers: v })} min={1} />
            </div>

            <Field title="Assignment age" hint="How long since the lead was last assigned/transferred. 0 = ignore.">
              <div className="flex flex-wrap items-center gap-2">
                <select value={d.assign_age_op} onChange={(e) => up({ assign_age_op: e.target.value as "gte" | "lt" })} className={textCls + " w-auto"}>
                  <option value="gte">At least</option>
                  <option value="lt">Less than</option>
                </select>
                <input type="number" min={0} value={d.assign_age_value === 0 ? "" : String(d.assign_age_value)} placeholder="0"
                  onChange={(e) => up({ assign_age_value: Math.max(0, Number(e.target.value) || 0) })} className={numCls} />
                <select value={d.assign_age_unit} onChange={(e) => up({ assign_age_unit: e.target.value as "calendar" | "working" })} className={textCls + " w-auto"}>
                  <option value="working">working day(s)</option>
                  <option value="calendar">calendar day(s)</option>
                </select>
              </div>
              <p className="mt-1 text-xs text-slate-400">Working days exclude weekends + holidays (per the assigned staff&apos;s shift).</p>
            </Field>

            <label className="flex items-center gap-2">
              <input type="checkbox" checked={d.exclude_mass_assigned} onChange={(e) => up({ exclude_mass_assigned: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
              <span className="text-sm text-slate-700">Exclude mass-assigned leads (bulk-dumped batches)</span>
            </label>

            <div className="grid gap-6 sm:grid-cols-2">
              <Field title="Only leads assigned to" hint="Optional — restrict to these current owners.">
                <Chips options={lk.staff} selected={d.include_staff_ids} onToggle={(id) => up({ include_staff_ids: toggleId(d.include_staff_ids, id) })} empty="No staff." scroll />
              </Field>
              <Field title="Never move leads from" hint="Optional — these owners are skipped.">
                <Chips options={lk.staff} selected={d.exclude_staff_ids} onToggle={(id) => up({ exclude_staff_ids: toggleId(d.exclude_staff_ids, id) })} empty="No staff." scroll />
              </Field>
            </div>
          </>
        )}

        <hr className="border-slate-100" />
        <Field title="Reassign among" hint="Round-robin pool. Leave empty for all active staff; the current owner is always skipped.">
          <Chips options={lk.staff} selected={d.target_staff_ids} onToggle={(id) => up({ target_staff_ids: toggleId(d.target_staff_ids, id) })} empty="No active staff." scroll />
        </Field>
      </div>
    </Drawer>
  );
}

// --------------------------------------------------------------- run results

function RunResults({ result }: { result: AutoTransferRunResult }) {
  return (
    <Card className="space-y-4">
      <p className="text-sm font-semibold text-slate-800">
        {result.dry_run ? "Preview" : "Run result"} — {result.dry_run ? "would move" : "moved"} <b className="text-emerald-700">{result.total}</b> lead(s)
      </p>
      {result.rules.length === 0 && <p className="text-sm text-slate-400">No enabled rules ran.</p>}
      {result.rules.map((r) => (
        <div key={r.id} className="rounded-lg border border-slate-100 p-3">
          <p className="text-sm font-semibold text-slate-700">{r.name} <span className="font-normal text-slate-400">({r.rule_type})</span></p>
          {r.reason ? (
            <p className="mt-1 text-sm text-amber-700">Skipped: {r.reason}</p>
          ) : (
            <>
              <p className="mt-1 text-xs text-slate-500">
                Scanned {r.scanned}; {result.dry_run ? "would move" : "moved"} {r.acted}. Skipped — age {r.skipped_age}, calls {r.skipped_calls}, updates {r.skipped_updates}, cap {r.skipped_cap}, pool {r.skipped_pool}, dup {r.skipped_dedupe}.
              </p>
              {r.details.length > 0 && (
                <ul className="mt-2 divide-y divide-slate-100 rounded-lg bg-slate-50/60">
                  {r.details.slice(0, 50).map((x) => (
                    <li key={x.lead_id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                      <span className="truncate text-slate-700">{x.lead}</span>
                      <span className="flex-shrink-0 text-slate-400">{x.from ?? "Unassigned"} <span className="text-slate-300">→</span> <span className="font-medium text-slate-600">{x.to}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      ))}
    </Card>
  );
}

// --------------------------------------------------------------------- page

export default function AutoTransferPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [bundle, setBundle] = useState<AutoTransferBundle | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [runRes, setRunRes] = useState<AutoTransferRunResult | null>(null);

  useEffect(() => {
    getAutoTransferRules()
      .then((b) => { setBundle(b); setLoading(false); })
      .catch(() => { toast.error("Could not load auto-transfer rules."); setLoading(false); });
  }, [toast]);

  const reload = () => getAutoTransferRules().then(setBundle);

  async function saveRule(d: Draft) {
    if (!d.name.trim()) { toast.warning("Give the rule a name."); return; }
    setSaving(true);
    try {
      await saveAutoTransferRule({ ...d, name: d.name.trim() });
      await reload();
      setEditing(null);
      toast.success("Rule saved.", { title: "Saved" });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save rule."); }
    setSaving(false);
  }

  async function toggleRule(rule: AutoTransferRule, on: boolean) {
    setBusyId(rule.id);
    try {
      await saveAutoTransferRule({ id: rule.id, name: rule.name, rule_type: rule.rule_type, enabled: on, sequence: rule.sequence, ...rule.config });
      await reload();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not update rule."); }
    setBusyId(null);
  }

  async function removeRule(rule: AutoTransferRule) {
    const ok = await confirm({
      title: "Delete this rule?",
      message: `"${rule.name}" will be removed. Leads already moved keep their new assignment.`,
      confirmLabel: "Delete", cancelLabel: "Cancel",
    });
    if (!ok) return;
    try { await deleteAutoTransferRule(rule.id); await reload(); toast.success("Rule deleted."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete rule."); }
  }

  async function run(dryRun: boolean, ruleId?: number) {
    if (!dryRun) {
      const ok = await confirm({
        title: "Run auto-transfer now?",
        message: ruleId ? "This rule's matching leads will be reassigned immediately." : "Every enabled rule runs now and reassigns matching leads immediately.",
        confirmLabel: "Yes, run now", cancelLabel: "Cancel",
      });
      if (!ok) return;
    }
    setRunning(true);
    setRunRes(null);
    try {
      const res = await runAutoTransferNow(dryRun, ruleId);
      setRunRes(res.result);
      if (!dryRun) { await reload(); toast.success(`${res.result.total} lead(s) moved.`); }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not run auto-transfer."); }
    setRunning(false);
  }

  const rules = bundle?.rules ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Auto Lead Transfer"
        subtitle="Build rules that automatically transfer cold leads to another counsellor, or distribute unassigned leads. A background job applies every enabled rule; you can also run them on demand."
        action={
          <div className="flex flex-wrap gap-2">
            <button onClick={() => run(true)} disabled={running || loading} className={btnGhost}>{running ? "Working…" : "Preview all"}</button>
            <button onClick={() => run(false)} disabled={running || loading} className={btnGhost}>Run all now</button>
            <button onClick={() => setEditing(newDraft())} disabled={loading} className={btnPrimary}>+ Add rule</button>
          </div>
        }
      />

      {loading ? (
        <Card><SkeletonText lines={6} /></Card>
      ) : rules.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-sm text-slate-500">No rules yet.</p>
          <button onClick={() => setEditing(newDraft())} className={`mt-3 ${btnPrimary}`}>+ Create your first rule</button>
        </Card>
      ) : (
        <div className="space-y-4">
          {bundle && rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              lk={bundle}
              busy={busyId === rule.id || running}
              onEdit={() => setEditing(ruleToDraft(rule))}
              onToggle={(on) => toggleRule(rule, on)}
              onDelete={() => removeRule(rule)}
              onPreview={() => run(true, rule.id)}
              onRun={() => run(false, rule.id)}
            />
          ))}
        </div>
      )}

      {runRes && <RunResults result={runRes} />}

      <p className="px-1 text-xs text-slate-400">
        Automation runs via the <code className="rounded bg-slate-100 px-1 py-0.5">leadtransfer:auto</code> cron. “Preview” shows what would move without changing anything; “Run now” applies it immediately. A lead is never moved twice in one run.
      </p>

      {editing && bundle && (
        <RuleEditor
          key={editing.id ?? "new"}
          initial={editing}
          lk={bundle}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={saveRule}
        />
      )}
    </div>
  );
}
