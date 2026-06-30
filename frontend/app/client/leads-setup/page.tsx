"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getLeadsSetup,
  createLeadStatus, updateLeadStatus, deleteLeadStatus,
  createLeadType, updateLeadType, deleteLeadType,
  createLeadSource, updateLeadSource, deleteLeadSource,
  createMarketingType, updateMarketingType, deleteMarketingType,
  createConversionType, updateConversionType, deleteConversionType,
  createFollowupGroup, updateFollowupGroup, deleteFollowupGroup,
  createState, updateState, deleteState,
  createCity, updateCity, deleteCity,
  getLeadImportSetup, saveLeadImportSetup,
  type LeadStatus, type LeadType, type LeadSource, type MarketingType, type ConversionType, type FollowupGroup,
  type State, type City, type LeadImportColumn,
} from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import { useClient } from "../ClientContext";
import { PageHeader, Card, Modal, SkeletonText } from "../../admin/ui";

const COLORS = ["indigo", "violet", "emerald", "amber", "rose", "sky", "teal", "pink", "orange", "lime", "cyan", "slate"];
const DOT: Record<string, string> = {
  indigo: "bg-indigo-500", violet: "bg-violet-500", emerald: "bg-emerald-500", amber: "bg-amber-500",
  rose: "bg-rose-500", sky: "bg-sky-500", teal: "bg-teal-500", pink: "bg-pink-500",
  orange: "bg-orange-500", lime: "bg-lime-500", cyan: "bg-cyan-500", slate: "bg-slate-500",
};
const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

