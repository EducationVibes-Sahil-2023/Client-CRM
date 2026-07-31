"use client";

import { useEffect, useMemo, useState } from "react";
import { notFound, useParams, useRouter } from "next/navigation";
import {
  getApplicantTracker, getApplicantTrackerFilters, saveApplicantConfig,
  APPLICANT_MULTI_KEYS,
  type ApplicantTrackerColumn, type ApplicantTrackerFilterOptions, type ApplicantTrackerFilters,
} from "../../lib/client";
import { useClient } from "../ClientContext";
import { useToast } from "../../components/toast/ToastProvider";
import { Card, Modal, PageHeader, Spinner } from "../../admin/ui";
import { DataTable, type Column } from "../../admin/DataTable";
import { MultiSelect, type SelectOption } from "../../admin/SearchSelect";
import { FilterRail, FilterToggle, FilterLabel, filterRailPad } from "../FilterRail";
import { useFilterLayout, FilterLayoutMenu, orderFilters } from "../../admin/tableConfig";
import { DateRangeFilter, resolveDateRange, rangeActive, EMPTY_RANGE, type DateRange } from "../../admin/dateFilter";

type TrackerRow = Record<string, string | number | null>;
type MultiKey = (typeof APPLICANT_MULTI_KEYS)[number];

const selCls =
  "rounded-lg border border-slate-300 bg-white py-2 px-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15";

// Colour common status words wherever they appear (Pending / Approved / …).
const STATUS_CLASSES: [RegExp, string][] = [
  [/^(approved|received|active|completed?|done|paid|confirmed|success|verified)$/i, "bg-emerald-50 text-emerald-700 ring-emerald-200"],
  [/^(rejected|cancell?ed|refund(ed)?|failed|overdue|expired|declined|inactive)$/i, "bg-rose-50 text-rose-600 ring-rose-200"],
  [/^(pending|hold|on ?hold|awaited?|waiting|processing|in ?transit|not ?received)$/i, "bg-amber-50 text-amber-700 ring-amber-200"],
  [/^(sent|applied|in ?progress|submitted|shortlisted|approved by)$/i, "bg-sky-50 text-sky-700 ring-sky-200"],
];
function keywordClass(v: string): string | null {
  const t = v.trim();
  for (const [re, cls] of STATUS_CLASSES) if (re.test(t)) return cls;
  return null;
}

/** A pill badge tinted with a hex colour (text + border in the colour, faint bg). */
function hexBadge(text: string, hex: string) {
  return (
    <span className="inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ color: hex, borderColor: hex, backgroundColor: `${hex}1a` }}>{text}</span>
  );
}

/**
 * Parse any recognizable date value into a Date + whether it carries a time.
 * Handles ISO (yyyy-mm-dd[ hh:mm[:ss]]) and dd-mm-yyyy / dd/mm/yyyy
 * [hh:mm [AM/PM]] — the formats the tracker's config emits. Returns null for
 * non-dates. Built in local time so the shown components match the source.
 */
function parseCellDate(raw: string): { d: Date; hasTime: boolean } | null {
  const s = raw.trim();
  if (s === "" || s.startsWith("0000-00-00")) return null;
  let y = 0, mo = 0, d = 0, hh = -1, mi = 0;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2})?)?$/))) {
    y = +m[1]; mo = +m[2]; d = +m[3];
    if (m[4] !== undefined) { hh = +m[4]; mi = +m[5]; }
  } else if ((m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?)?$/))) {
    d = +m[1]; mo = +m[2]; y = +m[3];
    if (m[4] !== undefined) {
      hh = +m[4]; mi = +m[5];
      const ap = m[6]?.toUpperCase();
      if (ap === "PM" && hh < 12) hh += 12;
      if (ap === "AM" && hh === 12) hh = 0;
    }
  } else {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const hasTime = hh >= 0 && hh <= 23;
  const dt = new Date(y, mo - 1, d, hasTime ? hh : 0, hasTime ? mi : 0);
  return Number.isNaN(dt.getTime()) ? null : { d: dt, hasTime };
}

