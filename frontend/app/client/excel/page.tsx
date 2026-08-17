"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, Card, Spinner } from "../../admin/ui";
import { SearchSelect, MultiSelect, type SelectOption } from "../../admin/SearchSelect";
import { useClient } from "../ClientContext";
import { useToast } from "../../components/toast/ToastProvider";
import { exportXlsx, exportCsvGrid } from "../../lib/xlsxExport";
import { parseFile, mapGrid, validateRows, importTemplate } from "./importEngine";
import {
  getImportSetup, importLeads, importTasks, importTeam,
  getLeads, getTasks, getStaff, getLeadStatuses, getLeadSources, getLeadTypes,
  type ImportEntity, type ImportColumn, type ImportResult,
  type LeadStatus, type LeadSource, type LeadType, type Staff,
} from "../../lib/client";

const lbl = "mb-1 block text-sm font-medium text-slate-600";

const ENTITIES: { key: ImportEntity; label: string; assignable: boolean }[] = [
  { key: "lead", label: "Leads", assignable: true },
  { key: "task", label: "Tasks", assignable: true },
  { key: "team", label: "Team", assignable: false },
];

/**
 * The lead EXPORT column set — richer than the importable columns: it includes the
 * resolved names + system fields (assignment date & time, created/follow dates,
 * last activity) that you view/report on but don't map on import. Custom fields
 * are appended after these at export time.
 */
const LEAD_EXPORT_COLS: { key: string; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "alt_phone", label: "Alternative Phone" },
  { key: "email", label: "Email" },
  { key: "status", label: "Status" },
  { key: "sub_status", label: "Sub Status" },
  { key: "source", label: "Lead Source" },
  { key: "lead_type", label: "Lead Type" },
  { key: "reference_name", label: "Reference" },
  { key: "assigned_to_name", label: "Assigned To" },
  { key: "assigned_date", label: "Assigned Date & Time" },
  { key: "follow_date", label: "Follow-up Date" },
  { key: "created_date", label: "Created Date" },
  { key: "first_response_seconds", label: "First Response (sec)" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "last_call_at", label: "Last Call" },
  { key: "last_reminder_at", label: "Last Reminder" },
  { key: "description", label: "Description" },
];

