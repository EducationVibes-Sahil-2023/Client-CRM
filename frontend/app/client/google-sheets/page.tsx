"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader, Card, Drawer, ConfirmDialog, Spinner, fmtDateTime } from "../../admin/ui";
import { SearchSelect, MultiSelect, type SelectOption } from "../../admin/SearchSelect";
import { useClient } from "../ClientContext";
import { useToast } from "../../components/toast/ToastProvider";
import {
  getSheets, saveSheetsConfig, previewSheet, saveSheet, deleteSheet, syncSheet, listWebForms,
  type SheetsState, type SheetSync, type SheetPreview, type WebFormBuilderFields,
} from "../../lib/client";

const inp = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";
const lbl = "mb-1 block text-sm font-medium text-slate-600";

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s._-]+/g, "");

/** Best-guess a lead target for a sheet header. */
function guessTarget(header: string, builder: WebFormBuilderFields): string {
  const h = norm(header);
  if (["name", "fullname", "leadname"].includes(h)) return "name";
  if (["phone", "mobile", "contact", "phonenumber", "contactnumber"].includes(h)) return "phone";
  if (["altphone", "alternatephone", "secondaryphone"].includes(h)) return "alt_phone";
  if (["email", "emailaddress", "mail"].includes(h)) return "email";
  if (h === "city") return "city";
  if (h === "state") return "state";
  if (["status", "leadstatus", "stage"].includes(h)) return "status";
  const c = builder.custom.find((c) => norm(c.label) === h || norm(c.key) === h);
  if (c) return `custom_${c.key}`;
  return "";
}

function blankDraft(): Partial<SheetSync> {
  return {
    id: 0, name: "", spreadsheet_url: "", sheet_tab: "", header_row: 1, column_map: {},
    dedupe_field: "phone", source_id: null, status_id: null, lead_type_id: null, assigned_to: null,
    auto_assignee: [], write_back: 1, status_result_column: "CRM Status", enabled: 1,
  };
}

