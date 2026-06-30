"use client";

import { useEffect, useMemo, useState } from "react";
import {
  adminGet,
  backupClientDb,
  backupMainDb,
  getClientSchema,
  getClientTableData,
  type Client,
  type ClientSchema,
  type SchemaTable,
  type TableData,
} from "../../lib/admin";
import { EmptyState, PageHeader, SkeletonBlock } from "../ui";
import { useToast } from "../../components/toast/ToastProvider";
import AutoBackupPanel from "./AutoBackupPanel";

/** Human-readable byte size, e.g. "12.4 KB". */
function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Colour a column's SQL type by family so the schema scans quickly. */
function typeTone(type: string): string {
  const t = type.toLowerCase();
  if (/(^|\b)(int|bigint|smallint|tinyint|decimal|float|double|numeric)/.test(t))
    return "bg-sky-50 text-sky-700 ring-sky-100";
  if (/(date|time|year)/.test(t)) return "bg-violet-50 text-violet-700 ring-violet-100";
  if (/(text|blob|json)/.test(t)) return "bg-amber-50 text-amber-700 ring-amber-100";
  if (/(enum|set)/.test(t)) return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  return "bg-slate-100 text-slate-600 ring-slate-200"; // varchar/char/etc.
}

const keyMeta: Record<string, { label: string; tone: string }> = {
  PRI: { label: "Primary", tone: "bg-amber-100 text-amber-700" },
  UNI: { label: "Unique", tone: "bg-indigo-100 text-indigo-700" },
  MUL: { label: "Index", tone: "bg-slate-100 text-slate-600" },
};

function SummaryCard({ label, value, icon, tone }: { label: string; value: string | number; icon: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <div>
          <div className="text-2xl font-bold text-slate-900">{value}</div>
          <div className="text-sm text-slate-500">{label}</div>
        </div>
      </div>
    </div>
  );
}

/** Render a single cell value: nulls muted, long strings truncated. */
function Cell({ value }: { value: string | number | null }) {
  if (value === null) return <span className="text-slate-300 italic">NULL</span>;
  const s = String(value);
  return (
    <span className="block max-w-[22rem] truncate align-top font-mono text-slate-700" title={s.length > 60 ? s : undefined}>
      {s === "" ? <span className="text-slate-300">∅</span> : s}
    </span>
  );
}

/**
 * Paginated, searchable, sortable browser for one table's rows. Remounted per
 * table (via a `key` on the parent) so its page/search/sort reset cleanly.
 */
