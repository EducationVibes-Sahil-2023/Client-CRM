"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getOfficeLocations,
  createOfficeLocation,
  updateOfficeLocation,
  deleteOfficeLocation,
  restoreOfficeLocation,
  type OfficeLocation,
  type WorkingHoursDay,
} from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import { useClient } from "../ClientContext";
import { Drawer, PageHeader } from "../../admin/ui";
import { DataTable, EntityCard, IconButton, type Column } from "../../admin/DataTable";
import HolidaysPanel from "./HolidaysPanel";
import ShiftsPanel from "./ShiftsPanel";

const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

// Weekly schedule: array index 0 = Sunday … 6 = Saturday. Displayed Mon→Sun.
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const defaultHours = (): WorkingHoursDay[] =>
  Array.from({ length: 7 }, (_, d) => ({ off: d === 0, open: "10:00", close: "19:00" }));
const summariseHours = (wh?: WorkingHoursDay[]): string => {
  if (!wh || wh.length !== 7) return "Not set";
  const on = DAY_ORDER.filter((d) => !wh[d].off);
  if (on.length === 0) return "Closed all week";
  return `${on.map((d) => DAY_LABELS[d]).join(", ")} · ${wh[on[0]].open}–${wh[on[0]].close}`;
};

interface Draft {
  id?: number;
  name: string;
  address: string;
  city: string;
  pincode: string;
  phone: string;
  latitude: string;
  longitude: string;
  map_url: string;
  working_hours: WorkingHoursDay[];
}
const blank: Draft = { name: "", address: "", city: "", pincode: "", phone: "", latitude: "", longitude: "", map_url: "", working_hours: defaultHours() };

function toDraft(o: OfficeLocation): Draft {
  return {
    id: o.id, name: o.name, address: o.address ?? "", city: o.city ?? "", pincode: o.pincode ?? "",
    phone: o.phone ?? "", latitude: o.latitude ?? "", longitude: o.longitude ?? "", map_url: o.map_url ?? "",
    working_hours: (o.working_hours && o.working_hours.length === 7) ? o.working_hours.map((h) => ({ ...h })) : defaultHours(),
  };
}

const OfficeIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/** Best Google Maps link for an office: explicit map_url, else coords, else address. */
function gmapsLink(o: { latitude?: string | null; longitude?: string | null; map_url?: string | null; address?: string | null; city?: string | null; pincode?: string | null }): string | null {
  if (o.map_url) return o.map_url;
  if (o.latitude && o.longitude) return `https://www.google.com/maps/search/?api=1&query=${o.latitude},${o.longitude}`;
  const q = [o.address, o.city, o.pincode].filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

export default function OfficeLocationsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { defaultPageSize, isAdmin, can } = useClient();
  const [offices, setOffices] = useState<OfficeLocation[] | null>(null);
  const [archived, setArchived] = useState<OfficeLocation[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<OfficeLocation | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"offices" | "shifts" | "holidays">("offices");

  const load = useCallback(() => {
    return getOfficeLocations()
      .then((d) => { setOffices(d.office_locations ?? []); setArchived(d.archived ?? []); })
      .catch(() => { setOffices([]); toast.error("Could not load office locations."); });
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const set = (k: keyof Draft) => (v: string) => setDraft((d) => d && { ...d, [k]: v });

  function useMyLocation() {
    if (!navigator.geolocation) { toast.warning("Geolocation isn't available in this browser."); return; }
    toast.info?.("Locating…");
    navigator.geolocation.getCurrentPosition(
      (pos) => setDraft((d) => d && { ...d, latitude: pos.coords.latitude.toFixed(7), longitude: pos.coords.longitude.toFixed(7) }),
      () => toast.error("Could not get your location."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function save() {
    if (!draft) return;
    if (draft.name.trim().length < 1) { toast.warning("Enter an office name."); return; }
    setSaving(true);
    try {
      const body = {
        name: draft.name, address: draft.address, city: draft.city, pincode: draft.pincode, phone: draft.phone,
        latitude: draft.latitude.trim() === "" ? null : draft.latitude.trim(),
        longitude: draft.longitude.trim() === "" ? null : draft.longitude.trim(),
        map_url: draft.map_url,
        working_hours: draft.working_hours,
      };
      if (draft.id) { await updateOfficeLocation(draft.id, body); toast.success("Office updated."); }
      else { await createOfficeLocation(body); toast.success("Office added."); }
      setDraft(null); await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
    finally { setSaving(false); }
  }

  async function remove(o: OfficeLocation) {
    const ok = await confirm({
      danger: true,
      title: `Archive ${o.name}?`,
      message: (
        <>
          This archives <b>{o.name}</b>{o.address ? <> — {o.address}{o.city ? `, ${o.city}` : ""}</> : null}. You can restore it
          anytime; no data is lost and staff assigned to it keep their history.
        </>
      ),
      confirmLabel: "Yes, archive",
      cancelLabel: "No, keep it",
    });
    if (!ok) return;
    try { await deleteOfficeLocation(o.id); toast.success("Office archived."); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not archive"); }
  }

  async function restore(o: OfficeLocation) {
    try { await restoreOfficeLocation(o.id); toast.success("Office restored."); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not restore"); }
  }

  const columns: Column<OfficeLocation>[] = [
    { key: "name", header: "Name", render: (o) => (
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><OfficeIcon className="h-4 w-4" /></span>
        <span className="font-semibold text-slate-800">{o.name}</span>
      </div>
    ) },
    { key: "address", header: "Address", render: (o) => <span className="text-slate-600">{o.address || "—"}</span> },
    { key: "city", header: "City", render: (o) => <span className="text-slate-600">{o.city || "—"}</span> },
    { key: "phone", header: "Phone", render: (o) => <span className="whitespace-nowrap text-slate-600">{o.phone || "—"}</span> },
    { key: "hours", header: "Working hours", render: (o) => <span className="text-xs text-slate-500">{summariseHours(o.working_hours)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Office Locations"
        subtitle="Offices, their weekly working hours, and the holiday calendar — used for first-response tracking."
        action={
          tab !== "offices" ? null :
          <div className="flex items-center gap-3">
            {archived.length > 0 && (
              <button onClick={() => setShowArchived((v) => !v)} className="text-sm font-medium text-slate-500 hover:text-slate-700">
                {showArchived ? "Hide" : "Show"} archived ({archived.length})
              </button>
            )}
            {can("team", "create") && (
              <button onClick={() => setDraft({ ...blank })} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>Add office
              </button>
            )}
          </div>
        }
      />

      <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1">
        {(["offices", "shifts", "holidays"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === t ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            {t === "offices" ? "Offices & hours" : t === "shifts" ? "Shifts" : "Holidays"}
          </button>
        ))}
      </div>

      {tab === "shifts" ? (
        <ShiftsPanel canCreate={can("team", "create")} canUpdate={can("team", "update")} canDelete={can("team", "delete")} />
      ) : tab === "holidays" ? (
        <HolidaysPanel offices={offices ?? []} canCreate={can("team", "create")} canUpdate={can("team", "update")} canDelete={can("team", "delete")} />
      ) : (
      <>
      <DataTable
        tableKey="office_locations"
        canRenameColumns={isAdmin}
        paginate
        defaultPageSize={defaultPageSize}
        columns={columns}
        rows={offices ?? []}
        getKey={(o) => o.id}
        loading={offices === null}
        emptyTitle="No office locations yet"
        emptyHint="Add your first office to assign staff to it."
        onRowClick={(o) => setSelected(o)}
        searchKeys={(o) => [o.name, o.address, o.city, o.phone]}
        searchPlaceholder="Search offices…"
        quickActions={(o) => (
          <>
            <IconButton title="View details" onClick={() => setSelected(o)}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" /></svg>
            </IconButton>
            {can("team", "update") && (
              <IconButton title="Edit" onClick={() => setDraft(toDraft(o))}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </IconButton>
            )}
            {can("team", "delete") && (
              <IconButton title="Archive" danger onClick={() => remove(o)}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </IconButton>
            )}
          </>
        )}
        card={(o) => (
          <EntityCard
            onClick={() => setSelected(o)}
            avatar={<span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white"><OfficeIcon className="h-7 w-7" /></span>}
            title={o.name}
            subtitle={o.city || o.address || "—"}
            footer={
              <div className="flex flex-col items-center gap-1 text-slate-500">
                {o.address && <span className="truncate">{o.address}</span>}
                {o.phone && <span className="font-medium text-slate-700">{o.phone}</span>}
              </div>
            }
          />
        )}
      />

      {showArchived && archived.length > 0 && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Archived</div>
          <ul className="divide-y divide-slate-100">
            {archived.map((o) => (
              <li key={o.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm text-slate-400 line-through">{o.name}{o.city ? ` · ${o.city}` : ""}</span>
                <button onClick={() => restore(o)} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8m0-5v5h5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      </>
      )}

      {/* Add / edit — right-side drawer */}
      <Drawer
        open={!!draft}
        onClose={() => !saving && setDraft(null)}
        title={draft?.id ? "Edit office" : "Add office"}
        subtitle={draft?.id ? "Update this office's details" : "Add an office or branch"}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setDraft(null)} disabled={saving} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
            <button onClick={save} disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? "Saving…" : draft?.id ? "Save changes" : "Add office"}</button>
          </div>
        }
      >
        {draft && (
          <div className="space-y-3">
            <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Name *</span>
              <input className={field} placeholder="e.g. Head Office" value={draft.name} onChange={(e) => set("name")(e.target.value)} autoFocus />
            </label>
            <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Address</span>
              <textarea className={field} rows={3} placeholder="Street, area…" value={draft.address} onChange={(e) => set("address")(e.target.value)} />
            </label>
            <div className="grid grid-cols-3 gap-3">
              <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">City</span>
                <input className={field} placeholder="City" value={draft.city} onChange={(e) => set("city")(e.target.value)} />
              </label>
              <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Pincode</span>
                <input className={field} placeholder="Pincode" value={draft.pincode} onChange={(e) => set("pincode")(e.target.value)} />
              </label>
              <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Phone</span>
                <input className={field} placeholder="Phone" value={draft.phone} onChange={(e) => set("phone")(e.target.value)} />
              </label>
            </div>

            <section className="rounded-xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Google location</h4>
                <button type="button" onClick={useMyLocation} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="10" r="2.5" /></svg>
                  Use current location
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Latitude</span>
                  <input className={field} inputMode="decimal" placeholder="e.g. 18.5204" value={draft.latitude} onChange={(e) => set("latitude")(e.target.value)} />
                </label>
                <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Longitude</span>
                  <input className={field} inputMode="decimal" placeholder="e.g. 73.8567" value={draft.longitude} onChange={(e) => set("longitude")(e.target.value)} />
                </label>
              </div>
              <label className="mt-3 block text-sm"><span className="mb-1 block font-medium text-slate-600">Google Maps link</span>
                <input className={field} placeholder="Paste a Google Maps URL (optional)" value={draft.map_url} onChange={(e) => set("map_url")(e.target.value)} />
              </label>
              {gmapsLink(draft) && (
                <a href={gmapsLink(draft)!} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:underline">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="10" r="2.5" /></svg>
                  Open in Google Maps
                </a>
              )}
            </section>

            {/* Weekly working hours — drives the first-response SLA. */}
            <section className="rounded-xl border border-slate-200 p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Working hours</h4>
              <div className="space-y-1.5">
                {DAY_ORDER.map((d) => {
                  const h = draft.working_hours[d];
                  const setDay = (patch: Partial<WorkingHoursDay>) =>
                    setDraft((dr) => dr && { ...dr, working_hours: dr.working_hours.map((x, i) => (i === d ? { ...x, ...patch } : x)) });
                  return (
                    <div key={d} className="flex items-center gap-2">
                      <span className="w-10 text-sm font-medium text-slate-600">{DAY_LABELS[d]}</span>
                      <label className="flex items-center gap-1.5 text-xs text-slate-500">
                        <input type="checkbox" checked={!h.off} onChange={(e) => setDay({ off: !e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                        Open
                      </label>
                      <input type="time" value={h.open} disabled={h.off} onChange={(e) => setDay({ open: e.target.value })} className={`${field} w-28 py-1 ${h.off ? "opacity-40" : ""}`} />
                      <span className="text-slate-400">–</span>
                      <input type="time" value={h.close} disabled={h.off} onChange={(e) => setDay({ close: e.target.value })} className={`${field} w-28 py-1 ${h.off ? "opacity-40" : ""}`} />
                      {h.off && <span className="text-xs font-medium text-slate-400">Weekly off</span>}
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">Uncheck a day to mark it a weekly off. First-response time is counted only within these hours (holidays excluded).</p>
            </section>
          </div>
        )}
      </Drawer>

      {/* View details — right-side drawer */}
      <Drawer open={!!selected} onClose={() => setSelected(null)} title="Office details" subtitle={selected?.city ?? undefined}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white"><OfficeIcon className="h-6 w-6" /></span>
              <div className="font-semibold text-slate-900">{selected.name}</div>
            </div>
            <dl className="grid grid-cols-1 gap-4 rounded-xl bg-slate-50 p-4 text-sm">
              <div><dt className="text-slate-400">Address</dt><dd className="mt-1 font-medium text-slate-800">{selected.address || "—"}</dd></div>
              <div className="grid grid-cols-3 gap-4">
                <div><dt className="text-slate-400">City</dt><dd className="mt-1 font-medium text-slate-800">{selected.city || "—"}</dd></div>
                <div><dt className="text-slate-400">Pincode</dt><dd className="mt-1 font-medium text-slate-800">{selected.pincode || "—"}</dd></div>
                <div><dt className="text-slate-400">Phone</dt><dd className="mt-1 font-medium text-slate-800">{selected.phone || "—"}</dd></div>
              </div>
              {(selected.latitude && selected.longitude) ? (
                <div><dt className="text-slate-400">Coordinates</dt><dd className="mt-1 font-medium text-slate-800">{selected.latitude}, {selected.longitude}</dd></div>
              ) : null}
            </dl>

            {(selected.latitude && selected.longitude) && (
              <iframe
                title="Map"
                className="h-48 w-full rounded-xl border border-slate-200"
                loading="lazy"
                src={`https://www.google.com/maps?q=${selected.latitude},${selected.longitude}&z=15&output=embed`}
              />
            )}

            {gmapsLink(selected) && (
              <a href={gmapsLink(selected)!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="10" r="2.5" /></svg>
                Open in Google Maps
              </a>
            )}
            <div className="flex gap-2">
              <button onClick={() => { const o = selected; setSelected(null); setDraft(toDraft(o)); }} className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-emerald-700">Edit details</button>
              <button onClick={() => { const o = selected; setSelected(null); remove(o); }} className="flex-1 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50">Archive</button>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
