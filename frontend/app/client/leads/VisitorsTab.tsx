"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getVisitors, getVisitorSetup, deleteVisitor,
  createVisitorType, deleteVisitorType, createVisitorStatus, updateVisitorStatus, deleteVisitorStatus,
  getStaff, getLeads,
  type Visitor, type VisitorType, type VisitorStatus, type Staff,
} from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import { Drawer, EmptyState, Spinner, fmtDateTime } from "../../admin/ui";
import { DataTable, IconButton, type Column } from "../../admin/DataTable";
import { MultiSelect, type SelectOption } from "../../admin/SearchSelect";
import { DateRangeFilter, inDateRange, rangeActive, EMPTY_RANGE, type DateRange } from "../../admin/dateFilter";
import { FilterRail, FilterToggle, FilterLabel, filterRailPad } from "../FilterRail";
import VisitorModal, { blankVisitorDraft, type VDraft } from "./VisitorModal";
import { PerfSummary } from "./DateSummary";

const HEX: Record<string, string> = {
  indigo: "#6366f1", violet: "#8b5cf6", emerald: "#10b981", amber: "#f59e0b",
  rose: "#f43f5e", sky: "#0ea5e9", teal: "#14b8a6", pink: "#ec4899",
  orange: "#f97316", lime: "#84cc16", cyan: "#06b6d4", slate: "#94a3b8",
};
const toHex = (c?: string) => (!c ? HEX.slate : c.startsWith("#") ? c : HEX[c] ?? HEX.slate);
const dot = (c?: string) => <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: toHex(c) }} />;
const chip = (label: string | null, color: string) => (label ? <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{dot(color)}{label}</span> : <span className="text-slate-400">—</span>);

const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";
const COLORS = ["indigo", "violet", "emerald", "amber", "rose", "sky", "teal", "pink", "orange", "lime", "cyan", "slate"];

const FILTERS = { type: [] as string[], status: [] as string[], assign: [] as string[], date: EMPTY_RANGE as DateRange };
// Default to the last 7 days (on visit date); Reset clears to "all" via FILTERS.
const DEFAULTS = { ...FILTERS, date: { preset: "7d" } as DateRange };
type Filters = typeof FILTERS;