function TableDataBrowser({ clientId, table }: { clientId: number; table: string }) {
  const [data, setData] = useState<TableData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<{ column: string | null; dir: "asc" | "desc" }>({ column: null, dir: "asc" });

  // Debounce the search box; reset to the first page on a new term.
  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [search]);

  function load() {
    setLoading(true);
    setError(null);
    getClientTableData(clientId, table, {
      page,
      perPage,
      search: debounced,
      sort: sort.column ?? undefined,
      dir: sort.dir,
    })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load rows"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, table, page, perPage, debounced, sort]);

  function toggleSort(col: string) {
    setSort((s) => (s.column === col ? { column: col, dir: s.dir === "asc" ? "desc" : "asc" } : { column: col, dir: "asc" }));
    setPage(1);
  }

  const pg = data?.pagination;
  const from = pg && pg.total ? (pg.page - 1) * pg.per_page + 1 : 0;
  const to = pg ? Math.min(pg.page * pg.per_page, pg.total) : 0;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search all columns…"
            className="w-72 rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
          />
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <label className="flex items-center gap-1.5">
            <span>Rows</span>
            <select
              value={perPage}
              onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
            >
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {pg && <span className="tabular-nums">{from.toLocaleString()}–{to.toLocaleString()} of {pg.total.toLocaleString()}</span>}
        </div>
      </div>

      {/* Grid */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {error ? (
          <div className="p-6 text-sm text-rose-700">{error}</div>
        ) : !data ? (
          <SkeletonBlock className="h-64" />
        ) : data.rows.length === 0 ? (
          <EmptyState title="No rows" hint={debounced ? "No rows match your search." : "This table is empty."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {data.columns.map((col) => {
                    const active = data.sort.column === col;
                    return (
                      <th key={col} className="px-4 py-2.5">
                        <button onClick={() => toggleSort(col)} className="inline-flex items-center gap-1 font-mono hover:text-slate-600">
                          {col}
                          <span className={active ? "text-indigo-500" : "text-slate-300"}>
                            {active ? (data.sort.dir === "asc" ? "▲" : "▼") : "↕"}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    {data.columns.map((col) => (
                      <td key={col} className="whitespace-nowrap px-4 py-2"><Cell value={row[col] ?? null} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {loading && data && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50">
            <svg className="h-6 w-6 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pg && pg.total_pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">Page {pg.page} of {pg.total_pages}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(1)} disabled={pg.page <= 1} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40">«</button>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pg.page <= 1} className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40">Prev</button>
            <button onClick={() => setPage((p) => Math.min(pg.total_pages, p + 1))} disabled={pg.page >= pg.total_pages} className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40">Next</button>
            <button onClick={() => setPage(pg.total_pages)} disabled={pg.page >= pg.total_pages} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40">»</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DatabasePage() {
  const toast = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState<number | null>(null);
  const [backuping, setBackuping] = useState<"main" | "client" | null>(null);
  const [schema, setSchema] = useState<ClientSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"structure" | "data">("structure");

  // Load the client list once; default to the first client.
  useEffect(() => {
    adminGet<{ clients: Client[] }>("/clients")
      .then((d) => {
        setClients(d.clients);
        if (d.clients.length) setClientId(d.clients[0].id);
      })
      .catch(() => setClients([]));
  }, []);

  // Load the selected client's schema. Defined outside the effect body so the
  // reset/loading state isn't set synchronously during render.
  function loadSchema(id: number) {
    setLoading(true);
    setError(null);
    setSchema(null);
    setActiveTable(null);
    getClientSchema(id)
      .then((d) => {
        setSchema(d);
        if (d.tables.length) setActiveTable(d.tables[0].name);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load schema"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // Deliberate fetch-on-change: load the schema whenever the client switches.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (clientId != null) loadSchema(clientId);
  }, [clientId]);

  const tables = useMemo(() => {
    const list = schema?.tables ?? [];
    if (!q.trim()) return list;
    const term = q.toLowerCase();
    return list.filter((t) => t.name.toLowerCase().includes(term));
  }, [schema, q]);

  const selected: SchemaTable | undefined = useMemo(
    () => schema?.tables.find((t) => t.name === activeTable),
    [schema, activeTable],
  );

  return (
    <>
      <PageHeader
        title="Database"
        subtitle="Inspect the structure of any client's isolated database"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={async () => {
                setBackuping("main");
                try { await backupMainDb(); toast.success("Main database backup downloaded."); }
                catch (e) { toast.error(e instanceof Error ? e.message : "Backup failed"); }
                finally { setBackuping(null); }
              }}
              disabled={backuping !== null}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {backuping === "main" ? "Backing up…" : "Backup main DB"}
            </button>
            <button
              onClick={async () => {
                if (!clientId) return;
                const c = clients.find((x) => x.id === clientId);
                setBackuping("client");
                try { await backupClientDb(clientId, (c?.name ?? "client").replace(/\s+/g, "-").toLowerCase()); toast.success(`Backup of ${c?.name ?? "client"} downloaded.`); }
                catch (e) { toast.error(e instanceof Error ? e.message : "Backup failed"); }
                finally { setBackuping(null); }
              }}
              disabled={backuping !== null || !clientId}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {backuping === "client" ? "Backing up…" : "Backup this client"}
            </button>
            <label className="flex items-center gap-2 text-sm">
              <span className="font-medium text-slate-500">Client</span>
              <select
                value={clientId ?? ""}
                onChange={(e) => setClientId(Number(e.target.value))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              >
                {clients.length === 0 && <option value="">No clients</option>}
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          </div>
        }
      />

      <AutoBackupPanel />

      {loading && <SkeletonBlock className="h-64" />}

      {!loading && error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
          <p className="font-semibold">Couldn&apos;t load this database</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      {!loading && !error && schema && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="grid gap-4 sm:grid-cols-3">
            <SummaryCard label="Tables" value={schema.summary.tables} tone="bg-indigo-100 text-indigo-600" icon="M4 6h16M4 12h16M4 18h16" />
            <SummaryCard label="Total rows" value={schema.summary.total_rows.toLocaleString()} tone="bg-emerald-100 text-emerald-600" icon="M3 10h18M3 6h18v12a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            <SummaryCard label="Size on disk" value={fmtBytes(schema.summary.total_size)} tone="bg-violet-100 text-violet-600" icon="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7" />
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">
            <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5v14" strokeLinecap="round" /></svg>
            Database <code className="rounded bg-white px-1.5 py-0.5 font-mono text-slate-700">{schema.client.db_name}</code> — isolated to {schema.client.name}.
          </div>

          {/* Explorer: table list + selected table detail */}
          <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
            {/* Table list */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-3">
                <div className="relative">
                  <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search tables…"
                    className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                  />
                </div>
              </div>
              <div className="max-h-[60vh] overflow-y-auto p-2">
                {tables.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-slate-400">No tables match.</p>
                ) : (
                  tables.map((t) => {
                    const active = t.name === activeTable;
                    return (
                      <button
                        key={t.name}
                        onClick={() => setActiveTable(t.name)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100"}`}
                      >
                        <span className="truncate font-mono">{t.name}</span>
                        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${active ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-500"}`}>
                          {t.rows.toLocaleString()}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Selected table detail */}
            <div className="min-w-0">
              {!selected ? (
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <EmptyState title="Select a table" hint="Pick a table on the left to view its columns." />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <h2 className="font-mono text-lg font-bold text-slate-900">{selected.name}</h2>
                    <span className="text-sm text-slate-400">
                      {selected.columns.length} columns · {selected.rows.toLocaleString()} rows · {fmtBytes(selected.size)}
                      {selected.engine ? ` · ${selected.engine}` : ""}
                    </span>
                  </div>
                  {selected.comment && <p className="text-sm text-slate-500">{selected.comment}</p>}

                  {/* Structure / Data tabs */}
                  <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
                    {(["structure", "data"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setViewMode(m)}
                        className={`rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition ${viewMode === m ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-700"}`}
                      >
                        {m === "structure" ? "Structure" : "Data"}
                      </button>
                    ))}
                  </div>

                  {viewMode === "data" && clientId != null && (
                    <TableDataBrowser key={`${clientId}-${selected.name}`} clientId={clientId} table={selected.name} />
                  )}

                  {viewMode === "structure" && (<>
                  {/* Columns */}
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                            <th className="px-4 py-2.5">Column</th>
                            <th className="px-4 py-2.5">Type</th>
                            <th className="px-4 py-2.5">Null</th>
                            <th className="px-4 py-2.5">Key</th>
                            <th className="px-4 py-2.5">Default</th>
                            <th className="px-4 py-2.5">Extra</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.columns.map((c) => (
                            <tr key={c.name} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                              <td className="px-4 py-2.5">
                                <span className="font-mono font-medium text-slate-800">{c.name}</span>
                                {c.comment && <span className="ml-2 text-xs text-slate-400">{c.comment}</span>}
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={`inline-block rounded-md px-2 py-0.5 font-mono text-xs ring-1 ${typeTone(c.type)}`}>{c.type}</span>
                              </td>
                              <td className="px-4 py-2.5">
                                {c.null
                                  ? <span className="text-slate-400">NULL</span>
                                  : <span className="font-medium text-slate-600">NOT NULL</span>}
                              </td>
                              <td className="px-4 py-2.5">
                                {c.key && keyMeta[c.key]
                                  ? <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${keyMeta[c.key].tone}`}>{keyMeta[c.key].label}</span>
                                  : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-4 py-2.5">
                                {c.default === null
                                  ? <span className="text-slate-300">—</span>
                                  : <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">{c.default}</code>}
                              </td>
                              <td className="px-4 py-2.5 text-xs text-slate-500">{c.extra || <span className="text-slate-300">—</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Indexes */}
                  {selected.indexes.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Indexes</h3>
                      <div className="flex flex-wrap gap-2">
                        {selected.indexes.map((i) => (
                          <span key={i.name} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs">
                            <span className={`h-1.5 w-1.5 rounded-full ${i.unique ? "bg-indigo-500" : "bg-slate-400"}`} />
                            <span className="font-medium text-slate-600">{i.name}</span>
                            <span className="font-mono text-slate-400">({i.columns.join(", ")})</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  </>)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!loading && !error && !schema && clients.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <EmptyState title="No clients yet" hint="Create a client to inspect its database." />
        </div>
      )}
    </>
  );
}
