"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Shared date-range filtering: quick presets (today … last month) plus an
 * explicit custom from/to range. Used by the leads filter bar but generic
 * enough for any date column.
 */

export type DatePreset =
  | "all" | "today" | "yesterday" | "7d" | "30d"
  | "next7" | "next15" | "this_month" | "last_month" | "custom";

export interface DateRange {
  preset: DatePreset;
  /** Inclusive lower bound (YYYY-MM-DD), only used when preset === "custom". */
  from?: string;
  /** Inclusive upper bound (YYYY-MM-DD), only used when preset === "custom". */
  to?: string;
}

export const EMPTY_RANGE: DateRange = { preset: "all" };

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "all", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "custom", label: "Custom range" },
];

// Forward-looking presets (e.g. upcoming follow-ups). Opt in per-filter via the
// DateRangeFilter `future` prop; they sit just before "Custom range".
export const FUTURE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "next7", label: "Next 7 days" },
  { value: "next15", label: "Next 15 days" },
];

/** Does a date string fall within the given range? "all" always matches. */
export function inDateRange(dateStr: string | null | undefined, range: DateRange): boolean {
  const { preset } = range;
  if (preset === "all") return true;
  if (!dateStr) return false;
  const key = dateStr.slice(0, 10);
  const d = new Date(`${key}T00:00:00`);
  if (isNaN(d.getTime())) return false;

  if (preset === "custom") {
    if (range.from && key < range.from) return false;
    if (range.to && key > range.to) return false;
    return true;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (preset === "this_month") {
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
  }
  if (preset === "last_month") {
    const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth();
  }

  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (preset === "today") return diff === 0;
  if (preset === "yesterday") return diff === 1;
  if (preset === "7d") return diff >= 0 && diff <= 7;
  if (preset === "30d") return diff >= 0 && diff <= 30;
  // Forward-looking: today through today+N (diff is negative for future dates).
  if (preset === "next7") return diff <= 0 && diff >= -7;
  return diff <= 0 && diff >= -15; // next15
}

/** True when a range would actually narrow the result set. */
export function rangeActive(range: DateRange): boolean {
  if (range.preset === "all") return false;
  if (range.preset === "custom") return !!(range.from || range.to);
  return true;
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Resolve a range to concrete inclusive { from, to } YYYY-MM-DD bounds for
 * server-side filtering (e.g. the follow-up / call dashboards that take from/to
 * query params). "all" returns empty bounds.
 */
export function resolveDateRange(range: DateRange): { from?: string; to?: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const shift = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };

  switch (range.preset) {
    case "all":        return {};
    case "custom":     return { from: range.from || undefined, to: range.to || undefined };
    case "today":      return { from: isoOf(today), to: isoOf(today) };
    case "yesterday":  return { from: isoOf(shift(-1)), to: isoOf(shift(-1)) };
    case "7d":         return { from: isoOf(shift(-7)), to: isoOf(today) };
    case "30d":        return { from: isoOf(shift(-30)), to: isoOf(today) };
    case "next7":      return { from: isoOf(today), to: isoOf(shift(7)) };
    case "next15":     return { from: isoOf(today), to: isoOf(shift(15)) };
    case "this_month": return { from: isoOf(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoOf(new Date(today.getFullYear(), today.getMonth() + 1, 0)) };
    case "last_month": return { from: isoOf(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: isoOf(new Date(today.getFullYear(), today.getMonth(), 0)) };
    default:           return {};
  }
}

const selCls =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15";

/** Preset dropdown that reveals from/to inputs when "Custom range" is chosen. */
export function DateRangeFilter({
  value,
  onChange,
  ariaLabel,
  future = false,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  ariaLabel?: string;
  /** Include the forward-looking "Next 7 / 15 days" presets (e.g. follow-ups). */
  future?: boolean;
}) {
  // Insert the future presets just before "Custom range" when enabled.
  const presets = future
    ? [...DATE_PRESETS.slice(0, -1), ...FUTURE_PRESETS, DATE_PRESETS[DATE_PRESETS.length - 1]]
    : DATE_PRESETS;
  return (
    <div className="space-y-1.5">
      <select
        aria-label={ariaLabel}
        value={value.preset}
        onChange={(e) => {
          const preset = e.target.value as DatePreset;
          onChange(preset === "custom" ? { ...value, preset } : { preset });
        }}
        className={selCls}
      >
        {presets.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      {value.preset === "custom" && (
        <RangeCalendar
          from={value.from}
          to={value.to}
          onChange={(from, to) => onChange({ preset: "custom", from, to })}
        />
      )}
    </div>
  );
}

// --------------------------------------------------------------- range calendar

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const parseYmd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m - 1, d };
};
/** "8 Jun 2026" from a YYYY-MM-DD string. */
const fmtShort = (s?: string) => {
  if (!s) return "";
  const { y, m, d } = parseYmd(s);
  return `${d} ${MONTHS[m].slice(0, 3)} ${y}`;
};

/**
 * A self-contained from→to range picker: a month calendar in a popover. The
 * first click sets the start, the second sets the end (click before the start
 * to restart). No external date-picker dependency.
 */
function RangeCalendar({
  from,
  to,
  onChange,
}: {
  from?: string;
  to?: string;
  onChange: (from?: string, to?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const anchor = from ? parseYmd(from) : null;
  const now = new Date();
  const [view, setView] = useState({ y: anchor ? anchor.y : now.getFullYear(), m: anchor ? anchor.m : now.getMonth() });

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  // Leading blanks + day cells for the displayed month.
  const cells = useMemo(() => {
    const firstWeekday = new Date(view.y, view.m, 1).getDay();
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    const out: (number | null)[] = Array.from({ length: firstWeekday }, () => null);
    for (let d = 1; d <= daysInMonth; d++) out.push(d);
    return out;
  }, [view]);

  const todayKey = ymd(now.getFullYear(), now.getMonth(), now.getDate());

  function pick(day: number) {
    const k = ymd(view.y, view.m, day);
    if (!from || (from && to)) {
      onChange(k, undefined);           // start a fresh range
    } else if (k < from) {
      onChange(k, undefined);           // clicked before start → restart there
    } else {
      onChange(from, k);                // complete the range
      setOpen(false);
    }
  }

  function step(delta: number) {
    setView((v) => {
      const m = v.m + delta;
      return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });
  }

  const label = from && to ? `${fmtShort(from)} – ${fmtShort(to)}` : from ? `${fmtShort(from)} – …` : "Pick dates";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-2.5 py-2 text-left text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15 ${from ? "border-indigo-300 text-slate-700" : "border-slate-300 text-slate-400"}`}
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          <svg className="h-4 w-4 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" /></svg>
          <span className="truncate">{label}</span>
        </span>
        <svg className={`h-4 w-4 flex-shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>

      {open && (
        <div className="animate-fade-up absolute left-0 z-30 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => step(-1)} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Previous month">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <span className="text-sm font-semibold text-slate-700">{MONTHS[view.m]} {view.y}</span>
            <button type="button" onClick={() => step(1)} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Next month">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((w) => <div key={w} className="py-1 text-[11px] font-medium text-slate-400">{w}</div>)}
            {cells.map((day, idx) => {
              if (day === null) return <div key={`b${idx}`} />;
              const k = ymd(view.y, view.m, day);
              const isStart = k === from;
              const isEnd = k === to;
              const inRange = !!(from && to && k >= from && k <= to);
              const isToday = k === todayKey;
              const endpoint = isStart || isEnd;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => pick(day)}
                  className={`h-8 rounded-lg text-sm transition ${endpoint ? "bg-indigo-600 font-semibold text-white" : inRange ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-100"} ${isToday && !endpoint ? "ring-1 ring-inset ring-indigo-300" : ""}`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
            <span className="text-[11px] text-slate-400">
              {from ? <>{fmtShort(from)}{to ? <> → {fmtShort(to)}</> : <> → pick end</>}</> : "Pick a start date"}
            </span>
            <button type="button" onClick={() => { onChange(undefined, undefined); }} className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700">Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
