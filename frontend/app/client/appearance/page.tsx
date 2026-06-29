"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, Card } from "../../admin/ui";
import { useClient } from "../ClientContext";
import { useToast } from "../../components/toast/ToastProvider";
import { clientUpload, saveBranding } from "../../lib/client";
import { API_URL } from "../../lib/api";
import {
  brandCssVars,
  readableOn,
  shadeScale,
  DEFAULT_BRANDING,
  type Branding,
  type Density,
  type SidebarStyle,
  type ThemeMode,
} from "../../lib/theme";
import { MAIN_NAV, orderNav } from "../ClientSidebar";

const SCALE_STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

export default function AppearancePage() {
  const toast = useToast();
  const { branding, brandingLoaded, updateBranding, hasFeature } = useClient();
  const [draft, setDraft] = useState<Branding>(branding);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Sync the editor with the loaded branding (once it arrives).
  useEffect(() => { if (brandingLoaded) setDraft(branding); }, [brandingLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Branding>(k: K, v: Branding[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const scale = useMemo(() => shadeScale(draft.brand_color), [draft.brand_color]);

  // Menu items in their current order, gated to the client's plan.
  const orderedMenu = useMemo(
    () => orderNav(MAIN_NAV, draft.menu_order).filter((i) => !i.feature || hasFeature(i.feature)),
    [draft.menu_order, hasFeature],
  );

  function moveMenu(index: number, dir: -1 | 1) {
    const next = [...orderedMenu];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    set("menu_order", next.map((i) => i.key));
  }

  async function uploadLogo(file: File) {
    setUploading(true);
    try {
      const r = await clientUpload(file);
      set("logo_url", r.url);
      toast.success("Logo uploaded.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const { branding: saved } = await saveBranding(draft);
      updateBranding(saved);
      setDraft(saved);
      toast.success("Appearance saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  function resetDefaults() {
    setDraft((d) => ({ ...DEFAULT_BRANDING, menu_order: d.menu_order }));
  }

  const logoSrc = draft.logo_url
    ? (draft.logo_url.startsWith("http") ? draft.logo_url : `${API_URL}${draft.logo_url}`)
    : "";

  return (
    <>
      <PageHeader
        title="Appearance & Branding"
        subtitle="Customise the colour, logo, menu order and feel of your CRM"
        action={
          <div className="flex gap-2">
            <button onClick={resetDefaults} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Reset</button>
            <button onClick={save} disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? "Saving…" : "Save changes"}</button>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* ---- Controls ---- */}
        <div className="space-y-5 lg:col-span-2">
          {/* Brand colour */}
          <Card>
            <h3 className="font-semibold text-slate-900">Brand colour</h3>
            <p className="mt-0.5 text-sm text-slate-500">Sets the primary colour across buttons, links, charts and highlights.</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input type="color" value={draft.brand_color} onChange={(e) => set("brand_color", e.target.value)} className="h-11 w-14 cursor-pointer rounded-lg border border-slate-200 bg-white p-1" aria-label="Pick brand colour" />
              <input
                value={draft.brand_color}
                onChange={(e) => set("brand_color", e.target.value)}
                placeholder="#10b981"
                className="w-32 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
              />
              <div className="flex gap-1.5">
                {["#10b981", "#6366f1", "#3b82f6", "#8b5cf6", "#f43f5e", "#14b8a6", "#f59e0b", "#0ea5e9"].map((c) => (
                  <button key={c} onClick={() => set("brand_color", c)} title={c} className="h-7 w-7 rounded-full ring-2 ring-white shadow" style={{ background: c }} />
                ))}
              </div>
            </div>
            {/* generated scale */}
            <div className="mt-4 flex overflow-hidden rounded-lg ring-1 ring-slate-200">
              {SCALE_STOPS.map((s) => (
                <div key={s} className="h-8 flex-1" style={{ background: scale[s] }} title={`${s}: ${scale[s]}`} />
              ))}
            </div>
          </Card>

          {/* Logo + identity */}
          <Card>
            <h3 className="font-semibold text-slate-900">Logo & name</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Workspace name</label>
                <input value={draft.app_name} onChange={(e) => set("app_name", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15" />
                <label className="mb-1 mt-3 block text-xs font-medium text-slate-500">Tagline</label>
                <input value={draft.app_tagline} onChange={(e) => set("app_tagline", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Logo</label>
                <div className="flex items-center gap-3">
                  <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                    {logoSrc ? <img src={logoSrc} alt="Logo" className="h-full w-full object-cover" /> : <span className="text-xs text-slate-400">None</span>}
                  </span>
                  <div className="flex flex-col gap-1.5">
                    <button onClick={() => fileRef.current?.click()} disabled={uploading} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">{uploading ? "Uploading…" : "Upload logo"}</button>
                    {draft.logo_url && <button onClick={() => set("logo_url", "")} className="text-left text-xs font-medium text-rose-600 hover:underline">Remove</button>}
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
                </div>
              </div>
            </div>
          </Card>

          {/* Theme / density / sidebar */}
          <Card>
            <h3 className="font-semibold text-slate-900">Theme & layout</h3>
            <div className="mt-4 space-y-4">
              <SegRow label="Mode" value={draft.theme_mode} onChange={(v) => set("theme_mode", v as ThemeMode)} options={[["light", "Light"], ["dark", "Dark"], ["system", "System"]]} />
              <SegRow label="Density" value={draft.density} onChange={(v) => set("density", v as Density)} options={[["comfortable", "Comfortable"], ["compact", "Compact"]]} />
              <SegRow label="Sidebar" value={draft.sidebar_style} onChange={(v) => set("sidebar_style", v as SidebarStyle)} options={[["subtle", "Subtle"], ["solid", "Solid accent"]]} />
            </div>
          </Card>

          {/* Menu order */}
          <Card>
            <h3 className="font-semibold text-slate-900">Menu order</h3>
            <p className="mt-0.5 text-sm text-slate-500">Reorder the main sidebar menu. Items hidden by your plan won&apos;t show.</p>
            <ul className="mt-4 space-y-1.5">
              {orderedMenu.map((item, i) => (
                <li key={item.key} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <span className="flex h-5 w-5 items-center justify-center text-xs font-semibold text-slate-400">{i + 1}</span>
                  <span className="flex-1 text-sm font-medium text-slate-700">{item.label}</span>
                  <div className="flex gap-1">
                    <button onClick={() => moveMenu(i, -1)} disabled={i === 0} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" aria-label="Move up">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 15l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    <button onClick={() => moveMenu(i, 1)} disabled={i === orderedMenu.length - 1} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" aria-label="Move down">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* ---- Live preview ---- */}
        <div className="lg:col-span-1">
          <div className="sticky top-20">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Live preview</h3>
            <Preview draft={draft} logoSrc={logoSrc} menu={orderedMenu} />
          </div>
        </div>
      </div>
    </>
  );
}

function SegRow({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
        {options.map(([v, l]) => (
          <button key={v} onClick={() => onChange(v)} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${value === v ? "bg-emerald-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function Preview({ draft, logoSrc, menu }: { draft: Branding; logoSrc: string; menu: typeof MAIN_NAV }) {
  const dark = draft.theme_mode === "dark";
  const solid = draft.sidebar_style === "solid";
  const onBrand = readableOn(draft.brand_color);
  return (
    <div
      className={`client-shell overflow-hidden rounded-2xl border border-slate-200 shadow-sm ${dark ? "dark" : ""}`}
      data-density={draft.density}
      data-sidebar={draft.sidebar_style}
      style={brandCssVars(draft.brand_color)}
    >
      <div className="flex bg-slate-50" style={{ minHeight: 320 }}>
        {/* mini sidebar */}
        <div className="w-40 flex-shrink-0 border-r border-slate-200 bg-white p-2.5">
          <div className="mb-3 flex items-center gap-2 px-1">
            {logoSrc ? <img src={logoSrc} alt="" className="h-7 w-7 rounded-lg object-cover" /> : <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-[10px] font-bold text-white">{(draft.app_name || "C").slice(0, 1)}</span>}
            <div className="min-w-0 leading-tight"><div className="truncate text-[11px] font-bold text-slate-900">{draft.app_name || "My CRM"}</div></div>
          </div>
          {menu.slice(0, 5).map((m, idx) => {
            const active = idx === 0;
            const activeCls = solid ? "text-white" : "bg-emerald-50 text-emerald-700";
            return (
              <div key={m.key} className={`mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium ${active ? activeCls : "text-slate-500"}`} style={active && solid ? { background: "var(--color-emerald-600)" } : undefined}>
                <span className={`h-1.5 w-1.5 rounded-full ${active && !solid ? "bg-emerald-600" : active ? "bg-white" : "bg-slate-300"}`} />
                <span className="truncate">{m.label}</span>
              </div>
            );
          })}
        </div>
        {/* mini content */}
        <div className="flex-1 p-3">
          <div className="rounded-xl bg-white p-3 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">Dashboard</div>
            <div className="mt-0.5 text-[11px] text-slate-500">Welcome back 👋</div>
            <button className="mt-3 rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: "var(--color-emerald-600)", color: onBrand }}>Primary action</button>
            <div className="mt-3 flex gap-1.5">
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Badge</span>
              <span className="text-[11px] font-medium text-emerald-600">A themed link</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
