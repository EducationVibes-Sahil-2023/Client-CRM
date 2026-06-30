"use client";

import { useState } from "react";
import { PageHeader } from "../../admin/ui";
import { FieldSetupDrawer } from "../FieldSetupDrawer";
import { getFormSetup, saveFormFields, type FormKey, type CustomField } from "../../lib/client";
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
  const [busy, setBusy] = useState<FormKey | null>(null);

  async function configure(form: FormKey) {
    setBusy(form);
    try {
      const d = await getFormSetup(form);
      setRequirable(d.requirable);
      setRequired(new Set(d.required_fields));
      setCustom(d.custom_fields);
      setOpen(form);
    } catch {
      toast.error("Could not load this form's setup.");
    } finally {
      setBusy(null);
    }
  }

  const active = FORMS.find((f) => f.key === open);

  return (
    <>
      <PageHeader title="Form Setup" subtitle="Choose which fields are mandatory and add custom fields to any form." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FORMS.map((f) => (
          <button
            key={f.key}
            onClick={() => configure(f.key)}
            disabled={busy !== null}
            className="group flex flex-col items-start rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md disabled:opacity-60"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <span className="mt-3 text-sm font-semibold text-slate-800">{f.label}</span>
            <span className="mt-1 text-xs text-slate-400">{f.desc}</span>
            <span className="mt-3 text-xs font-semibold text-emerald-600">{busy === f.key ? "Loading…" : "Configure fields →"}</span>
          </button>
        ))}
      </div>

      {active && (
        <FieldSetupDrawer
          open={open !== null}
          onClose={() => setOpen(null)}
          title={`${active.label} form fields`}
          subtitle="Toggle mandatory fields and add custom fields."
          requirableFields={requirable}
          required={required}
          customFields={custom}
          onSave={(body) => saveFormFields(active.key, body)}
          onSaved={(req, cf) => { setRequired(new Set(req)); setCustom(cf); }}
        />
      )}
    </>
  );
}
