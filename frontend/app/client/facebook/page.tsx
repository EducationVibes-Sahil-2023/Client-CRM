"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader, Card, Drawer, ConfirmDialog, Spinner } from "../../admin/ui";
import { SearchSelect, MultiSelect, type SelectOption } from "../../admin/SearchSelect";
import { useClient } from "../ClientContext";
import { useToast } from "../../components/toast/ToastProvider";
import { API_URL } from "../../lib/api";
import {
  getFacebook, saveFacebookConfig, facebookOauthUrl, connectFacebook, getPageForms,
  saveFbForm, deleteFbForm, syncFbForm, disconnectFacebook, listWebForms, getFacebookLogs,
  type FacebookState, type FbForm, type FbPage, type FbLiveForm, type WebFormBuilderFields, type FbLogEntry,
} from "../../lib/client";

const inp = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";
const lbl = "mb-1 block text-sm font-medium text-slate-600";
const DEDUPE_FIELDS: SelectOption[] = [
  { value: "phone", label: "Phone" }, { value: "email", label: "Email" }, { value: "name", label: "Name" },
];

/** A blank mapping row for a newly-picked live form. */
function scaffold(page: FbPage, live: FbLiveForm): Partial<FbForm> {
  return {
    id: 0, page_id: page.page_id, form_id: live.id, form_name: live.name,
    field_map: { full_name: "name", email: "email", phone_number: "phone" },
    source_id: null, status_id: null, lead_type_id: null, assigned_to: null,
    auto_assignee: [], allow_duplicate: 0, prevent_duplicate_field: "phone",
    create_duplicate_as_task: 0, notify_on_import: 1, notify_type: "responsible", notify_staff: [], enabled: 1,
  };
}

