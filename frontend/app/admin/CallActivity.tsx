"use client";

import type { CallLog } from "../lib/client";
import { formatDuration, statusMeta, typeLabel, sourceLabel } from "../lib/calls";
import { Avatar } from "./DataTable";
import { fmtWallDate, fmtWallTime, fmtWallDateTime } from "../lib/datetime";

/** Per-direction phone-icon colour + label. */
const DIR = {
  outgoing: { ring: "bg-sky-100 text-sky-600", text: "text-sky-600", arrow: "M7 17L17 7M9 7h8v8" },
  incoming: { ring: "bg-emerald-100 text-emerald-600", text: "text-emerald-600", arrow: "M17 17L7 7M7 15V7h8" },
  missed: { ring: "bg-rose-100 text-rose-600", text: "text-rose-600", arrow: "M17 17L7 7M7 15V7h8" },
} as const;

/** Source → device icon + badge letter + label, matching a phone/IVR feed. */
const SOURCE = {
  phone: {
    label: "Mobile",
    badge: "P",
    icon: "M7 4h10a1 1 0 011 1v14a1 1 0 01-1 1H7a1 1 0 01-1-1V5a1 1 0 011-1zM11 18h2",
  },
  ivr: {
    label: "IVR",
    badge: "I",
    icon: "M4 13a8 8 0 0116 0v4a2 2 0 01-2 2h-1v-6h3M7 19H6a2 2 0 01-2-2v-4h3v6z",
  },
} as const;

/**
 * One call rendered as an attractive activity row: staff avatar + name, the
 * call direction with its status, the start–end window, the matched lead, and a
 * device/source badge on the right. Used on the Call Tracking page and the
 * lead's Calls tab.
 */
export function CallActivityItem({ call }: { call: CallLog }) {
  const dir = DIR[(call.type as keyof typeof DIR)] ?? DIR.outgoing;
  // Known source → its device badge; any other (e.g. "mobile") → a generic badge
  // with the title-cased label + first letter, so custom sources still show.
  const src = SOURCE[(call.source as keyof typeof SOURCE)]
    ?? (call.source ? { label: sourceLabel(call.source), badge: call.source.charAt(0).toUpperCase(), icon: SOURCE.phone.icon } : null);
  const sm = statusMeta(call.call_status);
  const dirLabel = call.type ? typeLabel(call.type) : "Call";

  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <Avatar name={call.staff_name || "?"} color="from-slate-400 to-slate-500" />

      {/* Who + what */}
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-slate-400">{fmtWallDateTime(call.call_start)}</div>
        <div className="truncate text-sm font-semibold text-indigo-600">{call.staff_name ?? "Unknown staff"}</div>

        <div className="mt-1 flex items-center gap-2">
          <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${dir.ring}`}>
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={dir.arrow} strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${sm.chip}`}>{sm.label}</span>
          <span className="text-xs text-slate-400">({dirLabel})</span>
          {call.connected && (
            <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">{formatDuration(call.duration)}</span>
          )}
        </div>

        <div className="mt-1 text-[11px] text-slate-400">
          {fmtWallDate(call.call_start)} · {fmtWallTime(call.call_start)} – {fmtWallTime(call.call_end)}
        </div>
      </div>

      {/* Lead + device/source */}
      <div className="flex flex-shrink-0 items-center gap-4">
        <div className="hidden text-right sm:block">
          <div className="truncate text-sm font-medium text-slate-700">{call.lead_name ?? <span className="text-slate-400">Unmatched</span>}</div>
          <div className="text-[11px] tabular-nums text-slate-400">{call.contact ?? "—"}</div>
        </div>
        {src && (
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-9 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d={src.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white">{src.badge}</span>
            </span>
            <span className="text-sm font-medium text-indigo-600">{src.label}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** A divided list of call activity rows. */
export function CallActivityList({ calls }: { calls: CallLog[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {calls.map((c) => (
        <li key={c.id}><CallActivityItem call={c} /></li>
      ))}
    </ul>
  );
}
