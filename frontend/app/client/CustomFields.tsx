"use client";

import { SearchSelect } from "../admin/SearchSelect";
import type { CustomField } from "../lib/client";

const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

/**
 * Render inputs for a form's admin-defined custom fields, bound to a values map
 * (key → string). Shared by the lead, visitor and staff forms. Validation errors
 * are keyed `custom_<key>` to match the backend.
 */
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
      {fields.map((f) => {
        const ek = `custom_${f.key}`;
        const val = values[f.key] ?? "";
        const err = errors?.[ek];
        const cls = `${field} ${err ? "border-rose-300" : ""}`;
        return (
          <div key={f.key}>
            <span className="mb-1 block text-sm font-medium text-slate-600">{f.label}{f.required && <span className="text-rose-500"> *</span>}</span>
            {f.type === "textarea" ? (
              <textarea value={val} onChange={(e) => onChange(f.key, e.target.value)} rows={3} className={cls} />
            ) : f.type === "select" ? (
              <SearchSelect ariaLabel={f.label} value={val} onChange={(v) => onChange(f.key, v)} options={[{ value: "", label: "— Select —" }, ...f.options.map((o) => ({ value: o, label: o }))]} placeholder="— Select —" searchPlaceholder="Search…" className={err ? "ring-2 ring-rose-500/30" : ""} />
            ) : (
              <input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} value={val} onChange={(e) => onChange(f.key, e.target.value)} className={cls} />
            )}
            {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}
          </div>
        );
      })}
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