export default function ExcelHubPage() {
  const { can, permissionsLoaded } = useClient();
  const [tab, setTab] = useState<ImportEntity>("lead");

  // Shared lookups (loaded once) for import options + export naming.
  const [statuses, setStatuses] = useState<LeadStatus[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [types, setTypes] = useState<LeadType[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  useEffect(() => {
    let alive = true;
    getLeadStatuses().then((d) => { if (alive) setStatuses(d.lead_statuses ?? []); }).catch(() => {});
    getLeadSources().then((d) => { if (alive) setSources(d.lead_sources ?? []); }).catch(() => {});
    getLeadTypes().then((d) => { if (alive) setTypes(d.lead_types ?? []); }).catch(() => {});
    getStaff().then((d) => { if (alive) setStaff(d.staff ?? []); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (permissionsLoaded && !can("data_import", "view")) {
    return (
      <Card className="mx-auto mt-10 max-w-lg text-center">
        <h2 className="text-lg font-semibold text-slate-800">No access</h2>
        <p className="mt-1 text-sm text-slate-500">You don&apos;t have permission to import or export data. Ask an admin to grant the <b>Import (Excel)</b> permission.</p>
      </Card>
    );
  }

  return (
    <div>
      <PageHeader title="Excel / Data" subtitle="Import from and export to Excel (.xlsx) or CSV — leads, tasks and team." />
      <div className="mb-5 flex gap-6 border-b border-slate-200">
        {ENTITIES.map((e) => (
          <button key={e.key} onClick={() => setTab(e.key)} className={`-mb-px border-b-2 px-1 pb-3 text-sm font-medium ${tab === e.key ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>{e.label}</button>
        ))}
      </div>
      <EntityPanel key={tab} entity={tab} statuses={statuses} sources={sources} types={types} staff={staff} />
    </div>
  );
}

function EntityPanel({ entity, statuses, sources, types, staff }: {
  entity: ImportEntity; statuses: LeadStatus[]; sources: LeadSource[]; types: LeadType[]; staff: Staff[];
}) {
  const toast = useToast();
  const { can } = useClient();
  const canImport = can("data_import", "create"); // view-only users can still export
  const assignable = entity !== "team";
  const fileRef = useRef<HTMLInputElement>(null);

  const [columns, setColumns] = useState<ImportColumn[]>([]);
  const [loading, setLoading] = useState(true);
  // import state
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  // options
  const [statusId, setStatusId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [mode, setMode] = useState<"single" | "robin">("single");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [notify, setNotify] = useState(true);
  // export state
  const [exporting, setExporting] = useState(false);

  // EntityPanel is remounted per tab (key={tab}), so `loading` starts true; the
  // effect only needs to resolve it (set state inside the promise, never sync).
  useEffect(() => {
    let alive = true;
    getImportSetup(entity)
      .then((d) => { if (alive) setColumns(d.columns); })
      .catch((e) => { if (alive) toast.error((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [entity]); // eslint-disable-line react-hooks/exhaustive-deps

  const staffOpts: SelectOption[] = staff.map((s) => ({ value: String(s.id), label: s.name }));
  const idOpts = (list: { id: number; name: string }[], none: string): SelectOption[] =>
    [{ value: "", label: none }, ...list.map((r) => ({ value: String(r.id), label: r.name }))];

  const issues = useMemo(() => validateRows(rows, columns, entity), [rows, columns, entity]);
  const ready = rows.length - issues.length;

  async function onFile(file: File) {
    setResult(null);
    try {
      const grid = await parseFile(file);
      const mapped = mapGrid(grid, columns);
      setRows(mapped.rows);
      setInfo(mapped.info);
    } catch {
      toast.error("Could not read that file. Upload a .xlsx or .csv.");
    }
  }

  async function runImport() {
    if (!rows.length) return;
    if (entity === "lead" && !statusId) { toast.warning("Pick a status to apply to the imported leads."); return; }
    if (mode === "robin" && assignees.length < 2) { toast.warning("Round-robin needs at least 2 members."); return; }
    setImporting(true); setResult(null);
    try {
      const picked = (mode === "single" ? assignees.slice(0, 1) : assignees).map(Number).filter(Boolean);
      let r: ImportResult;
      if (entity === "lead") {
        r = await importLeads(rows, {
          status_id: Number(statusId),
          source_id: sourceId ? Number(sourceId) : null,
          lead_type_id: typeId ? Number(typeId) : null,
          assign_mode: mode, assignees: picked, notify,
        });
      } else if (entity === "task") {
        r = await importTasks(rows, { assign_mode: mode, assignees: picked, notify });
      } else {
        r = await importTeam(rows);
      }
      setResult(r);
      if (r.inserted) toast.success(`Imported ${r.inserted} record${r.inserted === 1 ? "" : "s"}.`);
      else toast.warning("No records were imported.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  // ---- export: fetch this entity's rows, project onto its columns ----
  async function fetchRows(): Promise<Record<string, unknown>[]> {
    if (entity === "lead") return (await getLeads({ page: 1, per_page: 100000 })).leads as unknown as Record<string, unknown>[];
    if (entity === "task") return (await getTasks()).tasks as unknown as Record<string, unknown>[];
    return (await getStaff()).staff as unknown as Record<string, unknown>[];
  }
  const cellVal = (row: Record<string, unknown>, c: { key: string; custom?: boolean }): string =>
    c.custom
      ? String(((row.custom_fields ?? {}) as Record<string, unknown>)[c.key] ?? "")
      : String(row[c.key] ?? "");
  // Export uses a full read-only column set for leads (all table fields, incl. the
  // assignment date/time); tasks/team export their configured columns. Custom
  // fields are appended in both cases.
  const exportColumns = (): { key: string; label: string; custom?: boolean }[] => {
    const custom = columns.filter((c) => c.custom).map((c) => ({ key: c.key, label: c.label, custom: true }));
    if (entity === "lead") return [...LEAD_EXPORT_COLS, ...custom];
    return columns.map((c) => ({ key: c.key, label: c.label, custom: c.custom }));
  };
  async function doExport(kind: "xlsx" | "csv") {
    setExporting(true);
    try {
      const data = await fetchRows();
      const cols = exportColumns();
      const headers = cols.map((c) => c.label);
      const grid = data.map((row) => cols.map((c) => cellVal(row, c)));
      const name = `${entity === "team" ? "team" : entity + "s"}-export`;
      if (kind === "xlsx") await exportXlsx(name, headers, grid, ENTITIES.find((e) => e.key === entity)?.label);
      else exportCsvGrid(name, headers, grid);
      toast.success(`Exported ${data.length} row${data.length === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  async function downloadTemplate() {
    const { headers, rows } = importTemplate(columns);
    await exportXlsx(`${entity}-import-template`, headers, rows, "Template");
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;

  return (
    <div className={`grid gap-5 ${canImport ? "lg:grid-cols-2" : "lg:grid-cols-1"}`}>
      {/* IMPORT */}
      {canImport && (
      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-700">Import from Excel / CSV</h3>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        <div className="flex flex-wrap gap-2">
          <button onClick={() => fileRef.current?.click()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Choose file…</button>
          <button onClick={downloadTemplate} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50">Download template</button>
        </div>
        {info && <p className="text-xs text-slate-500">{info}</p>}

        {rows.length > 0 && (
          <>
            {issues.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {issues.length} row{issues.length === 1 ? "" : "s"} will be skipped (e.g. row {issues[0].row}: {issues[0].message})
              </div>
            )}
            <p className="text-sm text-slate-600"><b>{ready}</b> ready to import{issues.length ? `, ${issues.length} skipped` : ""}.</p>

            {entity === "lead" && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Status <span className="text-rose-500">*</span></label><SearchSelect value={statusId} onChange={setStatusId} options={idOpts(statuses.filter((s) => !s.parent_id), "— Select —")} /></div>
                <div><label className={lbl}>Source</label><SearchSelect value={sourceId} onChange={setSourceId} options={idOpts(sources, "— None —")} /></div>
                <div><label className={lbl}>Lead type</label><SearchSelect value={typeId} onChange={setTypeId} options={idOpts(types, "— None —")} /></div>
              </div>
            )}
            {assignable && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                  {(["single", "robin"] as const).map((m) => (
                    <label key={m} className="flex items-center gap-1.5"><input type="radio" name={`mode-${entity}`} checked={mode === m} onChange={() => setMode(m)} />{m === "single" ? "Assign all to one" : "Round-robin"}</label>
                  ))}
                </div>
                <MultiSelect value={assignees} onChange={setAssignees} options={staffOpts} placeholder="No assignment" ariaLabel="Assignees" />
                <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify assignees</label>
              </div>
            )}

            <button onClick={runImport} disabled={importing || ready === 0} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
              {importing ? "Importing…" : `Import ${ready} record${ready === 1 ? "" : "s"}`}
            </button>
          </>
        )}

        {result && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-700">Imported {result.inserted}, skipped {result.failed}.</p>
            {result.errors.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs text-rose-600">
                {result.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
              </ul>
            )}
          </div>
        )}
      </Card>
      )}

      {/* EXPORT */}
      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-700">Export to Excel / CSV</h3>
        <p className="text-sm text-slate-500">Download all {ENTITIES.find((e) => e.key === entity)?.label.toLowerCase()} as a spreadsheet — columns match the import template, so exports round-trip back in.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => doExport("xlsx")} disabled={exporting} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{exporting ? "Exporting…" : "Export .xlsx"}</button>
          <button onClick={() => doExport("csv")} disabled={exporting} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">Export .csv</button>
        </div>
        <div className="border-t border-slate-100 pt-3">
          <p className="mb-1 text-xs font-medium text-slate-500">Columns</p>
          <div className="flex flex-wrap gap-1.5">
            {columns.map((c) => <span key={c.key} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{c.label}</span>)}
          </div>
        </div>
      </Card>
    </div>
  );
}
