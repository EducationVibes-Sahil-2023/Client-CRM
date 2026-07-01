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
  getTaskSetup,
  getTaskStages,
  createTaskStage,
  updateTaskStage,
  deleteTaskStage,
  reorderTaskStages,
  saveTaskFieldSettings,
  updateTask,
  TASK_REQUIRABLE_FIELDS,
  type ClientActivity,
  type Staff,
  type Task,
  type TaskComment,
  type TaskCustomField,
  type TaskStage,
} from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";
import { ConfirmDialog, Drawer, PageHeader, SkeletonBlock, fmtDate, fmtDateTime, timeAgo } from "../../admin/ui";
import { useClient } from "../ClientContext";
import { MultiSelect, SearchSelect, type SelectOption } from "../../admin/SearchSelect";
import { FieldSetupDrawer } from "../FieldSetupDrawer";
import RichTextEditor from "../../admin/RichTextEditor";
import { DateRangeFilter, inDateRange, rangeActive, EMPTY_RANGE, type DateRange } from "../../admin/dateFilter";
import { FilterRail, FilterToggle, FilterLabel, filterRailPad } from "../FilterRail";

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
  /** Values for admin-defined custom fields, keyed by field key. */
  custom: Record<string, string>;
}
const blank: Draft = { title: "", description: "", assigned_to: "", start_date: "", due_date: "", priority: "medium", type: "task", status: "open", custom: {} };

/** Plain-text from a rich-text HTML string (for previews + "is it empty" checks). */
const stripHtml = (h: string) => h.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

// Board columns are data-driven (admin-managed task stages). Each stage carries
// a named colour; these static class sets keep Tailwind's JIT happy (no string
// interpolation) while letting every stage pick its own tint.
interface StageClasses { dot: string; head: string; count: string; active: string; ring: string; swatch: string }
const STAGE_COLORS: Record<string, StageClasses> = {
  slate:   { dot: "bg-slate-400",   head: "bg-slate-100",   count: "text-slate-500",   active: "bg-slate-600",   ring: "ring-slate-400",   swatch: "bg-slate-500" },
  indigo:  { dot: "bg-indigo-500",  head: "bg-indigo-50",   count: "text-indigo-600",  active: "bg-indigo-600",  ring: "ring-indigo-400",  swatch: "bg-indigo-500" },
  violet:  { dot: "bg-violet-500",  head: "bg-violet-50",   count: "text-violet-600",  active: "bg-violet-600",  ring: "ring-violet-400",  swatch: "bg-violet-500" },
  amber:   { dot: "bg-amber-500",   head: "bg-amber-50",    count: "text-amber-600",   active: "bg-amber-500",   ring: "ring-amber-400",   swatch: "bg-amber-500" },
  emerald: { dot: "bg-emerald-500", head: "bg-emerald-50",  count: "text-emerald-600", active: "bg-emerald-600", ring: "ring-emerald-400", swatch: "bg-emerald-500" },
  teal:    { dot: "bg-teal-500",    head: "bg-teal-50",     count: "text-teal-600",    active: "bg-teal-600",    ring: "ring-teal-400",    swatch: "bg-teal-500" },
  sky:     { dot: "bg-sky-500",     head: "bg-sky-50",      count: "text-sky-600",     active: "bg-sky-600",     ring: "ring-sky-400",     swatch: "bg-sky-500" },
  rose:    { dot: "bg-rose-500",    head: "bg-rose-50",     count: "text-rose-600",    active: "bg-rose-600",    ring: "ring-rose-400",    swatch: "bg-rose-500" },
  pink:    { dot: "bg-pink-500",    head: "bg-pink-50",     count: "text-pink-600",    active: "bg-pink-600",    ring: "ring-pink-400",    swatch: "bg-pink-500" },
  orange:  { dot: "bg-orange-500",  head: "bg-orange-50",   count: "text-orange-600",  active: "bg-orange-600",  ring: "ring-orange-400",  swatch: "bg-orange-500" },
  lime:    { dot: "bg-lime-500",    head: "bg-lime-50",     count: "text-lime-600",    active: "bg-lime-600",    ring: "ring-lime-400",    swatch: "bg-lime-500" },
  cyan:    { dot: "bg-cyan-500",    head: "bg-cyan-50",     count: "text-cyan-600",    active: "bg-cyan-600",    ring: "ring-cyan-400",    swatch: "bg-cyan-500" },
};
const STAGE_PALETTE = Object.keys(STAGE_COLORS);
const stageClasses = (color: string): StageClasses => STAGE_COLORS[color] ?? STAGE_COLORS.slate;

