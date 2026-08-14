"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  getAutoTransferRules, saveAutoTransferRule, deleteAutoTransferRule, runAutoTransferNow,
  getLeadNotifications, saveLeadNotification, deleteLeadNotification, runLeadNotificationsNow,
  type AutoTransferBundle, type AutoTransferRule, type AutoTransferRuleConfig, type AutoTransferRuleType, type AutoTransferRunResult,
  type LeadNotificationBundle, type LeadNotificationRule, type LeadNotificationConfig, type LeadNotificationRunResult,
  type AgeUnit, type IdName,
} from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import { PageHeader, Card, Drawer, SkeletonText } from "../../admin/ui";

const btnPrimary = "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60";
const btnGhost = "rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60";
const chipBtn = "rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50";
const numCls = "w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";
const textCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

const AGE_UNITS: { value: AgeUnit; label: string }[] = [
  { value: "clock_hours", label: "clock hours" },
  { value: "working_hours", label: "working hours" },
  { value: "calendar_days", label: "calendar days" },
  { value: "working_days", label: "working days" },
];
const ageUnitLabel = (u: string) => AGE_UNITS.find((x) => x.value === u)?.label ?? u;
const toggleId = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
const names = (ids: number[], opts: IdName[]) => ids.map((id) => opts.find((o) => o.id === id)?.name).filter(Boolean).join(", ");

// ---- transfer-rule draft ----
type Draft = { id?: number; name: string; rule_type: AutoTransferRuleType; enabled: boolean; sequence: number } & AutoTransferRuleConfig;
const blankConfig = (): AutoTransferRuleConfig => ({
  status_ids: [], lead_type_ids: [], source_ids: [], exclude_mass_assigned: false,
  created_after: "", days_since_created: 0, max_calls: 0, count_connected_only: false, max_updates: 0,
  assign_age_op: "gte", assign_age_value: 0, assign_age_unit: "calendar_days",
  max_transfers: 3, include_staff_ids: [], exclude_staff_ids: [], target_staff_ids: [],
});
const newDraft = (): Draft => ({ name: "", rule_type: "transfer", enabled: false, sequence: 0, ...blankConfig() });
const ruleToDraft = (r: AutoTransferRule): Draft => ({ id: r.id, name: r.name, rule_type: r.rule_type, enabled: r.enabled, sequence: r.sequence, ...r.config });

// ---- notification draft ----
type NotifyDraft = { id?: number; name: string; enabled: boolean; sequence: number } & LeadNotificationConfig;
const blankNotify = (): LeadNotificationConfig => ({
  status_ids: [], lead_type_ids: [], source_ids: [], exclude_mass_assigned: false,
  created_after: "", days_since_created: 0, max_calls: 1, count_connected_only: false, max_updates: 0,
  age_value: 2, age_unit: "clock_hours", notify_rep: true, notify_leader: false,
  message: "Follow up with {name} ({phone}) — no response yet.", push_enabled: true,
});
const newNotify = (): NotifyDraft => ({ name: "", enabled: false, sequence: 0, ...blankNotify() });
const notifyToDraft = (r: LeadNotificationRule): NotifyDraft => ({ id: r.id, name: r.name, enabled: r.enabled, sequence: r.sequence, ...r.config });

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

