"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTableConfig, saveTableConfig, getTableLabels, saveTableLabels, getTableSort, saveTableSort, type TableConfig, type TableSort } from "../lib/client";
import type { Column } from "./DataTable";

export type Align = "left" | "center" | "right";

export const DEFAULT_COL_WIDTH = 160;
export const MIN_COL_WIDTH = 64;

/** A column with its user-resolved width/alignment applied. */
export interface ResolvedColumn<T> extends Column<T> {
  resolvedWidth: number;
  resolvedAlign: Align;
}

export interface TableConfigApi<T> {
  /** True once the saved layout has loaded (or there was nothing to load). */
  ready: boolean;
  /** Visible columns, in the user's order, with width/alignment resolved. */
  columns: ResolvedColumn<T>[];
  /** Every column (visible or not) in order, for the customization panel. */
  allColumns: { key: string; header: string; defaultHeader: string; hidden: boolean; lockVisible: boolean; align: Align }[];
  toggleHidden: (key: string) => void;
  setAlign: (key: string, align: Align) => void;
  setWidth: (key: string, width: number) => void;
  /** Move `key` so it sits just before `beforeKey` (drag-and-drop reorder). */
  moveBefore: (key: string, beforeKey: string | null) => void;
  reset: () => void;
  /** True when the layout differs from the column defaults. */
  customized: boolean;
  /** Whether the current user may rename columns (client admin only). */
  canRename: boolean;
  /** Set a client-wide custom name for a column; empty restores the default. */
  setLabel: (key: string, label: string) => void;
  /** The custom name for a column, or "" when it uses its built-in header. */
  labelOf: (key: string) => string;
  /** The user's saved rows-per-page for this table, or undefined to use the client default. */
  pageSize?: number;
  /** Persist a rows-per-page choice for this table (per user). */
  setPageSize: (n: number) => void;
  /** Client-wide admin sort config: which columns are sortable + the default sort. */
  sort: TableSort;
  /** Fast lookup of whether a column key is admin-enabled for sorting. */
  isSortable: (key: string) => boolean;
  /** Admin: toggle whether a column can be sorted (client-wide). */
  setColumnSortable: (key: string, on: boolean) => void;
  /** Admin: set the default sort column + direction (client-wide). */
  setDefaultSort: (key: string, dir: "asc" | "desc") => void;
}

const emptySort: TableSort = { sortable: [], key: "", dir: "asc" };

const emptyConfig: TableConfig = {};

/**
 * Loads, applies and persists a per-user layout for one data table. Backed by
 * GET/POST /client/table-prefs/<key>; saves are debounced so dragging a resize
 * handle doesn't spam the server. When `tableKey` is undefined the table is not
 * customizable and the columns pass through untouched.
 */
