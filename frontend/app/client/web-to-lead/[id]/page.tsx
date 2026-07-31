"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader, Card, Spinner } from "../../../admin/ui";
import { SearchSelect, MultiSelect, type SelectOption } from "../../../admin/SearchSelect";
import { useClient } from "../../ClientContext";
import { useToast } from "../../../components/toast/ToastProvider";
import {
  getWebForm, listWebForms, createWebForm, updateWebForm, regenerateWebFormApiKey,
  type WebForm, type WebFormField, type WebFormBuilderFields,
} from "../../../lib/client";
import { API_URL } from "../../../lib/api";
import { formUrl } from "../page";

const inp = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";
const lbl = "mb-1 block text-sm font-medium text-slate-600";

type Draft = Omit<WebForm, "id" | "token" | "api_key" | "submission_count" | "created_at">;
type PaletteItem = { key: string; label: string; type: string; builtin: boolean; options: string[] };

function blankDraft(): Draft {
  return {
    name: "", language: "en", submit_text: "Submit",
    success_message: "Thank you!\nYour enquiry has been submitted. Our team will get in touch with you shortly.",
    fields: [], source_id: null, status_id: null, assigned_to: null, lead_type_id: null,
    auto_assignee: [], auto_assign_state_wise: 0, state_assignee_map: {},
    auto_mark_public: 0, allow_location_fields: 0, notify_on_transfer: 0, allow_duplicate: 0,
    prevent_duplicate_field: "phone", prevent_duplicate_field2: null, create_duplicate_as_task: 0,
    notify_on_import: 0, notify_type: "responsible", notify_staff: [], enabled: 1,
  };
}

type TabKey = "builder" | "setup" | "integration";

