"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getLeadTransfers, approveLeadTransfer, rejectLeadTransfer, cancelLeadTransfer, saveLeadTransferMode,
  getStaff, type LeadTransfer, type TransferStatus, type Staff,
} from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import { EmptyState, Spinner, fmtDate } from "../../admin/ui";
import { DataTable, IconButton, type Column } from "../../admin/DataTable";
import { MultiSelect, type SelectOption } from "../../admin/SearchSelect";
import { DateRangeFilter, inDateRange, rangeActive, EMPTY_RANGE, type DateRange } from "../../admin/dateFilter";
import { FilterRail, FilterToggle, FilterLabel, filterRailPad } from "../FilterRail";
import { PerfSummary } from "./DateSummary";

const STATUS_META: Record<TransferStatus, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-amber-50 text-amber-700" },
  approved: { label: "Approved", cls: "bg-emerald-50 text-emerald-700" },
  rejected: { label: "Rejected", cls: "bg-rose-50 text-rose-700" },
  cancelled: { label: "Cancelled", cls: "bg-slate-100 text-slate-500" },
};
const STATUS_OPTS: SelectOption[] = (Object.keys(STATUS_META) as TransferStatus[]).map((s) => ({ value: s, label: STATUS_META[s].label }));

const BLANK = { status: [] as string[], to: [] as string[], from: [] as string[], date: EMPTY_RANGE as DateRange };
// Dashboards default to the last 7 days (Reset clears back to "all" via BLANK).
const DEFAULTS = { ...BLANK, date: { preset: "7d" } as DateRange };
type Filters = typeof BLANK;