export default function FacebookPage() {
  const { isAdmin, permissionsLoaded } = useClient();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [fb, setFb] = useState<FacebookState | null>(null);
  const [builder, setBuilder] = useState<WebFormBuilderFields | null>(null);
  const [editing, setEditing] = useState<Partial<FbForm> | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [del, setDel] = useState<FbForm | null>(null);
  const [busy, setBusy] = useState(false);

  const redirectUri = typeof window !== "undefined" ? `${window.location.origin}/client/facebook` : "";

  const reload = () => getFacebook().then(setFb).catch((e) => toast.error((e as Error).message));

  useEffect(() => {
    let alive = true;
    const boot = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (code) {
        try { await connectFacebook(code, redirectUri); toast.success("Facebook connected"); }
        catch (e) { toast.error((e as Error).message); }
        window.history.replaceState({}, "", "/client/facebook");
      }
      const [f, w] = await Promise.all([getFacebook(), listWebForms().catch(() => null)]);
      if (!alive) return;
      setFb(f);
      if (w) setBuilder(w.builder_fields);
    };
    boot().catch((e) => { if (alive) toast.error((e as Error).message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function connect() {
    try {
      const { url } = await facebookOauthUrl(redirectUri);
      window.location.href = url;
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function doDisconnect() {
    setBusy(true);
    try { await disconnectFacebook(); toast.success("Facebook disconnected"); setConfirmDisconnect(false); await reload(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  async function confirmDelete() {
    if (!del) return;
    setBusy(true);
    try { await deleteFbForm(del.id); toast.success("Form removed"); setDel(null); await reload(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  async function sync(f: FbForm) {
    try { const r = await syncFbForm(f.id); toast.success(`Synced — ${r.inserted} new lead(s).`); await reload(); }
    catch (e) { toast.error((e as Error).message); }
  }

  if (permissionsLoaded && !isAdmin) {
    return <Card className="mx-auto mt-10 max-w-lg text-center"><h2 className="text-lg font-semibold text-slate-800">Admins only</h2><p className="mt-1 text-sm text-slate-500">Only the client admin can manage the Facebook integration.</p></Card>;
  }
  if (loading || !fb) return <div className="flex justify-center py-16"><Spinner /></div>;

  return (
    <div>
      <PageHeader
        title="Facebook Leads"
        subtitle="Capture Facebook Lead Ads straight into your CRM."
        action={fb.connected ? <button onClick={() => setConfirmDisconnect(true)} className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50">Disconnect</button> : undefined}
      />

      {!fb.connected ? (
        <div className="max-w-2xl space-y-5">
          <AppSettings fb={fb} redirectUri={redirectUri} onSaved={reload} defaultOpen />
          {fb.configured && (
            <Card className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#1877F2]/10 text-[#1877F2]">
                <svg className="h-7 w-7" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12a12 12 0 10-13.9 11.9v-8.4H7v-3.5h3.1V9.4c0-3 1.8-4.7 4.6-4.7 1.3 0 2.7.24 2.7.24v3h-1.5c-1.5 0-2 .93-2 1.9v2.2h3.4l-.55 3.5h-2.9v8.4A12 12 0 0024 12z" /></svg>
              </div>
              <h3 className="text-base font-semibold text-slate-800">Connect your Facebook Page</h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">Sign in with Facebook and grant access to your Pages. We&apos;ll pull leads from the lead forms you choose.</p>
              <button onClick={connect} className="mt-4 rounded-lg bg-[#1877F2] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#166fe0]">Connect Facebook</button>
            </Card>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {fb.pages.map((page) => (
            <PageCard key={page.id} page={page} onAdd={(live) => setEditing(scaffold(page, live))} onEdit={setEditing} onSync={sync} onDelete={setDel} />
          ))}
          <LeadLog />
          <AppSettings fb={fb} redirectUri={redirectUri} onSaved={reload} />
        </div>
      )}

      {editing && builder && (
        <FormEditor
          draft={editing}
          builder={builder}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload(); }}
        />
      )}

      <ConfirmDialog open={confirmDisconnect} title="Disconnect Facebook?" message="This removes all connected pages and stops new Facebook leads. Existing leads are kept." confirmLabel="Disconnect" busy={busy} onConfirm={doDisconnect} onClose={() => setConfirmDisconnect(false)} />
      <ConfirmDialog open={!!del} title="Remove this form?" message={<>The mapping for <b>{del?.form_name}</b> will be removed and its leads will stop syncing.</>} confirmLabel="Remove" busy={busy} onConfirm={confirmDelete} onClose={() => setDel(null)} />
    </div>
  );
}

/** Live log of leads Facebook has delivered (raw values + outcome) for this client. */
function LeadLog() {
  const toast = useToast();
  const [entries, setEntries] = useState<FbLogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { setEntries((await getFacebookLogs()).entries); }
    catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resultBadge = (r?: string) => {
    const map: Record<string, string> = {
      created: "bg-emerald-50 text-emerald-700", duplicate_leadgen: "bg-amber-50 text-amber-700",
      skipped_no_phone: "bg-rose-50 text-rose-700",
    };
    const cls = r ? (map[r] ?? "bg-slate-100 text-slate-600") : "bg-slate-100 text-slate-500";
    return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{r ?? "—"}</span>;
  };

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Lead delivery log</h3>
          <p className="text-xs text-slate-400">What Facebook sent and whether it became a lead. Newest first.</p>
        </div>
        <button onClick={load} disabled={loading} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">{loading ? "Loading…" : "Refresh"}</button>
      </div>
      {entries === null ? (
        <p className="py-6 text-center text-sm text-slate-400">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="rounded-lg bg-slate-50 py-6 text-center text-sm text-slate-400">No Facebook leads received yet. Submit a test lead from Meta&apos;s Lead Ads Testing Tool, then Refresh.</p>
      ) : (
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {entries.map((e, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-slate-400">{e.ts}</span>
                {e.form && <span className="font-medium text-slate-700">{e.form}</span>}
                {e.event === "received" ? resultBadge(e.result) : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">skipped: {e.reason}</span>}
                {e.lead_id ? <span className="text-slate-400">→ lead #{e.lead_id}</span> : null}
              </div>
              {e.data && Object.keys(e.data).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-slate-600">
                  {Object.entries(e.data).map(([k, v]) => (
                    <span key={k}><span className="text-slate-400">{k}:</span> {v || "—"}</span>
                  ))}
                </div>
              )}
              {(e.leadgen_id || e.page_id) && (
                <div className="mt-1 font-mono text-[10px] text-slate-300">leadgen {e.leadgen_id} · page {e.page_id}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ReadonlyRow({ label, value, onCopy }: { label: string; value: string; onCopy: (t: string, what: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      <div className="flex gap-2">
        <input readOnly value={value} className={`${inp} bg-slate-50 font-mono text-xs`} onClick={(e) => (e.target as HTMLInputElement).select()} />
        <button onClick={() => onCopy(value, label)} className="shrink-0 rounded-lg border border-slate-300 px-3 text-sm text-slate-600 hover:bg-slate-50">Copy</button>
      </div>
    </div>
  );
}

function AppSettings({ fb, redirectUri, onSaved, defaultOpen = false }: {
  fb: FacebookState; redirectUri: string; onSaved: () => Promise<void> | void; defaultOpen?: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(defaultOpen);
  const [appId, setAppId] = useState(fb.config.app_id ?? "");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);

  const callbackUrl = `${API_URL}/public/fb/webhook`;
  const copy = (t: string, what: string) => navigator.clipboard.writeText(t).then(() => toast.success(`${what} copied`)).catch(() => {});

  async function save() {
    if (!appId.trim()) { toast.error("Enter your App ID."); return; }
    setSaving(true);
    try {
      await saveFacebookConfig({ app_id: appId.trim(), app_secret: secret });
      toast.success("Saved");
      setSecret("");
      await onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">Meta app settings {fb.configured && <span className="ml-2 text-xs font-normal text-emerald-600">✓ configured</span>}</span>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-slate-500">
            Create a Meta app at <span className="font-medium">developers.facebook.com</span> (add <b>Facebook Login</b> + <b>Webhooks</b>, request <code>pages_show_list</code>, <code>leads_retrieval</code>, <code>pages_manage_metadata</code>), then paste its App ID &amp; Secret here.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={lbl}>App ID</label><input value={appId} onChange={(e) => setAppId(e.target.value)} className={inp} placeholder="e.g. 123456789012345" /></div>
            <div><label className={lbl}>App Secret</label><input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} className={inp} placeholder={fb.config.has_secret ? "•••••••• saved — leave blank to keep" : "App secret"} /></div>
          </div>
          <button onClick={save} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? "Saving…" : "Save app settings"}</button>

          <div className="space-y-3 border-t border-slate-100 pt-4">
            <p className="text-xs font-medium text-slate-500">Paste these into your Meta app:</p>
            <ReadonlyRow label="OAuth redirect URI (Facebook Login → Valid OAuth Redirect URIs)" value={redirectUri} onCopy={copy} />
            <ReadonlyRow label="Webhook callback URL (Webhooks → leadgen)" value={callbackUrl} onCopy={copy} />
            {fb.config.verify_token
              ? <ReadonlyRow label="Webhook verify token" value={fb.config.verify_token} onCopy={copy} />
              : <p className="text-xs text-amber-600">Webhook verify token isn&apos;t set on the server (<code>facebook.webhookVerifyToken</code>). Real-time delivery needs it; otherwise leads still arrive via the polling sync.</p>}
          </div>
        </div>
      )}
    </Card>
  );
}

function PageCard({ page, onAdd, onEdit, onSync, onDelete }: {
  page: FbPage; onAdd: (f: FbLiveForm) => void; onEdit: (f: FbForm) => void; onSync: (f: FbForm) => void; onDelete: (f: FbForm) => void;
}) {
  const toast = useToast();
  const [live, setLive] = useState<FbLiveForm[] | null>(null);
  const [loadingForms, setLoadingForms] = useState(false);
  const mappedIds = new Set(page.forms.map((f) => f.form_id));

  async function loadForms() {
    setLoadingForms(true);
    try { const r = await getPageForms(page.id); setLive(r.forms); }
    catch (e) { toast.error((e as Error).message); }
    finally { setLoadingForms(false); }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div><h3 className="text-sm font-semibold text-slate-800">{page.page_name}</h3><p className="text-xs text-slate-400">Page ID {page.page_id}</p></div>
      </div>

      {page.forms.length > 0 ? (
        <div className="space-y-2">
          {page.forms.map((f) => (
            <div key={f.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-slate-700">{f.form_name || f.form_id}</p>
                <p className="text-xs text-slate-400">{f.submission_count} lead(s) · {f.enabled ? "active" : "paused"}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => onSync(f)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Sync now</button>
                <button onClick={() => onEdit(f)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Edit</button>
                <button onClick={() => onDelete(f)} className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50">Remove</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400">No lead forms connected yet.</p>
      )}

      <div className="mt-3 border-t border-slate-100 pt-3">
        {live === null ? (
          <button onClick={loadForms} disabled={loadingForms} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{loadingForms ? "Loading…" : "+ Add a lead form"}</button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">Pick a form:</span>
            {live.filter((f) => !mappedIds.has(f.id)).map((f) => (
              <button key={f.id} onClick={() => onAdd(f)} className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100">{f.name}</button>
            ))}
            {live.filter((f) => !mappedIds.has(f.id)).length === 0 && <span className="text-xs text-slate-400">All forms already added.</span>}
          </div>
        )}
      </div>
    </Card>
  );
}

function FormEditor({ draft, builder, onClose, onSaved }: {
  draft: Partial<FbForm>; builder: WebFormBuilderFields; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [d, setD] = useState<Partial<FbForm>>(draft);
  const set = <K extends keyof FbForm>(k: K, v: FbForm[K]) => setD((s) => ({ ...s, [k]: v }));

  // Mapping rows derived from field_map (fbField → target).
  const [rows, setRows] = useState<{ fb: string; target: string }[]>(
    Object.entries(draft.field_map ?? {}).map(([fb, target]) => ({ fb, target })),
  );

  const targetOpts = useMemo<SelectOption[]>(() => [
    { value: "", label: "— Ignore —" },
    ...builder.builtin.map((b) => ({ value: b.key, label: b.label })),
    ...builder.custom.map((c) => ({ value: `custom_${c.key}`, label: `${c.label} (custom)` })),
  ], [builder]);

  const idOpts = (list: { id: number; name: string }[], none: string): SelectOption[] =>
    [{ value: "", label: none }, ...list.map((r) => ({ value: String(r.id), label: r.name }))];
  const staffOpts: SelectOption[] = builder.staff.map((s) => ({ value: String(s.id), label: s.name }));

  async function save() {
    setSaving(true);
    const field_map: Record<string, string> = {};
    for (const r of rows) if (r.fb.trim() && r.target) field_map[r.fb.trim()] = r.target;
    try {
      await saveFbForm({ ...d, field_map } as unknown as Record<string, unknown>);
      toast.success("Saved");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title={d.form_name || "Lead form"} subtitle="Map Facebook fields to lead fields and set how leads are handled."
      footer={<div className="flex justify-end gap-2"><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button><button onClick={save} disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? "Saving…" : "Save"}</button></div>}
    >
      <div className="space-y-5">
        <section>
          <h4 className="mb-2 text-sm font-semibold text-slate-700">Field mapping</h4>
          <p className="mb-2 text-xs text-slate-400">Enter each Facebook form field name and the lead field it fills. Standard fields (full_name, email, phone_number) are pre-filled.</p>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={r.fb} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, fb: e.target.value } : x))} placeholder="FB field name" className={`${inp} flex-1`} />
                <span className="text-slate-300">→</span>
                <div className="flex-1"><SearchSelect value={r.target} onChange={(v) => setRows(rows.map((x, j) => j === i ? { ...x, target: v } : x))} options={targetOpts} /></div>
                <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-rose-400 hover:text-rose-600" aria-label="Remove">✕</button>
              </div>
            ))}
            <button onClick={() => setRows([...rows, { fb: "", target: "" }])} className="text-sm font-medium text-emerald-600 hover:underline">+ Add field</button>
          </div>
        </section>

        <section className="space-y-3 border-t border-slate-100 pt-4">
          <h4 className="text-sm font-semibold text-slate-700">Lead defaults</h4>
          <div><label className={lbl}>Source</label><SearchSelect value={String(d.source_id ?? "")} onChange={(v) => set("source_id", v ? Number(v) : null)} options={idOpts(builder.sources, "— None —")} /></div>
          <div><label className={lbl}>Status</label><SearchSelect value={String(d.status_id ?? "")} onChange={(v) => set("status_id", v ? Number(v) : null)} options={idOpts(builder.statuses, "— First status —")} /></div>
          <div><label className={lbl}>Responsible (Assignee)</label><SearchSelect value={String(d.assigned_to ?? "")} onChange={(v) => set("assigned_to", v ? Number(v) : null)} options={idOpts(builder.staff, "— Unassigned —")} /></div>
          <div><label className={lbl}>Lead type</label><SearchSelect value={String(d.lead_type_id ?? "")} onChange={(v) => set("lead_type_id", v ? Number(v) : null)} options={idOpts(builder.lead_types, "— None —")} /></div>
          <div><label className={lbl}>Auto-assignee pool (round-robin)</label><MultiSelect value={(d.auto_assignee ?? []).map(String)} onChange={(v) => set("auto_assignee", v.map(Number))} options={staffOpts} placeholder="No auto assignment" /></div>
        </section>

        <section className="space-y-2 border-t border-slate-100 pt-4">
          <h4 className="text-sm font-semibold text-slate-700">Rules</h4>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={!d.allow_duplicate} onChange={(e) => set("allow_duplicate", e.target.checked ? 0 : 1)} /> Prevent duplicate leads</label>
          {!d.allow_duplicate && (
            <div><label className={lbl}>Duplicate on field</label><SearchSelect value={d.prevent_duplicate_field ?? "phone"} onChange={(v) => set("prevent_duplicate_field", v)} options={DEDUPE_FIELDS} /></div>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={!!d.notify_on_import} onChange={(e) => set("notify_on_import", e.target.checked ? 1 : 0)} /> Notify the assignee on new leads</label>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={!!d.enabled} onChange={(e) => set("enabled", e.target.checked ? 1 : 0)} /> Active (syncing leads)</label>
        </section>
      </div>
    </Drawer>
  );
}