export default function WebFormEditor() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const { isAdmin, permissionsLoaded } = useClient();

  const idParam = String(params.id ?? "new");
  const isNew = idParam === "new";
  const id = isNew ? 0 : Number(idParam);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<TabKey>("builder");
  const [builder, setBuilder] = useState<WebFormBuilderFields | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft());

  useEffect(() => {
    let alive = true;
    const p = isNew
      ? listWebForms().then((d) => { if (alive) setBuilder(d.builder_fields); })
      : getWebForm(id).then((d) => {
          if (!alive) return;
          setBuilder(d.builder_fields);
          setToken(d.form.token);
          setApiKey(d.form.api_key ?? null);
          // Strip server-owned keys; keep only the editable Draft shape.
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id: _i, token: _t, api_key: _k, submission_count: _s, created_at: _c, ...rest } = d.form;
          setDraft(rest);
        });
    p.catch((e) => { if (alive) toast.error((e as Error).message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const palette = useMemo<PaletteItem[]>(() => {
    if (!builder) return [];
    return [
      ...builder.builtin.map((b) => ({ key: b.key, label: b.label, type: b.type, builtin: true, options: [] as string[] })),
      ...builder.custom.map((c) => ({ key: c.key, label: c.label, type: c.type, builtin: false, options: c.options })),
    ];
  }, [builder]);
  const addedKeys = useMemo(() => new Set(draft.fields.map((f) => f.key)), [draft.fields]);

  function addField(p: PaletteItem) {
    if (addedKeys.has(p.key)) return;
    const f: WebFormField = {
      key: p.key, param: p.key, label: p.label, type: p.type, required: p.key === "phone",
      placeholder: p.type === "select" ? "" : `Enter ${p.label}`, builtin: p.builtin, options: p.options,
    };
    set("fields", [...draft.fields, f]);
  }
  function updateField(i: number, patch: Partial<WebFormField>) {
    set("fields", draft.fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function removeField(i: number) {
    set("fields", draft.fields.filter((_, idx) => idx !== i));
  }
  function moveField(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= draft.fields.length) return;
    const next = [...draft.fields];
    [next[i], next[j]] = [next[j], next[i]];
    set("fields", next);
  }

  async function save() {
    if (!draft.name.trim()) { toast.error("Give the form a name (in Form Information & Setup)."); setTab("setup"); return; }
    if (!draft.fields.some((f) => f.key === "phone")) { toast.error("Add a Mobile Number field — it's required to create a lead."); setTab("builder"); return; }
    setSaving(true);
    try {
      const body = draft as unknown as Record<string, unknown>;
      if (isNew) {
        const r = await createWebForm(body);
        toast.success("Form created");
        router.replace(`/client/web-to-lead/${r.id}`);
      } else {
        await updateWebForm(id, body);
        toast.success("Saved");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (permissionsLoaded && !isAdmin) {
    return <Card className="mx-auto mt-10 max-w-lg text-center"><h2 className="text-lg font-semibold text-slate-800">Admins only</h2><p className="mt-1 text-sm text-slate-500">Only the client admin can manage web forms.</p></Card>;
  }
  if (loading || !builder) return <div className="flex justify-center py-16"><Spinner /></div>;

  const idOpts = (rows: { id: number; name: string }[], none = "— None —"): SelectOption[] =>
    [{ value: "", label: none }, ...rows.map((r) => ({ value: String(r.id), label: r.name }))];
  const staffOpts: SelectOption[] = builder.staff.map((s) => ({ value: String(s.id), label: s.name }));

  return (
    <div>
      <PageHeader
        title={isNew ? "New Web Form" : draft.name || "Edit Web Form"}
        subtitle="Design the form, map submissions to a lead, then grab the embed code."
        action={
          <div className="flex gap-2">
            <Link href="/client/web-to-lead" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Back</Link>
            <button onClick={save} disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
          </div>
        }
      />

      {/* Tab bar */}
      <div className="mb-5 flex gap-6 border-b border-slate-200">
        {([["builder", "Form Builder"], ["setup", "Form Information & Setup"], ["integration", "Integration Code"]] as [TabKey, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-1 pb-3 text-sm font-medium ${tab === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>{label}</button>
        ))}
      </div>

      {tab === "builder" && (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          {/* Palette */}
          <Card className="h-max">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Available fields</h3>
            <p className="mb-3 text-xs text-slate-400">Click a field to add it to the form. Custom fields come from Form Setup → Leads.</p>
            <div className="space-y-1">
              {palette.map((p) => {
                const used = addedKeys.has(p.key);
                return (
                  <button key={p.key} disabled={used} onClick={() => addField(p)} className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${used ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300" : "border-slate-200 text-slate-700 hover:border-emerald-400 hover:bg-emerald-50"}`}>
                    <span>{p.label}{!p.builtin && <span className="ml-1 text-[10px] uppercase text-emerald-500">custom</span>}</span>
                    <span className="text-slate-300">{used ? "✓" : "+"}</span>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Field list + preview */}
          <div className="space-y-5">
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Form fields</h3>
              {draft.fields.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">No fields yet — add fields from the left. A Mobile Number field is required.</p>
              ) : (
                <div className="space-y-2">
                  {draft.fields.map((f, i) => (
                    <div key={f.key} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col">
                          <button onClick={() => moveField(i, -1)} disabled={i === 0} className="text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="Move up">▲</button>
                          <button onClick={() => moveField(i, 1)} disabled={i === draft.fields.length - 1} className="text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="Move down">▼</button>
                        </div>
                        <input value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} className={`${inp} flex-1`} placeholder="Field label" />
                        <input value={f.placeholder ?? ""} onChange={(e) => updateField(i, { placeholder: e.target.value })} className={`${inp} flex-1`} placeholder="Placeholder" />
                        <label className="flex items-center gap-1 whitespace-nowrap text-xs text-slate-500">
                          <input type="checkbox" checked={f.required || f.key === "phone"} disabled={f.key === "phone"} onChange={(e) => updateField(i, { required: e.target.checked })} /> Required
                        </label>
                        <button onClick={() => removeField(i)} disabled={f.key === "phone"} className="text-rose-400 hover:text-rose-600 disabled:opacity-30" aria-label="Remove">✕</button>
                      </div>
                      {/* Parameter / key name external callers (API, your own site) send. */}
                      <div className="mt-2 flex items-center gap-2 pl-8">
                        <span className="whitespace-nowrap text-[11px] font-medium text-slate-400">Key / parameter name</span>
                        <input
                          value={f.param ?? f.key}
                          onChange={(e) => updateField(i, { param: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                          className={`${inp} w-56 font-mono text-xs`}
                          placeholder={f.key}
                        />
                        <span className="text-[11px] text-slate-400">Sent in the submission / API body. Maps to <b>{f.label || f.key}</b>.</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Live preview */}
            <Card>
              <h3 className="mb-4 text-sm font-semibold text-slate-700">Preview</h3>
              <div className="space-y-4">
                {draft.fields.map((f) => (
                  <div key={f.key}>
                    <label className={lbl}>{f.label}{f.required && <span className="text-rose-500"> *</span>}</label>
                    <PreviewInput field={f} />
                  </div>
                ))}
                {draft.fields.length > 0 && (
                  <button className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white" disabled>{draft.submit_text || "Submit"}</button>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "setup" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-700">Form information</h3>
            <div><label className={lbl}>Form Name <span className="text-rose-500">*</span></label><input value={draft.name} onChange={(e) => set("name", e.target.value)} className={inp} placeholder="e.g. Website Home Enquiry" /></div>
            <div><label className={lbl}>Language</label><input value={draft.language} onChange={(e) => set("language", e.target.value)} className={inp} /></div>
            <div><label className={lbl}>Submit button text</label><input value={draft.submit_text} onChange={(e) => set("submit_text", e.target.value)} className={inp} /></div>
            <div><label className={lbl}>Message to show after submit</label><textarea value={draft.success_message ?? ""} onChange={(e) => set("success_message", e.target.value)} rows={4} className={inp} /></div>

            <div className="space-y-2 border-t border-slate-100 pt-3">
              <Check label="Auto mark as public" checked={!!draft.auto_mark_public} onChange={(v) => set("auto_mark_public", v ? 1 : 0)} />
              <Check label="Allow form location fields (State, City)" checked={!!draft.allow_location_fields} onChange={(v) => set("allow_location_fields", v ? 1 : 0)} />
              <Check label="Allow notification when lead transferred" checked={!!draft.notify_on_transfer} onChange={(v) => set("notify_on_transfer", v ? 1 : 0)} />
              <Check label="Allow duplicate lead to be inserted into database" checked={!!draft.allow_duplicate} onChange={(v) => set("allow_duplicate", v ? 1 : 0)} />
              <Check label="Form enabled (accepting submissions)" checked={!!draft.enabled} onChange={(v) => set("enabled", v ? 1 : 0)} />
            </div>

            {!draft.allow_duplicate && (
              <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                <div><label className={lbl}>Prevent duplicate on field</label><SearchSelect value={draft.prevent_duplicate_field ?? "phone"} onChange={(v) => set("prevent_duplicate_field", v || null)} options={DEDUPE_FIELDS} /></div>
                <div><label className={lbl}>+ field (optional)</label><SearchSelect value={draft.prevent_duplicate_field2 ?? ""} onChange={(v) => set("prevent_duplicate_field2", v || null)} options={[{ value: "", label: "— None —" }, ...DEDUPE_FIELDS]} /></div>
                <label className="col-span-2 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={!!draft.create_duplicate_as_task} onChange={(e) => set("create_duplicate_as_task", e.target.checked ? 1 : 0)} /> Create duplicate as a task assigned to the responsible staff</label>
              </div>
            )}
          </Card>

          <Card className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-700">Lead mapping & assignment</h3>
            <div><label className={lbl}>Source</label><SearchSelect value={String(draft.source_id ?? "")} onChange={(v) => set("source_id", v ? Number(v) : null)} options={idOpts(builder.sources)} /></div>
            <div><label className={lbl}>Status</label><SearchSelect value={String(draft.status_id ?? "")} onChange={(v) => set("status_id", v ? Number(v) : null)} options={idOpts(builder.statuses, "— First status —")} /></div>
            <div><label className={lbl}>Responsible (Assignee)</label><SearchSelect value={String(draft.assigned_to ?? "")} onChange={(v) => set("assigned_to", v ? Number(v) : null)} options={idOpts(builder.staff, "— Unassigned —")} /></div>
            <div><label className={lbl}>Lead Type</label><SearchSelect value={String(draft.lead_type_id ?? "")} onChange={(v) => set("lead_type_id", v ? Number(v) : null)} options={idOpts(builder.lead_types)} /></div>
            <div><label className={lbl}>Auto Assignee pool (round-robin)</label><MultiSelect value={draft.auto_assignee.map(String)} onChange={(v) => set("auto_assignee", v.map(Number))} options={staffOpts} placeholder="No auto assignment" /></div>

            <div className="border-t border-slate-100 pt-3">
              <Check label="Auto assignation — State Wise" checked={!!draft.auto_assign_state_wise} onChange={(v) => set("auto_assign_state_wise", v ? 1 : 0)} />
              {!!draft.auto_assign_state_wise && (
                <div className="mt-3 max-h-72 space-y-2 overflow-y-auto rounded-lg border border-slate-100 p-3">
                  <p className="text-xs text-slate-400">Map a state to one or more counsellors. Pick several to round-robin leads among them. Unmapped states fall back to the round-robin pool, then the Responsible.</p>
                  {builder.states.length === 0 && <p className="text-xs text-slate-400">No states configured (add them in Leads Setup).</p>}
                  {builder.states.map((st) => (
                    <div key={st} className="grid grid-cols-2 items-center gap-2">
                      <span className="truncate text-sm text-slate-600">{st}</span>
                      <MultiSelect
                        value={(draft.state_assignee_map[st] ?? []).map(String)}
                        onChange={(v) => {
                          const m = { ...draft.state_assignee_map };
                          if (v.length) m[st] = v.map(Number); else delete m[st];
                          set("state_assignee_map", m);
                        }}
                        options={staffOpts}
                        placeholder="— Unmapped —"
                        ariaLabel={`Counsellors for ${st}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-3">
              <Check label="Notify staff when a lead is captured" checked={!!draft.notify_on_import} onChange={(v) => set("notify_on_import", v ? 1 : 0)} />
              {!!draft.notify_on_import && (
                <>
                  <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                    {(["responsible", "specific"] as const).map((t) => (
                      <label key={t} className="flex items-center gap-1.5">
                        <input type="radio" name="notify_type" checked={draft.notify_type === t} onChange={() => set("notify_type", t)} />
                        {t === "responsible" ? "Responsible person" : "Specific staff members"}
                      </label>
                    ))}
                  </div>
                  {draft.notify_type === "specific" && (
                    <MultiSelect value={draft.notify_staff.map(String)} onChange={(v) => set("notify_staff", v.map(Number))} options={staffOpts} placeholder="Select staff to notify" />
                  )}
                </>
              )}
            </div>
          </Card>
        </div>
      )}

      {tab === "integration" && (
        <Card className="max-w-3xl">
          {isNew || !token ? (
            <p className="py-8 text-center text-sm text-slate-500">Save the form first to generate its public link and embed code.</p>
          ) : (
            <IntegrationCode token={token} submitText={draft.submit_text} formId={id} apiKey={apiKey} fields={draft.fields} onKey={setApiKey} />
          )}
        </Card>
      )}
    </div>
  );
}

const DEDUPE_FIELDS: SelectOption[] = [
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "name", label: "Name" },
  { value: "alt_phone", label: "Alternative phone" },
  { value: "city", label: "City" },
  { value: "state", label: "State" },
];

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
      {label}
    </label>
  );
}

/** A disabled, representative input for the live preview. */
function PreviewInput({ field }: { field: WebFormField }) {
  const cls = `${inp} bg-slate-50`;
  if (field.type === "textarea") return <textarea disabled rows={3} placeholder={field.placeholder} className={cls} />;
  if (field.type === "select") return (
    <select disabled className={cls}><option>{field.placeholder || "— Select —"}</option>{field.options.map((o) => <option key={o}>{o}</option>)}</select>
  );
  const t = field.type === "email" ? "email" : field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "tel" ? "tel" : "text";
  return <input disabled type={t} placeholder={field.placeholder} className={cls} />;
}

function IntegrationCode({ token, submitText, formId, apiKey, fields, onKey }: {
  token: string; submitText: string; formId: number; apiKey: string | null;
  fields: WebFormField[]; onKey: (k: string) => void;
}) {
  const toast = useToast();
  const [w, setW] = useState(600);
  const [h, setH] = useState(850);
  const [regen, setRegen] = useState(false);
  const url = formUrl(token);
  const iframe = `<iframe width="${w}" height="${h}" src="${url}" frameborder="0" allowfullscreen></iframe>`;
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${what} copied`); }
    catch { toast.error("Could not copy"); }
  };

  // API endpoint (server-to-server) + a ready-to-run example body from the form's
  // fields (defaulting phone, since it's required to create a lead).
  const endpoint = `${API_URL}/public/forms/${token}`;
  const sample: Record<string, string> = {};
  for (const f of fields) sample[f.param || f.key] = f.key === "phone" ? "9876543210" : f.key === "email" ? "lead@example.com" : `Sample ${f.label}`;
  if (!fields.some((f) => f.key === "phone")) sample.phone = "9876543210";
  const bodyJson = JSON.stringify(sample, null, 2);
  const curl = `curl -X POST "${endpoint}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Api-Key: ${apiKey ?? "YOUR_API_KEY"}" \\\n  -d '${JSON.stringify(sample)}'`;

  async function regenerate() {
    if (!confirm("Regenerate the API key? Any integration using the old key will stop working.")) return;
    setRegen(true);
    try { const r = await regenerateWebFormApiKey(formId); onKey(r.api_key); toast.success("API key regenerated."); }
    catch (e) { toast.error((e as Error).message); }
    finally { setRegen(false); }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">Copy &amp; paste the code anywhere on your site to show the form. Adjust the width and height to fit.</p>
      <div>
        <label className={lbl}>Public form URL</label>
        <div className="flex gap-2">
          <a href={url} target="_blank" rel="noreferrer" className="flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-emerald-700 hover:underline">{url}</a>
          <button onClick={() => copy(url, "URL")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Copy</button>
        </div>
      </div>
      <div className="flex gap-3">
        <div><label className={lbl}>Width (px)</label><input type="number" value={w} onChange={(e) => setW(Number(e.target.value) || 0)} className={`${inp} w-28`} /></div>
        <div><label className={lbl}>Height (px)</label><input type="number" value={h} onChange={(e) => setH(Number(e.target.value) || 0)} className={`${inp} w-28`} /></div>
      </div>
      <div>
        <label className={lbl}>Embed code</label>
        <textarea readOnly value={iframe} rows={3} className={`${inp} font-mono text-xs`} onClick={(e) => (e.target as HTMLTextAreaElement).select()} />
        <button onClick={() => copy(iframe, "Embed code")} className="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Copy embed code</button>
      </div>
      <p className="text-xs text-slate-400">Submit button label: “{submitText || "Submit"}”.</p>

      {/* ---- API access (server-to-server / Postman) ---- */}
      <div className="mt-6 space-y-3 border-t border-slate-200 pt-5">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">API access (Postman / server-to-server)</h3>
          <p className="mt-0.5 text-xs text-slate-500">POST a JSON body to the endpoint below with your API key in the <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">X-Api-Key</code> header to create a lead. The key is secret — don&apos;t put it in front-end / browser code.</p>
        </div>

        <div>
          <label className={lbl}>Endpoint</label>
          <div className="flex gap-2">
            <input readOnly value={`POST ${endpoint}`} className={`${inp} flex-1 font-mono text-xs`} onClick={(e) => (e.target as HTMLInputElement).select()} />
            <button onClick={() => copy(endpoint, "Endpoint")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Copy</button>
          </div>
        </div>

        <div>
          <label className={lbl}>API key</label>
          <div className="flex gap-2">
            <input readOnly value={apiKey ?? "—"} className={`${inp} flex-1 font-mono text-xs`} onClick={(e) => (e.target as HTMLInputElement).select()} />
            <button onClick={() => apiKey && copy(apiKey, "API key")} disabled={!apiKey} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Copy</button>
            <button onClick={regenerate} disabled={regen} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50">{regen ? "…" : "Regenerate"}</button>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Send it as header <code className="rounded bg-slate-100 px-1">X-Api-Key</code> (or a JSON field <code className="rounded bg-slate-100 px-1">api_key</code>).</p>
        </div>

        <div>
          <label className={lbl}>Example JSON body</label>
          <textarea readOnly value={bodyJson} rows={Math.min(8, Object.keys(sample).length + 2)} className={`${inp} font-mono text-xs`} onClick={(e) => (e.target as HTMLTextAreaElement).select()} />
          <button onClick={() => copy(bodyJson, "JSON body")} className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Copy JSON</button>
        </div>

        <div>
          <label className={lbl}>cURL</label>
          <textarea readOnly value={curl} rows={4} className={`${inp} font-mono text-xs`} onClick={(e) => (e.target as HTMLTextAreaElement).select()} />
          <button onClick={() => copy(curl, "cURL command")} className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Copy cURL</button>
        </div>
      </div>
    </div>
  );
}