export default function VisitorsTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Visitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [types, setTypes] = useState<VisitorType[]>([]);
  const [statuses, setStatuses] = useState<VisitorStatus[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [leads, setLeads] = useState<{ id: number; label: string }[]>([]);

  const [search, setSearch] = useState("");
  const [draftF, setDraftF] = useState<Filters>(DEFAULTS);
  const [applied, setApplied] = useState<Filters>(DEFAULTS);
  const [railOpen, setRailOpen] = useState(false);

  const [draft, setDraft] = useState<VDraft | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    return getVisitors()
      .then((d) => { setRows(d.visitors ?? []); setCanManage(d.can_manage); })
      .catch(() => toast.error("Could not load visitors."))
      .finally(() => setLoading(false));
  }, [toast]);
  const loadSetup = useCallback(() => getVisitorSetup().then((d) => { setTypes(d.types ?? []); setStatuses(d.statuses ?? []); setCanManage(d.can_manage); }).catch(() => {}), []);
  useEffect(() => { load(); loadSetup(); }, [load, loadSetup]);
  useEffect(() => { getStaff().then((d) => setStaff(d.staff ?? [])).catch(() => {}); }, []);
  useEffect(() => { getLeads().then((d) => setLeads((d.leads ?? []).map((l) => ({ id: l.id, label: (l.name?.trim() || l.phone) })))).catch(() => {}); }, []);

  const typeOpts: SelectOption[] = useMemo(() => types.map((t) => ({ value: String(t.id), label: t.name, prefix: dot(t.color) })), [types]);
  const statusOpts: SelectOption[] = useMemo(() => statuses.map((s) => ({ value: String(s.id), label: s.name, prefix: dot(s.color) })), [statuses]);
  const staffOpts: SelectOption[] = useMemo(() => staff.map((s) => ({ value: String(s.id), label: s.name })), [staff]);
  const leadOpts: SelectOption[] = useMemo(() => [{ value: "", label: "— Not linked —" }, ...leads.map((l) => ({ value: String(l.id), label: l.label }))], [leads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((v) => {
      if (applied.type.length && !applied.type.includes(String(v.type_id ?? ""))) return false;
      if (applied.status.length && !applied.status.includes(String(v.status_id ?? ""))) return false;
      if (applied.assign.length && !applied.assign.includes(String(v.assigned_to ?? ""))) return false;
      if (!inDateRange(v.visit_date ?? v.created_at, applied.date)) return false;
      if (q && ![v.name, v.phone, v.email, v.purpose, v.type_name, v.status_name, v.assigned_name, v.lead_name].some((x) => (x ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, applied, search]);

  const appliedCount = [applied.type.length, applied.status.length, applied.assign.length, rangeActive(applied.date)].filter(Boolean).length;
  const dirty = useMemo(() => JSON.stringify(draftF) !== JSON.stringify(applied), [draftF, applied]);
  const draftSet = !!(draftF.type.length || draftF.status.length || draftF.assign.length || rangeActive(draftF.date));

  function openNew() { setDraft(blankVisitorDraft(types, statuses)); }
  function openEdit(v: Visitor) {
    setDraft({
      id: v.id, name: v.name, phone: v.phone ?? "", email: v.email ?? "",
      type_id: v.type_id ? String(v.type_id) : "", status_id: v.status_id ? String(v.status_id) : "",
      assigned_to: v.assigned_to ? String(v.assigned_to) : "", lead_id: v.lead_id ? String(v.lead_id) : "",
      purpose: v.purpose ?? "", visit_date: v.visit_date ? v.visit_date.replace(" ", "T").slice(0, 16) : "",
      notes: v.notes ?? "", status_final: v.status_final, custom: { ...(v.custom_fields ?? {}) },
    });
  }
  async function remove(v: Visitor) {
    if (await confirm({ title: "Delete visitor?", message: `Remove ${v.name} from the visitor log? It is archived (recoverable), not destroyed.`, confirmLabel: "Delete", danger: true })) {
      try { await deleteVisitor(v.id); toast.success("Visitor deleted."); await load(); }
      catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete."); }
    }
  }

  const columns: Column<Visitor>[] = [
    { key: "name", header: "Visitor", width: 170, lockVisible: true, render: (v) => <span className="font-medium text-slate-800">{v.name}</span> },
    { key: "phone", header: "Phone", width: 120, render: (v) => <span className="tabular-nums text-slate-600">{v.phone || "—"}</span> },
    { key: "type", header: "Type", width: 130, render: (v) => chip(v.type_name, v.type_color) },
    { key: "status", header: "Status", width: 150, render: (v) => <span className="inline-flex items-center gap-1">{chip(v.status_name, v.status_color)}{v.status_final && <svg className="h-3 w-3 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-label="Finalised"><path d="M6 10V8a6 6 0 1112 0v2M5 10h14v10H5z" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span> },
    { key: "visit_date", header: "Visit date", width: 150, render: (v) => <span className="text-slate-600">{v.visit_date ? fmtDateTime(v.visit_date) : "—"}</span> },
    { key: "assigned", header: "Assigned", width: 140, render: (v) => <span className="text-slate-600">{v.assigned_name || "—"}</span> },
    { key: "lead", header: "Linked lead", width: 150, defaultHidden: true, render: (v) => <span className="text-slate-600">{v.lead_name || "—"}</span> },
    { key: "purpose", header: "Purpose", width: 200, defaultHidden: true, render: (v) => <span className="text-slate-500">{v.purpose || "—"}</span> },
  ];

  return (
    <div className={filterRailPad(railOpen)}>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2">
          <div className="flex-shrink-0"><FilterToggle open={railOpen} count={appliedCount} onClick={() => { setDraftF(applied); setRailOpen((o) => !o); }} /></div>
          <div className="relative w-full max-w-sm">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, purpose…" className={`${field} pl-9`} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <button onClick={() => setSetupOpen(true)} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10.3 4.3a2 2 0 013.4 0l.4.8 1-.2a2 2 0 012.4 2.4l-.2 1 .8.4a2 2 0 010 3.4l-.8.4.2 1a2 2 0 01-2.4 2.4l-1-.2-.4.8a2 2 0 01-3.4 0l-.4-.8-1 .2a2 2 0 01-2.4-2.4l.2-1-.8-.4a2 2 0 010-3.4l.8-.4-.2-1a2 2 0 012.4-2.4l1 .2z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Configure
            </button>
          )}
          <button onClick={openNew} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
            Log visitor
          </button>
        </div>
      </div>

      {!loading && filtered.length > 0 && (
        <PerfSummary
          title="Counselor performance — visitors handled"
          totalLabel="Total visitors" totalSub="In the selected period"
          activeLabel="Active counselors" topLabel="Top counselor" unit="visitors" color="#10b981"
          rows={Object.values(filtered.reduce((acc, v) => {
            const name = v.assigned_name ?? "Unassigned";
            (acc[name] ??= { name, value: 0 }).value++;
            return acc;
          }, {} as Record<string, { name: string; value: number }>))}
        />
      )}

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState title={rows.length ? "No matching visitors" : "No visitors yet"} hint={rows.length ? "Try clearing the filters." : "Log your first office / seminar visitor."} />
      ) : (
        <DataTable
          tableKey="visitors"
          columns={columns}
          rows={filtered}
          getKey={(v) => v.id}
          nowrap
          paginate
          defaultPageSize={25}
          onRowClick={(v) => openEdit(v)}
          quickActions={(v) => (
            <>
              <IconButton title="Edit" onClick={() => openEdit(v)}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </IconButton>
              <IconButton title="Delete" danger onClick={() => remove(v)}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </IconButton>
            </>
          )}
        />
      )}

      {/* Filters */}
      <FilterRail
        open={railOpen} onClose={() => setRailOpen(false)} dirty={dirty}
        onReset={() => setDraftF(FILTERS)} resetDisabled={!draftSet}
        onApply={() => { setApplied(draftF); setRailOpen(false); }} applyDisabled={!dirty} applyLabel="Apply"
      >
        <div className="space-y-1.5"><FilterLabel>Visitor date</FilterLabel><DateRangeFilter ariaLabel="Visitor date" value={draftF.date} onChange={(v) => setDraftF((d) => ({ ...d, date: v }))} /></div>
        <div className="space-y-1.5"><FilterLabel>Type</FilterLabel><MultiSelect ariaLabel="Type" value={draftF.type} onChange={(v) => setDraftF((d) => ({ ...d, type: v }))} options={typeOpts} placeholder="All types" searchPlaceholder="Search…" /></div>
        <div className="space-y-1.5"><FilterLabel>Status</FilterLabel><MultiSelect ariaLabel="Status" value={draftF.status} onChange={(v) => setDraftF((d) => ({ ...d, status: v }))} options={statusOpts} placeholder="All statuses" searchPlaceholder="Search…" /></div>
        <div className="space-y-1.5"><FilterLabel>Assigned to</FilterLabel><MultiSelect ariaLabel="Assigned" value={draftF.assign} onChange={(v) => setDraftF((d) => ({ ...d, assign: v }))} options={staffOpts} placeholder="Anyone" searchPlaceholder="Search team…" /></div>
      </FilterRail>

      {/* Add / edit visitor — shared with the per-lead "Log visitor" action */}
      <VisitorModal draft={draft} setDraft={setDraft} types={types} statuses={statuses} staff={staff} leadOpts={leadOpts} canManage={canManage} onDone={() => { setDraft(null); load(); }} />

      {/* Admin: manage types & statuses */}
      <SetupDrawer open={setupOpen} onClose={() => setSetupOpen(false)} types={types} statuses={statuses} onChanged={loadSetup} />
    </div>
  );
}

/** Admin drawer to add/remove visitor types & statuses (statuses carry an is_final flag). */
function SetupDrawer({ open, onClose, types, statuses, onChanged }: { open: boolean; onClose: () => void; types: VisitorType[]; statuses: VisitorStatus[]; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [tName, setTName] = useState(""); const [tColor, setTColor] = useState("indigo");
  const [sName, setSName] = useState(""); const [sColor, setSColor] = useState("amber"); const [sFinal, setSFinal] = useState(false);

  async function run(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); toast.success(ok); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Action failed."); }
  }
  const swatches = (val: string, set: (c: string) => void) => (
    <div className="flex flex-wrap gap-1.5">
      {COLORS.map((c) => <button key={c} type="button" onClick={() => set(c)} className={`h-6 w-6 rounded-full ${val === c ? "ring-2 ring-offset-1 ring-slate-400" : ""}`} style={{ background: toHex(c) }} aria-label={c} />)}
    </div>
  );

  return (
    <Drawer open={open} onClose={onClose} title="Visitor setup" subtitle="Define the visitor types and statuses your team uses." width="max-w-lg">
      <div className="space-y-6">
        <section>
          <h4 className="mb-2 text-sm font-semibold text-slate-700">Types</h4>
          <ul className="mb-3 divide-y divide-slate-100">
            {types.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-2">
                {dot(t.color)}<span className="flex-1 text-sm text-slate-700">{t.name}</span>
                <button onClick={() => confirm({ title: "Delete type?", message: `Delete the "${t.name}" type?`, confirmLabel: "Delete", danger: true }).then((ok) => { if (ok) run(() => deleteVisitorType(t.id), "Type deleted."); })} className="text-slate-400 hover:text-rose-500" aria-label="Delete">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5h6v2M10 11v6M14 11v6M5 7l1 13h12l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </li>
            ))}
            {types.length === 0 && <li className="py-2 text-sm text-slate-400">No types yet.</li>}
          </ul>
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <input value={tName} onChange={(e) => setTName(e.target.value)} placeholder="New type name" className={field} />
            {swatches(tColor, setTColor)}
            <button onClick={() => { if (!tName.trim()) { toast.warning("Enter a name."); return; } run(() => createVisitorType({ name: tName, color: tColor }), "Type added.").then(() => setTName("")); }} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Add type</button>
          </div>
        </section>

        <section>
          <h4 className="mb-2 text-sm font-semibold text-slate-700">Statuses</h4>
          <p className="mb-2 text-xs text-slate-400">A <b>finalised</b> status (e.g. Completed) can only be changed by an admin once reached.</p>
          <ul className="mb-3 divide-y divide-slate-100">
            {statuses.map((s) => (
              <li key={s.id} className="flex items-center gap-2 py-2">
                {dot(s.color)}<span className="flex-1 text-sm text-slate-700">{s.name}</span>
                <button onClick={() => run(() => updateVisitorStatus(s.id, { name: s.name, color: s.color, is_final: s.is_final ? 0 : 1 }), "Updated.")} className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${s.is_final ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`} title="Toggle finalised">
                  {s.is_final ? "Finalised" : "Open"}
                </button>
                <button onClick={() => confirm({ title: "Delete status?", message: `Delete the "${s.name}" status?`, confirmLabel: "Delete", danger: true }).then((ok) => { if (ok) run(() => deleteVisitorStatus(s.id), "Status deleted."); })} className="text-slate-400 hover:text-rose-500" aria-label="Delete">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5h6v2M10 11v6M14 11v6M5 7l1 13h12l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </li>
            ))}
            {statuses.length === 0 && <li className="py-2 text-sm text-slate-400">No statuses yet.</li>}
          </ul>
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <input value={sName} onChange={(e) => setSName(e.target.value)} placeholder="New status name" className={field} />
            {swatches(sColor, setSColor)}
            <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={sFinal} onChange={(e) => setSFinal(e.target.checked)} className="h-4 w-4 rounded border-slate-300" /> Finalised (admin-only once reached)</label>
            <button onClick={() => { if (!sName.trim()) { toast.warning("Enter a name."); return; } run(() => createVisitorStatus({ name: sName, color: sColor, is_final: sFinal ? 1 : 0 }), "Status added.").then(() => { setSName(""); setSFinal(false); }); }} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Add status</button>
          </div>
        </section>
      </div>
    </Drawer>
  );
}
