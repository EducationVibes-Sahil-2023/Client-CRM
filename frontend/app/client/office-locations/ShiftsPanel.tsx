"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getShifts,
  createShift,
  updateShift,
  deleteShift,
  type Shift,
  type WorkingHoursDay,
} from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";

const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const defaultHours = (): WorkingHoursDay[] =>
  Array.from({ length: 7 }, (_, d) => ({ off: d === 0, open: "10:00", close: "19:00" }));
const summarise = (wh?: WorkingHoursDay[]): string => {
  if (!wh || wh.length !== 7) return "Not set";
  const on = DAY_ORDER.filter((d) => !wh[d].off);
  if (on.length === 0) return "Closed all week";
  return `${on.map((d) => DAY_LABELS[d]).join(", ")} · ${wh[on[0]].open}–${wh[on[0]].close}`;
};

interface SDraft { id?: number; name: string; working_hours: WorkingHoursDay[] }

/** Named work shifts (weekly schedules), assignable to staff — feed first-response. */
export default function ShiftsPanel({ canCreate, canUpdate, canDelete }: { canCreate: boolean; canUpdate: boolean; canDelete: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [draft, setDraft] = useState<SDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    return getShifts().then((d) => setShifts(d.shifts ?? [])).catch(() => { setShifts([]); toast.error("Could not load shifts."); });
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!draft) return;
    if (draft.name.trim().length < 1) { toast.warning("Enter a shift name."); return; }
    setSaving(true);
    try {
      const body = { name: draft.name.trim(), working_hours: draft.working_hours };
      if (draft.id) { await updateShift(draft.id, body); toast.success("Shift updated."); }
      else { await createShift(body); toast.success("Shift added."); }
      setDraft(null); await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
    finally { setSaving(false); }
  }

  async function remove(s: Shift) {
    const ok = await confirm({ danger: true, title: "Delete shift?", message: <><b>{s.name}</b> will be removed and unmapped from any staff on it.</>, confirmLabel: "Yes, delete", cancelLabel: "No, keep it" });
    if (!ok) return;
    try { await deleteShift(s.id); toast.success("Shift deleted."); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete"); }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-600">Shifts</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{shifts?.length ?? 0}</span>
        </div>
        {canCreate && (
          <button onClick={() => setDraft({ name: "", working_hours: defaultHours() })} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>Add shift
          </button>
        )}
      </div>

      {shifts === null ? (
        <div className="py-10 text-center text-sm text-slate-400">Loading…</div>
      ) : shifts.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400">No shifts yet. Add a shift and map staff to it in the Team page.</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {shifts.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2.5">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800">{s.name}</div>
                <div className="text-xs text-slate-400">{summarise(s.working_hours)}</div>
              </div>
              {canUpdate && (
                <button onClick={() => setDraft({ id: s.id, name: s.name, working_hours: (s.working_hours && s.working_hours.length === 7) ? s.working_hours.map((h) => ({ ...h })) : defaultHours() })} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Edit">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              )}
              {canDelete && (
                <button onClick={() => remove(s)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" aria-label="Delete">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={() => !saving && setDraft(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-semibold text-slate-900">{draft.id ? "Edit shift" : "Add shift"}</h3>
            <label className="mb-3 block text-sm"><span className="mb-1 block font-medium text-slate-600">Name</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Morning, Night" className={field} autoFocus />
            </label>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Weekly hours</div>
            <div className="space-y-1.5">
              {DAY_ORDER.map((d) => {
                const h = draft.working_hours[d];
                const setDay = (patch: Partial<WorkingHoursDay>) =>
                  setDraft((dr) => dr && { ...dr, working_hours: dr.working_hours.map((x, i) => (i === d ? { ...x, ...patch } : x)) });
                return (
                  <div key={d} className="flex items-center gap-2">
                    <span className="w-10 text-sm font-medium text-slate-600">{DAY_LABELS[d]}</span>
                    <label className="flex items-center gap-1.5 text-xs text-slate-500">
                      <input type="checkbox" checked={!h.off} onChange={(e) => setDay({ off: !e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                      Open
                    </label>
                    <input type="time" value={h.open} disabled={h.off} onChange={(e) => setDay({ open: e.target.value })} className={`${field} w-28 py-1 ${h.off ? "opacity-40" : ""}`} />
                    <span className="text-slate-400">–</span>
                    <input type="time" value={h.close} disabled={h.off} onChange={(e) => setDay({ close: e.target.value })} className={`${field} w-28 py-1 ${h.off ? "opacity-40" : ""}`} />
                    {h.off && <span className="text-xs font-medium text-slate-400">Off</span>}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setDraft(null)} disabled={saving} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
              <button onClick={save} disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? "Saving…" : draft.id ? "Save" : "Add"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
