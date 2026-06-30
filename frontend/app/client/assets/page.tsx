"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addAssetNote,
  allocateAsset,
  clientUpload,
  createAsset,
  deleteAsset,
  getAssetHistory,
  getAssets,
  getAssetSetup,
  getStaff,
  revokeAsset,
  saveAssetFieldSettings,
  transferAsset,
  updateAsset,
  ASSET_REQUIRABLE_FIELDS,
  type Asset,
  type AssetLog,
  type Staff,
  type TaskCustomField,
} from "../../lib/client";
import { API_URL } from "../../lib/api";
import { useToast } from "../../components/toast/ToastProvider";
import { useClient } from "../ClientContext";
import { Badge, Card, Drawer, Modal, PageHeader, SkeletonStats, SkeletonBlock, fmtDate, timeAgo } from "../../admin/ui";
import { DataTable, IconButton, type Column } from "../../admin/DataTable";
import { FieldRow, inputCls } from "../../admin/clients/formKit";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import { MultiSelect, SearchSelect, type SelectOption } from "../../admin/SearchSelect";
import { FilterRail, FilterToggle, FilterLabel, filterRailPad } from "../FilterRail";
import { FieldSetupDrawer } from "../FieldSetupDrawer";
import RichTextEditor from "../../admin/RichTextEditor";
import { DonutChart, BarChart } from "../../admin/Charts";

interface Draft {
  id?: number;
  asset_code: string; name: string; quantity: string; unit: string; series_model: string;
  asset_group: string; managed_by: string; asset_location: string; purchase_date: string;
  warranty_months: string; unit_price: string; depreciation_months: string;
  supplier_name: string; supplier_phone: string; supplier_address: string; description: string; attachment: string;
  /** Values for admin-defined custom fields, keyed by field key. */
  custom: Record<string, string>;
}
const blank: Draft = {
  asset_code: "", name: "", quantity: "1", unit: "", series_model: "", asset_group: "",
  managed_by: "", asset_location: "", purchase_date: "", warranty_months: "", unit_price: "",
  depreciation_months: "", supplier_name: "", supplier_phone: "", supplier_address: "", description: "", attachment: "",
  custom: {},
};
const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

function toDraft(a: Asset): Draft {
  return {
    id: a.id, asset_code: a.asset_code ?? "", name: a.name, quantity: String(a.quantity ?? 1), unit: a.unit ?? "",
    series_model: a.series_model ?? "", asset_group: a.asset_group ?? "", managed_by: a.managed_by ? String(a.managed_by) : "",
    asset_location: a.asset_location ?? "", purchase_date: a.purchase_date ? a.purchase_date.slice(0, 10) : "",
    warranty_months: a.warranty_months != null ? String(a.warranty_months) : "", unit_price: a.unit_price ?? "",
    depreciation_months: a.depreciation_months != null ? String(a.depreciation_months) : "",
    supplier_name: a.supplier_name ?? "", supplier_phone: a.supplier_phone ?? "", supplier_address: a.supplier_address ?? "",
    description: a.description ?? "", attachment: a.attachment ?? "",
    custom: { ...(a.custom_fields ?? {}) },
  };
}

// Tracker timeline visuals.
const logMeta: Record<AssetLog["action"], { color: string; icon: string; label: (l: AssetLog) => string }> = {
  created: { color: "bg-emerald-100 text-emerald-600", icon: "M12 5v14M5 12h14", label: () => "Asset created" },
  updated: { color: "bg-amber-100 text-amber-600", icon: "M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z", label: () => "Details updated" },
  allocated: { color: "bg-indigo-100 text-indigo-600", icon: "M16 11l2 2 4-4M16 7a4 4 0 11-8 0 4 4 0 018 0z", label: (l) => `Allocated to ${l.to_name ?? "staff"}` },
  transferred: { color: "bg-violet-100 text-violet-600", icon: "M4 7h16M4 7l4-4M4 7l4 4M20 17H4M20 17l-4-4M20 17l-4 4", label: (l) => `Transferred ${l.from_name ? `from ${l.from_name} ` : ""}to ${l.to_name ?? "staff"}` },
  revoked: { color: "bg-rose-100 text-rose-600", icon: "M18 6L6 18M6 6l12 12", label: (l) => `Revoked${l.from_name ? ` from ${l.from_name}` : ""}` },
  note: { color: "bg-sky-100 text-sky-600", icon: "M11 5h6M11 9h6M5 5h.01M5 9h.01M5 13h.01M11 13h6M5 17h.01M11 17h6", label: () => "Note" },
  deleted: { color: "bg-slate-100 text-slate-500", icon: "M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13", label: () => "Asset deleted" },
};

// Status → colour (hex for charts, classes for chips).
const STATUS_HEX: Record<string, string> = {
  allocated: "#6366f1", available: "#10b981", maintenance: "#f59e0b",
  repair: "#f59e0b", retired: "#94a3b8", lost: "#f43f5e", damaged: "#f43f5e",
};
const statusHex = (s: string) => STATUS_HEX[s] ?? "#64748b";