export function useTableConfig<T>(tableKey: string | undefined, columns: Column<T>[], canRename = false): TableConfigApi<T> {
  const [config, setConfig] = useState<TableConfig>(emptyConfig);
  const [ready, setReady] = useState(!tableKey);
  const dirty = useRef(false);          // gate saves until the user actually changes something
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Client-wide custom column names (shared across the client; admin-editable).
  const [labels, setLabels] = useState<Record<string, string>>({});
  const labelsDirty = useRef(false);
  const labelSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Client-wide sort config (shared; admin-editable): sortable columns + default.
  const [sort, setSort] = useState<TableSort>(emptySort);
  const sortDirty = useRef(false);
  const sortSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the saved layout once per table key. `ready` starts false whenever
  // there's a key to load (set in useState init), and flips true after the
  // fetch settles — no synchronous setState inside the effect body.
  useEffect(() => {
    if (!tableKey) return;
    let alive = true;
    getTableConfig(tableKey)
      .then((r) => { if (alive) setConfig(r.config ?? emptyConfig); })
      .catch(() => { /* fall back to defaults */ })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [tableKey]);

  // Debounced persistence — only after a user-driven change.
  useEffect(() => {
    if (!tableKey || !dirty.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTableConfig(tableKey, config).catch(() => { /* keep the local layout regardless */ });
    }, 600);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [config, tableKey]);

  // Load the client-wide column names once per table key (everyone reads them).
  useEffect(() => {
    if (!tableKey) return;
    let alive = true;
    getTableLabels(tableKey)
      .then((r) => { if (alive) setLabels(r.labels ?? {}); })
      .catch(() => { /* fall back to built-in headers */ });
    return () => { alive = false; };
  }, [tableKey]);

  // Debounced persistence of label changes — admin only, after a user edit.
  useEffect(() => {
    if (!tableKey || !labelsDirty.current) return;
    if (labelSaveTimer.current) clearTimeout(labelSaveTimer.current);
    labelSaveTimer.current = setTimeout(() => {
      saveTableLabels(tableKey, labels).catch(() => { /* keep local names regardless */ });
    }, 600);
    return () => { if (labelSaveTimer.current) clearTimeout(labelSaveTimer.current); };
  }, [labels, tableKey]);

  // Load the client-wide sort config once per table key (everyone reads it).
  useEffect(() => {
    if (!tableKey) return;
    let alive = true;
    getTableSort(tableKey)
      .then((r) => { if (alive && r.sort) setSort({ sortable: r.sort.sortable ?? [], key: r.sort.key ?? "", dir: r.sort.dir === "desc" ? "desc" : "asc" }); })
      .catch(() => { /* fall back to no sorting */ });
    return () => { alive = false; };
  }, [tableKey]);

  // Debounced persistence of sort-config changes — admin only, after an edit.
  useEffect(() => {
    if (!tableKey || !sortDirty.current) return;
    if (sortSaveTimer.current) clearTimeout(sortSaveTimer.current);
    sortSaveTimer.current = setTimeout(() => {
      saveTableSort(tableKey, sort).catch(() => { /* keep local regardless */ });
    }, 600);
    return () => { if (sortSaveTimer.current) clearTimeout(sortSaveTimer.current); };
  }, [sort, tableKey]);

  const update = useCallback((fn: (c: TableConfig) => TableConfig) => {
    dirty.current = true;
    setConfig((c) => fn(c));
  }, []);

  const labelOf = useCallback((key: string) => labels[key] ?? "", [labels]);

  const setLabel = useCallback((key: string, label: string) => {
    if (!canRename) return;
    labelsDirty.current = true;
    setLabels((m) => {
      const next = { ...m };
      const trimmed = label.trim();
      if (trimmed === "") delete next[key];
      else next[key] = trimmed;
      return next;
    });
  }, [canRename]);

  const isSortable = useCallback((key: string) => sort.sortable.includes(key), [sort.sortable]);

  const setColumnSortable = useCallback((key: string, on: boolean) => {
    if (!canRename) return; // admin-only, same gate as renames
    sortDirty.current = true;
    setSort((s) => {
      const set = new Set(s.sortable);
      if (on) set.add(key); else set.delete(key);
      const sortable = [...set];
      // If the default column is no longer sortable, clear the default.
      const key2 = on || s.key !== key ? s.key : "";
      return { ...s, sortable, key: sortable.includes(key2) ? key2 : "" };
    });
  }, [canRename]);

  const setDefaultSort = useCallback((key: string, dir: "asc" | "desc") => {
    if (!canRename) return;
    sortDirty.current = true;
    setSort((s) => {
      // Choosing a default implies that column is sortable.
      const sortable = key && !s.sortable.includes(key) ? [...s.sortable, key] : s.sortable;
      return { ...s, sortable, key, dir };
    });
  }, [canRename]);

  const naturalKeys = useMemo(() => columns.map((c) => c.key), [columns]);
  const byKey = useMemo(() => {
    const m: Record<string, Column<T>> = {};
    columns.forEach((c) => { m[c.key] = c; });
    return m;
  }, [columns]);

  // Full order: saved order first (existing keys only), then any new columns.
  const orderedKeys = useMemo(() => {
    const saved = (config.order ?? []).filter((k) => naturalKeys.includes(k));
    const rest = naturalKeys.filter((k) => !saved.includes(k));
    return [...saved, ...rest];
  }, [config.order, naturalKeys]);

  // The default hidden set (columns flagged defaultHidden) applies until the
  // user saves their own hidden list.
  const defaultHidden = useMemo(() => columns.filter((c) => c.defaultHidden).map((c) => c.key), [columns]);
  const hiddenSet = useMemo(
    () => new Set(config.hidden ?? defaultHidden),
    [config.hidden, defaultHidden],
  );

  const resolveAlign = useCallback(
    (key: string): Align => config.aligns?.[key] ?? byKey[key]?.align ?? "left",
    [config.aligns, byKey],
  );
  const resolveWidth = useCallback(
    (key: string): number => config.widths?.[key] ?? byKey[key]?.width ?? DEFAULT_COL_WIDTH,
    [config.widths, byKey],
  );

  const visibleColumns = useMemo<ResolvedColumn<T>[]>(() => {
    return orderedKeys
      .map((k) => byKey[k])
      .filter((c): c is Column<T> => !!c && (c.lockVisible || !hiddenSet.has(c.key)))
      .map((c) => ({ ...c, header: labels[c.key] || c.header, resolvedWidth: resolveWidth(c.key), resolvedAlign: resolveAlign(c.key) }));
  }, [orderedKeys, byKey, hiddenSet, resolveWidth, resolveAlign, labels]);

  const allColumns = useMemo(
    () => orderedKeys.map((k) => ({
      key: k,
      header: labels[k] || byKey[k]?.header || k,
      defaultHeader: byKey[k]?.header ?? k,
      hidden: hiddenSet.has(k) && !byKey[k]?.lockVisible,
      lockVisible: !!byKey[k]?.lockVisible,
      align: resolveAlign(k),
    })),
    [orderedKeys, byKey, hiddenSet, resolveAlign, labels],
  );

  const toggleHidden = useCallback((key: string) => {
    if (byKey[key]?.lockVisible) return;
    update((c) => {
      const set = new Set(c.hidden ?? defaultHidden);
      if (set.has(key)) set.delete(key); else set.add(key);
      return { ...c, hidden: [...set] };
    });
  }, [byKey, defaultHidden, update]);

  const setAlign = useCallback((key: string, align: Align) => {
    update((c) => ({ ...c, aligns: { ...(c.aligns ?? {}), [key]: align } }));
  }, [update]);

  const setWidth = useCallback((key: string, width: number) => {
    const w = Math.max(byKey[key]?.minWidth ?? MIN_COL_WIDTH, Math.round(width));
    update((c) => ({ ...c, widths: { ...(c.widths ?? {}), [key]: w } }));
  }, [byKey, update]);

  const moveBefore = useCallback((key: string, beforeKey: string | null) => {
    if (key === beforeKey) return;
    update((c) => {
      const cur = orderedKeys.slice();
      const from = cur.indexOf(key);
      if (from === -1) return c;
      cur.splice(from, 1);
      const to = beforeKey === null ? cur.length : cur.indexOf(beforeKey);
      cur.splice(to === -1 ? cur.length : to, 0, key);
      return { ...c, order: cur };
    });
  }, [orderedKeys, update]);

  const setPageSize = useCallback((n: number) => {
    update((c) => ({ ...c, pageSize: n }));
  }, [update]);

  const reset = useCallback(() => { update(() => ({})); }, [update]);

  const customized = useMemo(
    () => !!(config.order?.length || config.hidden?.length || (config.widths && Object.keys(config.widths).length) || (config.aligns && Object.keys(config.aligns).length)),
    [config],
  );

  // Non-customizable path: pass columns straight through.
  if (!tableKey) {
    return {
      ready: true,
      columns: columns.map((c) => ({ ...c, resolvedWidth: c.width ?? DEFAULT_COL_WIDTH, resolvedAlign: c.align ?? "left" })),
      allColumns: [],
      toggleHidden: () => {}, setAlign: () => {}, setWidth: () => {}, moveBefore: () => {}, reset: () => {},
      customized: false,
      canRename: false, setLabel: () => {}, labelOf: () => "",
      pageSize: undefined, setPageSize: () => {},
      sort: emptySort, isSortable: () => false, setColumnSortable: () => {}, setDefaultSort: () => {},
    };
  }

  return { ready, columns: visibleColumns, allColumns, toggleHidden, setAlign, setWidth, moveBefore, reset, customized, canRename, setLabel, labelOf, pageSize: config.pageSize, setPageSize, sort, isSortable, setColumnSortable, setDefaultSort };
}

// ---------------------------------------------------------------- settings UI

const ALIGN_ICON: Record<Align, string> = {
  left: "M4 6h16M4 12h10M4 18h13",
  center: "M4 6h16M7 12h10M5 18h14",
  right: "M4 6h16M10 12h10M7 18h13",
};

/**
 * The "Columns" gear menu: search, show/hide, reorder (drag) and per-column
 * alignment, plus a reset. Pure controller over a `TableConfigApi`.
 */
export function ColumnSettings<T>({ api }: { api: TableConfigApi<T> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dragKey, setDragKey] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const q = query.trim().toLowerCase();
  const rows = q ? api.allColumns.filter((c) => c.header.toLowerCase().includes(q)) : api.allColumns;
  const visibleCount = api.allColumns.filter((c) => !c.hidden).length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${open || api.customized ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Columns
        <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-500">{visibleCount}</span>
      </button>

      {open && (
        <div className="animate-fade-up absolute right-0 z-30 mt-1 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customize columns</span>
            {api.customized && (
              <button onClick={api.reset} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Reset</button>
            )}
          </div>

          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search columns…"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-sm focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              />
            </div>
          </div>

          {api.canRename && (
            <div className="border-b border-slate-100 p-2">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Default sort (whole team)</div>
              <div className="flex items-center gap-1.5">
                <select
                  value={api.sort.key}
                  onChange={(e) => api.setDefaultSort(e.target.value, api.sort.dir)}
                  className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                >
                  <option value="">None</option>
                  {api.allColumns.filter((c) => api.isSortable(c.key)).map((c) => (
                    <option key={c.key} value={c.key}>{c.header}</option>
                  ))}
                </select>
                <div className="flex items-center rounded-md border border-slate-200 p-0.5">
                  {(["asc", "desc"] as const).map((d) => (
                    <button
                      key={d}
                      disabled={!api.sort.key}
                      onClick={() => api.sort.key && api.setDefaultSort(api.sort.key, d)}
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold transition ${api.sort.dir === d ? "bg-indigo-600 text-white" : "text-slate-400 hover:bg-slate-100"} disabled:opacity-40`}
                    >
                      {d === "asc" ? "A→Z" : "Z→A"}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">Tick the ⇅ on a column below to let everyone sort by it.</p>
            </div>
          )}

          <ul className="max-h-72 overflow-y-auto py-1">
            {rows.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No matching columns</li>}
            {rows.map((c) => (
              <li
                key={c.key}
                draggable={!q}
                onDragStart={() => setDragKey(c.key)}
                onDragOver={(e) => { if (dragKey && dragKey !== c.key) e.preventDefault(); }}
                onDrop={() => { if (dragKey) { api.moveBefore(dragKey, c.key); setDragKey(null); } }}
                onDragEnd={() => setDragKey(null)}
                className={`flex items-center gap-2 px-2 py-1.5 ${dragKey === c.key ? "opacity-40" : ""} ${q ? "" : "cursor-grab active:cursor-grabbing"} hover:bg-slate-50`}
              >
                {!q && (
                  <svg className="h-4 w-4 flex-shrink-0 text-slate-300" fill="currentColor" viewBox="0 0 20 20"><path d="M7 4a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM7 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM7 16a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM16 4a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM16 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM16 16a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" /></svg>
                )}
                <div className="flex flex-1 items-center gap-2 truncate">
                  <input
                    type="checkbox"
                    checked={!c.hidden}
                    disabled={c.lockVisible}
                    onChange={() => api.toggleHidden(c.key)}
                    className="h-4 w-4 flex-shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30 disabled:opacity-50"
                  />
                  {api.canRename ? (
                    <input
                      value={api.labelOf(c.key)}
                      placeholder={c.defaultHeader}
                      onChange={(e) => api.setLabel(c.key, e.target.value)}
                      onDragStart={(e) => e.preventDefault()}
                      title={`Rename — default: ${c.defaultHeader}`}
                      className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                    />
                  ) : (
                    <span className={`truncate text-sm ${c.hidden ? "text-slate-400" : "text-slate-700"}`}>{c.header}</span>
                  )}
                  {c.lockVisible && <span className="ml-1 text-[10px] font-medium uppercase text-slate-300">fixed</span>}
                </div>
                {api.canRename && (
                  <button
                    title={api.isSortable(c.key) ? "Sortable for everyone — click to disable" : "Enable sorting for everyone"}
                    onClick={() => api.setColumnSortable(c.key, !api.isSortable(c.key))}
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition ${api.isSortable(c.key) ? "bg-indigo-600 text-white" : "text-slate-400 hover:bg-slate-100"}`}
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 9l4-4 4 4M8 15l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                )}
                <div className="flex items-center rounded-md border border-slate-200 p-0.5">
                  {(["left", "center", "right"] as Align[]).map((a) => (
                    <button
                      key={a}
                      title={`Align ${a}`}
                      onClick={() => api.setAlign(c.key, a)}
                      className={`flex h-5 w-5 items-center justify-center rounded transition ${c.align === a ? "bg-indigo-600 text-white" : "text-slate-400 hover:bg-slate-100"}`}
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={ALIGN_ICON[a]} strokeLinecap="round" /></svg>
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">
            Drag rows to reorder · drag a column edge in the table to resize. Show/hide &amp; layout are saved to your account.
            {api.canRename && <span className="mt-0.5 block text-indigo-500">Renamed column names apply for your whole team. Clear a name to restore its default.</span>}
          </p>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------- generic show/hide preferences

export interface HiddenPrefsApi {
  ready: boolean;
  hidden: string[];
  isHidden: (id: string) => boolean;
  toggle: (id: string) => void;
  reset: () => void;
  customized: boolean;
}

/**
 * Per-user "which of these things are hidden" list, persisted under `tableKey`
 * via /client/table-prefs. Generic — used for the leads filter-visibility menu
 * so each user controls which filters show. Debounced save, same as columns.
 */
export function useHiddenPrefs(tableKey: string): HiddenPrefsApi {
  const [hidden, setHidden] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    getTableConfig(tableKey)
      .then((r) => { if (alive) setHidden(r.config?.hidden ?? []); })
      .catch(() => { /* defaults */ })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [tableKey]);

  useEffect(() => {
    if (!dirty.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTableConfig(tableKey, { hidden }).catch(() => { /* keep local */ });
    }, 600);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [hidden, tableKey]);

  const toggle = useCallback((id: string) => {
    dirty.current = true;
    setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));
  }, []);
  const reset = useCallback(() => { dirty.current = true; setHidden([]); }, []);

  return {
    ready, hidden,
    isHidden: (id: string) => hidden.includes(id),
    toggle, reset,
    customized: hidden.length > 0,
  };
}

/**
 * Gear menu listing toggleable items (search + checkboxes + reset). Generic
 * controller over a {@link HiddenPrefsApi} — used for the leads filter chooser.
 */
export function VisibilityMenu({
  api,
  items,
  buttonLabel = "Filters",
  title = "Show filters",
}: {
  api: HiddenPrefsApi;
  items: { id: string; label: string }[];
  buttonLabel?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const q = query.trim().toLowerCase();
  const rows = q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  const shownCount = items.filter((i) => !api.isHidden(i.id)).length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${open || api.customized ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {buttonLabel}
        <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-500">{shownCount}</span>
      </button>

      {open && (
        <div className="animate-fade-up absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</span>
            {api.customized && <button onClick={api.reset} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Show all</button>}
          </div>
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search filters…"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-sm focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              />
            </div>
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {rows.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No matching filters</li>}
            {rows.map((i) => (
              <li key={i.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={!api.isHidden(i.id)}
                    onChange={() => api.toggle(i.id)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
                  />
                  <span className={`truncate text-sm ${api.isHidden(i.id) ? "text-slate-400" : "text-slate-700"}`}>{i.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