export default function GoogleSheetsPage() {
  const { isAdmin, permissionsLoaded } = useClient();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<SheetsState | null>(null);
  const [builder, setBuilder] = useState<WebFormBuilderFields | null>(null);
  const [editing, setEditing] = useState<Partial<SheetSync> | null>(null);
  const [del, setDel] = useState<SheetSync | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState<number | null>(null);

  const reload = () => getSheets().then(setState).catch((e) => toast.error((e as Error).message));

  useEffect(() => {
    let alive = true;
    Promise.all([getSheets(), listWebForms().catch(() => null)])
      .then(([s, w]) => { if (!alive) return; setState(s); if (w) setBuilder(w.builder_fields); })
      .catch((e) => { if (alive) toast.error((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function runSync(s: SheetSync) {
    setSyncing(s.id);
    try {
      const r = await syncSheet(s.id);
      toast.success(`${r.inserted} new, ${r.updated} updated, ${r.skipped} skipped.`);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(null);
    }
  }

  async function confirmDelete() {
    if (!del) return;
    setBusy(true);
    try { await deleteSheet(del.id); toast.success("Removed"); setDel(null); await reload(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  if (permissionsLoaded && !isAdmin) {
    return <Card className="mx-auto mt-10 max-w-lg text-center"><h2 className="text-lg font-semibold text-slate-800">Admins only</h2><p className="mt-1 text-sm text-slate-500">Only the client admin can manage the Google Sheets sync.</p></Card>;
  }
  if (loading || !state) return <div className="flex justify-center py-16"><Spinner /></div>;

  return (
    <div>
      <PageHeader
        title="Google Sheets"
        subtitle="Auto-fetch leads from a Google Sheet — create new leads and update statuses."
        action={state.configured ? <button onClick={() => setEditing(blankDraft())} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">+ Add sheet</button> : undefined}
      />

      <div className="space-y-5">
        <ServiceAccountCard state={state} onSaved={reload} defaultOpen={!state.configured} />

        {state.configured && (
          state.sheets.length === 0 ? (
            <Card className="text-center text-sm text-slate-500">No sheets connected yet. Click <b>Add sheet</b> to map your first Google Sheet.</Card>
          ) : (
            <div className="space-y-3">
              {state.sheets.map((s) => (
                <Card key={s.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{s.name} {!s.enabled && <span className="ml-1 text-xs font-normal text-slate-400">(paused)</span>}</p>
                      <p className="text-xs text-slate-400">
                        <a href={s.spreadsheet_url} target="_blank" rel="noreferrer" className="hover:text-emerald-600 hover:underline">open sheet</a>
                        {s.sheet_tab ? ` · tab "${s.sheet_tab}"` : ""} · {s.inserted_count} created, {s.updated_count} updated
                        {s.last_synced_at ? ` · last ${fmtDateTime(s.last_synced_at)}` : " · never synced"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => runSync(s)} disabled={syncing === s.id} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{syncing === s.id ? "Syncing…" : "Sync now"}</button>
                      <button onClick={() => setEditing(s)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Edit</button>
                      <button onClick={() => setDel(s)} className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50">Remove</button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )
        )}
      </div>

      {editing && builder && (
        <SheetEditor draft={editing} builder={builder} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />
      )}
      <ConfirmDialog open={!!del} title="Remove this sheet?" message={<>The mapping for <b>{del?.name}</b> will be removed. Leads already created are kept.</>} confirmLabel="Remove" busy={busy} onConfirm={confirmDelete} onClose={() => setDel(null)} />
    </div>
  );
}

function ServiceAccountCard({ state, onSaved, defaultOpen }: { state: SheetsState; onSaved: () => void; defaultOpen: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(defaultOpen);
  const [json, setJson] = useState("");
  const [saving, setSaving] = useState(false);
  const email = state.config.service_account_email;

  async function save() {
    if (!json.trim()) { toast.error("Paste the service-account JSON."); return; }
    setSaving(true);
    try { await saveSheetsConfig(json.trim()); toast.success("Saved"); setJson(""); onSaved(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <Card>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">Google service account {state.configured && <span className="ml-2 text-xs font-normal text-emerald-600">✓ configured</span>}</span>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-slate-500">
            In Google Cloud: create a project, enable the <b>Google Sheets API</b>, create a <b>service account</b>, and download its JSON key. Paste it below.
          </p>
          {email && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
              Share your Google Sheet with this address (as <b>Editor</b> if you want the CRM Status written back, else Viewer):<br />
              <span className="font-mono break-all">{email}</span>
              <button onClick={() => navigator.clipboard.writeText(email).then(() => toast.success("Email copied")).catch(() => {})} className="ml-2 rounded border border-emerald-300 px-2 py-0.5 text-emerald-700 hover:bg-emerald-100">Copy</button>
            </div>
          )}
          <div>
            <label className={lbl}>Service-account JSON key</label>
            <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={5} className={`${inp} font-mono text-xs`} placeholder={state.config.has_service_account ? '•••• saved — paste a new key only to replace it' : '{ "type": "service_account", "client_email": "...", "private_key": "..." }'} />
          </div>
          <button onClick={save} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? "Saving…" : "Save service account"}</button>
        </div>
      )}
    </Card>
  );
}

function SheetEditor({ draft, builder, onClose, onSaved }: {
  draft: Partial<SheetSync>; builder: WebFormBuilderFields; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [d, setD] = useState<Partial<SheetSync>>(draft);
  const set = <K extends keyof SheetSync>(k: K, v: SheetSync[K]) => setD((s) => ({ ...s, [k]: v }));
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [loadingCols, setLoadingCols] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>(draft.column_map ?? {});

  const targetOpts = useMemo<SelectOption[]>(() => [
    { value: "", label: "— Ignore —" },
    ...builder.builtin.map((b) => ({ value: b.key, label: b.label })),
    { value: "status", label: "Lead status (create / update)" },
    ...builder.custom.map((c) => ({ value: `custom_${c.key}`, label: `${c.label} (custom)` })),
  ], [builder]);
  const idOpts = (list: { id: number; name: string }[], none: string): SelectOption[] =>
    [{ value: "", label: none }, ...list.map((r) => ({ value: String(r.id), label: r.name }))];
  const staffOpts: SelectOption[] = builder.staff.map((s) => ({ value: String(s.id), label: s.name }));

  async function loadColumns() {
    if (!d.spreadsheet_url?.trim()) { toast.error("Paste the Google Sheet URL first."); return; }
    setLoadingCols(true);
    try {
      const p = await previewSheet({ spreadsheet_url: d.spreadsheet_url, sheet_tab: d.sheet_tab || undefined, header_row: d.header_row });
      setPreview(p);
      if (!d.sheet_tab && p.tab) set("sheet_tab", p.tab);
      // Merge existing map with guesses for any unmapped header.
      const next: Record<string, string> = { ...mapping };
      for (const h of p.headers) if (!(h in next)) next[h] = guessTarget(h, builder);
      setMapping(next);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingCols(false);
    }
  }

  async function save() {
    if (!d.spreadsheet_url?.trim()) { toast.error("Paste the Google Sheet URL."); return; }
    const column_map: Record<string, string> = {};
    for (const [h, t] of Object.entries(mapping)) if (t) column_map[h] = t;
    if (!Object.values(column_map).includes("phone")) { toast.error("Map a column to Phone — it's required to create leads."); return; }
    setSaving(true);
    try {
      await saveSheet({ ...d, column_map } as unknown as Record<string, unknown>);
      toast.success("Saved");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title={d.name || "Connect a Google Sheet"} subtitle="Map sheet columns to lead fields, then sync."
      footer={<div className="flex justify-end gap-2"><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button><button onClick={save} disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? "Saving…" : "Save"}</button></div>}
    >
      <div className="space-y-5">
        <section className="space-y-3">
          <div><label className={lbl}>Name</label><input value={d.name ?? ""} onChange={(e) => set("name", e.target.value)} className={inp} placeholder="e.g. Landing page signups" /></div>
          <div><label className={lbl}>Google Sheet URL</label><input value={d.spreadsheet_url ?? ""} onChange={(e) => set("spreadsheet_url", e.target.value)} className={inp} placeholder="https://docs.google.com/spreadsheets/d/…" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Tab (optional)</label><input value={d.sheet_tab ?? ""} onChange={(e) => set("sheet_tab", e.target.value)} className={inp} placeholder="first tab" /></div>
            <div><label className={lbl}>Header row</label><input type="number" min={1} value={d.header_row ?? 1} onChange={(e) => set("header_row", Number(e.target.value) || 1)} className={inp} /></div>
          </div>
          <button onClick={loadColumns} disabled={loadingCols} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">{loadingCols ? "Loading…" : "Load columns"}</button>
          {preview && preview.tabs.length > 1 && (
            <div><label className={lbl}>Tab</label><SearchSelect value={d.sheet_tab ?? ""} onChange={(v) => { set("sheet_tab", v); setPreview(null); }} options={preview.tabs.map((t) => ({ value: t, label: t }))} /></div>
          )}
        </section>

        {preview && (
          <section className="border-t border-slate-100 pt-4">
            <h4 className="mb-2 text-sm font-semibold text-slate-700">Column mapping</h4>
            <p className="mb-2 text-xs text-slate-400">Match each sheet column to a lead field. Map one to <b>Lead status</b> to set/update status by name.</p>
            <div className="space-y-2">
              {preview.headers.map((h) => (
                <div key={h} className="grid grid-cols-2 items-center gap-2">
                  <span className="truncate text-sm text-slate-600" title={h}>{h || <em className="text-slate-300">(blank)</em>}</span>
                  <SearchSelect value={mapping[h] ?? ""} onChange={(v) => setMapping({ ...mapping, [h]: v })} options={targetOpts} />
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-3 border-t border-slate-100 pt-4">
          <h4 className="text-sm font-semibold text-slate-700">Matching & defaults</h4>
          <div><label className={lbl}>Match existing leads by</label><SearchSelect value={d.dedupe_field ?? "phone"} onChange={(v) => set("dedupe_field", v)} options={[{ value: "phone", label: "Phone" }, { value: "email", label: "Email" }]} /></div>
          <div><label className={lbl}>Default status (new leads, if no status column)</label><SearchSelect value={String(d.status_id ?? "")} onChange={(v) => set("status_id", v ? Number(v) : null)} options={idOpts(builder.statuses, "— First status —")} /></div>
          <div><label className={lbl}>Source</label><SearchSelect value={String(d.source_id ?? "")} onChange={(v) => set("source_id", v ? Number(v) : null)} options={idOpts(builder.sources, "— None —")} /></div>
          <div><label className={lbl}>Lead type</label><SearchSelect value={String(d.lead_type_id ?? "")} onChange={(v) => set("lead_type_id", v ? Number(v) : null)} options={idOpts(builder.lead_types, "— None —")} /></div>
          <div><label className={lbl}>Responsible (Assignee)</label><SearchSelect value={String(d.assigned_to ?? "")} onChange={(v) => set("assigned_to", v ? Number(v) : null)} options={idOpts(builder.staff, "— Unassigned —")} /></div>
          <div><label className={lbl}>Auto-assignee pool (round-robin)</label><MultiSelect value={(d.auto_assignee ?? []).map(String)} onChange={(v) => set("auto_assignee", v.map(Number))} options={staffOpts} placeholder="No auto assignment" /></div>
        </section>

        <section className="space-y-2 border-t border-slate-100 pt-4">
          <h4 className="text-sm font-semibold text-slate-700">Write-back & status</h4>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={!!d.write_back} onChange={(e) => set("write_back", e.target.checked ? 1 : 0)} /> Write result back to the sheet (Inserted / Updated / Skipped)</label>
          {!!d.write_back && (
            <div><label className={lbl}>Result column name</label><input value={d.status_result_column ?? "CRM Status"} onChange={(e) => set("status_result_column", e.target.value)} className={inp} /></div>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={!!d.enabled} onChange={(e) => set("enabled", e.target.checked ? 1 : 0)} /> Active (included in auto-sync)</label>
        </section>
      </div>
    </Drawer>
  );
}
