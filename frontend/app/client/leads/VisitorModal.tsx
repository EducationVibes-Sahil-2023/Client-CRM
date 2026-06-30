"use client";

import { useEffect, useState } from "react";
import { Modal } from "../../admin/ui";
import { SearchSelect, type SelectOption } from "../../admin/SearchSelect";
import { createVisitor, updateVisitor, getFormSetup, type VisitorType, type VisitorStatus, type Staff, type CustomField } from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";
import { CustomFieldInputs, customFieldErrors } from "../CustomFields";
import RichTextEditor from "../../admin/RichTextEditor";

const HEX: Record<string, string> = {
  indigo: "#6366f1", violet: "#8b5cf6", emerald: "#10b981", amber: "#f59e0b",
  rose: "#f43f5e", sky: "#0ea5e9", teal: "#14b8a6", pink: "#ec4899",
  orange: "#f97316", lime: "#84cc16", cyan: "#06b6d4", slate: "#94a3b8",
};
const toHex = (c?: string) => (!c ? HEX.slate : c.startsWith("#") ? c : HEX[c] ?? HEX.slate);
const dot = (c?: string) => <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: toHex(c) }} />;
const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

/** The editable shape of a visitor in the add/edit form. */
export interface VDraft {
  id?: number;
  name: string; phone: string; email: string;
  type_id: string; status_id: string; assigned_to: string; lead_id: string;
  purpose: string; visit_date: string; notes: string;
  /** Whether the visitor's *current* status is finalised (drives the status lock). */
  status_final: boolean;
  /** Admin-defined custom field values, keyed by field key. */
  custom: Record<string, string>;
}

/** A blank draft, defaulting type/status to the first option. */
export const blankVisitorDraft = (types: VisitorType[], statuses: VisitorStatus[]): VDraft => ({
  name: "", phone: "", email: "",
  type_id: types[0] ? String(types[0].id) : "",
  status_id: statuses[0] ? String(statuses[0].id) : "",
  assigned_to: "", lead_id: "", purpose: "", visit_date: "", notes: "", status_final: false, custom: {},
});

/** Pre-fill a visitor draft from a lead (used by the "Log visitor" lead action). */
export const visitorDraftFromLead = (
  lead: { id: number; name?: string | null; phone?: string | null; email?: string | null },
  types: VisitorType[], statuses: VisitorStatus[],
): VDraft => ({
  ...blankVisitorDraft(types, statuses),
  name: lead.name?.trim() || "",
  phone: lead.phone || "",
  email: lead.email || "",
  lead_id: String(lead.id),
});

/**
 * Shared add/edit visitor modal. The form is controlled by `draft`/`setDraft`;
 * on save it persists and calls `onDone` (close + refresh). Used by both the
 * Visitors tab and the per-lead "Log visitor" action.
 */
export default function VisitorModal({
  draft, setDraft, types, statuses, staff, leadOpts, canManage, onDone,
}: {
  draft: VDraft | null;
  setDraft: (d: VDraft | null) => void;
  types: VisitorType[];
  statuses: VisitorStatus[];
  staff: Staff[];
  leadOpts: SelectOption[];
  canManage: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  useEffect(() => { getFormSetup("visitor").then((d) => setCustomFields(d.custom_fields)).catch(() => {}); }, []);

  const typeOpts: SelectOption[] = types.map((t) => ({ value: String(t.id), label: t.name, prefix: dot(t.color) }));
  const statusOpts: SelectOption[] = statuses.map((s) => ({ value: String(s.id), label: s.name, prefix: dot(s.color) }));
  const staffOpts: SelectOption[] = staff.map((s) => ({ value: String(s.id), label: s.name }));

  const setF = <K extends keyof VDraft>(k: K, val: VDraft[K]) => setDraft(draft ? { ...draft, [k]: val } : draft);
  // Once finalised, only an admin can change the status of an existing visitor.
  const statusLocked = !!draft?.id && draft.status_final && !canManage;

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) { toast.warning("Enter the visitor's name."); return; }
    const ce = customFieldErrors(customFields, draft.custom);
    setErrors(ce);
    if (Object.keys(ce).length) return;
    setSaving(true);
    try {
      const body = {
        name: draft.name, phone: draft.phone, email: draft.email,
        type_id: draft.type_id, status_id: draft.status_id, assigned_to: draft.assigned_to,
        lead_id: draft.lead_id, purpose: draft.purpose, visit_date: draft.visit_date, notes: draft.notes,
        custom_fields: draft.custom,
      };
      if (draft.id) await updateVisitor(draft.id, body); else await createVisitor(body);
      toast.success(draft.id ? "Visitor updated." : "Visitor logged.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the visitor.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? "Edit visitor" : "Log visitor"}>
      {draft && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Name</span><input value={draft.name} onChange={(e) => setF("name", e.target.value)} className={field} placeholder="Visitor name" autoFocus /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Phone</span><input value={draft.phone} onChange={(e) => setF("phone", e.target.value)} className={field} /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Email</span><input value={draft.email} onChange={(e) => setF("email", e.target.value)} className={field} type="email" /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Visit date</span><input value={draft.visit_date} onChange={(e) => setF("visit_date", e.target.value)} className={field} type="datetime-local" /></label>
          <div className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Type</span><SearchSelect ariaLabel="Type" value={draft.type_id} onChange={(v) => setF("type_id", v)} options={typeOpts} placeholder="Select type…" /></div>
          <div className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Status</span>
            {statusLocked
              ? <div className={`${field} bg-slate-50 text-slate-500`}>{statuses.find((s) => String(s.id) === draft.status_id)?.name ?? "—"} <span className="text-xs text-amber-600">· finalised</span></div>
              : <SearchSelect ariaLabel="Status" value={draft.status_id} onChange={(v) => setF("status_id", v)} options={statusOpts} placeholder="Select status…" />}
          </div>
          <div className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Assigned to</span><SearchSelect ariaLabel="Assigned to" value={draft.assigned_to} onChange={(v) => setF("assigned_to", v)} options={staffOpts} placeholder="Unassigned" searchPlaceholder="Search team…" /></div>
          <div className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Linked lead <span className="font-normal text-slate-400">(optional)</span></span><SearchSelect ariaLabel="Linked lead" value={draft.lead_id} onChange={(v) => setF("lead_id", v)} options={leadOpts} placeholder="— Not linked —" searchPlaceholder="Search leads…" /></div>
          <label className="block text-sm sm:col-span-2"><span className="mb-1 block font-medium text-slate-600">Purpose</span><input value={draft.purpose} onChange={(e) => setF("purpose", e.target.value)} className={field} placeholder="Reason for the visit" /></label>
          <div className="block text-sm sm:col-span-2"><span className="mb-1 block font-medium text-slate-600">Notes</span><RichTextEditor key={`vnotes-${draft.id ?? "new"}`} initialHTML={draft.notes} onChange={(html) => setF("notes", html)} placeholder="Notes about the visit…" minHeight={120} /></div>
          {statusLocked && <p className="text-xs text-amber-600 sm:col-span-2">This visit is finalised — only an admin can change its status.</p>}
          <CustomFieldInputs fields={customFields} values={draft.custom} onChange={(k, v) => setDraft({ ...draft, custom: { ...draft.custom, [k]: v } })} errors={errors} />
          <div className="flex justify-end gap-2 pt-1 sm:col-span-2">
            <button onClick={() => setDraft(null)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={save} disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? "Saving…" : draft.id ? "Save changes" : "Log visitor"}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
