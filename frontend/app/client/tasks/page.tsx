"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addTaskComment,
  createTask,
  deleteTask,
  deleteTaskComment,
  getStaff,
  getTask,
  getTaskActivity,
  getTaskComments,
  getTasks,
  updateTask,
  type ClientActivity,
  type Staff,
  type Task,
  type TaskComment,
} from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";
import { ConfirmDialog, Drawer, PageHeader, fmtDate, fmtDateTime, timeAgo } from "../../admin/ui";
import { useClient } from "../ClientContext";

interface Draft {
  id?: number;
  title: string;
  description: string;
  assigned_to: string;
  start_date: string;
  due_date: string;
  priority: string;
  type: string;
  status: string;
}
const blank: Draft = { title: "", description: "", assigned_to: "", start_date: "", due_date: "", priority: "medium", type: "task", status: "open" };
const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

const priorityTone: Record<string, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-amber-500 text-white",
  high: "bg-red-500 text-white",
  urgent: "bg-red-600 text-white",
};

const TYPE_META: Record<string, { label: string; cls: string; icon: string }> = {
  feature: { label: "Feature", cls: "bg-indigo-50 text-indigo-600", icon: "M13 2L3 14h7l-1 8 10-12h-7z" },
  bug: { label: "Bug", cls: "bg-rose-50 text-rose-600", icon: "M9 7h6a3 3 0 013 3v4a6 6 0 01-12 0v-4a3 3 0 013-3zM3 13h3m12 0h3M4 8l2 1m14-1l-2 1M4 18l2-1m14 1l-2-1M12 7v13" },
  improvement: { label: "Improvement", cls: "bg-sky-50 text-sky-600", icon: "M12 3v3m0 12v3M5.6 5.6l2.1 2.1m8.6 8.6l2.1 2.1M3 12h3m12 0h3M5.6 18.4l2.1-2.1m8.6-8.6l2.1-2.1M12 8a4 4 0 100 8 4 4 0 000-8z" },
  task: { label: "Task", cls: "bg-slate-100 text-slate-600", icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" },
};
const typeMeta = (t: string) => TYPE_META[t] ?? TYPE_META.task;

const COLUMNS = [
  { key: "open", label: "Backlog", dot: "bg-slate-400", head: "bg-slate-100", count: "text-slate-500", active: "bg-slate-600" },
  { key: "in_progress", label: "In Progress", dot: "bg-indigo-500", head: "bg-indigo-50", count: "text-indigo-600", active: "bg-indigo-600" },
  { key: "in_review", label: "In Review", dot: "bg-amber-500", head: "bg-amber-50", count: "text-amber-600", active: "bg-amber-500" },
  { key: "done", label: "Done", dot: "bg-emerald-500", head: "bg-emerald-50", count: "text-emerald-600", active: "bg-emerald-600" },
] as const;

const ACTION_META: Record<string, { cls: string; icon: string }> = {
  created: { cls: "bg-emerald-100 text-emerald-600", icon: "M12 5v14M5 12h14" },
  updated: { cls: "bg-amber-100 text-amber-600", icon: "M4 12a8 8 0 018-8 8 8 0 017 4M20 12a8 8 0 01-8 8 8 8 0 01-7-4M16 4h4v4M8 20H4v-4" },
  comment: { cls: "bg-sky-100 text-sky-600", icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" },
  deleted: { cls: "bg-rose-100 text-rose-600", icon: "M6 7h12M9 7V5h6v2m-8 0 1 13h6l1-13" },
};
const actionMeta = (a: string) => ACTION_META[a] ?? { cls: "bg-slate-100 text-slate-500", icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" };

function isOverdue(t: Task) {
  return t.status !== "done" && !!t.due_date && t.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

function cardDue(t: Task) {
  if (!t.due_date) return null;
  const d = new Date(t.due_date.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return null;
  const text = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const today = new Date().toISOString().slice(0, 10);
  const iso = t.due_date.slice(0, 10);
  if (t.status !== "done" && iso < today) return { text, tone: "text-red-600" };
  if (t.status !== "done" && iso === today) return { text, tone: "text-amber-600" };
  return { text, tone: "text-slate-500" };
}

// Start→due progress + on-time status — drives the per-card and drawer time bar.
function timeBar(t: Task) {
  if (t.status === "done") {
    if (t.completed_at && t.due_date) {
      const onTime = t.completed_at.slice(0, 10) <= t.due_date.slice(0, 10);
      return { pct: 100, bar: onTime ? "bg-emerald-500" : "bg-amber-500", label: onTime ? "Completed on time" : "Completed late", tone: onTime ? "text-emerald-600" : "text-amber-600" };
    }
    return { pct: 100, bar: "bg-emerald-500", label: "Completed", tone: "text-emerald-600" };
  }
  if (!t.due_date) return null;
  const end = new Date(t.due_date.replace(" ", "T")).getTime();
  if (Number.isNaN(end)) return null;
  const startSrc = t.start_date || t.created_at;
  const start = startSrc ? new Date(startSrc.replace(" ", "T")).getTime() : end;
  const now = Date.now();
  const span = Math.max(end - start, 1);
  const pct = Math.min(100, Math.max(0, Math.round(((now - start) / span) * 100)));
  const day = 86_400_000;
  const daysLeft = Math.ceil((end - now) / day);
  if (daysLeft < 0) return { pct: 100, bar: "bg-red-500", label: `Overdue by ${Math.abs(daysLeft)}d`, tone: "text-red-600" };
  if (daysLeft === 0) return { pct, bar: "bg-amber-500", label: "Due today", tone: "text-amber-600" };
  if (daysLeft <= 2) return { pct, bar: "bg-amber-500", label: `${daysLeft}d left`, tone: "text-amber-600" };
  return { pct, bar: "bg-emerald-500", label: `${daysLeft}d left`, tone: "text-slate-500" };
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
}

export default function TasksPage() {
  const toast = useToast();
  const { refreshNotifications } = useClient();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete confirmation popup state.
  const [confirmDel, setConfirmDel] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Detail drawer state.
  const [detail, setDetail] = useState<Task | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [activity, setActivity] = useState<ClientActivity[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [posting, setPosting] = useState(false);

  const [view, setView] = useState<"board" | "list">("board");
  const [query, setQuery] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [listStatus, setListStatus] = useState<"all" | "open" | "in_progress" | "in_review" | "done" | "overdue">("all");
  const [dragId, setDragId] = useState<number | null>(null);

  function load() {
    getTasks().then((d) => setTasks(d.tasks)).catch(() => setTasks([]));
    getStaff().then((d) => setStaff(d.staff)).catch(() => {});
  }
  useEffect(load, []);

  const summary = useMemo(() => {
    const t = tasks ?? [];
    return {
      total: t.length,
      in_progress: t.filter((x) => x.status === "in_progress").length,
      high: t.filter((x) => x.priority === "high" || x.priority === "urgent").length,
      features: t.filter((x) => x.type === "feature").length,
      bugs: t.filter((x) => x.type === "bug").length,
    };
  }, [tasks]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (t: Task) =>
      (!q || t.title.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q)) &&
      (!assignee || String(t.assigned_to ?? "") === assignee) &&
      (!priority || t.priority === priority) &&
      (!typeFilter || t.type === typeFilter);
  }, [query, assignee, priority, typeFilter]);

  const filtered = useMemo(() => (tasks ?? []).filter(matches), [tasks, matches]);

  async function save() {
    if (!draft) return;
    if (draft.title.trim().length < 2) { toast.warning("Enter a task title."); return; }
    setSaving(true);
    try {
      const body = { title: draft.title, description: draft.description, assigned_to: draft.assigned_to ? Number(draft.assigned_to) : 0, start_date: draft.start_date, due_date: draft.due_date, priority: draft.priority, type: draft.type, status: draft.status };
      if (draft.id) { await updateTask(draft.id, body); toast.success("Task updated."); }
      else { await createTask(body); toast.success("Task created."); }
      setDraft(null);
      load();
      if (detail && draft.id === detail.id) refreshDetail(detail.id);
      refreshNotifications();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
    finally { setSaving(false); }
  }

  async function changeStatus(t: Task, status: string) {
    if (t.status === status) return;
    setTasks((list) => list!.map((x) => (x.id === t.id ? { ...x, status } : x)));
    setDetail((d) => (d && d.id === t.id ? { ...d, status } : d));
    try {
      await updateTask(t.id, { status });
      refreshNotifications();
      if (detail && detail.id === t.id) refreshDetail(t.id);
      else load();
    } catch { load(); }
  }

  // Open the confirmation popup; the actual delete runs in confirmDelete().
  function remove(t: Task) {
    setConfirmDel(t);
  }

  async function confirmDelete() {
    const t = confirmDel;
    if (!t) return;
    setDeleting(true);
    try {
      await deleteTask(t.id);
      toast.success("Task deleted.");
      setConfirmDel(null);
      setDetail((d) => (d && d.id === t.id ? null : d));
      load();
      refreshNotifications();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setDeleting(false);
    }
  }

  function editDraft(t: Task) {
    setDraft({ id: t.id, title: t.title, description: t.description ?? "", assigned_to: t.assigned_to ? String(t.assigned_to) : "", start_date: t.start_date ? t.start_date.slice(0, 10) : "", due_date: t.due_date ? t.due_date.slice(0, 10) : "", priority: t.priority, type: t.type || "task", status: t.status });
  }

  // ---- detail drawer ----
  function openDetail(t: Task) {
    setDetail(t);
    setComments([]);
    setActivity([]);
    setCommentDraft("");
    getTaskComments(t.id).then((d) => setComments(d.comments)).catch(() => {});
    getTaskActivity(t.id).then((d) => setActivity(d.activity)).catch(() => {});
  }
  function refreshDetail(id: number) {
    getTask(id).then((d) => setDetail(d.task)).catch(() => {});
    getTaskActivity(id).then((d) => setActivity(d.activity)).catch(() => {});
  }
  async function postComment() {
    if (!detail) return;
    const body = commentDraft.trim();
    if (!body) return;
    setPosting(true);
    try {
      const { comment } = await addTaskComment(detail.id, body);
      setComments((c) => [...c, comment]);
      setCommentDraft("");
      setTasks((list) => list?.map((x) => (x.id === detail.id ? { ...x, comment_count: (x.comment_count ?? 0) + 1 } : x)) ?? null);
      getTaskActivity(detail.id).then((d) => setActivity(d.activity)).catch(() => {});
      refreshNotifications();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not post comment"); }
    finally { setPosting(false); }
  }
  async function removeComment(c: TaskComment) {
    if (!detail) return;
    try {
      await deleteTaskComment(detail.id, c.id);
      setComments((list) => list.filter((x) => x.id !== c.id));
      setTasks((list) => list?.map((x) => (x.id === detail.id ? { ...x, comment_count: Math.max(0, (x.comment_count ?? 1) - 1) } : x)) ?? null);
    } catch { toast.error("Could not delete comment"); }
  }

  const stats = [
    { label: "Total Items", value: summary.total, tone: "text-slate-900" },
    { label: "High Priority", value: summary.high, tone: "text-red-600" },
    { label: "In Progress", value: summary.in_progress, tone: "text-amber-600" },
    { label: "Features", value: summary.features, tone: "text-indigo-600" },
    { label: "Bugs", value: summary.bugs, tone: "text-rose-600" },
  ];

  const detailTb = detail ? timeBar(detail) : null;

  return (
    <>
      <PageHeader
        title="Task Management"
        subtitle="Assign, track and complete work across your team"
        action={<button onClick={() => setDraft({ ...blank })} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"><svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>New task</button>}
      />

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{s.label}</div>
            <div className={`mt-1 text-3xl font-bold ${s.tone}`}>{s.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2">
          <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" strokeLinecap="round" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks" className="w-40 bg-transparent text-sm focus:outline-none" />
        </div>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none">
          <option value="">All assignees</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none">
          <option value="">All types</option>
          <option value="feature">Feature</option><option value="bug">Bug</option><option value="improvement">Improvement</option><option value="task">Task</option>
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none">
          <option value="">All priorities</option>
          <option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <div className="ml-auto flex rounded-lg border border-slate-300 bg-white p-0.5">
          {(["board", "list"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition ${view === v ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{v}</button>
          ))}
        </div>
      </div>

      {tasks === null ? (
        <div className="py-20 text-center text-slate-400">Loading…</div>
      ) : view === "board" ? (
        <>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
            Board View
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {COLUMNS.map((col) => {
              const items = filtered.filter((t) => t.status === col.key);
              return (
                <div
                  key={col.key}
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={() => { const t = (tasks ?? []).find((x) => x.id === dragId); if (t) changeStatus(t, col.key); setDragId(null); }}
                  className="flex flex-col"
                >
                  <div className={`mb-3 flex items-center justify-between rounded-xl px-4 py-3 ${col.head}`}>
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${col.dot}`} />
                      <h3 className="text-sm font-bold text-slate-800">{col.label}</h3>
                    </div>
                    <span className={`text-sm font-semibold ${col.count}`}>{items.length}</span>
                  </div>
                  <div className="flex min-h-[80px] flex-col gap-3">
                    {items.map((t) => {
                      const due = cardDue(t);
                      const tm = typeMeta(t.type);
                      const tb = timeBar(t);
                      return (
                        <div
                          key={t.id}
                          draggable
                          onDragStart={() => setDragId(t.id)}
                          onDragEnd={() => setDragId(null)}
                          onClick={() => openDetail(t)}
                          className={`group cursor-pointer rounded-xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${isOverdue(t) ? "border-red-200" : "border-slate-200"}`}
                        >
                          <div className="mb-2 flex flex-wrap items-center gap-1.5">
                            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tm.cls}`}>
                              <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={tm.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
                              {tm.label}
                            </span>
                            <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize ${priorityTone[t.priority] ?? priorityTone.medium}`}>{t.priority}</span>
                          </div>
                          <h4 className={`text-[15px] font-semibold leading-snug ${t.status === "done" ? "text-slate-400 line-through" : "text-slate-900"}`}>{t.title}</h4>
                          {t.description && <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-slate-500">{t.description}</p>}
                          {tb && (
                            <div className="mt-3">
                              <div className="mb-1 flex items-center justify-between">
                                <span className="text-[11px] font-medium text-slate-400">Progress</span>
                                <span className={`text-[11px] font-semibold ${tb.tone}`}>{tb.label}</span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                                <div className={`h-full rounded-full ${tb.bar} transition-all`} style={{ width: `${tb.pct}%` }} />
                              </div>
                            </div>
                          )}
                          <div className="mt-3.5 flex items-center justify-between gap-2">
                            <div className="flex flex-shrink-0 items-center gap-3 text-slate-400">
                              {due && (
                                <span className={`flex items-center gap-1 text-[12px] font-medium ${due.tone}`}>
                                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" /></svg>
                                  {due.text}
                                </span>
                              )}
                              {!!t.comment_count && (
                                <span className="flex items-center gap-1 text-[12px] font-medium text-slate-400">
                                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  {t.comment_count}
                                </span>
                              )}
                            </div>
                            {t.assignee_name ? (
                              <span className="flex min-w-0 items-center gap-1.5" title={t.assignee_name}>
                                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-[11px] font-bold text-white">{initials(t.assignee_name)}</span>
                                <span className="max-w-[110px] truncate text-xs font-medium text-slate-600">{t.assignee_name}</span>
                              </span>
                            ) : (
                              <span className="flex min-w-0 items-center gap-1.5 text-slate-400">
                                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-[10px] font-medium">?</span>
                                <span className="text-xs">Unassigned</span>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {items.length === 0 && <div className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">Drop tasks here</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <ListView
          tasks={filtered}
          listStatus={listStatus}
          setListStatus={setListStatus}
          onOpen={openDetail}
          onToggle={(t) => changeStatus(t, t.status === "done" ? "open" : "done")}
          onDelete={remove}
        />
      )}

      {/* ---- Create / edit drawer ---- */}
      <Drawer
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit task" : "New task"}
        subtitle={draft?.id ? "Update the details of this task" : "Add a new item to your board"}
        width="max-w-lg"
        z="z-[55]"
        footer={draft ? (
          <div className="flex items-center justify-between gap-2">
            {draft.id ? (
              <button onClick={() => { const t = (tasks ?? []).find((x) => x.id === draft.id); if (t) { setDraft(null); remove(t); } }} className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">Delete</button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => setDraft(null)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={save} disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        ) : undefined}
      >
        {draft && (
          <div className="space-y-3">
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Task title *" className={field} />
            <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Description" rows={3} className={field} />
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm"><span className="mb-1 block font-medium text-slate-600">Type</span>
                <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} className={field}>
                  <option value="task">Task</option><option value="feature">Feature</option><option value="bug">Bug</option><option value="improvement">Improvement</option>
                </select>
              </label>
              <label className="text-sm"><span className="mb-1 block font-medium text-slate-600">Priority</span>
                <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} className={field}>
                  <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
                </select>
              </label>
              <label className="text-sm"><span className="mb-1 block font-medium text-slate-600">Start date</span>
                <input type="date" value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} className={field} />
              </label>
              <label className="text-sm"><span className="mb-1 block font-medium text-slate-600">Due date</span>
                <input type="date" value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} className={field} />
              </label>
              <label className="text-sm"><span className="mb-1 block font-medium text-slate-600">Assign to</span>
                <select value={draft.assigned_to} onChange={(e) => setDraft({ ...draft, assigned_to: e.target.value })} className={field}>
                  <option value="">Unassigned</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="text-sm"><span className="mb-1 block font-medium text-slate-600">Status</span>
                <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} className={field}>
                  <option value="open">Backlog</option><option value="in_progress">In Progress</option><option value="in_review">In Review</option><option value="done">Done</option>
                </select>
              </label>
            </div>
          </div>
        )}
      </Drawer>

      {/* ---- Task detail drawer ---- */}
      <Drawer
        open={!!detail}
        onClose={() => setDetail(null)}
        title="Task details"
        width="max-w-2xl"
        footer={detail ? (
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => remove(detail)} className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">Delete</button>
            <div className="flex gap-2">
              <button onClick={() => setDetail(null)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Close</button>
              <button onClick={() => editDraft(detail)} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Edit details</button>
            </div>
          </div>
        ) : undefined}
      >
        {detail && (
          <div className="space-y-6">
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${typeMeta(detail.type).cls}`}>
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={typeMeta(detail.type).icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
                  {typeMeta(detail.type).label}
                </span>
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize ${priorityTone[detail.priority] ?? priorityTone.medium}`}>{detail.priority}</span>
              </div>
              <h2 className="mt-2 text-xl font-bold text-slate-900">{detail.title}</h2>
              {detail.description && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-500">{detail.description}</p>}
            </div>

            {/* Stage stepper */}
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Stage</div>
              <div className="flex flex-wrap gap-1.5">
                {COLUMNS.map((c) => {
                  const active = detail.status === c.key;
                  return (
                    <button key={c.key} onClick={() => changeStatus(detail, c.key)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? `${c.active} text-white` : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Time bar */}
            {detailTb && (
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Timeline</span>
                  <span className={`text-sm font-semibold ${detailTb.tone}`}>{detailTb.label}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${detailTb.bar} transition-all`} style={{ width: `${detailTb.pct}%` }} />
                </div>
              </div>
            )}

            {/* Meta */}
            <dl className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 text-sm">
              <div><dt className="text-slate-400">Start date</dt><dd className="mt-0.5 font-medium text-slate-800">{detail.start_date ? fmtDate(detail.start_date) : "—"}</dd></div>
              <div><dt className="text-slate-400">Due date</dt><dd className={`mt-0.5 font-medium ${isOverdue(detail) ? "text-red-600" : "text-slate-800"}`}>{detail.due_date ? fmtDate(detail.due_date) : "—"}</dd></div>
              <div><dt className="text-slate-400">Assignee</dt><dd className="mt-0.5 font-medium text-slate-800">{detail.assignee_name || "Unassigned"}</dd></div>
              <div><dt className="text-slate-400">Created</dt><dd className="mt-0.5 font-medium text-slate-800">{fmtDate(detail.created_at)}</dd></div>
              <div><dt className="text-slate-400">Created by</dt><dd className="mt-0.5 font-medium text-slate-800">{detail.created_by_name || "—"}</dd></div>
              <div className="col-span-2"><dt className="text-slate-400">Last updated by</dt><dd className="mt-0.5 font-medium text-slate-800">{detail.updated_by_name || "—"}</dd></div>
              {detail.status === "done" && detail.completed_at && (
                <div className="col-span-2"><dt className="text-slate-400">Completed</dt><dd className="mt-0.5 font-medium text-slate-800">{fmtDateTime(detail.completed_at)}
                  {detail.due_date && (
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${detail.completed_at.slice(0, 10) <= detail.due_date.slice(0, 10) ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
                      {detail.completed_at.slice(0, 10) <= detail.due_date.slice(0, 10) ? "On time" : "Late"}
                    </span>
                  )}
                </dd></div>
              )}
            </dl>

            {/* Comments */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Comments <span className="text-slate-400">({comments.length})</span></h3>
              <div className="space-y-3">
                {comments.length === 0 && <p className="text-sm text-slate-400">No comments yet. Start the discussion below.</p>}
                {comments.map((c) => (
                  <div key={c.id} className="group flex gap-3">
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-500 to-slate-700 text-[11px] font-bold text-white">{initials(c.author_name || "?")}</span>
                    <div className="min-w-0 flex-1 rounded-xl bg-slate-50 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-800">{c.author_name || "Member"}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-400" title={fmtDateTime(c.created_at)}>{timeAgo(c.created_at)}</span>
                          <button onClick={() => removeComment(c)} className="text-slate-300 opacity-0 transition hover:text-red-500 group-hover:opacity-100" title="Delete">
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" /></svg>
                          </button>
                        </span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-600">{c.body}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-end gap-2">
                <textarea
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); postComment(); } }}
                  rows={1}
                  placeholder="Write a comment…  (⌘/Ctrl + Enter to send)"
                  className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
                />
                <button onClick={postComment} disabled={posting || !commentDraft.trim()} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{posting ? "…" : "Post"}</button>
              </div>
            </section>

            {/* Activity timeline */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Activity</h3>
              {activity.length === 0 ? (
                <p className="text-sm text-slate-400">No activity recorded yet.</p>
              ) : (
                <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-slate-200">
                  {activity.map((a) => {
                    const m = actionMeta(a.action);
                    return (
                      <li key={a.id} className="relative flex gap-3">
                        <span className={`relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ring-4 ring-white ${m.cls}`}>
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={m.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </span>
                        <div className="min-w-0 flex-1 pt-0.5">
                          <div className="text-sm font-medium text-slate-700 first-letter:uppercase">{a.description || a.action}</div>
                          <div className="text-xs text-slate-400">{a.actor_name || "System"} · <span title={fmtDateTime(a.created_at)}>{timeAgo(a.created_at)}</span></div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
        )}
      </Drawer>

      {/* ---- Delete confirmation popup ---- */}
      <ConfirmDialog
        open={!!confirmDel}
        title="Delete task?"
        message={
          <>
            <b className="text-slate-800">“{confirmDel?.title}”</b> will be removed from your task list.
            It’s kept for audit and can be restored by an administrator.
          </>
        }
        confirmLabel="Delete task"
        busy={deleting}
        onConfirm={confirmDelete}
        onClose={() => !deleting && setConfirmDel(null)}
      />
    </>
  );
}

function ListView({
  tasks, listStatus, setListStatus, onOpen, onToggle, onDelete,
}: {
  tasks: Task[];
  listStatus: "all" | "open" | "in_progress" | "in_review" | "done" | "overdue";
  setListStatus: (v: "all" | "open" | "in_progress" | "in_review" | "done" | "overdue") => void;
  onOpen: (t: Task) => void;
  onToggle: (t: Task) => void;
  onDelete: (t: Task) => void;
}) {
  const tabs = [
    { key: "all" as const, label: "All" },
    { key: "open" as const, label: "Backlog" },
    { key: "in_progress" as const, label: "In Progress" },
    { key: "in_review" as const, label: "In Review" },
    { key: "done" as const, label: "Done" },
    { key: "overdue" as const, label: "Overdue" },
  ];
  const rows = tasks.filter((t) => listStatus === "all" ? true : listStatus === "overdue" ? isOverdue(t) : t.status === listStatus);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap gap-1 border-b border-slate-100 p-2">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setListStatus(t.key)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${listStatus === t.key ? "bg-emerald-50 text-emerald-700" : "text-slate-500 hover:bg-slate-100"}`}>{t.label}</button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-400">No tasks here</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((t) => {
            const due = cardDue(t);
            const tm = typeMeta(t.type);
            return (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <button onClick={() => onToggle(t)} className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ${t.status === "done" ? "border-emerald-500 bg-emerald-500" : "border-slate-300"}`} aria-label="Toggle done">
                  {t.status === "done" && <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </button>
                <button onClick={() => onOpen(t)} className="min-w-0 flex-1 text-left">
                  <span className={`block truncate text-sm font-medium ${t.status === "done" ? "text-slate-400 line-through" : "text-slate-800"}`}>{t.title}</span>
                  <span className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="capitalize">{t.assignee_name || "Unassigned"}</span>
                    {due && <><span>·</span><span className={due.tone}>{due.text}</span></>}
                    {!!t.comment_count && <><span>·</span><span>{t.comment_count} 💬</span></>}
                  </span>
                </button>
                <span className={`hidden rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase sm:inline ${tm.cls}`}>{tm.label}</span>
                <span className={`hidden rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize sm:inline ${priorityTone[t.priority] ?? priorityTone.medium}`}>{t.priority}</span>
                <button onClick={() => onDelete(t)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" aria-label="Delete">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
