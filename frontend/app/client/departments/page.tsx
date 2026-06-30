"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  restoreDepartment,
  type Department,
} from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import { useClient } from "../ClientContext";
import { PageHeader, Card, Modal, SkeletonText } from "../../admin/ui";

const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

interface Draft {
  id?: number;
  name: string;
}

export default function DepartmentsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useClient();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [archived, setArchived] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    return getDepartments()
      .then((d) => {
        setDepartments(d.departments ?? []);
        setArchived(d.archived ?? []);
      })
      .catch(() => toast.error("Could not load departments."))
      .finally(() => setLoading(false));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!draft) return;
    if (draft.name.trim().length < 1) { toast.warning("Enter a department name."); return; }
    setSaving(true);
    try {
      if (draft.id) { await updateDepartment(draft.id, draft.name); toast.success("Department updated."); }
      else { await createDepartment(draft.name); toast.success("Department added."); }
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function archive(d: Department) {
    const ok = await confirm({
      danger: true,
      title: `Archive ${d.name}?`,
      message: (
        <>
          This archives <b>{d.name}</b>. You can restore it anytime; no data is lost and staff assigned to it keep their history.
        </>
      ),
      confirmLabel: "Yes, archive",
      cancelLabel: "No, keep it",
    });
    if (!ok) return;
    try { await deleteDepartment(d.id); toast.success("Department archived."); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not archive."); }
  }

  async function restore(d: Department) {
    try { await restoreDepartment(d.id); toast.success("Department restored."); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not restore."); }
  }

  return (
    <>
      <PageHeader
        title="Departments"
        subtitle="Organise your team into departments. Archived departments can be restored anytime."
        action={can("team", "create") ? <button onClick={() => setDraft({ name: "" })} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"><svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>Add department</button> : undefined}
      />

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-slate-500">{departments.length} active {departments.length === 1 ? "department" : "departments"}</p>
          {archived.length > 0 && (
            <button onClick={() => setShowArchived((v) => !v)} className="text-sm font-medium text-slate-500 hover:text-slate-700">
              {showArchived ? "Hide" : "Show"} archived ({archived.length})
            </button>
          )}
        </div>

        {loading ? (
          <SkeletonText lines={6} className="py-2" />
        ) : departments.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">No departments yet. Click “Add department” to create one.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {departments.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-3">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{d.name}</span>
                {can("team", "update") && (
                  <button onClick={() => setDraft({ id: d.id, name: d.name })} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Edit">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                )}
                {can("team", "delete") && (
                  <button onClick={() => archive(d)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" aria-label="Archive">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {showArchived && archived.length > 0 && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Archived</div>
            <ul className="divide-y divide-slate-100">
              {archived.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-400 line-through">{d.name}</span>
                  <button onClick={() => restore(d)} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8m0-5v5h5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={`${draft?.id ? "Edit" : "New"} department`}>
        {draft && (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-600">Name</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Sales" className={field} autoFocus onKeyDown={(e) => e.key === "Enter" && save()} />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setDraft(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={save} disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
