"use client";

import { useEffect } from "react";
import { useClient } from "./ClientContext";

/**
 * A full-height filter panel attached to the right edge of the client panel,
 * like the main menu. Used across the dashboard so every list filters the same
 * way. It slides in/out (no backdrop, so the list stays visible and usable
 * beside it) and auto-collapses the main sidebar while open to free up room.
 *
 * Pages own their filter state (draft vs applied); this only renders the shell:
 * a header (title + dirty hint + close), a scrollable body (the filter fields)
 * and a Reset / Apply footer.
 *
 * Pair the page's content wrapper with `filterRailPad(open)` so the list isn't
 * hidden behind the rail while it's open.
 */
export function FilterRail({
  open,
  onClose,
  title = "Filters",
  dirty,
  onReset,
  resetDisabled,
  onApply,
  applyDisabled,
  applying,
  applyLabel = "Apply filters",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Shows the "Unapplied changes" hint when the draft differs from applied. */
  dirty?: boolean;
  onReset: () => void;
  resetDisabled?: boolean;
  onApply: () => void;
  applyDisabled?: boolean;
  applying?: boolean;
  applyLabel?: string;
  children: React.ReactNode;
}) {
  const { setCollapsed, setContentFull } = useClient();

  // While the rail is open: collapse the main sidebar and let the content span
  // full width (no max-width cap) so the list fills the space beside the rail.
  // Both are restored on close (or when the page unmounts with the rail open).
  useEffect(() => {
    if (!open) return;
    setCollapsed(true);
    setContentFull(true);
    return () => { setCollapsed(false); setContentFull(false); };
  }, [open, setCollapsed, setContentFull]);

  return (
    <aside
      className={`fixed right-0 top-16 z-30 flex h-[calc(100vh-4rem)] w-80 max-w-[85vw] flex-col border-l border-slate-200 bg-white shadow-xl transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`}
      aria-hidden={!open}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="text-[11px] text-slate-400">{dirty ? "Unapplied changes" : "Up to date"}</p>
        </div>
        <button onClick={onClose} title="Close filters" className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">{children}</div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
        <button
          onClick={onReset}
          disabled={resetDisabled}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset
        </button>
        <button
          onClick={onApply}
          disabled={applyDisabled || applying}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {applying && <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>}
          {applying ? "Applying…" : applyLabel}
        </button>
      </div>
    </aside>
  );
}

/** A toggle button for opening the FilterRail, with an active-count badge. */
export function FilterToggle({
  open,
  count,
  onClick,
  label = "Filters",
}: {
  open: boolean;
  count?: number;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold shadow-sm transition ${open ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
    >
      <svg className={`h-4 w-4 ${open ? "text-emerald-600" : "text-slate-500"}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 5h18M6 12h12M10 19h4" strokeLinecap="round" /></svg>
      {label}
      {!!count && count > 0 && (
        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-bold text-white">{count}</span>
      )}
      <svg className={`h-4 w-4 transition ${open ? "rotate-180 text-emerald-600" : "text-slate-400"}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

/** Content-wrapper className that pads the page so the list clears the open rail. */
export const filterRailPad = (open: boolean) => `transition-all duration-200 ${open ? "lg:pr-[21rem]" : ""}`;

/** Standard label above a filter control in the rail body. */
export function FilterLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{children}</span>;
}