const assetVal = (a: Asset) => (Number(a.unit_price) || 0) * (a.quantity || 1);
const fmtMoney = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const CARD_BATCH = 12; // card view: cards loaded per infinite-scroll step

// ---- Filters (a draft the user edits in the rail + the applied set that filters;
// synced on "Apply", mirroring the Announcements section). ----
interface AssetFilters {
  status: string[];
  group: string[];
  allocation: string[]; // "allocated" | "available"
  managedBy: string[];  // staff id (string)
  location: string[];
}
const BLANK_ASSET_FILTERS: AssetFilters = { status: [], group: [], allocation: [], managedBy: [], location: [] };
const ALLOCATION_OPTIONS: SelectOption[] = [
  { value: "allocated", label: "Allocated" },
  { value: "available", label: "Available" },
];
const assetFiltersActive = (f: AssetFilters): boolean =>
  f.status.length > 0 || f.group.length > 0 || f.allocation.length > 0 || f.managedBy.length > 0 || f.location.length > 0;
const countAssetFilters = (f: AssetFilters): number =>
  [f.status.length, f.group.length, f.allocation.length, f.managedBy.length, f.location.length].filter(Boolean).length;
const assetGroupOf = (a: { asset_group: string | null }) => (a.asset_group || "Ungrouped").trim() || "Ungrouped";

/** Warranty expiry date from purchase + months, or null. */
function warrantyExpiry(a: Asset): Date | null {
  if (!a.purchase_date || a.warranty_months == null) return null;
  const d = new Date(a.purchase_date.slice(0, 10));
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + a.warranty_months);
  return d;
}
// Whole days until warranty expiry (negative = expired), or null. Kept at
// module scope so the time read stays out of the render path.
function warrantyDaysLeft(a: Asset): number | null {
  const e = warrantyExpiry(a);
  return e ? Math.ceil((e.getTime() - Date.now()) / 86400000) : null;
}

type ActionType = "allocate" | "transfer" | "revoke";

