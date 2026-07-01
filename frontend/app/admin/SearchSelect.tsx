"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
  /** Optional leading node (e.g. a status colour dot) rendered before the label. */
  prefix?: React.ReactNode;
}

/**
 * A native-select replacement with a type-to-search box — for filters whose
 * option lists get long (statuses, sources, team members). Keyboard-friendly:
 * ↑/↓ to move, Enter to pick, Esc to close. Closes on outside click.
 */
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  className = "",
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  // Focus the search box whenever the menu opens (DOM side effect only).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  function openMenu() {
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const o = filtered[active]; if (o) pick(o.value); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-left text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15 ${className}`}
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {selected?.prefix}
          <span className={`truncate ${selected ? "" : "text-slate-400"}`}>{selected?.label ?? placeholder}</span>
        </span>
        <svg className={`h-4 w-4 flex-shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>

      {open && (
        <div className="animate-fade-up absolute left-0 z-30 mt-1 w-full min-w-52 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={onKeyDown}
                placeholder={searchPlaceholder}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-sm focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              />
            </div>
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No matches</li>}
            {filtered.map((o, i) => {
              const isSel = o.value === value;
              const isActive = i === active;
              return (
                <li key={o.value || `__opt_${i}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(o.value)}
                    className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm transition ${isActive ? "bg-indigo-50" : ""} ${isSel ? "font-semibold text-indigo-700" : "text-slate-700"}`}
                  >
                    {o.prefix}
                    <span className="truncate">{o.label}</span>
                    {isSel && <svg className="ml-auto h-4 w-4 flex-shrink-0 text-indigo-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Multi-select sibling of {@link SearchSelect}: a searchable checkbox list. The
 * trigger summarises the selection ("All", a single label, or "N selected").
 * `value`/`onChange` work with an array of option values.
 */
export function MultiSelect({
  value,
  onChange,
  options,
  placeholder = "All",
  searchPlaceholder = "Search…",
  className = "",
  ariaLabel,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  function toggle(v: string) {
    const next = new Set(value);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange([...next]);
  }

  // Trigger label: name when exactly one, else a count, else the placeholder.
  const label =
    value.length === 0 ? placeholder
      : value.length === 1 ? (options.find((o) => o.value === value[0])?.label ?? "1 selected")
        : `${value.length} selected`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => { setQuery(""); setOpen((o) => !o); }}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-2.5 py-2 text-left text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15 ${value.length ? "border-indigo-300 text-slate-700" : "border-slate-300 text-slate-700"} ${className}`}
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {value.length > 0 && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white">{value.length}</span>}
          <span className={`truncate ${value.length ? "" : "text-slate-400"}`}>{label}</span>
        </span>
        <svg className={`h-4 w-4 flex-shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>

      {open && (
        <div className="animate-fade-up absolute left-0 z-30 mt-1 w-full min-w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-sm focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              />
            </div>
          </div>
          {value.length > 0 && (
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5">
              <span className="text-[11px] font-medium text-slate-500">{value.length} selected</span>
              <button type="button" onClick={() => onChange([])} className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700">Clear</button>
            </div>
          )}
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No matches</li>}
            {filtered.map((o) => {
              const isSel = selectedSet.has(o.value);
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => toggle(o.value)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-slate-50 ${isSel ? "text-indigo-700" : "text-slate-700"}`}
                  >
                    <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${isSel ? "border-indigo-600 bg-indigo-600" : "border-slate-300"}`}>
                      {isSel && <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </span>
                    {o.prefix}
                    <span className="truncate">{o.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
