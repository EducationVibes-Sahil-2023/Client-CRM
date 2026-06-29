"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getDemoRequests,
  markNotificationRead,
  markDemoReplied,
  deleteDemoRequest,
  type DemoRequest,
  type Pagination,
} from "../../lib/admin";
import { useAdmin } from "../AdminContext";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import { Badge, Drawer, PageHeader, fmtDate } from "../ui";
import { AvatarCell, DataTable, IconButton, type Column } from "../DataTable";
import ReplyComposer, { type ReplyTarget } from "../ReplyComposer";

export default function DemoRequestsPage() {
  const { refreshNotifications } = useAdmin();
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<DemoRequest[]>([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<Pagination | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "created_at", dir: "desc" });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DemoRequest | null>(null);
  const [replyRow, setReplyRow] = useState<DemoRequest | null>(null);

  const replyTarget = (r: DemoRequest): ReplyTarget => ({ email: r.email, name: r.name, subject: `Re: your demo request${r.company ? ` — ${r.company}` : ""}` });

  async function markReplied(r: DemoRequest) {
    try {
      await markDemoReplied(r.id);
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, status: "replied" } : x)));
      setSelected((s) => (s && s.id === r.id ? { ...s, status: "replied" } : s));
      refreshNotifications();
    } catch { /* non-blocking */ }
  }

  async function remove(r: DemoRequest) {
    const ok = await confirm({
      danger: true,
      title: `Delete demo request from ${r.name}?`,
      message: <>This archives the demo request and hides it from the list. It can be restored later — nothing is permanently destroyed.</>,
      confirmLabel: "Yes, delete",
      cancelLabel: "No, keep it",
    });
    if (!ok) return;
    try {
      await deleteDemoRequest(r.id);
      setRows((rs) => rs.filter((x) => x.id !== r.id));
      setSelected((s) => (s && s.id === r.id ? null : s));
      refreshNotifications();
      toast.success("Demo request deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  const load = useCallback(() => {
    setLoading(true);
    getDemoRequests(`?page=${page}&per_page=8&q=${encodeURIComponent(q)}&sort=${sort.key}&dir=${sort.dir}`)
      .then((d) => { setRows(d.demo_requests); setMeta(d.pagination); })
      .finally(() => setLoading(false));
  }, [page, q, sort]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  function onSort(key: string) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  async function open(row: DemoRequest) {
    setSelected(row);
    if (row.status === "new") {
      await markNotificationRead({ type: "demo", id: row.id } as never);
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: "read" } : r)));
      refreshNotifications();
    }
  }

  const columns: Column<DemoRequest>[] = [
    { key: "name", header: "Name", sortable: true, render: (r) => (
      <div className="flex items-center gap-2">
        {r.status === "new" && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-indigo-500" />}
        <AvatarCell name={r.name} subtitle={r.email} />
      </div>
    ) },
    { key: "company", header: "Company", sortable: true, render: (r) => <span className="text-slate-600">{r.company || "—"}</span> },
    { key: "team_size", header: "Team", sortable: true, render: (r) => <span className="text-slate-600">{r.team_size || "—"}</span> },
    { key: "created_at", header: "Date", sortable: true, render: (r) => <span className="text-slate-500">{fmtDate(r.created_at)}</span> },
    { key: "status", header: "Status", sortable: true, render: (r) => <Badge value={r.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Demo Requests"
        subtitle="People who asked for a product demo"
        action={
          <div className="relative">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
            <input value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} placeholder="Search…" className="w-64 rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15" />
          </div>
        }
      />

      <DataTable
        columns={columns}
        rows={rows}
        getKey={(r) => r.id}
        loading={loading}
        emptyTitle="No demo requests"
        emptyHint="New requests will appear here."
        sort={sort}
        onSort={onSort}
        onRowClick={open}
        page={page}
        totalPages={meta?.total_pages ?? 1}
        onPage={setPage}
        total={meta?.total}
        quickActions={(r) => (
          <>
            <IconButton title="Reply" onClick={() => setReplyRow(r)}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 17l-5-5 5-5M4 12h11a4 4 0 014 4v2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </IconButton>
            <IconButton title="Delete" danger onClick={() => remove(r)}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </IconButton>
          </>
        )}
      />

      <Drawer open={!!selected} onClose={() => setSelected(null)} title="Demo request">
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-lg font-bold text-indigo-600">{selected.name.slice(0, 1).toUpperCase()}</span>
              <div>
                <div className="font-semibold text-slate-900">{selected.name}</div>
                <div className="text-sm text-slate-500">{selected.email}</div>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 text-sm">
              <div><dt className="text-slate-400">Company</dt><dd className="font-medium text-slate-800">{selected.company || "—"}</dd></div>
              <div><dt className="text-slate-400">Phone</dt><dd className="font-medium text-slate-800">{selected.phone || "—"}</dd></div>
              <div><dt className="text-slate-400">Team size</dt><dd className="font-medium text-slate-800">{selected.team_size || "—"}</dd></div>
              <div><dt className="text-slate-400">Submitted</dt><dd className="font-medium text-slate-800">{fmtDate(selected.created_at)}</dd></div>
            </dl>
            {selected.message && (
              <div>
                <div className="mb-1 text-sm font-medium text-slate-700">Message</div>
                <p className="rounded-xl border border-slate-200 p-3 text-sm text-slate-600">{selected.message}</p>
              </div>
            )}
            <button onClick={() => setReplyRow(selected)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white hover:bg-indigo-700">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 17l-5-5 5-5M4 12h11a4 4 0 014 4v2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Reply
            </button>
          </div>
        )}
      </Drawer>

      <ReplyComposer
        target={replyRow ? replyTarget(replyRow) : null}
        onClose={() => setReplyRow(null)}
        onSent={() => replyRow && markReplied(replyRow)}
      />
    </>
  );
}