// ---- Filters (a draft the user edits in the rail + the applied set that
// actually filters; synced on "Apply", mirroring the Announcements section). ----
interface TaskFilters {
  assignee: string[];
  type: string[];
  priority: string[];
  due: DateRange;
}
const BLANK_TASK_FILTERS: TaskFilters = { assignee: [], type: [], priority: [], due: EMPTY_RANGE };
const TYPE_OPTIONS: SelectOption[] = [
  { value: "feature", label: "Feature" },
  { value: "bug", label: "Bug" },
  { value: "improvement", label: "Improvement" },
  { value: "task", label: "Task" },
];
const PRIORITY_OPTIONS: SelectOption[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];
const taskFiltersActive = (f: TaskFilters): boolean =>
  f.assignee.length > 0 || f.type.length > 0 || f.priority.length > 0 || rangeActive(f.due);
const countTaskFilters = (f: TaskFilters): number =>
  [f.assignee.length, f.type.length, f.priority.length, rangeActive(f.due)].filter(Boolean).length;
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

/** A board column built from an admin-defined stage. */
interface StageColumn extends StageClasses { key: string; label: string; is_done: boolean }
const toColumns = (stages: TaskStage[]): StageColumn[] =>
  stages.map((s) => ({ key: s.key, label: s.name, is_done: s.is_done, ...stageClasses(s.color) }));

