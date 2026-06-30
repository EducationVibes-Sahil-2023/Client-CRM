"use client";

import { useEffect, useState } from "react";
import { Drawer } from "../admin/ui";
import { useToast } from "../components/toast/ToastProvider";
import type { TaskCustomField, TaskFieldType } from "../lib/client";

const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const FIELD_TYPE_OPTIONS: { value: TaskFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Text area" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown" },
];

/**
 * Reusable admin panel for a form's field config: toggle which built-in fields
 * are mandatory and build custom fields (text / textarea / number / date /
 * dropdown). Used by the Tasks and Assets pages — the `onSave` prop is the
 * entity-specific save call.
 */
export function FieldSetupDrawer({
  open,
  onClose,
  title,
  subtitle,
  requirableFields,
  required,
  customFields,
  onSave,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  requirableFields: { key: string; label: string }[];
  required: Set<string>;
  customFields: TaskCustomField[];
  onSave: (body: { required_fields: string[]; custom_fields: TaskCustomField[] }) => Promise<{ required_fields: string[]; custom_fields: TaskCustomField[] }>;
  onSaved: (req: string[], custom: TaskCustomField[]) => void;
}) {
  const toast = useToast();
  const [req, setReq] = useState<Set<string>>(required);
  const [fields, setFields] = useState<TaskCustomField[]>(customFields);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReq(new Set(required));
    setFields(customFields.map((f) => ({ ...f, options: [...f.options] })));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: string) => setReq((r) => { const n = new Set(r); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const addField = () => setFields((f) => [...f, { key: "", label: "", type: "text", required: false, options: [] }]);
  const patch = (i: number, p: Partial<TaskCustomField>) => setFields((f) => f.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const removeField = (i: number) => setFields((f) => f.filter((_, j) => j !== i));

  async function save() {
    const clean = fields
      .filter((f) => f.label.trim())
      .map((f) => ({
        key: f.key || slugify(f.label),
        label: f.label.trim(),
        type: f.type,
        required: f.required,
        options: f.type === "select" ? f.options.map((o) => o.trim()).filter(Boolean) : [],
      }));
    setSaving(true);
    try {
      const d = await onSave({ required_fields: [...req], custom_fields: clean });
      onSaved(d.required_fields, d.custom_fields);
      toast.success("Form fields saved.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      width="max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
        </div>
      }
    >
      <div className="space-y-6">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Mandatory fields</h4>
          <p className="mt-0.5 text-xs text-slate-400">Toggle a field to make it required on the form.</p>
          <div className="mt-3 space-y-1.5">
            {requirableFields.map((f) => (
              <label key={f.key} className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <span className="font-medium text-slate-700">{f.label}</span>
                <input type="checkbox" checked={req.has(f.key)} onChange={() => toggle(f.key)} className="h-4 w-4 cursor-pointer rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Custom fields</h4>
            <button onClick={addField} className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>Add field
            </button>
          </div>
          {fields.length === 0 ? (
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">No custom fields yet. Add one to collect extra info on the form.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {fields.map((f, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center gap-2">
                    <input value={f.label} onChange={(e) => patch(i, { label: e.target.value })} placeholder="Field label" className={`${inputCls} flex-1`} />
                    <button onClick={() => removeField(i)} title="Remove" className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5h6v2m-1 0 .8 13H8.2L9 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <select value={f.type} onChange={(e) => patch(i, { type: e.target.value as TaskFieldType })} className={inputCls}>
                      {FIELD_TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-600">
                      <input type="checkbox" checked={f.required} onChange={(e) => patch(i, { required: e.target.checked })} className="h-4 w-4 cursor-pointer rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                      Required
                    </label>
                  </div>
                  {f.type === "select" && (
                    <input
                      value={f.options.join(", ")}
                      onChange={(e) => patch(i, { options: e.target.value.split(",").map((o) => o.replace(/^\s+|\s+$/g, "")) })}
                      placeholder="Options, comma separated (e.g. Low, Medium, High)"
                      className={`${inputCls} mt-2`}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

/** Render one custom field's input (text / textarea / number / date / dropdown). */
export { FIELD_TYPE_OPTIONS };
