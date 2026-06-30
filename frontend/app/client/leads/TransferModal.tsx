"use client";

import { useState } from "react";
import { Modal } from "../../admin/ui";
import { SearchSelect, type SelectOption } from "../../admin/SearchSelect";
import { createLeadTransfer, type Staff } from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";

/**
 * Request (or, in "direct" mode, perform) a transfer of one lead to another rep.
 * The wording adapts to the client's transfer mode.
 */
export default function TransferModal({
  open, lead, staff, mode, onClose, onDone,
}: {
  open: boolean;
  lead: { id: number; name: string } | null;
  staff: Staff[];
  mode: "direct" | "approval";
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const opts: SelectOption[] = staff.map((s) => ({ value: String(s.id), label: s.name }));

  async function submit() {
    if (!lead) return;
    if (!to) { toast.warning("Pick a team member to transfer to."); return; }
    setBusy(true);
    try {
      const r = await createLeadTransfer({ lead_id: lead.id, to_staff_id: Number(to), reason: reason.trim() || undefined });
      toast.success(r.status === "approved" ? "Lead transferred." : "Transfer request sent for approval.");
      setTo(""); setReason("");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not transfer the lead.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Transfer ${lead?.name || "lead"}`}>
      <div className="space-y-3">
        <p className={`rounded-lg px-3 py-2 text-xs ${mode === "direct" ? "bg-amber-50 text-amber-700" : "bg-indigo-50 text-indigo-700"}`}>
          {mode === "direct"
            ? "Direct mode: this lead is reassigned immediately."
            : "Approval mode: an admin must approve. The lead is hidden from all lists until then."}
        </p>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Transfer to</span>
          <SearchSelect ariaLabel="Transfer to" value={to} onChange={setTo} options={opts} placeholder="Select a team member…" searchPlaceholder="Search team…" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Reason <span className="font-normal text-slate-400">(optional)</span></span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why are you transferring this lead?"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
          />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={busy} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
            {busy ? "Working…" : mode === "direct" ? "Transfer lead" : "Request transfer"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
