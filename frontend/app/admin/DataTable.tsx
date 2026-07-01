"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Skeleton, SkeletonCard, EmptyState } from "./ui";
import { useTableConfig, ColumnSettings } from "./tableConfig";
import { PAGE_SIZE_OPTIONS } from "../lib/theme";

export type DataView = "list" | "grid";

/** Compare two cell values for sorting. Blanks/nulls sort last; numbers
 *  numerically; strings with numeric-awareness ("10" after "9"). */
function cmpVals(a: unknown, b: unknown): number {
  const aBlank = a === null || a === undefined || a === "";
  const bBlank = b === null || b === undefined || b === "";
  if (aBlank && bBlank) return 0;
  if (aBlank) return 1;
  if (bBlank) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export type SortState = { key: string; dir: "asc" | "desc" } | null;

/** Stable client-side sort of rows by a column's `sortAccessor` (or the row's
 *  field matching the column key). Exported so pages that own pagination can
 *  sort the whole dataset before slicing, matching the table's header sort. */
export function sortRows<T>(rows: T[], columns: Column<T>[], sort: SortState): T[] {
  if (!sort) return rows;
  const col = columns.find((c) => c.key === sort.key);
  if (!col) return rows;
  const acc = col.sortAccessor ?? ((row: T) => (row as Record<string, unknown>)[col.key] as string | number | null | undefined);
  const dir = sort.dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => cmpVals(acc(a), acc(b)) * dir);
}

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  className?: string;
  render: (row: T) => React.ReactNode;
  /** Default text alignment (a user override, if any, wins). */
  align?: "left" | "center" | "right";
  /** Default pixel width used when the table is customizable. */
  width?: number;
  /** Smallest width the user can resize this column to (px). */
  minWidth?: number;
  /** When true the column can never be hidden (e.g. the primary name column). */
  lockVisible?: boolean;
  /** Start hidden until the user opts to show it (no saved layout yet). */
  defaultHidden?: boolean;
  /**
   * Comparable value for client-side sorting of this column. Defaults to the
   * row's field matching `key`. Provide this when the column renders derived
   * data (e.g. a joined name or a different field than its key).
   */
  sortAccessor?: (row: T) => string | number | boolean | null | undefined;
}

export interface RowAction<T> {
  label: string;
  icon: React.ReactNode;
  onClick: (row: T) => void;
  danger?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getKey: (row: T) => string | number;
  loading?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  sort?: { key: string; dir: "asc" | "desc" };
  onSort?: (key: string) => void;
  /** Fired with the active client-side sort (self-contained mode) so a page
   *  that slices rows itself can sort the full dataset the same way. */
  onSortChange?: (sort: SortState) => void;
  /** The incoming `rows` are already sorted (e.g. the page sorts in SQL from the
   *  onSortChange key). Keeps admin-config sortability + asc/desc reporting but
   *  skips DataTable's own client-side re-sort so the server order is preserved. */
  serverSorted?: boolean;
  rowActions?: (row: T) => RowAction<T>[];
  quickActions?: (row: T) => React.ReactNode;
  onRowClick?: (row: T) => void;
  page?: number;
  totalPages?: number;
  onPage?: (p: number) => void;
  total?: number;
  /**
   * Self-contained client-side pagination: DataTable slices `rows` itself,
   * renders the page bar + a rows-per-page selector, and (when `tableKey` is
   * set) persists the chosen size per user. Ignored when an external `onPage`
   * is provided (the page owns pagination then, e.g. the leads filter drawer).
   */
  paginate?: boolean;
  /** Default rows-per-page for internal pagination (usually the client setting). */
  defaultPageSize?: number;
  /** Controlled rows-per-page for EXTERNAL pagination (pages that own onPage). */
  pageSize?: number;
  /** Called when the user picks a new rows-per-page (external pagination). */
  onPageSize?: (n: number) => void;
  /** When provided, a grid (details) view becomes available alongside the list. */
  card?: (row: T) => React.ReactNode;
  /** Initial view; defaults to "list". */
  defaultView?: DataView;
  /** Controlled view: pass this (with the toggle rendered by the page) to own
   *  the toolbar layout. When set, DataTable renders no toolbar of its own. */
  view?: DataView;
  /** Enables a built-in search box that filters rows on these fields. */
  searchKeys?: (row: T) => (string | null | undefined)[];
  searchPlaceholder?: string;
  /** Initial value for the built-in search box (e.g. a global-search deep link). */
  initialSearch?: string;
  /**
   * In grid (card) view, reveal cards progressively as the user scrolls instead
   * of showing a page bar. Only affects the grid view; the list view keeps its
   * normal pagination. Requires `paginate` + a `card` renderer.
   */
  infiniteScroll?: boolean;
  /** Extra controls rendered on the left of the toolbar. */
  toolbar?: React.ReactNode;
  /**
   * Enables per-user column customization (show/hide, reorder, resize, align)
   * persisted under this key via /client/table-prefs/<tableKey>. Omit to keep
   * the table fixed and uncustomizable (the default for every other table).
   */
  tableKey?: string;
  /** When true, cell text never wraps (the table scrolls horizontally instead). */
  nowrap?: boolean;
  /** When true, a leading checkbox column is shown for bulk selection. */
  selectable?: boolean;
  /** Controlled set of selected row keys (used with selectable). */
  selectedKeys?: Set<string | number>;
  /** Called with the next selection whenever a checkbox toggles. */
  onSelectionChange?: (keys: Set<string | number>) => void;
  /** Pagination layout: "between" (default) or "right" to group controls right. */
  pageAlign?: "between" | "right";
  /** When true, the Columns menu lets the user rename column headers (client admin). */
  canRenameColumns?: boolean;
}

