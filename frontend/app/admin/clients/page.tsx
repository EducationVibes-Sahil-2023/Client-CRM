"use client";

import { useEffect, useMemo, useState } from "react";
import { adminGet, adminPost, deleteClient, type Client } from "../../lib/admin";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import { Badge, Drawer, PageHeader, ValidityBadge, fmtDate } from "../ui";
import CreateClientModal from "./CreateClientModal";
import EditClientModal from "./EditClientModal";
import {
  Avatar,
  AvatarCell,
  DataTable,
  DotLabel,
  EntityCard,
  IconButton,
  RowMenu,
  ViewToggle,
  type Column,
  type DataView,
  type RowAction,
} from "../DataTable";

const planColor: Record<string, string> = { starter: "slate", growth: "indigo", enterprise: "violet" };
const PER_PAGE = 8;

// Status pill with a leading icon, echoing the reference contacts design.
const statusMeta: Record<string, { tone: string; icon: string }> = {
  active: { tone: "bg-emerald-50 text-emerald-600 ring-emerald-100", icon: "M5 13l4 4L19 7" },
  trial: { tone: "bg-sky-50 text-sky-600 ring-sky-100", icon: "M8 5v14l11-7z" },
  suspended: { tone: "bg-rose-50 text-rose-600 ring-rose-100", icon: "M10 9v6m4-6v6M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  inactive: { tone: "bg-slate-100 text-slate-500 ring-slate-200", icon: "M18 12H6" },
};
function StatusPill({ value }: { value: string }) {
  const m = statusMeta[value] ?? statusMeta.inactive;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ${m.tone}`}>
      <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={m.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
      {value || "active"}
    </span>
  );
}

function StatCard({ label, value, trend, icon, tone }: { label: string; value: string | number; trend: string; icon: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <button className="text-slate-300 hover:text-slate-400"><svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20"><path d="M6 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm5.5 0a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm4 1.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" /></svg></button>
      </div>
      <div className="mt-3 text-3xl font-bold text-slate-900">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">{label}
        <span className="inline-flex items-center gap-0.5 font-medium text-emerald-600">
          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 15l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>{trend}
        </span>
      </div>
    </div>
  );
}

export default function ClientsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "active" | "trial">("all");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "created_at", dir: "desc" });
  const [page, setPage] = useState(1);
  const [view, setView] = useState<DataView>("list");
  const [selected, setSelected] = useState<Client | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);

  function applyUpdate(updated: Client) {
    setClients((list) => list.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)));
    setSelected((s) => (s && s.id === updated.id ? { ...s, ...updated } : s));
  }

  function load() {
    setLoading(true);
    adminGet<{ clients: Client[] }>("/clients")
      .then((d) => setClients(d.clients))
      .catch(() => setClients([]))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const filtered = useMemo(() => {
    let r = clients;
    if (tab !== "all") r = r.filter((c) => c.status === tab);
    if (q) r = r.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || (c.email ?? "").toLowerCase().includes(q.toLowerCase()));
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...r].sort((a, b) => {
      const av = String((a as unknown as Record<string, unknown>)[sort.key] ?? "");
      const bv = String((b as unknown as Record<string, unknown>)[sort.key] ?? "");
      return av.localeCompare(bv) * dir;
    });
  }, [clients, tab, q, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  function onSort(key: string) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  async function setStatus(c: Client, status: string) {
    try {
      await adminPost(`/clients/${c.id}/status`, { status });
      setClients((list) => list.map((x) => (x.id === c.id ? { ...x, status } : x)));
      toast.success(`${c.name} marked ${status}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update");
    }
  }

  async function remove(c: Client) {
    const ok = await confirm({
      danger: true,
      title: `Delete ${c.name}?`,
      message: (
        <>
          This archives <b>{c.name}</b> and hides it from your clients. Its database and login accounts are kept, so it can be restored later. No data is destroyed.
        </>
      ),
      confirmLabel: "Yes, delete",
      cancelLabel: "No, keep it",
    });
    if (!ok) return;
    try {
      await deleteClient(c.id);
      setClients((list) => list.filter((x) => x.id !== c.id));
      setSelected((s) => (s && s.id === c.id ? null : s));
      toast.success(`${c.name} deleted.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  function exportCsv() {
    const head = ["Company", "Email", "Plan", "Status", "Joined"];
    const lines = filtered.map((c) => [c.name, c.email ?? "", c.plan, c.status, c.created_at].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "clients.csv"; a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported to CSV.");
  }

  const stats = {
    total: clients.length,
    active: clients.filter((c) => c.status === "active").length,
    paid: clients.filter((c) => c.plan === "growth" || c.plan === "enterprise").length,
  };

  const actions = (c: Client): RowAction<Client>[] => [
    { label: "Details", icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4m0-4h.01" strokeLinecap="round" /></svg>, onClick: () => setSelected(c) },
    { label: "Edit", icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>, onClick: () => setEditing(c) },
    c.status === "active"
      ? { label: "Suspend", icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9 9h6v6H9z" /></svg>, onClick: () => setStatus(c, "suspended") }
      : { label: "Activate", icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>, onClick: () => setStatus(c, "active") },
    { label: "Delete", danger: true, icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>, onClick: () => remove(c) },
  ];

  const columns: Column<Client>[] = [
    { key: "name", header: "Name", sortable: true, render: (c) => <AvatarCell name={c.name} /> },
    { key: "email", header: "Email", sortable: true, render: (c) => <span className="text-slate-600">{c.email || "—"}</span> },
    { key: "phone", header: "Phone", render: (c) => <span className="whitespace-nowrap text-slate-600">{c.phone || "—"}</span> },
    { key: "subdomain", header: "Workspace", render: (c) => <span className="text-slate-500">{c.subdomain || "—"}</span> },
    { key: "plan", header: "Plan", sortable: true, render: (c) => <DotLabel label={c.plan || "starter"} color={planColor[c.plan] ?? "slate"} /> },
    { key: "plan_start", header: "Plan start", sortable: true, render: (c) => <span className="whitespace-nowrap text-slate-500">{fmtDate(c.plan_start)}</span> },
    { key: "plan_end", header: "Plan end", sortable: true, render: (c) => <span className="whitespace-nowrap"><ValidityBadge start={c.plan_start} end={c.plan_end} /></span> },
    { key: "status", header: "Status", sortable: true, render: (c) => <StatusPill value={c.status || "active"} /> },
  ];

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="Tenant organizations on your platform"
        action={
          <div className="flex gap-2">
            <button onClick={exportCsv} className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Export CSV
            </button>
            <button onClick={() => setCreating(true)} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
              Create Client
            </button>
          </div>
        }
      />

      {/* Stat cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Total Clients" value={stats.total} trend="+12%" icon="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8z" tone="bg-indigo-100 text-indigo-600" />
        <StatCard label="Active" value={stats.active} trend="+8%" icon="M5 13l4 4L19 7" tone="bg-emerald-100 text-emerald-600" />
        <StatCard label="Paid plans" value={stats.paid} trend="+5%" icon="M3 10h18M3 6h18v12a2 2 0 01-2 2H5a2 2 0 01-2-2z" tone="bg-violet-100 text-violet-600" />
      </div>

      {/* Single toolbar: tabs on the left, search + view toggle on the right */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
          {(["all", "active", "trial"] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); setPage(1); }} className={`rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition ${tab === t ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-700"}`}>
              {t === "all" ? "All Clients" : t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search by name…" className="w-64 rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15" />
          </div>
          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={pageRows}
        getKey={(c) => c.id}
        loading={loading}
        emptyTitle="No clients"
        emptyHint="Onboard your first client to see it here."
        sort={sort}
        onSort={onSort}
        onRowClick={(c) => setSelected(c)}
        page={page}
        totalPages={totalPages}
        onPage={setPage}
        total={filtered.length}
        view={view}
        quickActions={(c) => (
          <>
            <IconButton title="View details" onClick={() => setSelected(c)}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" /></svg>
            </IconButton>
            <IconButton title="Edit" onClick={() => setEditing(c)}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </IconButton>
            {c.status === "active" ? (
              <IconButton title="Suspend" onClick={() => setStatus(c, "suspended")}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9 9h6v6H9z" /></svg>
              </IconButton>
            ) : (
              <IconButton title="Activate" onClick={() => setStatus(c, "active")}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </IconButton>
            )}
            <IconButton title="Delete" danger onClick={() => remove(c)}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </IconButton>
          </>
        )}
        card={(c) => (
          <EntityCard
            onClick={() => setSelected(c)}
            menu={<RowMenu actions={actions(c)} row={c} />}
            avatar={<Avatar name={c.name} size="lg" />}
            title={c.name}
            subtitle={c.email ?? "No email"}
            badge={<StatusPill value={c.status || "active"} />}
            footer={
              <div className="flex flex-col items-center gap-1">
                <span className="capitalize text-slate-500">{c.plan || "starter"} plan</span>
                <span className="flex items-center gap-1.5 font-medium text-slate-700">
                  <svg className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18" strokeLinecap="round" /></svg>
                  {c.subdomain || "—"}
                </span>
              </div>
            }
          />
        )}
      />

      <CreateClientModal open={creating} onClose={() => setCreating(false)} onCreated={load} />
      <EditClientModal client={editing} onClose={() => setEditing(null)} onSaved={applyUpdate} />

      <Drawer open={!!selected} onClose={() => setSelected(null)} title="Client details">
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-lg font-bold text-white">{selected.name.slice(0, 1).toUpperCase()}</span>
              <div>
                <div className="font-semibold text-slate-900">{selected.name}</div>
                <div className="text-sm text-slate-500">{selected.email || "No email"}</div>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 text-sm">
              <div><dt className="text-slate-400">Plan</dt><dd className="mt-1"><Badge value={selected.plan || "starter"} /></dd></div>
              <div><dt className="text-slate-400">Status</dt><dd className="mt-1"><Badge value={selected.status || "active"} /></dd></div>
              <div><dt className="text-slate-400">Phone</dt><dd className="font-medium text-slate-800">{selected.phone || "—"}</dd></div>
              <div><dt className="text-slate-400">Workspace</dt><dd className="font-medium text-slate-800">{selected.subdomain || "—"}</dd></div>
              <div><dt className="text-slate-400">Joined</dt><dd className="font-medium text-slate-800">{fmtDate(selected.created_at)}</dd></div>
            </dl>

            {/* Subscription window */}
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">Subscription</span>
                <ValidityBadge start={selected.plan_start} end={selected.plan_end} />
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><dt className="text-slate-400">Starts</dt><dd className="font-medium text-slate-800">{fmtDate(selected.plan_start)}</dd></div>
                <div><dt className="text-slate-400">Ends</dt><dd className="font-medium text-slate-800">{fmtDate(selected.plan_end)}</dd></div>
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={() => { setEditing(selected); setSelected(null); }} className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-indigo-700">Edit details</button>
              {selected.status === "active" ? (
                <button onClick={() => { setStatus(selected, "suspended"); }} className="flex-1 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50">Suspend</button>
              ) : (
                <button onClick={() => { setStatus(selected, "active"); }} className="flex-1 rounded-lg border border-emerald-200 px-4 py-2 text-sm font-medium text-emerald-600 hover:bg-emerald-50">Activate</button>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
