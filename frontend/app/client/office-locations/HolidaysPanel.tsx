"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getHolidays,
  createHoliday,
  updateHoliday,
  deleteHoliday,
  type Holiday,
  type OfficeLocation,
} from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import { SearchSelect, type SelectOption } from "../../admin/SearchSelect";
import { fmtDate } from "../../admin/ui";

const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

interface HDraft { id?: number; holiday_date: string; name: string; office_location_id: string }

/** Year-wise holiday calendar. Holidays scoped to an office (or all offices) are
 *  excluded from the first-response SLA. */
export default function HolidaysPanel({
  offices, canCreate, canUpdate, canDelete,
}: {
  offices: OfficeLocation[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [holidays, setHolidays] = useState<Holiday[] | null>(null);
  const [years, setYears] = useState<number[]>([thisYear]);
  const [draft, setDraft] = useState<HDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback((y: number) => {
    return getHolidays(y)
      .then((d) => { setHolidays(d.holidays ?? []); setYears(d.years?.length ? d.years : [y]); })
      .catch(() => { setHolidays([]); toast.error("Could not load holidays."); });
  }, [toast]);
  useEffect(() => { load(year); }, [load, year]);

  const officeOptions = useMemo<SelectOption[]>(
    () => [{ value: "", label: "All offices" }, ...offices.map((o) => ({ value: String(o.id), label: o.name }))],
    [offices],
  );

  // Offer a couple of future years to add ahead, plus any that already have data.
  const yearChoices = useMemo(() => {
    const set = new Set<number>([...years, thisYear, thisYear + 1, year]);
    return [...set].sort((a, b) => b - a);
  }, [years, thisYear, year]);

  async function save() {
    if (!draft) return;
    if (!draft.holiday_date) { toast.warning("Pick a date."); return; }
    if (draft.name.trim().length < 1) { toast.warning("Enter a holiday name."); return; }
    setSaving(true);
    try {
      const body = { holiday_date: draft.holiday_date, name: draft.name.trim(), office_location_id: draft.office_location_id ? Number(draft.office_location_id) : 0 };
      if (draft.id) { await updateHoliday(draft.id, body); toast.success("Holiday updated."); }
      else { await createHoliday(body); toast.success("Holiday added."); }
      const y = Number(draft.holiday_date.slice(0, 4)) || year;
      setDraft(null);
      if (y !== year) setYear(y); else await load(year);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
    finally { setSaving(false); }
  }

  async function remove(h: Holiday) {
    const ok = await confirm({ danger: true, title: "Delete holiday?", message: <><b>{h.name}</b> ({fmtDate(h.holiday_date)}) will be removed.</>, confirmLabel: "Yes, delete", cancelLabel: "No, keep it" });
    if (!ok) return;
    try { await deleteHoliday(h.id); toast.success("Holiday deleted."); await load(year); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete"); }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-600">Year</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15">
            {yearChoices.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{holidays?.length ?? 0} holiday{(holidays?.length ?? 0) === 1 ? "" : "s"}</span>
        </div>
        {canCreate && (
          <button onClick={() => setDraft({ holiday_date: `${year}-01-01`, name: "", office_location_id: "" })} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>Add holiday
          </button>
        )}
      </div>

      {holidays === null ? (
        <div className="py-10 text-center text-sm text-slate-400">Loading…</div>
      ) : holidays.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400">No holidays for {year}. Add your first one.</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center gap-3 py-2.5">
              <span className="flex h-10 w-12 flex-shrink-0 flex-col items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                <span className="text-[10px] font-semibold uppercase leading-none">{new Date(h.holiday_date.replace(" ", "T")).toLocaleDateString(undefined, { month: "short" })}</span>
                <span className="text-base font-bold leading-none">{h.holiday_date.slice(8, 10)}</span>
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800">{h.name}</div>
                <div className="text-xs text-slate-400">{fmtDate(h.holiday_date)} · {h.office_name ? h.office_name : "All offices"}</div>
              </div>
              {canUpdate && (
                <button onClick={() => setDraft({ id: h.id, holiday_date: h.holiday_date.slice(0, 10), name: h.name, office_location_id: h.office_location_id ? String(h.office_location_id) : "" })} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Edit">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              )}
              {canDelete && (
                <button onClick={() => remove(h)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" aria-label="Delete">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add / edit holiday — inline modal */}
      {draft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={() => !saving && setDraft(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-semibold text-slate-900">{draft.id ? "Edit holiday" : "Add holiday"}</h3>
            <div className="space-y-3">
              <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Date</span>
                <input type="date" value={draft.holiday_date} onChange={(e) => setDraft({ ...draft, holiday_date: e.target.value })} className={field} autoFocus />
              </label>
              <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Name</span>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Independence Day" className={field} />
              </label>
              <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Applies to</span>
                <SearchSelect ariaLabel="Office" value={draft.office_location_id} onChange={(v) => setDraft({ ...draft, office_location_id: v })} options={officeOptions} placeholder="All offices" searchPlaceholder="Search offices…" />
              </label>
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
