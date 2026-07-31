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
  headerExtra,
  hintFields,
  hints,
  orderFields,
  order,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  requirableFields: { key: string; label: string }[];
  required: Set<string>;
  customFields: TaskCustomField[];
  onSave: (body: { required_fields: string[]; custom_fields: TaskCustomField[]; hints: Record<string, string>; order: string[] }) => Promise<{ required_fields: string[]; custom_fields: TaskCustomField[] }>;
  onSaved: (req: string[], custom: TaskCustomField[]) => void;
  /** Extra controls rendered at the top of the drawer body (e.g. a scope picker). */
  headerExtra?: React.ReactNode;
  /** Fields whose hint/tagline the admin can customize (with defaults). */
  hintFields?: { key: string; label: string; default: string }[];
  /** Current hint overrides (fieldKey → text). */
  hints?: Record<string, string>;
  /** Built-in form fields the admin can rearrange + preview (enables the Arrange & Preview sections). */
  orderFields?: { key: string; label: string; readOnly?: boolean }[];
  /** Current saved field display order (list of keys). */
  order?: string[];
}) {
  const toast = useToast();
  const [req, setReq] = useState<Set<string>>(required);
  const [fields, setFields] = useState<TaskCustomField[]>(customFields);
  const [hintVals, setHintVals] = useState<Record<string, string>>(hints ?? {});
  const [orderState, setOrderState] = useState<string[]>(order ?? []);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReq(new Set(required));
    setFields(customFields.map((f) => ({ ...f, options: [...f.options] })));
    setHintVals({ ...(hints ?? {}) });
    setOrderState([...(order ?? [])]);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // The fields available to arrange: built-ins (from orderFields) + custom fields,
  // resolved into the saved order with any newcomers appended. Custom fields can be
  // positioned anywhere among the built-ins (preview + real form honour it).
  const hintDefaultOf = (key: string) => hintFields?.find((h) => h.key === key)?.default ?? "";
  const arrangeItems = orderFields
    ? [
        ...orderFields.map((f) => ({ key: f.key, label: f.label, required: req.has(f.key), custom: false, type: undefined as TaskFieldType | undefined, readOnly: !!f.readOnly })),
        ...fields.filter((f) => f.label.trim()).map((f) => ({ key: f.key || slugify(f.label), label: f.label.trim(), required: f.required, custom: true, type: f.type, readOnly: false })),
      ]
    : [];
  const orderedKeys = [
    ...orderState.filter((k) => arrangeItems.some((i) => i.key === k)),
    ...arrangeItems.filter((i) => !orderState.includes(i.key)).map((i) => i.key),
  ];
  const orderedItems = orderedKeys.map((k) => arrangeItems.find((i) => i.key === k)!).filter(Boolean);

  const moveField = (key: string, dir: -1 | 1) => {
    const keys = [...orderedKeys];
    const i = keys.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    setOrderState(keys);
  };
  const dropOn = (targetKey: string) => {
    if (!dragKey || dragKey === targetKey) { setDragKey(null); return; }
    const keys = orderedKeys.filter((k) => k !== dragKey);
    keys.splice(keys.indexOf(targetKey), 0, dragKey);
    setOrderState(keys);
    setDragKey(null);
  };
  // What kind of mock input the preview should draw for a field.
  const SELECT_KEYS = ["status_id", "sub_status_id", "source_id", "lead_type_id", "assigned_to", "reference_name"];
  const kindOf = (it: { key: string; custom: boolean; type?: TaskFieldType; readOnly: boolean }): string => {
    if (it.readOnly) return "readonly";
    if (it.custom) return it.type ?? "text";
    if (it.key === "description") return "textarea";
    return SELECT_KEYS.includes(it.key) ? "select" : "text";
  };
  const previewInput = (it: { key: string; custom: boolean; type?: TaskFieldType; readOnly: boolean }) => {
    const kind = kindOf(it);
    if (kind === "readonly") return <div className="mt-1 h-8 rounded-md border border-dashed border-slate-200 bg-white px-2 text-[11px] leading-8 text-slate-300">Set automatically</div>;
    if (kind === "textarea") return <div className="mt-1 h-14 rounded-md border border-slate-200 bg-white" />;
    if (kind === "select") return (
      <div className="mt-1 flex h-8 items-center justify-between rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-300">
        <span>Select…</span>
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
    );
    if (kind === "date") return <div className="mt-1 flex h-8 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-300">dd / mm / yyyy</div>;
    return <div className="mt-1 h-8 rounded-md border border-slate-200 bg-white" />;
  };

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
    const cleanHints = Object.fromEntries(Object.entries(hintVals).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    // Persist the order over FINAL keys (a custom field's key is settled on save).
    const cleanOrder = orderFields
      ? orderedKeys.map((k) => {
          const it = arrangeItems.find((i) => i.key === k);
          if (!it?.custom) return k;
          const cf = clean.find((c) => (c.key || slugify(c.label)) === k || c.label.trim() === it.label);
          return cf?.key ?? k;
        })
      : [];
    setSaving(true);
    try {
      const d = await onSave({ required_fields: [...req], custom_fields: clean, hints: cleanHints, order: cleanOrder });
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
        {headerExtra}
        {requirableFields.length > 0 && (
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
        )}

        {hintFields && hintFields.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Field hints / taglines</h4>
            <p className="mt-0.5 text-xs text-slate-400">Customize the helper text under each field. Leave blank to use the default.</p>
            <div className="mt-3 space-y-2.5">
              {hintFields.map((f) => {
                const effective = (hintVals[f.key] ?? "").trim() || f.default;
                return (
                  <div key={f.key} className="rounded-lg border border-slate-200 p-2.5">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-700">{f.label}</span>
                      {(hintVals[f.key] ?? "").trim() && <button type="button" onClick={() => setHintVals((h) => ({ ...h, [f.key]: "" }))} className="text-[11px] font-medium text-slate-400 hover:text-slate-600">Reset to default</button>}
                    </div>
                    <textarea
                      value={hintVals[f.key] ?? ""}
                      onChange={(e) => setHintVals((h) => ({ ...h, [f.key]: e.target.value }))}
                      placeholder={f.default || "No hint by default"}
                      rows={2}
                      maxLength={300}
                      className={inputCls}
                    />
                    {/* Live preview of the field + its effective hint. */}
                    <div className="mt-2 rounded-md bg-slate-50 px-2.5 py-2">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Preview</div>
                      <div className="mt-1 text-sm font-medium text-slate-700">{f.label}</div>
                      {effective && <div className="text-[11px] text-slate-400">{effective}</div>}
                      <div className="mt-1 h-7 rounded border border-slate-200 bg-white" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {orderFields && orderedItems.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Arrange fields</h4>
            <p className="mt-0.5 text-xs text-slate-400">Drag a field — or use the arrows — to change the order it appears on the form.</p>
            <div className="mt-3 space-y-1.5">
              {orderedItems.map((it, i) => (
                <div
                  key={it.key}
                  draggable
                  onDragStart={() => setDragKey(it.key)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dropOn(it.key)}
                  onDragEnd={() => setDragKey(null)}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition ${dragKey === it.key ? "border-emerald-400 bg-emerald-50/60" : "border-slate-200 bg-white hover:border-slate-300"}`}
                >
                  <svg className="h-4 w-4 flex-shrink-0 cursor-grab text-slate-300" fill="currentColor" viewBox="0 0 24 24"><path d="M9 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9-14a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" /></svg>
                  <span className="flex-1 truncate font-medium text-slate-700">
                    {it.label}
                    {it.required && <span className="ml-1 text-rose-500">*</span>}
                    {it.custom && <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-500">custom</span>}
                    {it.readOnly && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">auto</span>}
                  </span>
                  <span className="w-5 flex-shrink-0 text-right text-[11px] text-slate-300">{i + 1}</span>
                  <div className="flex flex-shrink-0 flex-col text-slate-400">
                    <button type="button" onClick={() => moveField(it.key, -1)} disabled={i === 0} title="Move up" className="leading-none hover:text-slate-700 disabled:opacity-30">
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    <button type="button" onClick={() => moveField(it.key, 1)} disabled={i === orderedItems.length - 1} title="Move down" className="leading-none hover:text-slate-700 disabled:opacity-30">
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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

        {orderFields && orderedItems.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Preview</h4>
            <p className="mt-0.5 text-xs text-slate-400">How the form will show with the current fields, order &amp; hints.</p>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {orderedItems.map((it) => {
                  const hint = (hintVals[it.key] ?? "").trim() || hintDefaultOf(it.key);
                  return (
                    <div key={it.key} className={it.key === "description" ? "sm:col-span-2" : ""}>
                      <div className="text-xs font-medium text-slate-600">{it.label}{it.required && <span className="ml-0.5 text-rose-500">*</span>}</div>
                      {previewInput(it)}
                      {hint && <div className="mt-0.5 text-[10px] leading-snug text-slate-400">{hint}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

/** Render one custom field's input (text / textarea / number / date / dropdown). */
export { FIELD_TYPE_OPTIONS };