function NumberField({ label, help, value, onChange, unit, min = 0, step }: { label: string; help?: string; value: number; onChange: (v: number) => void; unit?: string; min?: number; step?: string }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <input type="number" min={min} step={step} value={value === 0 ? "" : String(value)} placeholder={String(min)}
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
      {hint ? <p className="mb-2 text-xs text-slate-400">{hint}</p> : <div className="mb-2" />}
      {children}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const dist = type === "distribute";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${dist ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700"}`}>{dist ? "Distribute" : "Transfer"}</span>;
}

function AgeInput({ op, value, unit, onOp, onValue, onUnit, showOp }: { op?: "gte" | "lt"; value: number; unit: AgeUnit; onOp?: (v: "gte" | "lt") => void; onValue: (v: number) => void; onUnit: (v: AgeUnit) => void; showOp?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {showOp && (
        <select value={op} onChange={(e) => onOp?.(e.target.value as "gte" | "lt")} className={textCls + " w-auto"}>
          <option value="gte">At least</option>
          <option value="lt">Less than</option>
        </select>
      )}
      <input type="number" min={0} step="any" value={value === 0 ? "" : String(value)} placeholder="0"
        onChange={(e) => onValue(Math.max(0, Number(e.target.value) || 0))} className={numCls} />
      <select value={unit} onChange={(e) => onUnit(e.target.value as AgeUnit)} className={textCls + " w-auto"}>
        {AGE_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
      </select>
    </div>
  );
}

// --------------------------------------------------------------- transfer UI

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
    if (c.assign_age_value > 0) rows.push({ label: "Assignment Age", value: `${c.assign_age_op === "lt" ? "Less than" : "At least"} ${c.assign_age_value} ${ageUnitLabel(c.assign_age_unit)}` });
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

function RuleEditor({ initial, lk, saving, onClose, onSave }: { initial: Draft; lk: AutoTransferBundle; saving: boolean; onClose: () => void; onSave: (d: Draft) => void }) {
  const [d, setD] = useState<Draft>(initial);
  const up = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
  const isTransfer = d.rule_type === "transfer";

  return (
    <Drawer open onClose={onClose} title={d.id ? "Edit rule" : "New rule"} subtitle="Leads must satisfy all conditions to enter this rule" width="max-w-2xl"
      footer={<div className="flex justify-end gap-2"><button onClick={onClose} className={btnGhost}>Cancel</button><button onClick={() => onSave(d)} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save rule"}</button></div>}>
      <div className="space-y-6">
        <Field title="Rule name"><input value={d.name} onChange={(e) => up({ name: e.target.value })} placeholder="e.g. Not Reachable" className={textCls} /></Field>
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
        <label className="flex items-center gap-3"><Toggle on={d.enabled} onChange={(v) => up({ enabled: v })} /><span className="text-sm text-slate-700">Enabled — the cron applies this rule automatically</span></label>
        <hr className="border-slate-100" />
        <Field title="Status" hint="Only leads currently in one of these statuses qualify."><Chips options={lk.statuses} selected={d.status_ids} onToggle={(id) => up({ status_ids: toggleId(d.status_ids, id) })} empty="No lead statuses configured." scroll /></Field>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field title="Lead type" hint="Optional."><Chips options={lk.types} selected={d.lead_type_ids} onToggle={(id) => up({ lead_type_ids: toggleId(d.lead_type_ids, id) })} empty="No lead types." scroll /></Field>
          <Field title="Lead source" hint="Optional."><Chips options={lk.sources} selected={d.source_ids} onToggle={(id) => up({ source_ids: toggleId(d.source_ids, id) })} empty="No lead sources." scroll /></Field>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field title="Created after" hint="Absolute cutoff — only leads created after this date."><input type="date" value={d.created_after} onChange={(e) => up({ created_after: e.target.value })} className={textCls} /></Field>
          <NumberField label="Created at least ago" unit="days" help="0 = ignore." value={d.days_since_created} onChange={(v) => up({ days_since_created: v })} />
        </div>
        <NumberField label="At most this many updates" unit="updates" help="0 = ignore. Activity entries on the lead." value={d.max_updates} onChange={(v) => up({ max_updates: v })} />
        {isTransfer && (
          <>
            <hr className="border-slate-100" />
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Transfer conditions</p>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <NumberField label="Fewer than this many calls" unit="calls" help="Assigned rep's calls since assignment. 0 = ignore." value={d.max_calls} onChange={(v) => up({ max_calls: v })} />
                <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={d.count_connected_only} onChange={(e) => up({ count_connected_only: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /><span className="text-sm text-slate-600">Count only connected calls</span></label>
              </div>
              <NumberField label="Stop after" unit="transfers" help="Max auto-transfers per lead." value={d.max_transfers} onChange={(v) => up({ max_transfers: v })} min={1} />
            </div>
            <Field title="Assignment age" hint="How long since the lead was last assigned. 0 = ignore. Hours can be fractional (e.g. 2.5).">
              <AgeInput showOp op={d.assign_age_op} value={d.assign_age_value} unit={d.assign_age_unit}
                onOp={(v) => up({ assign_age_op: v })} onValue={(v) => up({ assign_age_value: v })} onUnit={(v) => up({ assign_age_unit: v })} />
              <p className="mt-1 text-xs text-slate-400">Working hours/days exclude nights, weekends &amp; holidays (per the assigned staff&apos;s shift).</p>
            </Field>
            <label className="flex items-center gap-2"><input type="checkbox" checked={d.exclude_mass_assigned} onChange={(e) => up({ exclude_mass_assigned: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /><span className="text-sm text-slate-700">Exclude mass-assigned leads (bulk-dumped batches)</span></label>
            <div className="grid gap-6 sm:grid-cols-2">
              <Field title="Only leads assigned to" hint="Optional."><Chips options={lk.staff} selected={d.include_staff_ids} onToggle={(id) => up({ include_staff_ids: toggleId(d.include_staff_ids, id) })} empty="No staff." scroll /></Field>
              <Field title="Never move leads from" hint="Optional."><Chips options={lk.staff} selected={d.exclude_staff_ids} onToggle={(id) => up({ exclude_staff_ids: toggleId(d.exclude_staff_ids, id) })} empty="No staff." scroll /></Field>
            </div>
          </>
        )}
        <hr className="border-slate-100" />
        <Field title="Reassign among" hint="Round-robin pool. Empty = all active staff; current owner skipped."><Chips options={lk.staff} selected={d.target_staff_ids} onToggle={(id) => up({ target_staff_ids: toggleId(d.target_staff_ids, id) })} empty="No active staff." scroll /></Field>
      </div>
    </Drawer>
  );
}

function RunResults({ result }: { result: AutoTransferRunResult }) {
  return (
    <Card className="space-y-4">
      <p className="text-sm font-semibold text-slate-800">{result.dry_run ? "Preview" : "Run result"} — {result.dry_run ? "would move" : "moved"} <b className="text-emerald-700">{result.total}</b> lead(s)</p>
      {result.rules.length === 0 && <p className="text-sm text-slate-400">No enabled rules ran.</p>}
      {result.rules.map((r) => (
        <div key={r.id} className="rounded-lg border border-slate-100 p-3">
          <p className="text-sm font-semibold text-slate-700">{r.name} <span className="font-normal text-slate-400">({r.rule_type})</span></p>
          {r.reason ? <p className="mt-1 text-sm text-amber-700">Skipped: {r.reason}</p> : (
            <>
              <p className="mt-1 text-xs text-slate-500">Scanned {r.scanned}; {result.dry_run ? "would move" : "moved"} {r.acted}. Skipped — age {r.skipped_age}, calls {r.skipped_calls}, updates {r.skipped_updates}, cap {r.skipped_cap}, pool {r.skipped_pool}, dup {r.skipped_dedupe}.</p>
              {r.details.length > 0 && (
                <ul className="mt-2 divide-y divide-slate-100 rounded-lg bg-slate-50/60">
                  {r.details.slice(0, 50).map((x) => (
                    <li key={x.lead_id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm"><span className="truncate text-slate-700">{x.lead}</span><span className="flex-shrink-0 text-slate-400">{x.from ?? "Unassigned"} <span className="text-slate-300">→</span> <span className="font-medium text-slate-600">{x.to}</span></span></li>
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

// ------------------------------------------------------------ notification UI

function NotifyCard({ rule, lk, busy, onEdit, onToggle, onDelete, onPreview, onRun }: {
  rule: LeadNotificationRule; lk: LeadNotificationBundle; busy: boolean;
  onEdit: () => void; onToggle: (on: boolean) => void; onDelete: () => void; onPreview: () => void; onRun: () => void;
}) {
  const c = rule.config;
  const to = [c.notify_rep && "Assigned rep", c.notify_leader && "Team leader"].filter(Boolean).join(" + ") || "—";
  return (
    <Card className={`space-y-3 ${rule.enabled ? "" : "opacity-75"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="truncate text-base font-bold text-slate-900">{rule.name}</span>
        {c.push_enabled && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Push</span>}
        <div className="ml-auto flex items-center gap-2"><span className="text-xs text-slate-400">{rule.enabled ? "On" : "Off"}</span><Toggle on={rule.enabled} onChange={onToggle} disabled={busy} /></div>
      </div>
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{c.message}</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        <div><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">When</p><p className="text-sm text-slate-800">≥ {c.age_value} {ageUnitLabel(c.age_unit)} after assign</p></div>
        {c.max_calls > 0 && <div><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">If under</p><p className="text-sm text-slate-800">{c.max_calls}{c.count_connected_only ? " connected" : ""} call(s)</p></div>}
        <div><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Notify</p><p className="text-sm text-slate-800">{to}</p></div>
        {c.status_ids.length > 0 && <div><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Status</p><p className="text-sm text-slate-800">{names(c.status_ids, lk.statuses)}</p></div>}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        <button onClick={onEdit} className={chipBtn}>Edit</button>
        <button onClick={onPreview} disabled={busy} className={chipBtn}>Preview</button>
        <button onClick={onRun} disabled={busy} className={chipBtn}>Send now</button>
        <button onClick={onDelete} className={`${chipBtn} text-rose-600 hover:bg-rose-50`}>Delete</button>
      </div>
    </Card>
  );
}

function NotifyEditor({ initial, lk, saving, onClose, onSave }: { initial: NotifyDraft; lk: LeadNotificationBundle; saving: boolean; onClose: () => void; onSave: (d: NotifyDraft) => void }) {
  const [d, setD] = useState<NotifyDraft>(initial);
  const up = (patch: Partial<NotifyDraft>) => setD((prev) => ({ ...prev, ...patch }));

  return (
    <Drawer open onClose={onClose} title={d.id ? "Edit notification" : "New notification"} subtitle="A timed reminder for leads that go unworked" width="max-w-2xl"
      footer={<div className="flex justify-end gap-2"><button onClick={onClose} className={btnGhost}>Cancel</button><button onClick={() => onSave(d)} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save notification"}</button></div>}>
      <div className="space-y-6">
        <Field title="Name"><input value={d.name} onChange={(e) => up({ name: e.target.value })} placeholder="e.g. Fresh lead – 2h reminder" className={textCls} /></Field>
        <label className="flex items-center gap-3"><Toggle on={d.enabled} onChange={(v) => up({ enabled: v })} /><span className="text-sm text-slate-700">Enabled — the cron sends this reminder automatically</span></label>

        <Field title="Message" hint="Click a variable to insert it. It's replaced with the lead's value when sent.">
          <textarea value={d.message} onChange={(e) => up({ message: e.target.value })} rows={3} className={textCls} placeholder="Call {name} at {phone} now." />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {lk.variables.map((v) => (
              <button key={v} type="button" onClick={() => up({ message: `${d.message}{${v}}` })} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-600 hover:bg-slate-100">{`{${v}}`}</button>
            ))}
          </div>
        </Field>

        <Field title="Send when" hint="Fires once the lead has been assigned this long without being worked. Hours can be fractional (e.g. 2.5).">
          <AgeInput value={d.age_value} unit={d.age_unit} onValue={(v) => up({ age_value: v })} onUnit={(v) => up({ age_unit: v })} />
        </Field>

        <div>
          <NumberField label="Only if fewer than this many calls" unit="calls" help="0 = send regardless of calls." value={d.max_calls} onChange={(v) => up({ max_calls: v })} />
          <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={d.count_connected_only} onChange={(e) => up({ count_connected_only: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /><span className="text-sm text-slate-600">Count only connected calls</span></label>
        </div>

        <Field title="Send to">
          <div className="space-y-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={d.notify_rep} onChange={(e) => up({ notify_rep: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /><span className="text-sm text-slate-700">The assigned counsellor</span></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={d.notify_leader} onChange={(e) => up({ notify_leader: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /><span className="text-sm text-slate-700">Their team leader (reports-to manager)</span></label>
          </div>
        </Field>
        <label className="flex items-center gap-3"><Toggle on={d.push_enabled} onChange={(v) => up({ push_enabled: v })} /><span className="text-sm text-slate-700">Also send a web push notification</span></label>

        <hr className="border-slate-100" />
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Which leads (optional filters)</p>
        <Field title="Status" hint="Empty = any status."><Chips options={lk.statuses} selected={d.status_ids} onToggle={(id) => up({ status_ids: toggleId(d.status_ids, id) })} empty="No lead statuses." scroll /></Field>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field title="Lead type"><Chips options={lk.types} selected={d.lead_type_ids} onToggle={(id) => up({ lead_type_ids: toggleId(d.lead_type_ids, id) })} empty="No lead types." scroll /></Field>
          <Field title="Lead source"><Chips options={lk.sources} selected={d.source_ids} onToggle={(id) => up({ source_ids: toggleId(d.source_ids, id) })} empty="No lead sources." scroll /></Field>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field title="Created after"><input type="date" value={d.created_after} onChange={(e) => up({ created_after: e.target.value })} className={textCls} /></Field>
          <NumberField label="Created at least ago" unit="days" help="0 = ignore." value={d.days_since_created} onChange={(v) => up({ days_since_created: v })} />
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={d.exclude_mass_assigned} onChange={(e) => up({ exclude_mass_assigned: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /><span className="text-sm text-slate-700">Exclude mass-assigned leads</span></label>
      </div>
    </Drawer>
  );
}

function NotifyRunResults({ result }: { result: LeadNotificationRunResult }) {
  return (
    <Card className="space-y-4">
      <p className="text-sm font-semibold text-slate-800">{result.dry_run ? "Preview" : "Send result"} — {result.dry_run ? "would notify" : "notified"} <b className="text-emerald-700">{result.total}</b> lead(s)</p>
      {result.rules.length === 0 && <p className="text-sm text-slate-400">No enabled notifications ran.</p>}
      {result.rules.map((r) => (
        <div key={r.id} className="rounded-lg border border-slate-100 p-3">
          <p className="text-sm font-semibold text-slate-700">{r.name}</p>
          {r.reason ? <p className="mt-1 text-sm text-amber-700">Skipped: {r.reason}</p> : (
            <>
              <p className="mt-1 text-xs text-slate-500">Scanned {r.scanned}; {result.dry_run ? "would notify" : "notified"} {r.sent}. Skipped — age {r.skipped_age}, calls {r.skipped_calls}, updates {r.skipped_updates}, already-sent {r.skipped_sent}, no-recipient {r.skipped_recipient}.</p>
              {r.details.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {r.details.slice(0, 50).map((x) => (
                    <li key={x.lead_id} className="rounded-lg bg-slate-50/60 px-3 py-1.5 text-sm"><span className="font-medium text-slate-700">{x.lead}</span> <span className="text-slate-400">→ {x.to}</span><br /><span className="text-slate-600">{x.message}</span></li>
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
  const [tab, setTab] = useState<"rules" | "notify">("rules");
  const [loading, setLoading] = useState(true);

  const [bundle, setBundle] = useState<AutoTransferBundle | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [runRes, setRunRes] = useState<AutoTransferRunResult | null>(null);

  const [nBundle, setNBundle] = useState<LeadNotificationBundle | null>(null);
  const [nEditing, setNEditing] = useState<NotifyDraft | null>(null);
  const [nSaving, setNSaving] = useState(false);
  const [nBusyId, setNBusyId] = useState<number | null>(null);
  const [nRunning, setNRunning] = useState(false);
  const [nRunRes, setNRunRes] = useState<LeadNotificationRunResult | null>(null);

  useEffect(() => {
    Promise.all([getAutoTransferRules(), getLeadNotifications()])
      .then(([b, n]) => { setBundle(b); setNBundle(n); setLoading(false); })
      .catch(() => { toast.error("Could not load auto-transfer settings."); setLoading(false); });
  }, [toast]);

  const reloadRules = () => getAutoTransferRules().then(setBundle);
  const reloadNotify = () => getLeadNotifications().then(setNBundle);

  // ---- transfer handlers ----
  async function saveRule(d: Draft) {
    if (!d.name.trim()) { toast.warning("Give the rule a name."); return; }
    setSaving(true);
    try { await saveAutoTransferRule({ ...d, name: d.name.trim() }); await reloadRules(); setEditing(null); toast.success("Rule saved.", { title: "Saved" }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save rule."); }
    setSaving(false);
  }
  async function toggleRule(rule: AutoTransferRule, on: boolean) {
    setBusyId(rule.id);
    try { await saveAutoTransferRule({ id: rule.id, name: rule.name, rule_type: rule.rule_type, enabled: on, sequence: rule.sequence, ...rule.config }); await reloadRules(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not update rule."); }
    setBusyId(null);
  }
  async function removeRule(rule: AutoTransferRule) {
    const ok = await confirm({ title: "Delete this rule?", message: `"${rule.name}" will be removed. Leads already moved keep their new assignment.`, confirmLabel: "Delete", cancelLabel: "Cancel" });
    if (!ok) return;
    try { await deleteAutoTransferRule(rule.id); await reloadRules(); toast.success("Rule deleted."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete rule."); }
  }
  async function runRules(dryRun: boolean, ruleId?: number) {
    if (!dryRun) { const ok = await confirm({ title: "Run auto-transfer now?", message: ruleId ? "This rule's matching leads will be reassigned immediately." : "Every enabled rule runs now and reassigns matching leads immediately.", confirmLabel: "Yes, run now", cancelLabel: "Cancel" }); if (!ok) return; }
    setRunning(true); setRunRes(null);
    try { const res = await runAutoTransferNow(dryRun, ruleId); setRunRes(res.result); if (!dryRun) { await reloadRules(); toast.success(`${res.result.total} lead(s) moved.`); } }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not run auto-transfer."); }
    setRunning(false);
  }

  // ---- notification handlers ----
  async function saveNotify(d: NotifyDraft) {
    if (!d.name.trim()) { toast.warning("Give the notification a name."); return; }
    setNSaving(true);
    try { await saveLeadNotification({ ...d, name: d.name.trim() }); await reloadNotify(); setNEditing(null); toast.success("Notification saved.", { title: "Saved" }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save notification."); }
    setNSaving(false);
  }
  async function toggleNotify(rule: LeadNotificationRule, on: boolean) {
    setNBusyId(rule.id);
    try { await saveLeadNotification({ id: rule.id, name: rule.name, enabled: on, sequence: rule.sequence, ...rule.config }); await reloadNotify(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not update notification."); }
    setNBusyId(null);
  }
  async function removeNotify(rule: LeadNotificationRule) {
    const ok = await confirm({ title: "Delete this notification?", message: `"${rule.name}" will be removed.`, confirmLabel: "Delete", cancelLabel: "Cancel" });
    if (!ok) return;
    try { await deleteLeadNotification(rule.id); await reloadNotify(); toast.success("Notification deleted."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete notification."); }
  }
  async function runNotify(dryRun: boolean, ruleId?: number) {
    if (!dryRun) { const ok = await confirm({ title: "Send notifications now?", message: ruleId ? "This notification will be sent for every matching lead right now." : "Every enabled notification will be sent for its matching leads now.", confirmLabel: "Yes, send now", cancelLabel: "Cancel" }); if (!ok) return; }
    setNRunning(true); setNRunRes(null);
    try { const res = await runLeadNotificationsNow(dryRun, ruleId); setNRunRes(res.result); if (!dryRun) { toast.success(`${res.result.total} reminder(s) sent.`); } }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not send notifications."); }
    setNRunning(false);
  }

  const rules = bundle?.rules ?? [];
  const nRules = nBundle?.rules ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Auto Lead Transfer"
        subtitle="Automatically move cold leads to another counsellor, and send timed reminders when a lead goes unworked. A background job applies everything; you can also run on demand."
        action={
          <div className="flex flex-wrap gap-2">
            {tab === "rules" ? (
              <>
                <button onClick={() => runRules(true)} disabled={running || loading} className={btnGhost}>{running ? "Working…" : "Preview all"}</button>
                <button onClick={() => runRules(false)} disabled={running || loading} className={btnGhost}>Run all now</button>
                <button onClick={() => setEditing(newDraft())} disabled={loading} className={btnPrimary}>+ Add rule</button>
              </>
            ) : (
              <>
                <button onClick={() => runNotify(true)} disabled={nRunning || loading} className={btnGhost}>{nRunning ? "Working…" : "Preview all"}</button>
                <button onClick={() => runNotify(false)} disabled={nRunning || loading} className={btnGhost}>Send all now</button>
                <button onClick={() => setNEditing(newNotify())} disabled={loading} className={btnPrimary}>+ Add notification</button>
              </>
            )}
          </div>
        }
      />

      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {(["rules", "notify"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${tab === t ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {t === "rules" ? "Transfer rules" : "Notifications"}
          </button>
        ))}
      </div>

      {loading ? (
        <Card><SkeletonText lines={6} /></Card>
      ) : tab === "rules" ? (
        <>
          {rules.length === 0 ? (
            <Card className="py-12 text-center"><p className="text-sm text-slate-500">No rules yet.</p><button onClick={() => setEditing(newDraft())} className={`mt-3 ${btnPrimary}`}>+ Create your first rule</button></Card>
          ) : (
            <div className="space-y-4">
              {bundle && rules.map((rule) => (
                <RuleCard key={rule.id} rule={rule} lk={bundle} busy={busyId === rule.id || running}
                  onEdit={() => setEditing(ruleToDraft(rule))} onToggle={(on) => toggleRule(rule, on)} onDelete={() => removeRule(rule)}
                  onPreview={() => runRules(true, rule.id)} onRun={() => runRules(false, rule.id)} />
              ))}
            </div>
          )}
          {runRes && <RunResults result={runRes} />}
        </>
      ) : (
        <>
          {nRules.length === 0 ? (
            <Card className="py-12 text-center"><p className="text-sm text-slate-500">No notifications yet.</p><button onClick={() => setNEditing(newNotify())} className={`mt-3 ${btnPrimary}`}>+ Create your first notification</button></Card>
          ) : (
            <div className="space-y-4">
              {nBundle && nRules.map((rule) => (
                <NotifyCard key={rule.id} rule={rule} lk={nBundle} busy={nBusyId === rule.id || nRunning}
                  onEdit={() => setNEditing(notifyToDraft(rule))} onToggle={(on) => toggleNotify(rule, on)} onDelete={() => removeNotify(rule)}
                  onPreview={() => runNotify(true, rule.id)} onRun={() => runNotify(false, rule.id)} />
              ))}
            </div>
          )}
          {nRunRes && <NotifyRunResults result={nRunRes} />}
        </>
      )}

      <p className="px-1 text-xs text-slate-400">
        Automation runs via the <code className="rounded bg-slate-100 px-1 py-0.5">leadtransfer:auto</code> cron (every 15 min for hour-based rules). “Preview” shows what would happen without changing anything.
      </p>

      {editing && bundle && <RuleEditor key={editing.id ?? "new"} initial={editing} lk={bundle} saving={saving} onClose={() => setEditing(null)} onSave={saveRule} />}
      {nEditing && nBundle && <NotifyEditor key={nEditing.id ?? "new"} initial={nEditing} lk={nBundle} saving={nSaving} onClose={() => setNEditing(null)} onSave={saveNotify} />}
    </div>
  );
}