export default function TransfersTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<LeadTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"direct" | "approval">("approval");
  const [canDecide, setCanDecide] = useState(false);
  const [myStaffId, setMyStaffId] = useState(0);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [savingMode, setSavingMode] = useState(false);

  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Filters>(DEFAULTS);
  const [applied, setApplied] = useState<Filters>(DEFAULTS);
  const [railOpen, setRailOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    return getLeadTransfers()
      .then((d) => { setRows(d.transfers ?? []); setMode(d.mode); setCanDecide(d.can_decide); setMyStaffId(d.my_staff_id); })
      .catch(() => toast.error("Could not load transfers."))
      .finally(() => setLoading(false));
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { getStaff().then((d) => setStaff(d.staff ?? [])).catch(() => {}); }, []);

  const staffOpts: SelectOption[] = useMemo(() => staff.map((s) => ({ value: String(s.id), label: s.name })), [staff]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (applied.status.length && !applied.status.includes(r.status)) return false;
      if (applied.to.length && !applied.to.includes(String(r.to_staff_id))) return false;
      if (applied.from.length && !applied.from.includes(String(r.from_staff_id ?? ""))) return false;
      if (!inDateRange(r.created_at, applied.date)) return false;
      if (q && ![r.lead_name, r.from_name, r.to_name, r.requested_name, r.reason].some((v) => (v ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, applied, search]);

  const appliedCount = [applied.status.length, applied.to.length, applied.from.length, rangeActive(applied.date)].filter(Boolean).length;
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(applied), [draft, applied]);
  const draftSet = !!(draft.status.length || draft.to.length || draft.from.length || rangeActive(draft.date));
  const pendingCount = rows.filter((r) => r.status === "pending").length;

  async function act(id: number, fn: () => Promise<unknown>, ok: string) {
    setBusy(id);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Action failed."); }
    finally { setBusy(null); }
  }
  function onApprove(t: LeadTransfer) { act(t.id, () => approveLeadTransfer(t.id), "Transfer approved."); }
  async function onReject(t: LeadTransfer) {
    if (await confirm({ title: "Reject transfer?", message: `Reject transferring ${t.lead_name ?? "this lead"} to ${t.to_name ?? "the rep"}? The lead stays with its current owner.`, confirmLabel: "Reject", danger: true }))
      act(t.id, () => rejectLeadTransfer(t.id), "Transfer rejected.");
  }
  async function onCancel(t: LeadTransfer) {
    if (await confirm({ title: "Cancel request?", message: "Cancel this pending transfer request?", confirmLabel: "Cancel request", danger: true }))
      act(t.id, () => cancelLeadTransfer(t.id), "Request cancelled.");
  }
  async function changeMode(m: "direct" | "approval") {
    if (m === mode) return;
    setSavingMode(true);
    try { await saveLeadTransferMode(m); setMode(m); toast.success(`Transfers now ${m === "direct" ? "apply directly" : "need admin approval"}.`); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save."); }
    finally { setSavingMode(false); }
  }

  const dash = <span className="text-slate-400">—</span>;
  const columns: Column<LeadTransfer>[] = [
    { key: "lead_name", header: "Lead", width: 170, lockVisible: true, render: (t) => <span className="font-medium text-slate-800">{t.lead_name || "—"}</span> },
    { key: "route", header: "From → To", width: 220, render: (t) => <span className="text-slate-600">{t.from_name || "Unassigned"} <span className="text-slate-300">→</span> <span className="font-medium text-slate-800">{t.to_name || "—"}</span></span> },
    { key: "requested_name", header: "Requested by", width: 140, render: (t) => <span className="text-slate-600">{t.requested_name || "—"}</span> },
    { key: "reason", header: "Reason", width: 200, render: (t) => (t.reason ? <span className="text-slate-500" title={t.reason}>{t.reason}</span> : dash) },
    { key: "status", header: "Status", width: 110, render: (t) => <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_META[t.status].cls}`}>{STATUS_META[t.status].label}</span> },
    { key: "created_at", header: "Requested", width: 120, render: (t) => <span className="text-slate-500">{fmtDate(t.created_at)}</span> },
  ];

  return (
    <div className={filterRailPad(railOpen)}>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2">
          <div className="flex-shrink-0"><FilterToggle open={railOpen} count={appliedCount} onClick={() => { setDraft(applied); setRailOpen((o) => !o); }} /></div>
          <div className="relative w-full max-w-sm">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search lead, rep, reason…" className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 pl-9 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          {pendingCount > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">{pendingCount} pending</span>}
          {canDecide && (
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium" title="How transfers are applied">
              {(["approval", "direct"] as const).map((m) => (
                <button key={m} disabled={savingMode} onClick={() => changeMode(m)} className={`rounded-md px-3 py-1.5 transition ${mode === m ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                  {m === "approval" ? "Needs approval" : "Direct"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!loading && filtered.length > 0 && (
        <PerfSummary
          title="Counselor performance — transfers received"
          totalLabel="Total transfers" totalSub="In the selected period"
          activeLabel="Active counselors" topLabel="Top counselor" unit="transfers" color="#6366f1"
          rows={Object.values(filtered.reduce((acc, r) => {
            const name = r.to_name ?? "Unknown";
            (acc[name] ??= { name, value: 0 }).value++;
            return acc;
          }, {} as Record<string, { name: string; value: number }>))}
        />
      )}

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState title={rows.length ? "No matching transfers" : "No transfers yet"} hint={rows.length ? "Try clearing the filters." : "Transfer a lead from the Leads tab to start."} />
      ) : (
        <DataTable
          tableKey="lead_transfers"
          columns={columns}
          rows={filtered}
          getKey={(t) => t.id}
          nowrap
          paginate
          defaultPageSize={25}
          quickActions={(t) => (
            t.status === "pending" ? (
              <>
                {canDecide && (
                  <>
                    <IconButton title="Approve" onClick={() => busy === null && onApprove(t)}>
                      <svg className="h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </IconButton>
                    <IconButton title="Reject" danger onClick={() => busy === null && onReject(t)}>
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
                    </IconButton>
                  </>
                )}
                {(canDecide || t.requested_by === myStaffId) && (
                  <IconButton title="Cancel request" onClick={() => busy === null && onCancel(t)}>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1018 0 9 9 0 00-18 0zM9 9l6 6M15 9l-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </IconButton>
                )}
              </>
            ) : <span className="pr-2 text-xs text-slate-400">{t.decided_at ? fmtDate(t.decided_at) : ""}</span>
          )}
        />
      )}

      <FilterRail
        open={railOpen}
        onClose={() => setRailOpen(false)}
        dirty={dirty}
        onReset={() => setDraft(BLANK)}
        resetDisabled={!draftSet}
        onApply={() => { setApplied(draft); setRailOpen(false); }}
        applyDisabled={!dirty}
        applyLabel="Apply"
      >
        <div className="space-y-1.5"><FilterLabel>Transfer date</FilterLabel><DateRangeFilter ariaLabel="Transfer date" value={draft.date} onChange={(v) => setDraft((d) => ({ ...d, date: v }))} /></div>
        <div className="space-y-1.5"><FilterLabel>Status</FilterLabel><MultiSelect ariaLabel="Status" value={draft.status} onChange={(v) => setDraft((d) => ({ ...d, status: v }))} options={STATUS_OPTS} placeholder="Any status" searchPlaceholder="Search…" /></div>
        <div className="space-y-1.5"><FilterLabel>Transferred to</FilterLabel><MultiSelect ariaLabel="To" value={draft.to} onChange={(v) => setDraft((d) => ({ ...d, to: v }))} options={staffOpts} placeholder="Anyone" searchPlaceholder="Search team…" /></div>
        <div className="space-y-1.5"><FilterLabel>Transferred from</FilterLabel><MultiSelect ariaLabel="From" value={draft.from} onChange={(v) => setDraft((d) => ({ ...d, from: v }))} options={staffOpts} placeholder="Anyone" searchPlaceholder="Search team…" /></div>
      </FilterRail>
    </div>
  );
}