const ACTION_META: Record<string, { cls: string; icon: string }> = {
  created: { cls: "bg-emerald-100 text-emerald-600", icon: "M12 5v14M5 12h14" },
  updated: { cls: "bg-amber-100 text-amber-600", icon: "M4 12a8 8 0 018-8 8 8 0 017 4M20 12a8 8 0 01-8 8 8 8 0 01-7-4M16 4h4v4M8 20H4v-4" },
  comment: { cls: "bg-sky-100 text-sky-600", icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" },
  deleted: { cls: "bg-rose-100 text-rose-600", icon: "M6 7h12M9 7V5h6v2m-8 0 1 13h6l1-13" },
};
const actionMeta = (a: string) => ACTION_META[a] ?? { cls: "bg-slate-100 text-slate-500", icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" };

// A task is "done" when its stage is flagged done (defaults to the "done" key
// before stages load).
const isDoneTask = (t: Task, done: Set<string>) => done.has(t.status);

function isOverdue(t: Task, done: Set<string>) {
  return !isDoneTask(t, done) && !!t.due_date && t.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

function cardDue(t: Task, done: Set<string>) {
  if (!t.due_date) return null;
  const d = new Date(t.due_date.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return null;
  const text = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const today = new Date().toISOString().slice(0, 10);
  const iso = t.due_date.slice(0, 10);
  const open = !isDoneTask(t, done);
  if (open && iso < today) return { text, tone: "text-red-600" };
  if (open && iso === today) return { text, tone: "text-amber-600" };
  return { text, tone: "text-slate-500" };
}

// Start→due progress + on-time status — drives the per-card and drawer time bar.
function timeBar(t: Task, done: Set<string>) {
  if (isDoneTask(t, done)) {
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
  const { refreshNotifications, isAdmin, can } = useClient();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [stages, setStages] = useState<TaskStage[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Admin-managed kanban stages (board columns).
  const [stageMgrOpen, setStageMgrOpen] = useState(false);

  // Admin-configured form fields: which built-ins are mandatory + custom fields.
  const [requiredFields, setRequiredFields] = useState<Set<string>>(new Set());
  const [customFields, setCustomFields] = useState<TaskCustomField[]>([]);
  const [setupOpen, setSetupOpen] = useState(false);
  const canManageFields = isAdmin || can("tasks", "update");

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
  // Seed from a global-search deep link (?q=...) when present.
  const [query, setQuery] = useState(() => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("q") ?? "" : ""));
  // `filters` is the draft edited in the rail; `applied` is what filters the board/list.
  const [filters, setFilters] = useState<TaskFilters>(BLANK_TASK_FILTERS);
  const [applied, setApplied] = useState<TaskFilters>(BLANK_TASK_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const setFilter = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const [listStatus, setListStatus] = useState<string>("all");
  const [dragId, setDragId] = useState<number | null>(null);

  function load() {
    getTasks().then((d) => { setTasks(d.tasks); if (d.stages) setStages(d.stages); }).catch(() => setTasks([]));
    getStaff().then((d) => setStaff(d.staff)).catch(() => {});
  }
  function loadSetup() {
    getTaskSetup().then((d) => { setRequiredFields(new Set(d.required_fields ?? [])); setCustomFields(d.custom_fields ?? []); }).catch(() => {});
  }
  function reloadStages() {
    getTaskStages().then((d) => setStages(d.stages)).catch(() => {});
  }
  useEffect(() => { load(); loadSetup(); }, []);

  // Derived stage data: board columns, the set of "done" keys, and the keys
  // used to default a new task / toggle completion.
  const columns = useMemo(() => toColumns(stages), [stages]);
  const doneKeys = useMemo(() => new Set(stages.filter((s) => s.is_done).map((s) => s.key)), [stages]);
  const statusOptions = useMemo<SelectOption[]>(() => stages.map((s) => ({ value: s.key, label: s.name })), [stages]);
  const firstStageKey = stages[0]?.key ?? "open";
  const doneStageKey = stages.find((s) => s.is_done)?.key ?? "done";

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
      (applied.assignee.length === 0 || applied.assignee.includes(String(t.assigned_to ?? ""))) &&
      (applied.type.length === 0 || applied.type.includes(t.type)) &&
      (applied.priority.length === 0 || applied.priority.includes(t.priority)) &&
      inDateRange(t.due_date, applied.due);
  }, [query, applied]);

  const appliedFilterCount = useMemo(() => countTaskFilters(applied), [applied]);
  const draftDirty = useMemo(() => JSON.stringify(filters) !== JSON.stringify(applied), [filters, applied]);
  const assigneeOptions = useMemo<SelectOption[]>(() => staff.map((s) => ({ value: String(s.id), label: s.name })), [staff]);
  function applyFilters() { setApplied(filters); }
  function clearFilters() { setFilters(BLANK_TASK_FILTERS); setApplied(BLANK_TASK_FILTERS); setQuery(""); }

  const filtered = useMemo(() => (tasks ?? []).filter(matches), [tasks, matches]);

  // Validate the title + any admin-mandated built-in and custom fields.
  function validate(d: Draft): Record<string, string> {
    const e: Record<string, string> = {};
    if (d.title.trim().length < 2) e.title = "Task title is required (min 2 characters).";
    for (const f of TASK_REQUIRABLE_FIELDS) {
      const raw = String((d as unknown as Record<string, string>)[f.key] ?? "");
      const val = f.key === "description" ? stripHtml(raw) : raw.trim();
      if (requiredFields.has(f.key) && !val) e[f.key] = `${f.label} is required.`;
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
      const body = { title: draft.title, description: draft.description, assigned_to: draft.assigned_to ? Number(draft.assigned_to) : 0, start_date: draft.start_date, due_date: draft.due_date, priority: draft.priority, type: draft.type, status: draft.status, custom_fields: draft.custom };
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
    setErrors({});
    setDraft({ id: t.id, title: t.title, description: t.description ?? "", assigned_to: t.assigned_to ? String(t.assigned_to) : "", start_date: t.start_date ? t.start_date.slice(0, 10) : "", due_date: t.due_date ? t.due_date.slice(0, 10) : "", priority: t.priority, type: t.type || "task", status: t.status, custom: { ...(t.custom_fields ?? {}) } });
  }
  function newDraft() { setErrors({}); setDraft({ ...blank, status: firstStageKey, custom: {} }); }

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

  const detailTb = detail ? timeBar(detail, doneKeys) : null;

  return (
    <>
      <PageHeader
        title="Task Management"
        subtitle="Assign, track and complete work across your team"
        action={
          <div className="flex items-center gap-2">
            {canManageFields && (
              <button onClick={() => setStageMgrOpen(true)} title="Manage board stages" className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="16" rx="1" /><rect x="17" y="4" width="4" height="16" rx="1" /></svg>
                Stages
              </button>
            )}
            {canManageFields && (
              <button onClick={() => setSetupOpen(true)} title="Configure task form fields" className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10.3 4.3a2 2 0 013.4 0l.5.9 1-.2a2 2 0 012.4 2.4l-.2 1 .9.5a2 2 0 010 3.4l-.9.5.2 1a2 2 0 01-2.4 2.4l-1-.2-.5.9a2 2 0 01-3.4 0l-.5-.9-1 .2a2 2 0 01-2.4-2.4l.2-1-.9-.5a2 2 0 010-3.4l.9-.5-.2-1a2 2 0 012.4-2.4l1 .2z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" /></svg>
                Form setup
              </button>
            )}
            {can("tasks", "create") && <button onClick={newDraft} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"><svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>New task</button>}
          </div>
        }
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

      {/* Toolbar — instant search + a Filters panel (assignee / type / priority /
          due date), mirroring the Announcements section. Nothing applies until
          “Apply”; the search box filters as you type. */}
      <div className={`mb-4 flex flex-wrap items-center gap-2 ${filterRailPad(filterOpen)}`}>
        <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2">
          <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" strokeLinecap="round" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks" className="w-40 bg-transparent text-sm focus:outline-none" />
        </div>
        <FilterToggle open={filterOpen} count={appliedFilterCount} onClick={() => { if (!filterOpen) setFilters(applied); setFilterOpen((o) => !o); }} />
        {(taskFiltersActive(applied) || query.trim()) && (
          <button onClick={clearFilters} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Clear</button>
        )}
        <div className="ml-auto flex rounded-lg border border-slate-300 bg-white p-0.5">
          {(["board", "list"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition ${view === v ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{v}</button>
          ))}
        </div>
      </div>

      <div className={filterRailPad(filterOpen)}>

      {tasks === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonBlock key={i} className="h-80" />)}
        </div>
      ) : view === "board" ? (
        <>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
            Board View
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {columns.map((col) => {
              const items = filtered.filter((t) => t.status === col.key);
              return (
                <div
                  key={col.key}
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={() => { const t = (tasks ?? []).find((x) => x.id === dragId); if (t) changeStatus(t, col.key); setDragId(null); }}
                  className="flex w-[300px] flex-shrink-0 flex-col"
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
                      const due = cardDue(t, doneKeys);
                      const tm = typeMeta(t.type);
                      const tb = timeBar(t, doneKeys);
                      return (
                        <div
                          key={t.id}
                          draggable
                          onDragStart={() => setDragId(t.id)}
                          onDragEnd={() => setDragId(null)}
                          onClick={() => openDetail(t)}
                          className={`group cursor-pointer rounded-xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${isOverdue(t, doneKeys) ? "border-red-200" : "border-slate-200"}`}
                        >
                          <div className="mb-2 flex flex-wrap items-center gap-1.5">
                            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tm.cls}`}>
                              <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={tm.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
                              {tm.label}
                            </span>
                            <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize ${priorityTone[t.priority] ?? priorityTone.medium}`}>{t.priority}</span>
                          </div>
                          <h4 className={`text-[15px] font-semibold leading-snug ${isDoneTask(t, doneKeys) ? "text-slate-400 line-through" : "text-slate-900"}`}>{t.title}</h4>
                          {stripHtml(t.description ?? "") && <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-slate-500">{stripHtml(t.description ?? "")}</p>}
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
          columns={columns}
          doneKeys={doneKeys}
          listStatus={listStatus}
          setListStatus={setListStatus}
          onOpen={openDetail}
          onToggle={(t) => changeStatus(t, isDoneTask(t, doneKeys) ? firstStageKey : doneStageKey)}
          onDelete={remove}
        />
      )}
      </div>

      {/* ---- Filters panel (assignee / type / priority / due date) ---- */}
      <FilterRail
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        dirty={draftDirty}
        onReset={() => setFilters(BLANK_TASK_FILTERS)}
        resetDisabled={!taskFiltersActive(filters)}
        onApply={applyFilters}
        applyDisabled={!draftDirty}
      >
        <div className="space-y-1.5">
          <FilterLabel>Assignee</FilterLabel>
          <MultiSelect ariaLabel="Filter by assignee" value={filters.assignee} onChange={(v) => setFilter("assignee", v)} options={assigneeOptions} placeholder="Anyone" searchPlaceholder="Search people…" />
        </div>
        <div className="space-y-1.5">
          <FilterLabel>Type</FilterLabel>
          <MultiSelect ariaLabel="Filter by type" value={filters.type} onChange={(v) => setFilter("type", v)} options={TYPE_OPTIONS} placeholder="Any type" searchPlaceholder="Search…" />
        </div>
        <div className="space-y-1.5">
          <FilterLabel>Priority</FilterLabel>
          <MultiSelect ariaLabel="Filter by priority" value={filters.priority} onChange={(v) => setFilter("priority", v)} options={PRIORITY_OPTIONS} placeholder="Any priority" searchPlaceholder="Search…" />
        </div>
        <div className="space-y-1.5">
          <FilterLabel>Due date</FilterLabel>
          <DateRangeFilter ariaLabel="Due date" value={filters.due} onChange={(v) => setFilter("due", v)} />
        </div>
      </FilterRail>

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
        {draft && (() => {
          const star = (key: string) => requiredFields.has(key) ? <span className="text-rose-500"> *</span> : null;
          const errCls = (k: string) => errors[k] ? "ring-2 ring-red-500/30" : "";
          const setC = (key: string, v: string) => setDraft({ ...draft, custom: { ...draft.custom, [key]: v } });
          const assigneeFormOpts: SelectOption[] = [{ value: "", label: "Unassigned" }, ...staff.map((s) => ({ value: String(s.id), label: s.name }))];
          return (
          <div className="space-y-3">
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-600">Title<span className="text-rose-500"> *</span></span>
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Task title" className={`${field} ${errCls("title")}`} />
              {errors.title && <p className="mt-1 text-xs text-rose-600">{errors.title}</p>}
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-600">Description{star("description")}</span>
              <RichTextEditor key={`desc-${draft.id ?? "new"}`} initialHTML={draft.description} onChange={(html) => setDraft((d) => d && { ...d, description: html })} placeholder="Describe the work…" minHeight={140} />
              {errors.description && <p className="mt-1 text-xs text-rose-600">{errors.description}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm"><span className="mb-1 block font-medium text-slate-600">Type{star("type")}</span>
                <SearchSelect ariaLabel="Type" value={draft.type} onChange={(v) => setDraft({ ...draft, type: v })} options={TYPE_OPTIONS} placeholder="— Select —" searchPlaceholder="Search…" className={errCls("type")} />
              </label>
              <label className="text-sm"><span className="mb-1 block font-medium text-slate-600">Priority{star("priority")}</span>
                <SearchSelect ariaLabel="Priority" value={draft.priority} onChange={(v) => setDraft({ ...draft, priority: v })} options={PRIORITY_OPTIONS} placeholder="— Select —" searchPlaceholder="Search…" className={errCls("priority")} />
              </label>
              <label className="text-sm"><span className="mb-1 block font-medium text-slate-600">Start date{star("start_date")}</span>
                <input type="date" value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} className={`${field} ${errCls("start_date")}`} />
              </label>
              <label className="text-sm"><span className="mb-1 block font-medium text-slate-600">Due date{star("due_date")}</span>
                <input type="date" value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} className={`${field} ${errCls("due_date")}`} />
              </label>
              <label className="text-sm"><span className="mb-1 block font-medium text-slate-600">Assign to{star("assigned_to")}</span>
                <SearchSelect ariaLabel="Assignee" value={draft.assigned_to} onChange={(v) => setDraft({ ...draft, assigned_to: v })} options={assigneeFormOpts} placeholder="Unassigned" searchPlaceholder="Search team…" className={errCls("assigned_to")} />
              </label>
              <label className="text-sm"><span className="mb-1 block font-medium text-slate-600">Status</span>
                <SearchSelect ariaLabel="Status" value={draft.status} onChange={(v) => setDraft({ ...draft, status: v })} options={statusOptions} placeholder="— Select —" searchPlaceholder="Search…" />
              </label>
            </div>

            {/* Admin-defined custom fields */}
            {customFields.length > 0 && (
              <div className="space-y-3 border-t border-slate-100 pt-3">
                {customFields.map((f) => {
                  const ek = `custom_${f.key}`;
                  const val = draft.custom[f.key] ?? "";
                  return (
                    <div key={f.key}>
                      <span className="mb-1 block text-sm font-medium text-slate-600">{f.label}{f.required && <span className="text-rose-500"> *</span>}</span>
                      {f.type === "textarea" ? (
                        <textarea value={val} onChange={(e) => setC(f.key, e.target.value)} rows={3} className={`${field} ${errCls(ek)}`} />
                      ) : f.type === "select" ? (
                        <SearchSelect ariaLabel={f.label} value={val} onChange={(v) => setC(f.key, v)} options={[{ value: "", label: "— Select —" }, ...f.options.map((o) => ({ value: o, label: o }))]} placeholder="— Select —" searchPlaceholder="Search…" className={errCls(ek)} />
                      ) : (
                        <input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} value={val} onChange={(e) => setC(f.key, e.target.value)} className={`${field} ${errCls(ek)}`} />
                      )}
                      {errors[ek] && <p className="mt-1 text-xs text-rose-600">{errors[ek]}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          );
        })()}
      </Drawer>

      {/* ---- Task form setup (admin) — mandatory toggles + custom field builder ---- */}
      <FieldSetupDrawer
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        title="Task form fields"
        subtitle="Choose mandatory fields and build your own custom fields"
        requirableFields={TASK_REQUIRABLE_FIELDS}
        required={requiredFields}
        customFields={customFields}
        onSave={saveTaskFieldSettings}
        onSaved={(req, custom) => { setRequiredFields(new Set(req)); setCustomFields(custom); }}
      />

      {/* ---- Task detail drawer ---- */}
      <Drawer
        open={!!detail}
        onClose={() => setDetail(null)}
        title="Task details"
        width="max-w-2xl"
        footer={detail ? (
          <div className="flex items-center justify-between gap-2">
            {can("tasks", "delete") ? <button onClick={() => remove(detail)} className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">Delete</button> : <span />}
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
              {stripHtml(detail.description ?? "") && <div className="rte-content mt-1.5 text-sm leading-relaxed text-slate-600" dangerouslySetInnerHTML={{ __html: detail.description ?? "" }} />}
            </div>

            {/* Stage stepper */}
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Stage</div>
              <div className="flex flex-wrap gap-1.5">
                {columns.map((c) => {
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
              <div><dt className="text-slate-400">Due date</dt><dd className={`mt-0.5 font-medium ${isOverdue(detail, doneKeys) ? "text-red-600" : "text-slate-800"}`}>{detail.due_date ? fmtDate(detail.due_date) : "—"}</dd></div>
              <div><dt className="text-slate-400">Assignee</dt><dd className="mt-0.5 font-medium text-slate-800">{detail.assignee_name || "Unassigned"}</dd></div>
              <div><dt className="text-slate-400">Created</dt><dd className="mt-0.5 font-medium text-slate-800">{fmtDate(detail.created_at)}</dd></div>
              <div><dt className="text-slate-400">Created by</dt><dd className="mt-0.5 font-medium text-slate-800">{detail.created_by_name || "—"}</dd></div>
              <div className="col-span-2"><dt className="text-slate-400">Last updated by</dt><dd className="mt-0.5 font-medium text-slate-800">{detail.updated_by_name || "—"}</dd></div>
              {isDoneTask(detail, doneKeys) && detail.completed_at && (
                <div className="col-span-2"><dt className="text-slate-400">Completed</dt><dd className="mt-0.5 font-medium text-slate-800">{fmtDateTime(detail.completed_at)}
                  {detail.due_date && (
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${detail.completed_at.slice(0, 10) <= detail.due_date.slice(0, 10) ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
                      {detail.completed_at.slice(0, 10) <= detail.due_date.slice(0, 10) ? "On time" : "Late"}
                    </span>
                  )}
                </dd></div>
              )}
            </dl>

            {/* Custom fields */}
            {customFields.some((f) => (detail.custom_fields?.[f.key] ?? "") !== "") && (
              <dl className="grid grid-cols-2 gap-4 rounded-xl border border-slate-100 p-4 text-sm">
                {customFields.filter((f) => (detail.custom_fields?.[f.key] ?? "") !== "").map((f) => (
                  <div key={f.key} className={f.type === "textarea" ? "col-span-2" : ""}>
                    <dt className="text-slate-400">{f.label}</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap font-medium text-slate-800">{detail.custom_fields?.[f.key]}</dd>
                  </div>
                ))}
              </dl>
            )}

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
                          {can("tasks", "update") && (
                            <button onClick={() => removeComment(c)} className="text-slate-300 opacity-0 transition hover:text-red-500 group-hover:opacity-100" title="Delete">
                              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" /></svg>
                            </button>
                          )}
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
  tasks, columns, doneKeys, listStatus, setListStatus, onOpen, onToggle, onDelete,
}: {
  tasks: Task[];
  columns: StageColumn[];
  doneKeys: Set<string>;
  listStatus: string;
  setListStatus: (v: string) => void;
  onOpen: (t: Task) => void;
  onToggle: (t: Task) => void;
  onDelete: (t: Task) => void;
}) {
  const tabs = [
    { key: "all", label: "All" },
    ...columns.map((c) => ({ key: c.key, label: c.label })),
    { key: "overdue", label: "Overdue" },
  ];
  const rows = tasks.filter((t) => listStatus === "all" ? true : listStatus === "overdue" ? isOverdue(t, doneKeys) : t.status === listStatus);

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
            const due = cardDue(t, doneKeys);
            const tm = typeMeta(t.type);
            const done = isDoneTask(t, doneKeys);
            return (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <button onClick={() => onToggle(t)} className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ${done ? "border-emerald-500 bg-emerald-500" : "border-slate-300"}`} aria-label="Toggle done">
                  {done && <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </button>
                <button onClick={() => onOpen(t)} className="min-w-0 flex-1 text-left">
                  <span className={`block truncate text-sm font-medium ${done ? "text-slate-400 line-through" : "text-slate-800"}`}>{t.title}</span>
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