export default function AssetsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { defaultPageSize, isAdmin, can } = useClient();
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Admin-configured form fields: which built-ins are mandatory + custom fields.
  const [requiredFields, setRequiredFields] = useState<Set<string>>(new Set());
  const [customFields, setCustomFields] = useState<TaskCustomField[]>([]);
  const [setupOpen, setSetupOpen] = useState(false);
  const canManageFields = isAdmin || can("assets", "update");
  const fileRef = useRef<HTMLInputElement>(null);

  const [action, setAction] = useState<{ type: ActionType; asset: Asset } | null>(null);
  const [actStaff, setActStaff] = useState("");
  const [actNotes, setActNotes] = useState("");
  const [acting, setActing] = useState(false);

  const [noteFor, setNoteFor] = useState<Asset | null>(null);
  const [noteText, setNoteText] = useState("");

  const [history, setHistory] = useState<{ asset: Asset; rows: AssetLog[] } | null>(null);

  // UI controls. Seed from a global-search deep link (?q=...) when present.
  const [query, setQuery] = useState(() => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("q") ?? "" : ""));
  // `filters` is the draft edited in the rail; `applied` is what filters the list.
  const [filters, setFilters] = useState<AssetFilters>(BLANK_ASSET_FILTERS);
  const [applied, setApplied] = useState<AssetFilters>(BLANK_ASSET_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const setFilter = <K extends keyof AssetFilters>(key: K, value: AssetFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const [view, setView] = useState<"grid" | "table">("grid");
  const [page, setPage] = useState(1);              // table pagination
  const [perPage, setPerPage] = useState(defaultPageSize);
  const [cardLimit, setCardLimit] = useState(CARD_BATCH); // card infinite scroll
  const sentinel = useRef<HTMLDivElement>(null);

  // Reset paging/scroll whenever the filtered set changes.
  const resetPaging = () => { setPage(1); setCardLimit(CARD_BATCH); };

  function load() {
    getAssets().then((d) => setAssets(d.assets)).catch(() => setAssets([]));
    getStaff().then((d) => setStaff(d.staff)).catch(() => {});
  }
  function loadSetup() {
    getAssetSetup().then((d) => { setRequiredFields(new Set(d.required_fields ?? [])); setCustomFields(d.custom_fields ?? []); }).catch(() => {});
  }
  useEffect(() => { load(); loadSetup(); }, []);

  const set = (k: keyof Draft) => (v: string) => setDraft((d) => d && { ...d, [k]: v });
  const reqAsset = (k: string) => requiredFields.has(k);
  const setCustom = (key: string, v: string) => setDraft((d) => (d ? { ...d, custom: { ...d.custom, [key]: v } } : d));
  const assigneeOpts: SelectOption[] = [{ value: "", label: "— Select —" }, ...staff.map((s) => ({ value: String(s.id), label: s.name }))];

  // -------------------------------------------------------- derived dashboard
  const list = useMemo(() => assets ?? [], [assets]);
  const stats = useMemo(() => {
    const total = list.length;
    const value = list.reduce((sum, a) => sum + assetVal(a), 0);
    const allocated = list.filter((a) => a.allocated_to_id).length;
    const available = total - allocated;
    let expiring = 0;
    for (const a of list) {
      const d = warrantyDaysLeft(a);
      if (d !== null && d >= 0 && d <= 60) expiring++;
    }
    return { total, value, allocated, available, expiring };
  }, [list]);

  const statusData = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of list) map.set(a.status, (map.get(a.status) ?? 0) + 1);
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value, color: statusHex(label) }));
  }, [list]);

  const groupData = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of list) {
      const g = (a.asset_group || "Ungrouped").trim() || "Ungrouped";
      map.set(g, (map.get(g) ?? 0) + assetVal(a));
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value]) => ({ label, value: Math.round(value) }));
  }, [list]);

  const warrantyWatch = useMemo(() => {
    return list
      .map((a) => ({ a, days: warrantyDaysLeft(a) }))
      .filter((x): x is { a: Asset; days: number } => x.days !== null && x.days <= 90)
      .sort((a, b) => a.days - b.days)
      .slice(0, 6);
  }, [list]);

  // Filter dropdown options, derived from the data on hand.
  const statusOptions = useMemo<SelectOption[]>(() => [...new Set(list.map((a) => a.status))].map((s) => ({ value: s, label: s })), [list]);
  const groupOptions = useMemo<SelectOption[]>(() => [...new Set(list.map(assetGroupOf))].map((g) => ({ value: g, label: g })), [list]);
  const locationOptions = useMemo<SelectOption[]>(() => [...new Set(list.map((a) => a.asset_location).filter((l): l is string => !!l))].map((l) => ({ value: l, label: l })), [list]);
  const managedByOptions = useMemo<SelectOption[]>(() => staff.map((s) => ({ value: String(s.id), label: s.name })), [staff]);

  const appliedFilterCount = useMemo(() => countAssetFilters(applied), [applied]);
  const draftDirty = useMemo(() => JSON.stringify(filters) !== JSON.stringify(applied), [filters, applied]);
  function applyFilters() { setApplied(filters); resetPaging(); }
  function clearFilters() { setFilters(BLANK_ASSET_FILTERS); setApplied(BLANK_ASSET_FILTERS); setQuery(""); resetPaging(); }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((a) => {
      if (applied.status.length && !applied.status.includes(a.status)) return false;
      if (applied.group.length && !applied.group.includes(assetGroupOf(a))) return false;
      if (applied.location.length && !applied.location.includes(a.asset_location ?? "")) return false;
      if (applied.managedBy.length && !applied.managedBy.includes(String(a.managed_by ?? ""))) return false;
      if (applied.allocation.length) {
        const isAllocated = !!a.allocated_to_id;
        const wantAllocated = applied.allocation.includes("allocated");
        const wantAvailable = applied.allocation.includes("available");
        if (!((wantAllocated && isAllocated) || (wantAvailable && !isAllocated))) return false;
      }
      if (!q) return true;
      return [a.name, a.asset_code, a.asset_group, a.series_model, a.allocated_to, a.managed_by_name, a.asset_location]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [list, query, applied]);

  // Table view: page slice. Card view: a growing slice for infinite scroll.
  const totalPages = Math.max(1, Math.ceil(visible.length / perPage));
  const pageRows = useMemo(() => visible.slice((page - 1) * perPage, page * perPage), [visible, page, perPage]);
  const cardRows = useMemo(() => visible.slice(0, cardLimit), [visible, cardLimit]);
  const moreCards = cardLimit < visible.length;

  // Infinite scroll: load the next batch of cards when the sentinel appears.
  useEffect(() => {
    if (view !== "grid" || !moreCards) return;
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries[0]?.isIntersecting && setCardLimit((n) => n + CARD_BATCH),
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [view, moreCards, visible.length]);

  // ----------------------------------------------------------------- actions
  async function uploadAttachment(file: File) {
    setUploading(true);
    try { const r = await clientUpload(file); setDraft((d) => d && { ...d, attachment: r.url }); toast.success("Attached."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Upload failed"); }
    finally { setUploading(false); }
  }

  function validate(d: Draft): Record<string, string> {
    const e: Record<string, string> = {};
    if (d.name.trim().length < 1) e.name = "Asset name is required.";
    for (const f of ASSET_REQUIRABLE_FIELDS) {
      if (requiredFields.has(f.key) && !String((d as unknown as Record<string, string>)[f.key] ?? "").trim()) {
        e[f.key] = `${f.label} is required.`;
      }
    }
    for (const f of customFields) {
      if (f.required && !String(d.custom[f.key] ?? "").trim()) e[`custom_${f.key}`] = `${f.label} is required.`;
    }
    return e;
  }

  async function save() {
    if (!draft) return;
    const e = validate(draft);
    setErrors(e);
    if (Object.keys(e).length) { toast.warning("Please fix the highlighted fields."); return; }
    setSaving(true);
    try {
      const { custom, ...rest } = draft;
      const body = { ...rest, quantity: Number(draft.quantity) || 1, managed_by: draft.managed_by ? Number(draft.managed_by) : 0, custom_fields: custom };
      if (draft.id) { await updateAsset(draft.id, body); toast.success("Asset updated."); }
      else { await createAsset(body); toast.success("Asset created."); }
      setDraft(null); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
    finally { setSaving(false); }
  }

  async function remove(a: Asset) {
    // A device that's still with a staff member must be returned (revoked) first.
    if (a.allocated_to_id) {
      toast.warning(`"${a.name}" is still allocated to ${a.allocated_to ?? "a staff member"}. Revoke it (return to company) before deleting.`);
      return;
    }
    const ok = await confirm({
      danger: true,
      title: `Delete "${a.name}"?`,
      message: <>This removes the asset from the list. Its record and tracker history are kept for audit and can be restored later.</>,
      confirmLabel: "Yes, delete",
      cancelLabel: "No, keep it",
    });
    if (!ok) return;
    try { await deleteAsset(a.id); toast.success("Asset deleted."); load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete"); }
  }

  function openAction(type: ActionType, asset: Asset) {
    setAction({ type, asset }); setActStaff(""); setActNotes("");
  }
  async function doAction() {
    if (!action) return;
    const { type, asset } = action;
    if ((type === "allocate" || type === "transfer") && !actStaff) { toast.warning("Select a staff member."); return; }
    setActing(true);
    try {
      if (type === "allocate") await allocateAsset(asset.id, Number(actStaff), actNotes);
      else if (type === "transfer") await transferAsset(asset.id, Number(actStaff), actNotes);
      else await revokeAsset(asset.id, actNotes);
      toast.success(type === "revoke" ? "Asset revoked." : `Asset ${type === "transfer" ? "transferred" : "allocated"}.`);
      setAction(null); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Action failed"); }
    finally { setActing(false); }
  }

  async function saveNote() {
    if (!noteFor || noteText.trim().length < 1) { toast.warning("Enter a note."); return; }
    try { await addAssetNote(noteFor.id, noteText.trim()); toast.success("Note added."); setNoteFor(null); setNoteText(""); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not add note"); }
  }

  async function openHistory(a: Asset) {
    try { const d = await getAssetHistory(a.id); setHistory({ asset: a, rows: d.history }); }
    catch { toast.error("Could not load tracker"); }
  }

  const columns: Column<Asset>[] = [
    { key: "asset_code", header: "Code", render: (a) => <span className="font-mono text-xs text-slate-500">{a.asset_code || "—"}</span> },
    { key: "name", header: "Asset", render: (a) => <div><div className="font-medium text-slate-800">{a.name}</div><div className="text-[11px] text-slate-400">{a.asset_group || a.series_model || "—"}</div></div> },
    { key: "quantity", header: "Qty", render: (a) => <span className="text-slate-600">{a.quantity}{a.unit ? ` ${a.unit}` : ""}</span> },
    { key: "value", header: "Value", render: (a) => <span className="text-slate-600">{assetVal(a) ? fmtMoney(assetVal(a)) : "—"}</span> },
    { key: "allocated", header: "Allocated to", render: (a) => a.allocated_to ? <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">{a.allocated_to}</span> : <span className="text-slate-400">—</span> },
    { key: "status", header: "Status", render: (a) => <Badge value={a.status} /> },
  ];

  const rowActions = (a: Asset) => [
    ...(a.allocated_to_id
      ? [
          { label: "Transfer", icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 7h16M4 7l4-4M4 7l4 4M20 17H4M20 17l-4-4M20 17l-4 4" strokeLinecap="round" strokeLinejoin="round" /></svg>, onClick: () => openAction("transfer", a) },
          { label: "Revoke", icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" /></svg>, onClick: () => openAction("revoke", a) },
        ]
      : [{ label: "Allocate", icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 11l2 2 4-4M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2" strokeLinecap="round" strokeLinejoin="round" /></svg>, onClick: () => openAction("allocate", a) }]),
    { label: "Add note", icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 5h6M11 9h6M5 5h.01M5 9h.01M5 13h.01M11 13h6M5 17h.01M11 17h6" strokeLinecap="round" /></svg>, onClick: () => { setNoteFor(a); setNoteText(""); } },
  ];

  return (
    <>
      <PageHeader
        title="Asset Management"
        subtitle="Track, value, allocate and audit every company asset"
        action={
          <div className="flex items-center gap-2">
            {canManageFields && (
              <button onClick={() => setSetupOpen(true)} title="Configure asset form fields" className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10.3 4.3a2 2 0 013.4 0l.5.9 1-.2a2 2 0 012.4 2.4l-.2 1 .9.5a2 2 0 010 3.4l-.9.5.2 1a2 2 0 01-2.4 2.4l-1-.2-.5.9a2 2 0 01-3.4 0l-.5-.9-1 .2a2 2 0 01-2.4-2.4l.2-1-.9-.5a2 2 0 010-3.4l.9-.5-.2-1a2 2 0 012.4-2.4l1 .2z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" /></svg>
                Form setup
              </button>
            )}
            {can("assets", "create") && <button onClick={() => { setErrors({}); setDraft({ ...blank, custom: {} }); }} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"><svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>Add asset</button>}
          </div>
        }
      />

      {assets === null ? (
        <div className="space-y-5">
          <SkeletonStats count={4} />
          <SkeletonBlock className="h-96" />
        </div>
      ) : (
        <div className={`space-y-5 ${filterRailPad(filterOpen)}`}>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard label="Total assets" value={String(stats.total)} tone="slate" icon="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-14L4 7m8 4v10M4 7v10l8 4" />
            <StatCard label="Portfolio value" value={fmtMoney(stats.value)} tone="emerald" icon="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            <StatCard label="Allocated" value={String(stats.allocated)} tone="indigo" icon="M16 11l2 2 4-4M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2" />
            <StatCard label="Available" value={String(stats.available)} tone="sky" icon="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            <StatCard label="Warranty <60d" value={String(stats.expiring)} tone="amber" icon="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
          </div>

          {/* Charts + warranty watch */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <h3 className="mb-4 font-semibold text-slate-900">Status mix</h3>
              {statusData.length ? <DonutChart data={statusData} size={170} /> : <p className="py-10 text-center text-sm text-slate-400">No data yet</p>}
            </Card>
            <Card>
              <h3 className="mb-4 font-semibold text-slate-900">Value by group</h3>
              {groupData.length ? <BarChart data={groupData} color="#10b981" height={190} /> : <p className="py-10 text-center text-sm text-slate-400">No data yet</p>}
            </Card>
            <Card>
              <h3 className="mb-3 font-semibold text-slate-900">Warranty watch</h3>
              {warrantyWatch.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400">No warranties expiring soon</p>
              ) : (
                <ul className="space-y-2.5">
                  {warrantyWatch.map(({ a, days }) => (
                    <li key={a.id}>
                      <button onClick={() => openHistory(a)} className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left hover:bg-slate-50">
                        <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold ${days < 0 ? "bg-rose-100 text-rose-600" : days <= 30 ? "bg-amber-100 text-amber-600" : "bg-slate-100 text-slate-500"}`}>
                          {days < 0 ? "!" : `${days}d`}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-800">{a.name}</span>
                          <span className="block text-[11px] text-slate-400">{days < 0 ? "Expired" : "Expires"} {a.asset_code ? `· ${a.asset_code}` : ""}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-56 flex-1">
              <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
              <input value={query} onChange={(e) => { setQuery(e.target.value); resetPaging(); }} placeholder="Search assets, code, group, holder…" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/15" />
            </div>
            <FilterToggle open={filterOpen} count={appliedFilterCount} onClick={() => { if (!filterOpen) setFilters(applied); setFilterOpen((o) => !o); }} />
            {(assetFiltersActive(applied) || query.trim()) && (
              <button onClick={clearFilters} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Clear</button>
            )}
            <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
              <ViewBtn active={view === "grid"} onClick={() => setView("grid")} icon="M4 4h7v7H4zM13 4h7v7h-7zM13 13h7v7h-7zM4 13h7v7H4z" />
              <ViewBtn active={view === "table"} onClick={() => setView("table")} icon="M3 6h18M3 12h18M3 18h18" />
            </div>
          </div>

          {/* List */}
          {view === "table" ? (
            <DataTable
              tableKey="assets"
              canRenameColumns={isAdmin}
              columns={columns}
              rows={pageRows}
              getKey={(a) => a.id}
              loading={false}
              emptyTitle="No assets"
              emptyHint="Add your first company asset."
              onRowClick={(a) => openHistory(a)}
              page={page}
              totalPages={totalPages}
              onPage={setPage}
              total={visible.length}
              pageSize={perPage}
              onPageSize={(n) => { setPerPage(n); setPage(1); }}
              quickActions={(a) => (
                <>
                  <IconButton title="Tracker log" onClick={() => openHistory(a)}>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </IconButton>
                  {can("assets", "update") && (
                    <IconButton title="Edit" onClick={() => setDraft(toDraft(a))}>
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </IconButton>
                  )}
                  {can("assets", "delete") && (
                    <IconButton title="Delete" danger onClick={() => remove(a)}>
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </IconButton>
                  )}
                </>
              )}
              rowActions={rowActions}
            />
          ) : visible.length === 0 ? (
            <Card><p className="py-12 text-center text-sm text-slate-400">{list.length === 0 ? "Add your first company asset." : "No assets match your search."}</p></Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {cardRows.map((a) => (
                <div key={a.id} className="group relative flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <div className="mb-3 flex items-start justify-between">
                    <span className="font-mono text-[11px] text-slate-400">{a.asset_code || "—"}</span>
                    <Badge value={a.status} />
                  </div>
                  <button onClick={() => openHistory(a)} className="flex items-start gap-3 text-left">
                    <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-white" style={{ background: statusHex(a.status) }}>
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-14L4 7m8 4v10M4 7v10l8 4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-slate-900">{a.name}</span>
                      <span className="block truncate text-xs text-slate-400">{a.asset_group || a.series_model || "—"}</span>
                    </span>
                  </button>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                      <div className="text-slate-400">Qty</div>
                      <div className="font-semibold text-slate-700">{a.quantity}{a.unit ? ` ${a.unit}` : ""}</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                      <div className="text-slate-400">Value</div>
                      <div className="font-semibold text-slate-700">{assetVal(a) ? fmtMoney(assetVal(a)) : "—"}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2 text-xs">
                    {a.allocated_to ? (
                      <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 font-medium text-emerald-700">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-200 text-[10px] text-emerald-800">{a.allocated_to.slice(0, 1).toUpperCase()}</span>
                        {a.allocated_to}
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-500">Unassigned</span>
                    )}
                    {a.managed_by_name && <span className="truncate text-slate-400">· mgr {a.managed_by_name}</span>}
                  </div>

                  <div className="mt-3 flex items-center gap-1 border-t border-slate-100 pt-3">
                    {a.allocated_to_id ? (
                      <>
                        <CardBtn title="Transfer" onClick={() => openAction("transfer", a)} icon="M4 7h16M4 7l4-4M4 7l4 4M20 17H4M20 17l-4-4M20 17l-4 4" />
                        <CardBtn title="Revoke" onClick={() => openAction("revoke", a)} icon="M18 6L6 18M6 6l12 12" />
                      </>
                    ) : (
                      <CardBtn title="Allocate" onClick={() => openAction("allocate", a)} icon="M16 11l2 2 4-4M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2" />
                    )}
                    <CardBtn title="Tracker" onClick={() => openHistory(a)} icon="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    <CardBtn title="Note" onClick={() => { setNoteFor(a); setNoteText(""); }} icon="M11 5h6M11 9h6M5 5h.01M5 9h.01M5 13h.01M11 13h6M5 17h.01M11 17h6" />
                    {can("assets", "update") && <CardBtn title="Edit" onClick={() => setDraft(toDraft(a))} icon="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" />}
                    {can("assets", "delete") && <CardBtn title="Delete" danger onClick={() => remove(a)} icon="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" />}
                  </div>
                </div>
              ))}
              {/* Infinite-scroll sentinel + status */}
              <div ref={sentinel} className="col-span-full">
                {moreCards ? (
                  <div className="flex items-center justify-center gap-2 py-4 text-sm text-slate-400">
                    <svg className="h-4 w-4 animate-spin text-emerald-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>
                    Loading more…
                  </div>
                ) : (
                  visible.length > CARD_BATCH && <p className="py-4 text-center text-xs text-slate-400">Showing all {visible.length} assets.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- Filters panel (status / group / allocation / managed by / location) ---- */}
      <FilterRail
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        dirty={draftDirty}
        onReset={() => setFilters(BLANK_ASSET_FILTERS)}
        resetDisabled={!assetFiltersActive(filters)}
        onApply={applyFilters}
        applyDisabled={!draftDirty}
      >
        <div className="space-y-1.5">
          <FilterLabel>Status</FilterLabel>
          <MultiSelect ariaLabel="Filter by status" value={filters.status} onChange={(v) => setFilter("status", v)} options={statusOptions} placeholder="Any status" searchPlaceholder="Search status…" />
        </div>
        <div className="space-y-1.5">
          <FilterLabel>Group</FilterLabel>
          <MultiSelect ariaLabel="Filter by group" value={filters.group} onChange={(v) => setFilter("group", v)} options={groupOptions} placeholder="Any group" searchPlaceholder="Search groups…" />
        </div>
        <div className="space-y-1.5">
          <FilterLabel>Allocation</FilterLabel>
          <MultiSelect ariaLabel="Filter by allocation" value={filters.allocation} onChange={(v) => setFilter("allocation", v)} options={ALLOCATION_OPTIONS} placeholder="Any" searchPlaceholder="Search…" />
        </div>
        <div className="space-y-1.5">
          <FilterLabel>Managed by</FilterLabel>
          <MultiSelect ariaLabel="Filter by manager" value={filters.managedBy} onChange={(v) => setFilter("managedBy", v)} options={managedByOptions} placeholder="Anyone" searchPlaceholder="Search people…" />
        </div>
        <div className="space-y-1.5">
          <FilterLabel>Location</FilterLabel>
          <MultiSelect ariaLabel="Filter by location" value={filters.location} onChange={(v) => setFilter("location", v)} options={locationOptions} placeholder="Any location" searchPlaceholder="Search locations…" />
        </div>
      </FilterRail>

      {/* Create / edit — right-side drawer */}
      <Drawer
        open={!!draft}
        onClose={() => !saving && setDraft(null)}
        title={draft?.id ? "Edit asset" : "Add asset"}
        subtitle={draft?.id ? "Update this asset's details" : "Add a company asset to track"}
        width="max-w-2xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setDraft(null)} disabled={saving} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
            <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
              {saving && <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>}
              {saving ? "Saving…" : draft?.id ? "Save changes" : "Save asset"}
            </button>
          </div>
        }
      >
        {draft && (
          <div className="space-y-6">
            <section>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Asset details</h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FieldRow label="Asset code"><input className={inputCls()} placeholder="Auto (AST-…)" value={draft.asset_code} onChange={(e) => set("asset_code")(e.target.value)} /></FieldRow>
                <FieldRow label="Asset name" required error={errors.name}><input className={inputCls()} placeholder="MacBook Pro 14” " value={draft.name} onChange={(e) => set("name")(e.target.value)} /></FieldRow>
                <FieldRow label="Quantity" required><input type="number" min="1" className={inputCls()} value={draft.quantity} onChange={(e) => set("quantity")(e.target.value)} /></FieldRow>
                <FieldRow label="Unit"><input className={inputCls()} placeholder="pcs / set" value={draft.unit} onChange={(e) => set("unit")(e.target.value)} /></FieldRow>
                <FieldRow label="Series / Model" required={reqAsset("series_model")} error={errors.series_model}><input className={inputCls()} value={draft.series_model} onChange={(e) => set("series_model")(e.target.value)} /></FieldRow>
                <FieldRow label="Asset group" required={reqAsset("asset_group")} error={errors.asset_group}><input className={inputCls()} value={draft.asset_group} onChange={(e) => set("asset_group")(e.target.value)} /></FieldRow>
                <FieldRow label="Managed by" required={reqAsset("managed_by")} error={errors.managed_by}>
                  <SearchSelect ariaLabel="Managed by" value={draft.managed_by} onChange={set("managed_by")} options={assigneeOpts} placeholder="— Select —" searchPlaceholder="Search team…" />
                </FieldRow>
                <FieldRow label="Asset location" required={reqAsset("asset_location")} error={errors.asset_location}><input className={inputCls()} value={draft.asset_location} onChange={(e) => set("asset_location")(e.target.value)} /></FieldRow>
                <FieldRow label="Date of purchase" required={reqAsset("purchase_date")} error={errors.purchase_date}><input type="date" className={inputCls()} value={draft.purchase_date} onChange={(e) => set("purchase_date")(e.target.value)} /></FieldRow>
                <FieldRow label="Warranty (months)" required={reqAsset("warranty_months")} error={errors.warranty_months}><input type="number" className={inputCls()} value={draft.warranty_months} onChange={(e) => set("warranty_months")(e.target.value)} /></FieldRow>
                <FieldRow label="Unit price" required={reqAsset("unit_price")} error={errors.unit_price}><input type="number" step="0.01" className={inputCls()} value={draft.unit_price} onChange={(e) => set("unit_price")(e.target.value)} /></FieldRow>
                <FieldRow label="Depreciation (months)"><input type="number" className={inputCls()} value={draft.depreciation_months} onChange={(e) => set("depreciation_months")(e.target.value)} /></FieldRow>
              </div>
            </section>

            <section>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Supplier</h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FieldRow label="Supplier name" required={reqAsset("supplier_name")} error={errors.supplier_name}><input className={inputCls()} value={draft.supplier_name} onChange={(e) => set("supplier_name")(e.target.value)} /></FieldRow>
                <FieldRow label="Supplier phone"><input className={inputCls()} value={draft.supplier_phone} onChange={(e) => set("supplier_phone")(e.target.value)} /></FieldRow>
                <FieldRow label="Supplier address" full><input className={inputCls()} value={draft.supplier_address} onChange={(e) => set("supplier_address")(e.target.value)} /></FieldRow>
              </div>
            </section>

            {/* Admin-defined custom fields */}
            {customFields.length > 0 && (
              <section>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Additional info</h4>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {customFields.map((f) => {
                    const ek = `custom_${f.key}`;
                    const val = draft.custom[f.key] ?? "";
                    return (
                      <FieldRow key={f.key} label={f.label} required={f.required} error={errors[ek]} full={f.type === "textarea"}>
                        {f.type === "textarea" ? (
                          <textarea value={val} onChange={(e) => setCustom(f.key, e.target.value)} rows={3} className={inputCls()} />
                        ) : f.type === "select" ? (
                          <SearchSelect ariaLabel={f.label} value={val} onChange={(v) => setCustom(f.key, v)} options={[{ value: "", label: "— Select —" }, ...f.options.map((o) => ({ value: o, label: o }))]} placeholder="— Select —" searchPlaceholder="Search…" />
                        ) : (
                          <input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} value={val} onChange={(e) => setCustom(f.key, e.target.value)} className={inputCls()} />
                        )}
                      </FieldRow>
                    );
                  })}
                </div>
              </section>
            )}

            <section>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Notes &amp; attachment</h4>
              <RichTextEditor key={`asset-desc-${draft.id ?? "new"}`} initialHTML={draft.description} onChange={(html) => set("description")(html)} placeholder="Description / notes…" minHeight={140} />
              <div className="mt-3 flex items-center gap-3">
                <button onClick={() => fileRef.current?.click()} disabled={uploading} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">{uploading ? "Uploading…" : "Attach file"}</button>
                <input ref={fileRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAttachment(e.target.files[0])} />
                {draft.attachment && <a href={`${API_URL}${draft.attachment}`} target="_blank" rel="noreferrer" className="text-sm text-emerald-600 hover:underline">View attachment</a>}
              </div>
            </section>
          </div>
        )}
      </Drawer>

      {/* Asset form setup (admin) — mandatory toggles + custom field builder */}
      <FieldSetupDrawer
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        title="Asset form fields"
        subtitle="Choose mandatory fields and build your own custom fields"
        requirableFields={ASSET_REQUIRABLE_FIELDS}
        required={requiredFields}
        customFields={customFields}
        onSave={saveAssetFieldSettings}
        onSaved={(req, custom) => { setRequiredFields(new Set(req)); setCustomFields(custom); }}
      />

      {/* Allocate / Transfer / Revoke */}
      <Modal open={!!action} onClose={() => setAction(null)} title={action ? `${action.type[0].toUpperCase()}${action.type.slice(1)} "${action.asset.name}"` : ""}>
        {action && (
          <div className="space-y-3">
            {action.type === "transfer" && action.asset.allocated_to && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">Currently with <b>{action.asset.allocated_to}</b></div>
            )}
            {action.type !== "revoke" && (
              <label className="text-sm"><span className="mb-1 block font-medium text-slate-600">{action.type === "transfer" ? "Transfer to" : "Assign to"} staff</span>
                <SearchSelect
                  ariaLabel="Select staff"
                  value={actStaff}
                  onChange={setActStaff}
                  options={[{ value: "", label: "— Select staff —" }, ...staff.filter((s) => s.id !== action.asset.allocated_to_id).map((s) => ({ value: String(s.id), label: s.name }))]}
                  placeholder="— Select staff —"
                  searchPlaceholder="Search team…"
                />
              </label>
            )}
            <textarea className={field} rows={2} placeholder="Notes (optional, tracked)" value={actNotes} onChange={(e) => setActNotes(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setAction(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={doAction} disabled={acting} className={`rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-60 ${action.type === "revoke" ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                {acting ? "Working…" : action.type === "revoke" ? "Revoke" : action.type === "transfer" ? "Transfer" : "Allocate"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Add note */}
      <Modal open={!!noteFor} onClose={() => setNoteFor(null)} title={`Add note — ${noteFor?.name ?? ""}`}>
        <div className="space-y-3">
          <textarea className={field} rows={4} placeholder="Write a note for the tracker…" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button onClick={() => setNoteFor(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={saveNote} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Add note</button>
          </div>
        </div>
      </Modal>

      {/* Detail + tracker timeline */}
      <Modal open={!!history} onClose={() => setHistory(null)} title={`Tracker — ${history?.asset.name ?? ""}`}>
        {history && (
          <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              <Fact label="Code" value={history.asset.asset_code || "—"} />
              <Fact label="Status" value={history.asset.status} />
              <Fact label="Value" value={assetVal(history.asset) ? fmtMoney(assetVal(history.asset)) : "—"} />
              <Fact label="Allocated to" value={history.asset.allocated_to || "Unassigned"} />
              <Fact label="Managed by" value={history.asset.managed_by_name || "—"} />
              <Fact label="Location" value={history.asset.asset_location || "—"} />
              <Fact label="Purchased" value={history.asset.purchase_date ? fmtDate(history.asset.purchase_date) : "—"} />
              <Fact label="Warranty ends" value={(() => { const e = warrantyExpiry(history.asset); return e ? fmtDate(e.toISOString()) : "—"; })()} />
              <Fact label="Group" value={history.asset.asset_group || "—"} />
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Activity tracker</h4>
              {history.rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">No activity yet.</p>
              ) : (
                <ol className="relative space-y-1 before:absolute before:left-[15px] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-slate-100">
                  {history.rows.map((r) => {
                    const m = logMeta[r.action] ?? logMeta.updated;
                    return (
                      <li key={r.id} className="relative flex items-start gap-3 rounded-xl p-2 transition hover:bg-slate-50">
                        <span className={`relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ring-4 ring-white ${m.color}`}>
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={m.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </span>
                        <div className="min-w-0 flex-1 pt-0.5">
                          <div className="text-sm font-medium text-slate-800">{m.label(r)}</div>
                          {r.note && <div className="mt-0.5 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600">{r.note}</div>}
                          <div className="mt-0.5 text-[11px] text-slate-400">{r.actor_name || "System"} · {timeAgo(r.created_at)}</div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- small parts

const toneClasses: Record<string, string> = {
  slate: "bg-slate-100 text-slate-600",
  emerald: "bg-emerald-100 text-emerald-600",
  indigo: "bg-indigo-100 text-indigo-600",
  sky: "bg-sky-100 text-sky-600",
  amber: "bg-amber-100 text-amber-600",
};
function StatCard({ label, value, icon, tone }: { label: string; value: string; icon: string; tone: keyof typeof toneClasses }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <span className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${toneClasses[tone]}`}>
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  );
}

function ViewBtn({ active, onClick, icon }: { active: boolean; onClick: () => void; icon: string }) {
  return (
    <button onClick={onClick} className={`flex h-8 w-8 items-center justify-center rounded-md transition ${active ? "bg-emerald-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

function CardBtn({ title, onClick, icon, danger }: { title: string; onClick: () => void; icon: string; danger?: boolean }) {
  return (
    <button onClick={onClick} title={title} className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${danger ? "text-slate-400 hover:bg-rose-50 hover:text-rose-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"}`}>
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="truncate font-medium capitalize text-slate-700">{value}</div>
    </div>
  );
}
