"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "../../admin/ui";
import { FieldSetupDrawer } from "../FieldSetupDrawer";
import { getFormSetup, saveFormFields, getLeadsSetup, LEAD_FIELD_HINTS, LEAD_FORM_FIELDS, type FormKey, type CustomField, type LeadType } from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";

const FORMS: { key: FormKey; label: string; desc: string }[] = [
  { key: "lead", label: "Leads", desc: "The add / edit lead form." },
  { key: "task", label: "Tasks", desc: "The task form." },
  { key: "asset", label: "Assets", desc: "The asset form." },
  { key: "visitor", label: "Visitors", desc: "The visitor log form." },
  { key: "staff", label: "Team / Staff", desc: "The staff member form." },
];

export default function FormSetupPage() {
  const toast = useToast();
  const [open, setOpen] = useState<FormKey | null>(null);
  const [requirable, setRequirable] = useState<{ key: string; label: string }[]>([]);
  const [required, setRequired] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState<CustomField[]>([]);
  const [hints, setHints] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [busy, setBusy] = useState<FormKey | null>(null);
  // Leads can be configured per lead type (0 = All types / base config).
  const [leadTypes, setLeadTypes] = useState<LeadType[]>([]);
  const [leadType, setLeadType] = useState(0);
  const [leadListOpen, setLeadListOpen] = useState(false); // showing the lead-type list
  // A live summary (mandatory + custom field counts) for every form in the list.
  const [summary, setSummary] = useState<Record<string, { required: number; custom: number }>>({});
  // Per-lead-type field counts (raw override; 0 = the "All types" base config).
  const [leadCounts, setLeadCounts] = useState<Record<number, { required: number; custom: number }>>({});
  const loadSummaries = () => {
    Promise.all(FORMS.map((f) => getFormSetup(f.key).then((d) => [f.key, { required: d.required_fields.length, custom: d.custom_fields.length }] as const).catch(() => [f.key, { required: 0, custom: 0 }] as const)))
      .then((rows) => setSummary(Object.fromEntries(rows)));
  };
  const loadLeadCounts = (types: LeadType[]) => {
    const targets = [0, ...types.map((t) => t.id)];
    Promise.all(targets.map((t) => getFormSetup("lead", { type: t }).then((d) => [t, { required: d.required_fields.length, custom: d.custom_fields.length }] as const).catch(() => [t, { required: 0, custom: 0 }] as const)))
      .then((rows) => setLeadCounts(Object.fromEntries(rows)));
  };
  useEffect(() => { getLeadsSetup().then((d) => { const t = d.lead_types ?? []; setLeadTypes(t); loadLeadCounts(t); }).catch(() => {}); loadSummaries(); }, []);

  async function loadSetup(form: FormKey, type: number) {
    const d = await getFormSetup(form, form === "lead" ? { type } : undefined);
    setRequirable(d.requirable);
    setRequired(new Set(d.required_fields));
    setCustom(d.custom_fields);
    setHints(d.hints ?? {});
    setOrder(d.order ?? []);
  }

  async function configure(form: FormKey) {
    // Leads → show the per-lead-type list first (each type is its own form).
    if (form === "lead") { setLeadListOpen(true); loadLeadCounts(leadTypes); return; }
    setBusy(form);
    try {
      setLeadType(0);
      await loadSetup(form, 0);
      setOpen(form);
    } catch {
      toast.error("Could not load this form's setup.");
    } finally {
      setBusy(null);
    }
  }

  // Open the lead form setup for a specific lead type (0 = base / all types).
  async function configureLeadType(type: number) {
    setBusy("lead");
    try {
      setLeadType(type);
      await loadSetup("lead", type);
      setOpen("lead");
    } catch {
      toast.error("Could not load this type's setup.");
    } finally {
      setBusy(null);
    }
  }

  // Switch the lead-type scope while the Leads drawer is open.
  async function pickLeadType(type: number) {
    setLeadType(type);
    try { await loadSetup("lead", type); } catch { toast.error("Could not load this type's setup."); }
  }

  const active = FORMS.find((f) => f.key === open);

  const iconCls = "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600";
  const rowCls = (i: number) => `group flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50 disabled:opacity-60 ${i > 0 ? "border-t border-slate-100" : ""}`;
  const formIcon = <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  const counts = (s?: { required: number; custom: number }) => (
    <span className="hidden flex-shrink-0 items-center gap-1.5 text-[11px] font-medium text-slate-500 sm:flex">
      <span className="rounded-full bg-slate-100 px-2 py-0.5">{s ? s.required : "—"} required</span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5">{s ? s.custom : "—"} custom</span>
    </span>
  );

  return (
    <>
      <PageHeader title="Form Setup" subtitle="Choose which fields are mandatory and add custom fields to any form." />

      {leadListOpen ? (
        // Lead form → one entry per lead type; each opens its own form setup.
        <>
          <button onClick={() => setLeadListOpen(false)} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            All forms
          </button>
          <p className="mb-2 text-sm text-slate-500">Pick a lead type to customize its form, or <b>All types</b> for the default that others inherit.</p>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {[{ id: 0, name: "All types (default)" }, ...leadTypes].map((t, i) => {
              const c = leadCounts[t.id];
              const isBase = t.id === 0;
              const hasCustom = !!c && (c.required > 0 || c.custom > 0);
              return (
                <button key={t.id} onClick={() => configureLeadType(t.id)} disabled={busy !== null} className={rowCls(i)}>
                  <span className={iconCls}>{formIcon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-800">{t.name}
                      {!isBase && <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${hasCustom ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>{hasCustom ? "custom form" : "inherits default"}</span>}
                    </span>
                    <span className="block text-xs text-slate-400">{isBase ? "Applies to every lead type unless overridden below." : "Its own mandatory + custom fields."}</span>
                  </span>
                  {counts(c)}
                  <span className="flex-shrink-0 text-xs font-semibold text-emerald-600">{busy === "lead" ? "…" : "Configure →"}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {FORMS.map((f, i) => (
            <button key={f.key} onClick={() => configure(f.key)} disabled={busy !== null} className={rowCls(i)}>
              <span className={iconCls}>{formIcon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-800">{f.label}{f.key === "lead" && <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600">per lead type</span>}</span>
                <span className="block text-xs text-slate-400">{f.desc}</span>
              </span>
              {f.key === "lead" ? <span className="hidden text-[11px] font-medium text-slate-400 sm:block">{leadTypes.length + 1} forms</span> : counts(summary[f.key])}
              <span className="flex-shrink-0 text-xs font-semibold text-emerald-600">{busy === f.key ? "Loading…" : f.key === "lead" ? "Open →" : "Configure →"}</span>
            </button>
          ))}
        </div>
      )}

      {active && (
        <FieldSetupDrawer
          key={`${active.key}-${leadType}`}
          open={open !== null}
          onClose={() => setOpen(null)}
          title={`${active.label} form fields`}
          subtitle={active.key === "lead" ? "Customize the form per lead type — or for all types." : "Toggle mandatory fields and add custom fields."}
          requirableFields={requirable}
          required={required}
          customFields={custom}
          hints={hints}
          hintFields={active.key === "lead" ? LEAD_FIELD_HINTS : undefined}
          orderFields={active.key === "lead" ? LEAD_FORM_FIELDS : undefined}
          order={order}
          headerExtra={active.key === "lead" ? (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Lead type</label>
              <select value={leadType} onChange={(e) => pickLeadType(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15">
                <option value={0}>All types (default)</option>
                {leadTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <p className="mt-1 text-xs text-slate-400">{leadType === 0 ? "Applies to every lead type unless a type has its own setup below." : "Overrides the default for this lead type only."}</p>
            </div>
          ) : undefined}
          onSave={(body) => saveFormFields(active.key, active.key === "lead" ? { ...body, type: leadType } : body)}
          onSaved={(req, cf) => { setRequired(new Set(req)); setCustom(cf); loadSummaries(); if (active.key === "lead") loadLeadCounts(leadTypes); }}
        />
      )}
    </>
  );
}