// A color can be a named preset ("indigo") or a custom hex ("#16a34a").
const isHex = (c: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
const dotClass = (c: string) => (isHex(c) ? "" : DOT[c] ?? "bg-slate-400");
const dotStyle = (c: string): React.CSSProperties | undefined => (isHex(c) ? { backgroundColor: c } : undefined);

type EntityKey = "statuses" | "sub_statuses" | "lead_types" | "sources" | "marketing" | "conversions" | "followup_groups" | "states" | "cities" | "import";

interface Draft {
  id?: number;
  name: string;
  color: string;
  parent_ids: number[];        // sub status → parent statuses (can be many)
  marketing_type_id: string;   // lead source
  lead_status_ids: number[];   // conversion type → grouped lead statuses
  percentage: string;          // conversion type → win % (manual mode)
  auto_percentage: boolean;    // conversion type → auto-calc % from lead counts
  state_id: string;            // city → parent state
}
const blank: Draft = { name: "", color: "indigo", parent_ids: [], marketing_type_id: "", lead_status_ids: [], percentage: "", auto_percentage: false, state_id: "" };

const TABS: { key: EntityKey; label: string; hint: string }[] = [
  { key: "statuses", label: "Lead Statuses", hint: "Pipeline stages a lead moves through." },
  { key: "sub_statuses", label: "Sub Statuses", hint: "A finer stage under one or more statuses — the same sub-status can sit under several statuses." },
  { key: "lead_types", label: "Lead Types", hint: "Categorise leads (e.g. Buyer, Seller)." },
  { key: "sources", label: "Lead Sources", hint: "Where leads come from, grouped by marketing type." },
  { key: "marketing", label: "Marketing Types", hint: "Channels that group your lead sources." },
  { key: "conversions", label: "Conversion Types", hint: "Group lead statuses into a pipeline stage with a win % (e.g. Prospect = Fresh + Warm)." },
  { key: "followup_groups", label: "Follow Up Groups", hint: "Group lead statuses into a named follow-up bucket (e.g. Prospect = Hot + Warm). Each group becomes a 'pending' card on the Follow Up Tracker." },
  { key: "states", label: "States", hint: "States/regions a lead can belong to. Add cities under each state." },
  { key: "cities", label: "Cities", hint: "Cities for the lead form, each grouped under a state. Pick the state when adding a city." },
  { key: "import", label: "Import setup", hint: "Choose which columns appear in the lead import template and which are mandatory. Phone (contact) is always required." },
];

// A sub-status has one or more parents; a top-level status has none.
const isSub = (s: LeadStatus) => (s.parent_ids?.length ?? 0) > 0 || !!s.parent_id;

export default function LeadsSetupPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useClient();
  const canCreate = can("leads_setup", "create");
  const canUpdate = can("leads_setup", "update");
  const canDelete = can("leads_setup", "delete");
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState<LeadStatus[]>([]);
  const [leadTypes, setLeadTypes] = useState<LeadType[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [marketing, setMarketing] = useState<MarketingType[]>([]);
  const [conversions, setConversions] = useState<ConversionType[]>([]);
  const [followupGroups, setFollowupGroups] = useState<FollowupGroup[]>([]);
  const [states, setStates] = useState<State[]>([]);
  const [cities, setCities] = useState<City[]>([]);

  const [tab, setTab] = useState<EntityKey>("statuses");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  // Import-template column config (which columns + mandatory).
  const [importCols, setImportCols] = useState<LeadImportColumn[]>([]);
  const [importSaving, setImportSaving] = useState(false);
  useEffect(() => { getLeadImportSetup().then((d) => setImportCols(d.columns)).catch(() => {}); }, []);

  const patchImportCol = (key: string, patch: Partial<LeadImportColumn>) =>
    setImportCols((cols) => cols.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  async function saveImport() {
    setImportSaving(true);
    try {
      const d = await saveLeadImportSetup(importCols.map((c) => ({ key: c.key, include: c.include, required: c.required })));
      setImportCols(d.columns);
      toast.success("Import setup saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setImportSaving(false);
    }
  }

  const load = useCallback(() => {
    return getLeadsSetup()
      .then((d) => {
        setStatuses(d.lead_statuses ?? []);
        setSources(d.lead_sources ?? []);
        setMarketing(d.marketing_types ?? []);
        setLeadTypes(d.lead_types ?? []);
        setConversions(d.conversion_types ?? []);
        setFollowupGroups(d.followup_groups ?? []);
        setStates(d.states ?? []);
        setCities(d.cities ?? []);
      })
      .catch(() => toast.error("Could not load leads setup."))
      .finally(() => setLoading(false));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  // Top-level statuses vs sub-statuses live in the same table, split by parents.
  const topStatuses = useMemo(() => statuses.filter((s) => !isSub(s)), [statuses]);
  const subStatuses = useMemo(() => statuses.filter(isSub), [statuses]);

  const items = useMemo(() => {
    switch (tab) {
      case "statuses": return topStatuses;
      case "sub_statuses": return subStatuses;
      case "lead_types": return leadTypes;
      case "sources": return sources;
      case "marketing": return marketing;
      case "conversions": return conversions;
      case "followup_groups": return followupGroups;
      case "states": return states;
      case "cities": return cities;
      case "import": return [];
    }
  }, [tab, topStatuses, subStatuses, leadTypes, sources, marketing, conversions, followupGroups, states, cities]);

  function openNew() { setDraft({ ...blank }); }

  function openEdit(it: LeadStatus | LeadType | LeadSource | MarketingType | ConversionType | FollowupGroup | State | City) {
    setDraft({
      id: it.id,
      name: it.name,
      color: it.color || "indigo",
      parent_ids: (it as LeadStatus).parent_ids ?? [],
      marketing_type_id: (it as LeadSource).marketing_type_id ? String((it as LeadSource).marketing_type_id) : "",
      lead_status_ids: (it as ConversionType).lead_status_ids ?? [],
      percentage: (it as ConversionType).percentage != null ? String((it as ConversionType).percentage) : "",
      auto_percentage: !!(it as ConversionType).auto_percentage,
      state_id: (it as City).state_id ? String((it as City).state_id) : "",
    });
  }

  async function save() {
    if (!draft) return;
    if (draft.name.trim().length < 1) { toast.warning("Enter a name."); return; }
    setSaving(true);
    try {
      const id = draft.id;
      if (tab === "statuses") {
        const body = { name: draft.name, color: draft.color, parent_ids: [] as number[] };
        if (id) await updateLeadStatus(id, body); else await createLeadStatus(body);
      } else if (tab === "sub_statuses") {
        if (draft.parent_ids.length === 0) { toast.warning("Pick at least one parent status."); setSaving(false); return; }
        const body = { name: draft.name, color: draft.color, parent_ids: draft.parent_ids };
        if (id) await updateLeadStatus(id, body); else await createLeadStatus(body);
      } else if (tab === "lead_types") {
        const body = { name: draft.name, color: draft.color };
        if (id) await updateLeadType(id, body); else await createLeadType(body);
      } else if (tab === "sources") {
        const body = { name: draft.name, color: draft.color, marketing_type_id: draft.marketing_type_id ? Number(draft.marketing_type_id) : null };
        if (id) await updateLeadSource(id, body); else await createLeadSource(body);
      } else if (tab === "marketing") {
        const body = { name: draft.name, color: draft.color };
        if (id) await updateMarketingType(id, body); else await createMarketingType(body);
      } else if (tab === "conversions") {
        const body = {
          name: draft.name, color: draft.color, lead_status_ids: draft.lead_status_ids,
          auto_percentage: draft.auto_percentage,
          percentage: draft.auto_percentage ? 0 : (draft.percentage ? Number(draft.percentage) : 0),
        };
        if (id) await updateConversionType(id, body); else await createConversionType(body);
      } else if (tab === "states") {
        const body = { name: draft.name, color: draft.color };
        if (id) await updateState(id, body); else await createState(body);
      } else if (tab === "cities") {
        if (!draft.state_id) { toast.warning("Pick the state this city belongs to."); setSaving(false); return; }
        const body = { name: draft.name, color: draft.color, state_id: Number(draft.state_id) };
        if (id) await updateCity(id, body); else await createCity(body);
      } else {
        const body = { name: draft.name, color: draft.color, lead_status_ids: draft.lead_status_ids };
        if (id) await updateFollowupGroup(id, body); else await createFollowupGroup(body);
      }
      toast.success(id ? "Saved." : "Added.");
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(it: { id: number; name: string }) {
    const noun = activeTab.label.replace(/s$/, "").toLowerCase();
    const ok = await confirm({
      danger: true,
      title: `Delete ${noun} “${it.name}”?`,
      message: (
        <>
          This removes <b>{it.name}</b> from your {activeTab.label.toLowerCase()}. It is archived (kept for audit), not destroyed, so it can be restored later.
        </>
      ),
      confirmLabel: "Yes, delete",
      cancelLabel: "No, keep it",
    });
    if (!ok) return;
    try {
      if (tab === "statuses" || tab === "sub_statuses") await deleteLeadStatus(it.id);
      else if (tab === "lead_types") await deleteLeadType(it.id);
      else if (tab === "sources") await deleteLeadSource(it.id);
      else if (tab === "marketing") await deleteMarketingType(it.id);
      else if (tab === "conversions") await deleteConversionType(it.id);
      else if (tab === "states") await deleteState(it.id);
      else if (tab === "cities") await deleteCity(it.id);
      else await deleteFollowupGroup(it.id);
      toast.success("Deleted.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete.");
    }
  }

  const activeTab = TABS.find((t) => t.key === tab)!;

  function subtitle(it: LeadStatus | LeadType | LeadSource | MarketingType | ConversionType | FollowupGroup | State | City): string | null {
    if (tab === "cities") return (it as City).state ? `State: ${(it as City).state}` : "No state";
    if (tab === "sub_statuses") {
      const s = it as LeadStatus;
      const names = s.parent_names?.length
        ? s.parent_names
        : (s.parent_ids ?? []).map((id) => statuses.find((x) => x.id === id)?.name).filter(Boolean);
      return names.length ? `Under: ${names.join(", ")}` : "No parent status";
    }
    if (tab === "sources") return (it as LeadSource).marketing_type ? `Marketing: ${(it as LeadSource).marketing_type}` : "No marketing type";
    if (tab === "conversions") {
      const c = it as ConversionType;
      const names = (c.lead_statuses ?? []).map((x) => x.name).join(", ") || "No statuses";
      const pct = c.auto_percentage ? "Auto %" : `${c.percentage ?? 0}%`;
      return `${pct} · ${names}`;
    }
    if (tab === "followup_groups") {
      const g = it as FollowupGroup;
      return (g.lead_statuses ?? []).map((x) => x.name).join(", ") || "No statuses — add some";
    }
    return null;
  }

  return (
    <>
      <PageHeader
        title="Leads Setup"
        subtitle="Configure the statuses, types, sources and conversions used across your leads."
        action={!canCreate || tab === "import" ? undefined : <button onClick={openNew} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"><svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>Add</button>}
      />

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`rounded-lg px-3 py-2 text-sm font-medium transition ${tab === t.key ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{t.label}</button>
        ))}
      </div>

      <Card>
        <p className="mb-4 text-sm text-slate-500">{activeTab.hint}</p>
        {tab === "import" ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <span>Column</span>
              <span className="flex gap-6 pr-1"><span className="w-20 text-center">In template</span><span className="w-20 text-center">Mandatory</span></span>
            </div>
            {importCols.map((c) => (
              <div key={c.key} className="flex items-center justify-between py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">
                  {c.label}
                  {c.custom && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">custom</span>}
                  {c.locked && <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">always</span>}
                </span>
                <div className="flex items-center gap-6 pr-1">
                  <input type="checkbox" disabled={c.locked || !canUpdate} checked={c.include} onChange={(e) => patchImportCol(c.key, { include: e.target.checked, ...(e.target.checked ? {} : { required: false }) })} className="h-5 w-20 cursor-pointer accent-emerald-600 disabled:opacity-50" />
                  <input type="checkbox" disabled={c.locked || !canUpdate || !c.include} checked={c.required} onChange={(e) => patchImportCol(c.key, { required: e.target.checked })} className="h-5 w-20 cursor-pointer accent-emerald-600 disabled:opacity-40" />
                </div>
              </div>
            ))}
            {canUpdate && (
              <div className="flex justify-end pt-3">
                <button onClick={saveImport} disabled={importSaving} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{importSaving ? "Saving…" : "Save import setup"}</button>
              </div>
            )}
          </div>
        ) : loading ? (
          <SkeletonText lines={6} className="py-2" />
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">No {activeTab.label.toLowerCase()} yet. Click “Add” to create one.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((it) => {
              const sub = subtitle(it);
              return (
                <li key={it.id} className="flex items-center gap-3 py-3">
                  <span className={`h-3 w-3 flex-shrink-0 rounded-full ${dotClass(it.color)}`} style={dotStyle(it.color)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{it.name}</span>
                    {sub && <span className="block truncate text-xs text-slate-400">{sub}</span>}
                  </span>
                  {canUpdate && (
                    <button onClick={() => openEdit(it)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Edit">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  )}
                  {canDelete && (
                    <button onClick={() => remove(it)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" aria-label="Delete">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={`${draft?.id ? "Edit" : "New"} ${activeTab.label.replace(/s$/, "").toLowerCase()}`}>
        {draft && (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-600">Name</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name" className={field} autoFocus />
            </label>

            <div>
              <span className="mb-1 block text-sm font-medium text-slate-600">Color</span>
              <div className="flex flex-wrap items-center gap-2">
                {COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => setDraft({ ...draft, color: c })} className={`h-7 w-7 rounded-full ${DOT[c]} ${draft.color === c ? "ring-2 ring-offset-2 ring-slate-400" : ""}`} aria-label={c} />
                ))}

                {/* Custom color — a hidden native picker behind a swatch. */}
                <label
                  title="Custom color"
                  className={`relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full ${isHex(draft.color) ? "ring-2 ring-offset-2 ring-slate-400" : ""}`}
                  style={isHex(draft.color)
                    ? { backgroundColor: draft.color }
                    : { background: "conic-gradient(from 0deg, #ef4444, #f59e0b, #84cc16, #10b981, #06b6d4, #6366f1, #d946ef, #ef4444)" }}
                >
                  <input
                    type="color"
                    value={isHex(draft.color) ? draft.color : "#6366f1"}
                    onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    aria-label="Pick a custom color"
                  />
                  {!isHex(draft.color) && (
                    <svg className="h-3.5 w-3.5 text-white drop-shadow" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
                  )}
                </label>
              </div>
              {isHex(draft.color) && (
                <span className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-slate-400">
                  Custom <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-600">{draft.color.toUpperCase()}</code>
                </span>
              )}
            </div>

            {tab === "sub_statuses" && (
              <div className="text-sm">
                <span className="mb-1 block font-medium text-slate-600">Parent statuses</span>
                {topStatuses.length === 0 ? (
                  <p className="text-xs text-slate-400">Add lead statuses first, then choose which ones this sub-status sits under.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {topStatuses.map((s) => {
                      const on = draft.parent_ids.includes(s.id);
                      return (
                        <button key={s.id} type="button"
                          onClick={() => setDraft({ ...draft, parent_ids: on ? draft.parent_ids.filter((x) => x !== s.id) : [...draft.parent_ids, s.id] })}
                          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${on ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                          <span className={`h-2 w-2 rounded-full ${dotClass(s.color)}`} style={dotStyle(s.color)} />
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                <span className="mt-1.5 block text-xs text-slate-400">Select one or more statuses. The same sub-status can sit under several statuses, and shows on the lead form under each.</span>
              </div>
            )}

            {tab === "sources" && (
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-600">Marketing type</span>
                <select value={draft.marketing_type_id} onChange={(e) => setDraft({ ...draft, marketing_type_id: e.target.value })} className={field}>
                  <option value="">None</option>
                  {marketing.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
            )}

            {tab === "cities" && (
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-600">State</span>
                {states.length === 0 ? (
                  <p className="text-xs text-slate-400">Add a state first, then assign this city to it.</p>
                ) : (
                  <select value={draft.state_id} onChange={(e) => setDraft({ ...draft, state_id: e.target.value })} className={field}>
                    <option value="">Select a state…</option>
                    {states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
                <span className="mt-1.5 block text-xs text-slate-400">The city is shown on the lead form only after this state is picked.</span>
              </label>
            )}

            {tab === "conversions" && (
              <>
                <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.auto_percentage}
                    onChange={(e) => setDraft({ ...draft, auto_percentage: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>
                    <span className="block font-medium text-slate-700">Auto-calculate percentage</span>
                    <span className="block text-xs text-slate-400">Compute the % from live lead counts: leads in the selected statuses ÷ total leads.</span>
                  </span>
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-600">Conversion percentage</span>
                  <div className="relative">
                    <input
                      type="number" min="0" max="100"
                      value={draft.auto_percentage ? "" : draft.percentage}
                      onChange={(e) => setDraft({ ...draft, percentage: e.target.value })}
                      placeholder={draft.auto_percentage ? "Auto" : "0"}
                      disabled={draft.auto_percentage}
                      className={`${field} pr-8 ${draft.auto_percentage ? "cursor-not-allowed bg-slate-50 text-slate-400" : ""}`}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
                  </div>
                  <span className="mt-1 block text-xs text-slate-400">
                    {draft.auto_percentage
                      ? "Calculated automatically — pending until the Leads module is live."
                      : "Win probability for leads in this stage."}
                  </span>
                </label>

                <div className="text-sm">
                  <span className="mb-1 block font-medium text-slate-600">Lead statuses in this stage</span>
                  {statuses.length === 0 ? (
                    <p className="text-xs text-slate-400">Add lead statuses first to group them here.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {statuses.map((s) => {
                        const on = draft.lead_status_ids.includes(s.id);
                        return (
                          <button key={s.id} type="button"
                            onClick={() => setDraft({ ...draft, lead_status_ids: on ? draft.lead_status_ids.filter((x) => x !== s.id) : [...draft.lead_status_ids, s.id] })}
                            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${on ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                            <span className={`h-2 w-2 rounded-full ${dotClass(s.color)}`} style={dotStyle(s.color)} />
                            {s.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            {tab === "followup_groups" && (
              <div className="text-sm">
                <span className="mb-1 block font-medium text-slate-600">Lead statuses in this group</span>
                {statuses.length === 0 ? (
                  <p className="text-xs text-slate-400">Add lead statuses first to group them here.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {statuses.map((s) => {
                      const on = draft.lead_status_ids.includes(s.id);
                      return (
                        <button key={s.id} type="button"
                          onClick={() => setDraft({ ...draft, lead_status_ids: on ? draft.lead_status_ids.filter((x) => x !== s.id) : [...draft.lead_status_ids, s.id] })}
                          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${on ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                          <span className={`h-2 w-2 rounded-full ${dotClass(s.color)}`} style={dotStyle(s.color)} />
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                <span className="mt-1.5 block text-xs text-slate-400">Pick the statuses this follow-up bucket covers (e.g. Prospect = Hot + Warm). It appears as a “pending” card on the Follow Up Tracker.</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setDraft(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={save} disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
