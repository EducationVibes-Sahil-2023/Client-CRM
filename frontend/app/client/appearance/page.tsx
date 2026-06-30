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
  fontStack,
  fontSizePx,
  resolveLogoSize,
  LOGO_WIDTH_RANGE,
  LOGO_HEIGHT_RANGE,
  DEFAULT_BRANDING,
  PAGE_SIZE_OPTIONS,
  FONT_FAMILY_OPTIONS,
  FONT_SIZE_OPTIONS,
  type Branding,
  type Density,
  type SidebarStyle,
  type ThemeMode,
  type FontFamily,
  type FontSize,
} from "../../lib/theme";
import { MAIN_NAV, orderNav, icons } from "../ClientSidebar";

const SCALE_STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

export default function AppearancePage() {
  const toast = useToast();
  const { branding, brandingLoaded, updateBranding, hasFeature } = useClient();
  const [draft, setDraft] = useState<Branding>(branding);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingFav, setUploadingFav] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const faviconRef = useRef<HTMLInputElement>(null);

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

  // Rename a nav item (blank = revert to its default label).
  function setMenuLabel(key: string, label: string) {
    const next = { ...draft.menu_labels };
    if (label.trim()) next[key] = label; else delete next[key];
    set("menu_labels", next);
  }
  // Change a nav item's icon (same key as the default reverts).
  function setMenuIcon(key: string, icon: string, defaultIcon: string) {
    const next = { ...draft.menu_icons };
    if (icon && icon !== defaultIcon) next[key] = icon; else delete next[key];
    set("menu_icons", next);
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

  async function uploadFavicon(file: File) {
    setUploadingFav(true);
    try {
      const r = await clientUpload(file);
      set("favicon_url", r.url);
      toast.success("Favicon uploaded.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingFav(false);
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
  const faviconSrc = draft.favicon_url
    ? (draft.favicon_url.startsWith("http") ? draft.favicon_url : `${API_URL}${draft.favicon_url}`)
    : "";
  const logoSize = resolveLogoSize(draft.logo_width, draft.logo_height);

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
              <div className="space-y-4">
                {/* Logo — shown at its configured size (object-contain, so wide logos aren't cropped). */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Logo (sidebar)</label>
                  <div className="flex items-center gap-3">
                    <span className="flex h-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 px-2" style={{ minWidth: 56 }}>
                      {logoSrc ? <img src={logoSrc} alt="Logo" className="object-contain" style={{ width: logoSize.width, height: logoSize.height }} /> : <span className="text-xs text-slate-400">None</span>}
                    </span>
                    <div className="flex flex-col gap-1.5">
                      <button onClick={() => fileRef.current?.click()} disabled={uploading} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">{uploading ? "Uploading…" : "Upload logo"}</button>
                      {draft.logo_url && <button onClick={() => set("logo_url", "")} className="text-left text-xs font-medium text-rose-600 hover:underline">Remove</button>}
                    </div>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
                  </div>
                </div>

                {/* Favicon — a separate, small square image for the browser tab. */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Favicon (browser tab)</label>
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
                      {faviconSrc ? <img src={faviconSrc} alt="Favicon" className="h-full w-full object-contain" /> : <span className="text-[10px] text-slate-400">None</span>}
                    </span>
                    <div className="flex flex-col gap-1.5">
                      <button onClick={() => faviconRef.current?.click()} disabled={uploadingFav} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">{uploadingFav ? "Uploading…" : "Upload favicon"}</button>
                      {draft.favicon_url && <button onClick={() => set("favicon_url", "")} className="text-left text-xs font-medium text-rose-600 hover:underline">Remove</button>}
                    </div>
                    <input ref={faviconRef} type="file" accept="image/*,.ico" className="hidden" onChange={(e) => e.target.files?.[0] && uploadFavicon(e.target.files[0])} />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">Square PNG/ICO works best. Falls back to your logo if empty.</p>
                </div>
              </div>
            </div>

            {/* Logo size — width & height in px, so wide (large-width, short-height) logos fit cleanly. */}
            <div className="mt-5 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 flex items-center justify-between text-xs font-medium text-slate-500"><span>Logo width</span><span className="font-semibold text-slate-700">{logoSize.width}px</span></span>
                <input type="range" min={LOGO_WIDTH_RANGE.min} max={LOGO_WIDTH_RANGE.max} value={logoSize.width} onChange={(e) => set("logo_width", e.target.value)} className="w-full accent-emerald-600" />
              </label>
              <label className="block">
                <span className="mb-1 flex items-center justify-between text-xs font-medium text-slate-500"><span>Logo height</span><span className="font-semibold text-slate-700">{logoSize.height}px</span></span>
                <input type="range" min={LOGO_HEIGHT_RANGE.min} max={LOGO_HEIGHT_RANGE.max} value={logoSize.height} onChange={(e) => set("logo_height", e.target.value)} className="w-full accent-emerald-600" />
              </label>
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

          {/* Typography */}
          <Card>
            <h3 className="font-semibold text-slate-900">Typography</h3>
            <p className="mt-0.5 text-sm text-slate-500">The font and base text size used across your whole dashboard.</p>
            <div className="mt-4 space-y-4">
              <SegRow
                label="Font style"
                value={draft.font_family}
                onChange={(v) => set("font_family", v as FontFamily)}
                options={FONT_FAMILY_OPTIONS.map((o) => [o.value, o.label] as [string, string])}
              />
              <SegRow
                label="Font size"
                value={draft.font_size}
                onChange={(v) => set("font_size", v as FontSize)}
                options={FONT_SIZE_OPTIONS.map((o) => [o.value, o.label] as [string, string])}
              />
              {/* Live sample — shows the picked typeface at the picked size. */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4" style={{ fontFamily: fontStack(draft.font_family), fontSize: fontSizePx(draft.font_size) }}>
                <div className="font-semibold text-slate-900">The quick brown fox jumps over the lazy dog</div>
                <div className="mt-1 text-slate-500">1234567890 — Leads, tasks, follow-ups &amp; reports at a glance.</div>
              </div>
            </div>
          </Card>

          {/* Table defaults */}
          <Card>
            <h3 className="font-semibold text-slate-900">Tables & pagination</h3>
            <p className="mt-0.5 text-sm text-slate-500">How many rows every data table (leads, team, calls, follow-ups, …) shows per page by default. Each person can still pick their own size from the table.</p>
            <div className="mt-4">
              <SegRow
                label="Default rows per page"
                value={String(draft.default_page_size)}
                onChange={(v) => set("default_page_size", v)}
                options={PAGE_SIZE_OPTIONS.map((n) => [String(n), String(n)] as [string, string])}
              />
            </div>
          </Card>

          {/* Menu — order, labels & icons */}
          <Card>
            <h3 className="font-semibold text-slate-900">Menu, labels &amp; icons</h3>
            <p className="mt-0.5 text-sm text-slate-500">Reorder the sidebar, rename items, and pick each one&apos;s icon. Items hidden by your plan won&apos;t show.</p>
            <ul className="mt-4 space-y-1.5">
              {orderedMenu.map((item, i) => (
                <li key={item.key} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <span className="w-5 flex-shrink-0 text-center text-xs font-semibold text-slate-400">{i + 1}</span>
                  <IconPicker value={draft.menu_icons[item.key] ?? item.icon} onPick={(ic) => setMenuIcon(item.key, ic, item.icon)} />
                  <input
                    value={draft.menu_labels[item.key] ?? ""}
                    onChange={(e) => setMenuLabel(item.key, e.target.value)}
                    placeholder={item.label}
                    className="min-w-0 flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
                  />
                  <div className="flex flex-shrink-0 gap-1">
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
            <p className="mt-3 text-[11px] text-slate-400">Leave a name blank to keep the default. Click the icon to change it.</p>
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

/** A button showing the current icon; opens a grid to pick a different one. */
function IconPicker({ value, onPick }: { value: string; onPick: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const path = icons[value] ?? icons.dashboard;
  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} title="Change icon" className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-600">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={path} strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-20 grid w-[15.5rem] grid-cols-7 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          {Object.entries(icons).map(([name, d]) => (
            <button
              key={name}
              type="button"
              onClick={() => { onPick(name); setOpen(false); }}
              title={name}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition ${name === value ? "bg-emerald-100 text-emerald-700" : "text-slate-500 hover:bg-slate-100"}`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={d} strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          ))}
        </div>
      )}
    </div>
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
      style={{ ...brandCssVars(draft.brand_color), "--app-font": fontStack(draft.font_family), fontFamily: fontStack(draft.font_family) } as React.CSSProperties}
    >
      <div className="flex bg-slate-50" style={{ minHeight: 320 }}>
        {/* mini sidebar */}
        <div className="w-40 flex-shrink-0 border-r border-slate-200 bg-white p-2.5">
          <div className="mb-3 flex items-center gap-2 px-1">
            {logoSrc ? <img src={logoSrc} alt="" className="rounded-lg object-contain" style={{ width: Math.min(resolveLogoSize(draft.logo_width, draft.logo_height).width, 120), height: Math.min(resolveLogoSize(draft.logo_width, draft.logo_height).height, 32) }} /> : <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-[10px] font-bold text-white">{(draft.app_name || "C").slice(0, 1)}</span>}
            <div className="min-w-0 leading-tight"><div className="truncate text-[11px] font-bold text-slate-900">{draft.app_name || "My CRM"}</div></div>
          </div>
          {menu.slice(0, 5).map((m, idx) => {
            const active = idx === 0;
            const activeCls = solid ? "text-white" : "bg-emerald-50 text-emerald-700";
            return (
              <div key={m.key} className={`mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium ${active ? activeCls : "text-slate-500"}`} style={active && solid ? { background: "var(--color-emerald-600)" } : undefined}>
                <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={icons[draft.menu_icons[m.key] ?? ""] ?? icons[m.icon]} strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span className="truncate">{draft.menu_labels[m.key] || m.label}</span>
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
