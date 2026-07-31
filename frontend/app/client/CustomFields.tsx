"use client";

import { SearchSelect } from "../admin/SearchSelect";
import type { CustomField } from "../lib/client";

const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

/**
 * Render inputs for a form's admin-defined custom fields, bound to a values map
 * (key → string). Shared by the lead, visitor and staff forms. Validation errors
 * are keyed `custom_<key>` to match the backend.
 */
/** One custom field's label + input (shared by the grouped renderer and the
 * interleaved lead form where fields sit at their arranged positions). */
export function CustomFieldCell({
  field: f, value, onChange, error,
}: {
  field: CustomField;
  value: string;
  onChange: (val: string) => void;
  error?: string;
}) {
  const cls = `${field} ${error ? "border-rose-300" : ""}`;
  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-slate-600">{f.label}{f.required && <span className="text-rose-500"> *</span>}</span>
      {f.type === "textarea" ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className={cls} />
      ) : f.type === "select" ? (
        <SearchSelect ariaLabel={f.label} value={value} onChange={onChange} options={[{ value: "", label: "— Select —" }, ...f.options.map((o) => ({ value: o, label: o }))]} placeholder="— Select —" searchPlaceholder="Search…" className={error ? "ring-2 ring-rose-500/30" : ""} />
      ) : (
        <input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} value={value} onChange={(e) => onChange(e.target.value)} className={cls} />
      )}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

export function CustomFieldInputs({
  fields, values, onChange, errors, className = "sm:col-span-2",
}: {
  fields: CustomField[];
  values: Record<string, string>;
  onChange: (key: string, val: string) => void;
  errors?: Record<string, string>;
  className?: string;
}) {
  if (!fields.length) return null;
  return (
    <div className={`space-y-3 border-t border-slate-100 pt-3 ${className}`}>
      {fields.map((f) => (
        <CustomFieldCell key={f.key} field={f} value={values[f.key] ?? ""} onChange={(v) => onChange(f.key, v)} error={errors?.[`custom_${f.key}`]} />
      ))}
    </div>
  );
}

/** Validate required custom fields into an errors map (key `custom_<key>`). */
export function customFieldErrors(fields: CustomField[], values: Record<string, string>): Record<string, string> {
  const e: Record<string, string> = {};
  for (const f of fields) {
    if (f.required && !String(values[f.key] ?? "").trim()) e[`custom_${f.key}`] = `${f.label} is required.`;
  }
  return e;
}