/** Stacked date/time cell — identical text + styling to the Leads table. */
function stackedDate(d: Date, hasTime: boolean) {
  const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return (
    <span className="block leading-tight text-slate-600">
      {date}
      {hasTime && (
        <>
          <br />
          <span className="text-[11px] text-slate-400">{d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
        </>
      )}
    </span>
  );
}

// The full applicant filter set (mirrors the legacy tracker). `multi` keys hold
// arrays; the rest are single strings; `onlyMyLeads` gates to local-lead matches.
// The two BETWEEN date ranges use the shared leads-style DateRange (preset + custom).
type Filters = Record<MultiKey, string[]> & {
  minor: string; tf_status: string; academic_year: string;
  courier_date: string; apostille_received: string; visa_payment_date: string; fly_date: string;
  applicantRange: DateRange;   // → from/to (tblclients.datecreated)
  lastUpdateRange: DateRange;  // → last_from/last_to (tblclients.last_update)
  onlyMyLeads: boolean;
};
const EMPTY_FILTERS: Filters = {
  ...(Object.fromEntries(APPLICANT_MULTI_KEYS.map((k) => [k, [] as string[]])) as unknown as Record<MultiKey, string[]>),
  minor: "", tf_status: "", academic_year: "",
  courier_date: "", apostille_received: "", visa_payment_date: "", fly_date: "",
  applicantRange: EMPTY_RANGE, lastUpdateRange: EMPTY_RANGE,
  onlyMyLeads: true,
};

// Single-value (exact-equals / Yes-No / year) params. The two BETWEEN ranges are
// resolved separately from their DateRange below.
const SINGLE_KEYS = ["minor", "tf_status", "academic_year", "courier_date", "apostille_received",
  "visa_payment_date", "fly_date"] as const;

// Top-level filter blocks, in display order — drives the admin "Layout" menu
// (drag-reorder + show/hide) and the CSS-`order` applied to each block below.
const FILTER_LAYOUT_DEFS: { id: string; label: string }[] = [
  { id: "onlyMyLeads", label: "Only my leads" },
  { id: "status", label: "Status" },
  { id: "stage", label: "Application Stage" },
  { id: "sub_stage", label: "Application Sub Stage" },
  { id: "lead_type", label: "Lead Type" },
  { id: "source", label: "Source" },
  { id: "client_type", label: "Client Type" },
  { id: "counsellor", label: "Counsellor" },
  { id: "neet_status", label: "NEET Status" },
  { id: "passport_status", label: "Passport Status" },
  { id: "doc_status", label: "Org Doc Status" },
  { id: "ev_partner", label: "EV Partner" },
  { id: "apostille_vendors", label: "Apostille Vendors" },
  { id: "visa_vendors", label: "Visa Vendors" },
  { id: "fly_vendors", label: "Fly Vendors" },
  { id: "fly_departure", label: "Fly Departure" },
  { id: "university", label: "Primary University" },
  { id: "country", label: "Primary Country" },
  { id: "apostille_status", label: "Apostille Status" },
  { id: "fly_batch", label: "Fly Batch" },
  { id: "minor", label: "Minor" },
  { id: "tf_status", label: "TF Status" },
  { id: "academic_year", label: "Academic Year" },
  { id: "applicantRange", label: "Applicant Date" },
  { id: "lastUpdateRange", label: "Last Update" },
  { id: "courier_date", label: "APS Courier Date" },
  { id: "apostille_received", label: "APS Receiving Date" },
  { id: "visa_payment_date", label: "Visa Payment Date" },
  { id: "fly_date", label: "Fly Date" },
];

function filtersToParams(f: Filters): ApplicantTrackerFilters {
  const p: ApplicantTrackerFilters = {};
  APPLICANT_MULTI_KEYS.forEach((k) => { if (f[k].length) (p as Record<string, string[]>)[k] = f[k]; });
  SINGLE_KEYS.forEach((k) => { if (f[k]) (p as Record<string, string>)[k] = f[k]; });
  // BETWEEN ranges: the backend needs BOTH bounds, so only send resolved pairs.
  const ar = resolveDateRange(f.applicantRange);
  if (ar.from && ar.to) { p.from = ar.from; p.to = ar.to; }
  const lr = resolveDateRange(f.lastUpdateRange);
  if (lr.from && lr.to) { p.last_from = lr.from; p.last_to = lr.to; }
  if (!f.onlyMyLeads) p.all = "1";
  return p;
}
function countActive(f: Filters): number {
  let n = 0;
  APPLICANT_MULTI_KEYS.forEach((k) => { if (f[k].length) n++; });
  SINGLE_KEYS.forEach((k) => { if (f[k]) n++; });
  if (rangeActive(f.applicantRange)) n++;
  if (rangeActive(f.lastUpdateRange)) n++;
  return n;
}

/**
 * Applicant section — a config-driven, read-only tracker over the secondary
 * (Perfex) DB. Display name + URL slug are admin-editable, so this single dynamic
 * route serves whatever slug the admin chose; any other slug 404s.
 */
export default function ApplicantSectionPage() {
  const { section } = useParams<{ section: string }>();
  const { applicant, applicantLoaded, setApplicant, isAdmin, permissionsLoaded } = useClient();
  // Client-wide admin filter layout: reorder + show/hide each filter block +
  // panel placement. Only the admin (the only role that can view this section)
  // persists it. `fo(id)` maps a block id to its CSS-`order` position.
  const filterLayout = useFilterLayout("applicant_filters", isAdmin);
  const fo = (id: string): number => {
    const idx = orderFilters(FILTER_LAYOUT_DEFS, filterLayout.order).findIndex((d) => d.id === id);
    return idx === -1 ? 0 : idx;
  };
  const toast = useToast();
  const router = useRouter();

  const isThisSection = applicantLoaded && section === applicant.slug;

  const [rows, setRows] = useState<TrackerRow[]>([]);
  const [trackerCols, setTrackerCols] = useState<ApplicantTrackerColumn[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // Filters (leads-style right rail): staged draft vs applied set.
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [opts, setOpts] = useState<ApplicantTrackerFilterOptions | null>(null);

  // Settings dialog (admin only): name, URL slug, and cell colours.
  const [editOpen, setEditOpen] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftSlug, setDraftSlug] = useState("");
  const [draftColors, setDraftColors] = useState<{ value: string; color: string }[]>([]);
  const [draftFrozen, setDraftFrozen] = useState(1);
  const [saving, setSaving] = useState(false);

  // Admin colour map (value → hex), lower-cased for case-insensitive matching.
  const colorMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [k, v] of Object.entries(applicant.colors ?? {})) m[k.trim().toLowerCase()] = v;
    return m;
  }, [applicant.colors]);

  // Every distinct status value across all status types (applicant status,
  // sub-status, stage, passport, doc, NEET, apostille) — so the admin can pick a
  // colour for any of them without typing.
  const knownStatusValues = useMemo(() => {
    const vals = new Set<string>(["YES", "NO"]);
    if (opts) {
      [opts.status, opts.sub_stage, opts.stage, opts.passport_status, opts.doc_status, opts.neet_status]
        .forEach((list) => list.forEach((o) => { if (o.name?.trim()) vals.add(o.name.trim()); }));
      opts.apostille_status.forEach((v) => { if (v.trim()) vals.add(v.trim()); });
    }
    return Array.from(vals).sort((a, b) => a.localeCompare(b));
  }, [opts]);

  const canView = isThisSection && (!permissionsLoaded || isAdmin);
  const appliedParams = useMemo(() => filtersToParams(filters), [filters]);

  useEffect(() => {
    if (!canView) return;
    setLoading(true);
    const t = setTimeout(() => {
      getApplicantTracker({ page, per_page: perPage, q: search.trim() || undefined, ...appliedParams })
        .then((r) => { setRows(r.rows ?? []); setTotal(r.total ?? 0); if (r.columns?.length) setTrackerCols(r.columns); })
        .catch((e) => toast.error(e?.message || "Could not load data."))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [canView, page, perPage, search, tick, appliedParams, toast]);

  useEffect(() => { if (canView) getApplicantTrackerFilters().then(setOpts).catch(() => {}); }, [canView]);

  useEffect(() => {
    const last = Math.max(1, Math.ceil(total / perPage));
    if (page > last) setPage(last);
  }, [total, perPage, page]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, totalPages);

  const columns = useMemo<Column<TrackerRow>[]>(() =>
    trackerCols.map((c, i) => ({
      key: c.key,
      header: c.label,
      lockVisible: i === 0,
      defaultHidden: !c.selected && i !== 0,
      render: (r) => {
        const raw = r[c.key] == null ? "" : String(r[c.key]);
        const s = raw.trim();
        if (!s) return <span className="text-slate-300">—</span>;
        // Date/time values → stacked, identical to the Leads table.
        const dt = parseCellDate(s);
        if (dt) return stackedDate(dt.d, dt.hasTime);
        // 1) Admin-configured colour for this exact value (client-admin editable).
        const cfg = colorMap[s.toLowerCase()];
        if (cfg) return hexBadge(s, cfg);
        // 2) YES / NO document defaults.
        if (raw === "YES") return <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">YES</span>;
        if (raw === "NO") return <span className="inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600 ring-1 ring-rose-200">NO</span>;
        // 3) Applicant Status → the status's configured colour (from the source DB).
        const hex = c.key === "status" ? String(r["__status_color"] ?? "") : "";
        if (/^#[0-9a-f]{6}$/i.test(hex)) return hexBadge(s, hex);
        // 4) Status-word defaults (Pending / Approved / Received / Sent …).
        const kc = keywordClass(s);
        if (kc) return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${kc}`}>{s}</span>;
        return <span className="whitespace-nowrap">{s}</span>;
      },
    })),
  [trackerCols, colorMap]);

  const activeCount = countActive(filters);
  const dirty = JSON.stringify(draft) !== JSON.stringify(filters);
  const applyFilters = () => { setFilters(draft); setPage(1); };
  const resetFilters = () => { setDraft(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); setPage(1); };
  const setD = (patch: Partial<Filters>) => setDraft((f) => ({ ...f, ...patch }));

  const idOpt = (list: { id: number; name: string }[]): SelectOption[] => list.map((o) => ({ value: String(o.id), label: o.name }));
  const strOpt = (list: string[]): SelectOption[] => list.map((s) => ({ value: s, label: s }));
  const years = Array.from({ length: 7 }, (_, i) => String(2023 + i));

  const COLOR_PRESETS = [["YES", "#16a34a"], ["NO", "#e11d48"], ["Active", "#16a34a"], ["Pending", "#d97706"], ["Approved", "#16a34a"], ["Received", "#16a34a"], ["Sent", "#0284c7"], ["Cancelled", "#e11d48"], ["Hold", "#d97706"]];
  const openEdit = () => {
    setDraftLabel(applicant.label);
    setDraftSlug(applicant.slug);
    const entries = Object.entries(applicant.colors ?? {}).map(([value, color]) => ({ value, color }));
    setDraftColors(entries.length ? entries : COLOR_PRESETS.map(([value, color]) => ({ value, color })));
    setDraftFrozen(applicant.frozen ?? 1);
    setEditOpen(true);
  };
  const save = async () => {
    const label = draftLabel.trim();
    const slug = draftSlug.trim().toLowerCase();
    if (!label) { toast.error("Enter a section name."); return; }
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(slug)) { toast.error("URL must be lowercase letters, numbers and hyphens."); return; }
    const colors: Record<string, string> = {};
    for (const { value, color } of draftColors) {
      const v = value.trim();
      if (v && /^#[0-9a-f]{6}$/i.test(color)) colors[v] = color.toLowerCase();
    }
    setSaving(true);
    try {
      const c = await saveApplicantConfig({ label, slug, colors, frozen: draftFrozen });
      setApplicant(c);
      setEditOpen(false);
      toast.success("Section updated.");
      if (c.slug !== section) router.replace(`/client/${c.slug}`);
    } catch (e) {
      toast.error((e as Error)?.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  if (!applicantLoaded) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!isThisSection) return notFound();

  if (permissionsLoaded && !isAdmin) {
    return (
      <div>
        <PageHeader title={applicant.label} subtitle="Read-only view of the external database." />
        <Card><div className="py-10 text-center text-sm text-slate-500">Only the client admin can view this section.</div></Card>
      </div>
    );
  }

  // The id- and string-multi filters, in the on-screen order.
  const idFilters: { key: MultiKey; label: string; options: SelectOption[] }[] = opts ? [
    { key: "status", label: "Status", options: idOpt(opts.status) },
    { key: "stage", label: "Application Stage", options: idOpt(opts.stage) },
    { key: "sub_stage", label: "Application Sub Stage", options: idOpt(opts.sub_stage) },
    { key: "lead_type", label: "Lead Type", options: idOpt(opts.lead_type) },
    { key: "source", label: "Source", options: idOpt(opts.source) },
    { key: "client_type", label: "Client Type", options: idOpt(opts.client_type) },
    { key: "counsellor", label: "Counsellor", options: idOpt(opts.counsellor) },
    { key: "neet_status", label: "NEET Status", options: idOpt(opts.neet_status) },
    { key: "passport_status", label: "Passport Status", options: idOpt(opts.passport_status) },
    { key: "doc_status", label: "Org Doc Status", options: idOpt(opts.doc_status) },
    { key: "ev_partner", label: "EV Partner", options: idOpt(opts.ev_partner) },
    { key: "apostille_vendors", label: "Apostille Vendors", options: idOpt(opts.vendors) },
    { key: "visa_vendors", label: "Visa Vendors", options: idOpt(opts.vendors) },
    { key: "fly_vendors", label: "Fly Vendors", options: idOpt(opts.vendors) },
    { key: "fly_departure", label: "Fly Departure", options: idOpt(opts.fly_departure) },
  ] : [];
  const strFilters: { key: MultiKey; label: string; options: SelectOption[] }[] = opts ? [
    { key: "university", label: "Primary University", options: strOpt(opts.university) },
    { key: "country", label: "Primary Country", options: strOpt(opts.country) },
    { key: "apostille_status", label: "Apostille Status", options: strOpt(opts.apostille_status) },
    { key: "fly_batch", label: "Fly Batch", options: strOpt(opts.fly_batch) },
  ] : [];
  const yesNo = [{ key: "minor" as const, label: "Minor" }, { key: "tf_status" as const, label: "TF Status" }];
  const singleDates = [
    { key: "courier_date" as const, label: "APS Courier Date" },
    { key: "apostille_received" as const, label: "APS Receiving Date" },
    { key: "visa_payment_date" as const, label: "Visa Payment Date" },
    { key: "fly_date" as const, label: "Fly Date" },
  ];

  return (
    <div className={filterRailPad(filterOpen, filterLayout.placement)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={applicant.label}
          subtitle={`Applicant tracker from the external database (read-only). URL: /client/${applicant.slug}`}
        />
        <div className="mt-1 flex items-center gap-2">
          <FilterToggle open={filterOpen} count={activeCount} onClick={() => { setDraft(filters); setFilterOpen((o) => !o); }} />
          {isAdmin && <FilterLayoutMenu api={filterLayout} defs={FILTER_LAYOUT_DEFS} />}
          {isAdmin && (
            <button
              type="button"
              onClick={openEdit}
              className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Rename / URL
            </button>
          )}
        </div>
      </div>

      <DataTable
        tableKey="applicant-tracker"
        canRenameColumns={isAdmin}
        sharedConfig
        frozenCols={applicant.frozen ?? 1}
        columns={columns}
        rows={rows}
        getKey={(r) => Number(r.userid)}
        loading={loading}
        nowrap
        emptyTitle={search || activeCount ? "No matching applicants" : "No applicants"}
        emptyHint={
          search || activeCount
            ? "Try clearing or widening your filters."
            : filters.onlyMyLeads
              ? "No applicants match a lead in your leads table yet. Turn off “Only my leads” in Filters to see everyone."
              : "Nothing came back from the external database."
        }
        toolbar={
          <div className="flex w-full items-center gap-2">
            <div className="relative min-w-48 flex-1 sm:max-w-xs">
              <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search name, email, mobile…"
                className={`${selCls} w-full pl-9`}
              />
            </div>
            <button
              type="button"
              onClick={() => setTick((t) => t + 1)}
              disabled={loading}
              title="Refresh"
              aria-label="Refresh"
              className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 transition hover:bg-slate-50 disabled:opacity-60"
            >
              <svg className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 2v6h-6M3 12a9 9 0 0115-6.7L21 8M3 22v-6h6M21 12a9 9 0 01-15 6.7L3 16" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        }
        page={safePage}
        totalPages={totalPages}
        onPage={setPage}
        total={total}
        pageSize={perPage}
        onPageSize={(n) => { setPerPage(n); setPage(1); }}
        pageAlign="right"
      />

      <FilterRail
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        dirty={dirty}
        onReset={resetFilters}
        resetDisabled={activeCount === 0 && filters.onlyMyLeads}
        onApply={() => { applyFilters(); }}
        applyDisabled={!dirty}
        applying={loading}
        placement={filterLayout.placement}
      >
        {!filterLayout.isHidden("onlyMyLeads") && (
          <label style={{ order: fo("onlyMyLeads") }} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <input type="checkbox" checked={draft.onlyMyLeads} onChange={(e) => setD({ onlyMyLeads: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
            <span className="font-medium text-slate-700">Only applicants linked to my leads</span>
          </label>
        )}

        {!opts && <div style={{ order: -1 }} className="py-6 text-center text-sm text-slate-400">Loading filters…</div>}

        {idFilters.map((f) => filterLayout.isHidden(f.key) ? null : (
          <div key={f.key} style={{ order: fo(f.key) }}>
            <FilterLabel>{f.label}</FilterLabel>
            <div className="mt-1"><MultiSelect value={draft[f.key]} onChange={(v) => setD({ [f.key]: v } as Partial<Filters>)} options={f.options} /></div>
          </div>
        ))}
        {strFilters.map((f) => filterLayout.isHidden(f.key) ? null : (
          <div key={f.key} style={{ order: fo(f.key) }}>
            <FilterLabel>{f.label}</FilterLabel>
            <div className="mt-1"><MultiSelect value={draft[f.key]} onChange={(v) => setD({ [f.key]: v } as Partial<Filters>)} options={f.options} /></div>
          </div>
        ))}

        {yesNo.map((f) => filterLayout.isHidden(f.key) ? null : (
          <div key={f.key} style={{ order: fo(f.key) }}>
            <FilterLabel>{f.label}</FilterLabel>
            <select value={draft[f.key]} onChange={(e) => setD({ [f.key]: e.target.value } as Partial<Filters>)} className={`${selCls} mt-1 w-full`}>
              <option value="">Any</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </div>
        ))}

        {!filterLayout.isHidden("academic_year") && (
          <div style={{ order: fo("academic_year") }}>
            <FilterLabel>Academic Year</FilterLabel>
            <select value={draft.academic_year} onChange={(e) => setD({ academic_year: e.target.value })} className={`${selCls} mt-1 w-full`}>
              <option value="">Any</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}

        {!filterLayout.isHidden("applicantRange") && (
          <div style={{ order: fo("applicantRange") }}>
            <FilterLabel>Applicant Date</FilterLabel>
            <div className="mt-1"><DateRangeFilter ariaLabel="Applicant date" value={draft.applicantRange} onChange={(v) => setD({ applicantRange: v })} /></div>
          </div>
        )}
        {!filterLayout.isHidden("lastUpdateRange") && (
          <div style={{ order: fo("lastUpdateRange") }}>
            <FilterLabel>Last Update</FilterLabel>
            <div className="mt-1"><DateRangeFilter ariaLabel="Last update" value={draft.lastUpdateRange} onChange={(v) => setD({ lastUpdateRange: v })} /></div>
          </div>
        )}

        {singleDates.map((f) => filterLayout.isHidden(f.key) ? null : (
          <div key={f.key} style={{ order: fo(f.key) }}>
            <FilterLabel>{f.label}</FilterLabel>
            <input type="date" value={draft[f.key]} onChange={(e) => setD({ [f.key]: e.target.value } as Partial<Filters>)} className={`${selCls} mt-1 w-full`} />
          </div>
        ))}
      </FilterRail>

      <Modal open={editOpen} title="Section settings" onClose={() => setEditOpen(false)}>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Section name</label>
            <input value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} maxLength={40} placeholder="Applicant" className={`${selCls} w-full`} />
            <p className="mt-1 text-xs text-slate-400">Shown in the sidebar and the page heading (e.g. Applicant, Customer).</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">URL slug</label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-slate-400">/client/</span>
              <input value={draftSlug} onChange={(e) => setDraftSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} maxLength={31} placeholder="applicant" className={`${selCls} flex-1`} />
            </div>
            <p className="mt-1 text-xs text-slate-400">Lowercase letters, numbers and hyphens. Changing this moves the page to the new address.</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Frozen columns</label>
            <select value={draftFrozen} onChange={(e) => setDraftFrozen(Number(e.target.value))} className={`${selCls} w-full`}>
              {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 0 ? "None" : `First ${n} column${n > 1 ? "s" : ""}`}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-400">Pin the first columns (e.g. Name) so they stay visible while you scroll the rest sideways.</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Status &amp; cell colours</label>
            <p className="mb-2 text-xs text-slate-400">Give any status value a colour — applicant status, sub-status, stage, passport status, doc status, NEET, apostille, YES/NO. Any cell matching the value (case-insensitive) shows as a coloured badge.</p>
            <datalist id="applicant-status-values">
              {knownStatusValues.map((v) => <option key={v} value={v} />)}
            </datalist>
            <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
              {draftColors.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={row.value}
                    list="applicant-status-values"
                    onChange={(e) => setDraftColors((rs) => rs.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
                    placeholder="Status value (type or pick)"
                    className={`${selCls} min-w-0 flex-1`}
                  />
                  <input
                    type="color"
                    value={/^#[0-9a-f]{6}$/i.test(row.color) ? row.color : "#16a34a"}
                    onChange={(e) => setDraftColors((rs) => rs.map((r, j) => (j === i ? { ...r, color: e.target.value } : r)))}
                    className="h-9 w-10 flex-shrink-0 cursor-pointer rounded border border-slate-300"
                  />
                  {row.value.trim() && hexBadge(row.value.trim(), /^#[0-9a-f]{6}$/i.test(row.color) ? row.color : "#16a34a")}
                  <button type="button" onClick={() => setDraftColors((rs) => rs.filter((_, j) => j !== i))} title="Remove" className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-4">
              <button type="button" onClick={() => setDraftColors((rs) => [...rs, { value: "", color: "#16a34a" }])} className="text-sm font-medium text-indigo-600 hover:text-indigo-700">+ Add colour</button>
              {knownStatusValues.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDraftColors((rs) => {
                    const have = new Set(rs.map((r) => r.value.trim().toLowerCase()));
                    const add = knownStatusValues.filter((v) => !have.has(v.toLowerCase())).map((v) => ({ value: v, color: "#64748b" }));
                    return [...rs, ...add];
                  })}
                  className="text-sm font-medium text-slate-500 hover:text-slate-700"
                >
                  Load all statuses ({knownStatusValues.length})
                </button>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setEditOpen(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