const EMPTY_SELECTION: Set<string | number> = new Set();

export function DataTable<T>({
  columns,
  rows,
  getKey,
  loading,
  emptyTitle = "Nothing here yet",
  emptyHint,
  sort,
  onSort,
  onSortChange,
  serverSorted,
  rowActions,
  quickActions,
  onRowClick,
  page = 1,
  totalPages = 1,
  onPage,
  total,
  paginate,
  defaultPageSize,
  pageSize: controlledPageSize,
  onPageSize,
  card,
  defaultView = "list",
  view: controlledView,
  searchKeys,
  searchPlaceholder = "Search…",
  initialSearch = "",
  infiniteScroll,
  toolbar,
  tableKey,
  nowrap,
  selectable,
  selectedKeys,
  onSelectionChange,
  pageAlign = "between",
  canRenameColumns,
}: DataTableProps<T>) {
  const [internalView, setInternalView] = useState<DataView>(defaultView);
  const [query, setQuery] = useState(initialSearch);
  const isControlled = controlledView !== undefined;
  const view = isControlled ? controlledView : internalView;
  const setView = setInternalView;

  // Per-user column layout (only active when tableKey is set).
  const tc = useTableConfig(tableKey, columns, canRenameColumns);
  const customize = !!tableKey;
  const cols = tc.columns;

  // Sorting. Controlled when the page supplies onSort (e.g. super-admin tables
  // that sort server-side); otherwise the table sorts itself client-side,
  // seeded from the client-wide admin config (tc.sort) with an ephemeral
  // per-view override when the user clicks a header.
  const controlledSort = !!onSort;
  const [internalSort, setInternalSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const userTouchedSort = useRef(false);
  useEffect(() => {
    if (controlledSort || userTouchedSort.current) return;
    setInternalSort(tc.sort.key ? { key: tc.sort.key, dir: tc.sort.dir } : null);
  }, [controlledSort, tc.sort.key, tc.sort.dir]);
  const effectiveSort: SortState = (controlledSort ? sort : internalSort) ?? null;
  // A column is sortable per the admin config; when the admin hasn't configured
  // any, fall back to the columns' own `sortable` flags so nothing regresses.
  const isColSortable = (key: string) => {
    if (controlledSort) return !!cols.find((c) => c.key === key)?.sortable;
    return tc.sort.sortable.length ? tc.sort.sortable.includes(key) : !!cols.find((c) => c.key === key)?.sortable;
  };
  const handleSort = (key: string) => {
    if (controlledSort) { onSort?.(key); return; }
    userTouchedSort.current = true;
    setInternalSort((s) => (s && s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  };

  // Column drag-to-reorder + drag-to-resize, both on the header row.
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const [resizingKey, setResizingKey] = useState<string | null>(null);

  function startResize(e: React.MouseEvent, key: string, startW: number) {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { key, startX: e.clientX, startW };
    setResizingKey(key);
    const move = (ev: MouseEvent) => {
      const r = resizing.current;
      if (r) tc.setWidth(r.key, r.startW + (ev.clientX - r.startX));
    };
    const up = () => {
      resizing.current = null;
      setResizingKey(null);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // Client-side search, only when searchKeys is supplied. Server-paginated
  // tables keep their own search and simply omit it.
  const searched = useMemo(() => {
    if (!searchKeys) return rows;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => searchKeys(r).some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [rows, searchKeys, query]);

  // Client-side sort (self-contained mode only — controlled tables arrive
  // already ordered from the page). Sorts the whole filtered set before paging.
  const visible = useMemo(
    () => (controlledSort || serverSorted ? searched : sortRows(searched, cols, effectiveSort)),
    [searched, controlledSort, serverSorted, effectiveSort, cols],
  );

  // Report the active sort so pages that own their pagination (slice rows before
  // passing them in) can sort the full dataset with the same order.
  useEffect(() => {
    if (controlledSort) return;
    onSortChange?.(effectiveSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledSort, effectiveSort]);

  // Self-contained client-side pagination. Active only when `paginate` is set
  // and the page hasn't taken over pagination via its own `onPage`. The chosen
  // rows-per-page persists per user when a tableKey is present; otherwise it
  // lives in component state (resets on reload).
  const internalPaginate = !!paginate && !onPage;
  const [internalPage, setInternalPage] = useState(1);
  const [localPageSize, setLocalPageSize] = useState<number | undefined>(undefined);
  const effectivePageSize =
    (customize ? tc.pageSize : localPageSize) ?? defaultPageSize ?? 15;
  const setPageSize = (n: number) => {
    if (customize) tc.setPageSize(n);
    else setLocalPageSize(n);
    setInternalPage(1);
  };

  // Reset to page 1 whenever the result set changes shape (search/page-size).
  useEffect(() => { setInternalPage(1); }, [query, effectivePageSize]);

  const internalTotalPages = internalPaginate
    ? Math.max(1, Math.ceil(visible.length / effectivePageSize))
    : 1;
  const safeInternalPage = Math.min(internalPage, internalTotalPages);
  const displayRows = useMemo(() => {
    if (!internalPaginate) return visible;
    const start = (safeInternalPage - 1) * effectivePageSize;
    return visible.slice(start, start + effectivePageSize);
  }, [internalPaginate, visible, safeInternalPage, effectivePageSize]);

  // Grid-view infinite scroll: progressively reveal cards (in page-size batches)
  // as a sentinel near the end of the list scrolls into view. Only kicks in for
  // the grid view with internal pagination; the list view keeps its page bar.
  const infinite = !!infiniteScroll && !!card && view === "grid" && internalPaginate;
  const batch = Math.max(1, effectivePageSize);
  const [visibleCount, setVisibleCount] = useState(batch);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset the revealed window when the result set or batch size changes.
  useEffect(() => { if (infinite) setVisibleCount(batch); }, [infinite, batch, query, visible.length]);

  // Reveal the next batch whenever the sentinel is in view (re-observes after
  // each reveal so a sentinel that's still visible keeps loading).
  useEffect(() => {
    if (!infinite) return;
    const el = sentinelRef.current;
    if (!el || visibleCount >= visible.length) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) setVisibleCount((c) => Math.min(c + batch, visible.length)); },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [infinite, batch, visible.length, visibleCount]);

  const gridRows = infinite ? visible.slice(0, visibleCount) : displayRows;
  const hasMore = infinite && visibleCount < visible.length;

  // Bulk-selection state (only active when selectable). Select-all toggles the
  // rows on the current page so it plays nicely with search/pagination.
  const selected = selectedKeys ?? EMPTY_SELECTION;
  const allSelected = selectable && displayRows.length > 0 && displayRows.every((r) => selected.has(getKey(r)));
  const someSelected = selectable && !allSelected && displayRows.some((r) => selected.has(getKey(r)));
  const toggleAll = () => {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    if (allSelected) displayRows.forEach((r) => next.delete(getKey(r)));
    else displayRows.forEach((r) => next.add(getKey(r)));
    onSelectionChange(next);
  };
  const toggleRow = (key: string | number) => {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(next);
  };
  const cellNowrap = nowrap ? "whitespace-nowrap" : "";

  const activeView: DataView = card ? view : "list";
  const showToolbar = !isControlled && !!(card || searchKeys || toolbar);
  const shell = "overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm";

  const pager = !loading && visible.length > 0 && (
    onPage ? (
      <Pagination page={page} totalPages={totalPages} onPage={onPage} total={total} count={visible.length} align={pageAlign} pageSize={controlledPageSize} onPageSize={onPageSize} />
    ) : internalPaginate ? (
      <Pagination
        page={safeInternalPage}
        totalPages={internalTotalPages}
        onPage={setInternalPage}
        total={visible.length}
        count={visible.length}
        align={pageAlign}
        pageSize={effectivePageSize}
        onPageSize={setPageSize}
      />
    ) : null
  );

  // Has-actions / leading-checkbox flags, reused by the skeleton + real table.
  const hasActionsCol = !!(rowActions || quickActions);

  let body: React.ReactNode;
  if (loading) {
    // Content-shaped skeleton: real headers (so columns don't jump when data
    // arrives) over shimmering placeholder rows, or placeholder cards in grid view.
    body = activeView === "grid" && card ? (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    ) : (
      <div className={shell}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {selectable && <th className="w-11 px-4 py-2.5" />}
                {cols.map((c) => (
                  <th key={c.key} className={`px-4 py-2.5 ${c.className ?? ""}`}><span className="truncate">{c.header}</span></th>
                ))}
                {hasActionsCol && <th className="px-4 py-2.5 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 7 }).map((_, r) => (
                <tr key={r} className="border-b border-slate-100 last:border-0">
                  {selectable && <td className="px-4 py-3"><Skeleton className="h-4 w-4" /></td>}
                  {cols.map((c, ci) => (
                    <td key={c.key} className="px-4 py-3"><Skeleton className={`h-3.5 ${ci === 0 ? "w-32" : "w-20"}`} /></td>
                  ))}
                  {hasActionsCol && <td className="px-4 py-3"><Skeleton className="ml-auto h-6 w-12" /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  } else if (visible.length === 0) {
    body = <div className={shell}><EmptyState title={emptyTitle} hint={emptyHint} /></div>;
  } else if (activeView === "grid" && card) {
    body = (
      <>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {gridRows.map((row) => (
            <div key={getKey(row)}>{card(row)}</div>
          ))}
        </div>
        {infinite ? (
          hasMore ? (
            <div ref={sentinelRef} className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>
              Loading more…
            </div>
          ) : (
            visible.length > batch && <div className="py-6 text-center text-xs text-slate-400">All {visible.length} shown</div>
          )
        ) : (
          pager && <div className={`mt-4 ${shell}`}>{pager}</div>
        )}
      </>
    );
  } else {
    body = (
      <div className={shell}>
        <div className="overflow-x-auto">
          <table className={`w-full text-[13px] ${customize && !nowrap ? "table-fixed" : ""}`}>
            {customize && (
              <colgroup>
                {selectable && <col style={{ width: 44 }} />}
                {cols.map((c) => <col key={c.key} style={{ width: c.resolvedWidth }} />)}
                {(rowActions || quickActions) && <col style={{ width: 96 }} />}
              </colgroup>
            )}
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {selectable && (
                  <th className="sticky left-0 z-20 w-11 bg-slate-50 px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      checked={!!allSelected}
                      ref={(el) => { if (el) el.indeterminate = !!someSelected; }}
                      onChange={toggleAll}
                      className="h-4 w-4 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </th>
                )}
                {cols.map((c) => {
                  const isSorted = effectiveSort?.key === c.key;
                  const sortableHere = isColSortable(c.key);
                  const isOver = customize && overCol === c.key && dragCol !== c.key;
                  return (
                    <th
                      key={c.key}
                      style={customize ? { textAlign: c.resolvedAlign } : undefined}
                      draggable={customize && resizingKey === null}
                      onDragStart={customize ? () => setDragCol(c.key) : undefined}
                      onDragOver={customize ? (e) => { if (dragCol && dragCol !== c.key) { e.preventDefault(); setOverCol(c.key); } } : undefined}
                      onDragLeave={customize ? () => setOverCol((o) => (o === c.key ? null : o)) : undefined}
                      onDrop={customize ? () => { if (dragCol) tc.moveBefore(dragCol, c.key); setDragCol(null); setOverCol(null); } : undefined}
                      onDragEnd={customize ? () => { setDragCol(null); setOverCol(null); } : undefined}
                      className={`relative select-none px-4 py-2.5 ${cellNowrap} ${c.className ?? ""} ${customize ? "cursor-grab active:cursor-grabbing" : ""} ${dragCol === c.key ? "opacity-40" : ""} ${isOver ? "bg-indigo-50" : ""}`}
                    >
                      {sortableHere ? (
                        <button
                          onClick={() => handleSort(c.key)}
                          onMouseDown={(e) => e.stopPropagation()}
                          draggable={false}
                          className="inline-flex items-center gap-1 transition hover:text-slate-600"
                        >
                          {c.header}
                          <span className="flex flex-col -space-y-1">
                            <svg className={`h-2 w-2 ${isSorted && effectiveSort?.dir === "asc" ? "text-indigo-600" : "text-slate-300"}`} fill="currentColor" viewBox="0 0 20 20"><path d="M10 4l5 6H5z" /></svg>
                            <svg className={`h-2 w-2 ${isSorted && effectiveSort?.dir === "desc" ? "text-indigo-600" : "text-slate-300"}`} fill="currentColor" viewBox="0 0 20 20"><path d="M10 16l-5-6h10z" /></svg>
                          </span>
                        </button>
                      ) : (
                        <span className="truncate">{c.header}</span>
                      )}
                      {customize && (
                        <span
                          onMouseDown={(e) => startResize(e, c.key, c.resolvedWidth)}
                          onClick={(e) => e.stopPropagation()}
                          onDragStart={(e) => e.preventDefault()}
                          title="Drag to resize"
                          className="absolute right-0 top-0 z-10 flex h-full w-2 cursor-col-resize items-center justify-center hover:bg-indigo-200/50"
                        >
                          <span className="h-3.5 w-px bg-slate-300" />
                        </span>
                      )}
                    </th>
                  );
                })}
                {(rowActions || quickActions) && (
                  <th className="sticky right-0 z-20 whitespace-nowrap bg-slate-50 px-4 py-2.5 text-right shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.12)]">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr
                  key={getKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`group border-b border-slate-100 transition last:border-0 hover:bg-indigo-50/40 ${selectable && selected.has(getKey(row)) ? "bg-indigo-50/40" : ""} ${onRowClick ? "cursor-pointer" : ""}`}
                >
                  {selectable && (
                    <td
                      className={`sticky left-0 z-10 w-11 px-4 py-2 align-middle transition group-hover:bg-[#f8faff] ${selectable && selected.has(getKey(row)) ? "bg-[#f8faff]" : "bg-white"}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={selected.has(getKey(row))}
                        onChange={() => toggleRow(getKey(row))}
                        className="h-4 w-4 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </td>
                  )}
                  {cols.map((c) => (
                    <td
                      key={c.key}
                      style={customize ? { textAlign: c.resolvedAlign } : undefined}
                      className={`px-4 py-2 align-middle ${cellNowrap} ${customize && !nowrap ? "truncate" : ""} ${c.className ?? ""}`}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                  {(rowActions || quickActions) && (
                    <td
                      className={`sticky right-0 z-10 whitespace-nowrap px-4 py-2 shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.12)] transition group-hover:bg-[#f8faff] ${selectable && selected.has(getKey(row)) ? "bg-[#f8faff]" : "bg-white"}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        {quickActions?.(row)}
                        {rowActions && <RowMenu actions={rowActions(row)} row={row} />}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pager}
      </div>
    );
  }

  // A table with a tableKey gets a slim bar holding the "Columns" gear, even
  // when it has no other toolbar (search / view toggle).
  if (!showToolbar) {
    if (!customize) return <>{body}</>;
    return (
      <div className="space-y-3">
        <div className="flex justify-end"><ColumnSettings api={tc} /></div>
        {body}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          {searchKeys && (
            <div className="relative min-w-56 flex-1 sm:max-w-xs">
              <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              />
            </div>
          )}
          {toolbar}
        </div>
        <div className="flex items-center gap-2">
          {customize && <ColumnSettings api={tc} />}
          {card && <ViewToggle view={activeView} onChange={setView} />}
        </div>
      </div>
      {body}
    </div>
  );
}

export function ViewToggle({ view, onChange }: { view: DataView; onChange: (v: DataView) => void }) {
  const btn = (active: boolean) =>
    `flex h-8 w-8 items-center justify-center rounded-md transition ${active ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-100"}`;
  return (
    <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
      <button title="List view" onClick={() => onChange("list")} className={btn(view === "list")}>
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button title="Details view" onClick={() => onChange("grid")} className={btn(view === "grid")}>
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 4h7v7H4zM13 4h7v7h-7zM13 13h7v7h-7zM4 13h7v7H4z" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );
}

export function IconButton({
  title,
  onClick,
  children,
  danger = false,
  disabled = false,
}: {
  title: string;
  onClick?: () => void;
  children: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? "hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600"
          : "hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
      }`}
    >
      {children}
    </button>
  );
}

export function RowMenu<T>({ actions, row }: { actions: RowAction<T>[]; row: T }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex h-7 w-7 items-center justify-center rounded-lg border text-slate-500 transition ${open ? "border-indigo-300 bg-indigo-50 text-indigo-600" : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"}`}
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path d="M6 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm5.5 0a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm4 1.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" /></svg>
      </button>
      {open && (
        <div className="animate-fade-up absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl">
          <div className="px-3 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Menu</div>
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={() => { setOpen(false); a.onClick(row); }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition hover:bg-slate-50 ${a.danger ? "text-red-600 hover:bg-red-50" : "text-slate-700"}`}
            >
              <span className={a.danger ? "text-red-500" : "text-slate-400"}>{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Numbered pagination with ellipses, like the reference design. */
export function Pagination({
  page,
  totalPages,
  onPage,
  total,
  count,
  align = "between",
  pageSize,
  onPageSize,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  total?: number;
  count?: number;
  /** "between" spreads Prev / pages / Next; "right" groups them on the right. */
  align?: "between" | "right";
  /** Current rows-per-page; renders a selector when paired with onPageSize. */
  pageSize?: number;
  onPageSize?: (n: number) => void;
}) {
  const pages = pageList(page, totalPages);
  const sizePicker = pageSize !== undefined && onPageSize && (
    <label className="flex items-center gap-1.5 text-[13px] text-slate-500">
      <span className="hidden sm:inline">Rows</span>
      <select
        value={pageSize}
        onChange={(e) => onPageSize(Number(e.target.value))}
        className="rounded-lg border border-slate-200 bg-white py-1.5 pl-2 pr-6 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
      >
        {PAGE_SIZE_OPTIONS.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
    </label>
  );
  const prevBtn = (
    <button
      disabled={page <= 1}
      onClick={() => onPage(page - 1)}
      className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      Previous
    </button>
  );
  const numbers = (
    <div className="flex items-center gap-1">
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`e${i}`} className="px-2 text-slate-400">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPage(p)}
            className={`h-8 min-w-8 rounded-lg px-2.5 text-[13px] font-medium transition ${p === page ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/25" : "text-slate-600 hover:bg-white hover:shadow-sm"}`}
          >
            {p}
          </button>
        ),
      )}
    </div>
  );
  const nextBtn = (
    <button
      disabled={page >= totalPages}
      onClick={() => onPage(page + 1)}
      className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
    >
      Next
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );

  const summary = (total ?? count) !== undefined && (
    <span className="text-[13px] text-slate-500">{(total ?? count)} result{(total ?? count) === 1 ? "" : "s"} · page {page} of {totalPages}</span>
  );

  if (align === "right") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/40 px-4 py-2.5">
        <div className="flex items-center gap-3">{summary}{sizePicker}</div>
        <div className="flex items-center gap-2">{prevBtn}{numbers}{nextBtn}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/40 px-4 py-2.5">
      <div className="flex items-center gap-2">{prevBtn}{sizePicker}</div>
      {numbers}
      {nextBtn}
    </div>
  );
}

function pageList(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "...")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("...");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push("...");
  out.push(total);
  return out;
}

// ---- reusable cells ----

/** Circular avatar — shows a photo when `image` is set, else a gradient initial. */
export function Avatar({
  name,
  image,
  size = "sm",
  color = "from-indigo-500 to-violet-600",
}: {
  name: string;
  image?: string | null;
  size?: "sm" | "lg";
  color?: string;
}) {
  const box = size === "lg" ? "h-16 w-16" : "h-8 w-8";
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={image} alt={name} className={`${box} flex-shrink-0 rounded-full object-cover shadow-sm`} />
    );
  }
  return (
    <span className={`flex ${box} flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${color} font-bold text-white shadow-sm ${size === "lg" ? "text-xl" : "text-[11px]"}`}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function AvatarCell({
  name,
  subtitle,
  image,
  color = "from-indigo-500 to-violet-600",
}: {
  name: string;
  subtitle?: string;
  image?: string | null;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar name={name} image={image} color={color} />
      <div className="min-w-0">
        <div className="truncate font-semibold text-slate-800">{name}</div>
        {subtitle && <div className="truncate text-[11px] text-slate-400">{subtitle}</div>}
      </div>
    </div>
  );
}

/**
 * Card for the "details" grid view: avatar on top, name, subtitle, badge, then
 * an optional divided footer. `menu` floats top-right; `onClick` opens the row.
 */
export function EntityCard({
  avatar,
  title,
  subtitle,
  badge,
  footer,
  menu,
  onClick,
}: {
  avatar: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  footer?: React.ReactNode;
  menu?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div className="group relative flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      {menu && (
        <div className="absolute right-3 top-3 z-10" onClick={(e) => e.stopPropagation()}>
          {menu}
        </div>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className={`flex flex-col items-center px-2 text-center ${onClick ? "cursor-pointer" : "cursor-default"}`}
      >
        {avatar}
        <span className="mt-3 block max-w-full truncate font-semibold text-slate-900">{title}</span>
        {subtitle && <span className="mt-0.5 block max-w-full truncate text-sm text-slate-500">{subtitle}</span>}
        {badge && <span className="mt-2 block">{badge}</span>}
      </button>
      {footer && <div className="mt-4 border-t border-slate-100 pt-4 text-center text-sm">{footer}</div>}
    </div>
  );
}

const dotColors: Record<string, string> = {
  indigo: "bg-indigo-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  rose: "bg-rose-500",
  slate: "bg-slate-400",
};

export function DotLabel({ label, color = "slate" }: { label: string; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-slate-600">
      <span className={`h-1.5 w-1.5 rounded-full ${dotColors[color] ?? dotColors.slate}`} />
      <span className="capitalize">{label}</span>
    </span>
  );
}
