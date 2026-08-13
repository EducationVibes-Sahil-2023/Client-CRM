"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Drawer, fmtDate, fmtDateTime } from "../admin/ui";
import { getLeadDetail, getTask, getStaff, type LeadDetail, type Task, type Staff } from "../lib/client";

/** A global-search result to show in the detail drawer. */
export type SearchTarget = { type: string; id: number; title: string; subtitle: string; href: string };

/** Human working-duration from seconds (e.g. "1h 5m", "3m 20s"). */
function fmtDur(s?: number | string | null): string {
  const n = Number(s);
  if (!n || Number.isNaN(n) || n < 0) return "—";
  const m = Math.floor(n / 60);
  const h = Math.floor(m / 60);
  if (h >= 1) return `${h}h ${m % 60}m`;
  if (m >= 1) return `${m}m ${n % 60}s`;
  return `${n}s`;
}

/** A labelled read-only field (matches the leads drawer's Information layout). */
function Field({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{empty ? <span className="text-slate-300">—</span> : children}</p>
    </div>
  );
}

/** A simple read-only list (reminders / notes / calls / activity tabs). */
function ListView({ items, empty }: { items: { id: number; primary: ReactNode; meta: string }[]; empty: string }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-slate-400">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={it.id} className="rounded-lg border border-slate-100 px-3 py-2">
          <p className="text-sm text-slate-700">{it.primary}</p>
          <p className="mt-0.5 text-xs text-slate-400">{it.meta}</p>
        </li>
      ))}
    </ul>
  );
}

/** Full lead detail — Information grid + Reminders / Notes / Calls / Activity tabs. */
function LeadDetailView({ target, onClose, onOpen }: { target: SearchTarget; onClose: () => void; onOpen: (href: string) => void }) {
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [tab, setTab] = useState<"info" | "reminders" | "notes" | "calls" | "activity">("info");

  useEffect(() => {
    let alive = true;
    getLeadDetail(target.id).then((d) => { if (alive) setDetail(d); }).catch(() => {});
    return () => { alive = false; };
  }, [target.id]);

  const l = detail?.lead;
  const tabs: [typeof tab, string, number | undefined][] = [
    ["info", "Information", undefined],
    ["reminders", "Reminders", detail?.reminders.length],
    ["notes", "Notes", detail?.notes.length],
    ["calls", "Calls", detail?.calls.length],
    ["activity", "Activity", detail?.activity.length],
  ];

  return (
    <Drawer
      open
      onClose={onClose}
      title={target.title}
      subtitle="Details, reminders, notes & activity"
      width="max-w-2xl"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Close</button>
          <button onClick={() => onOpen(`/client/leads?edit=${target.id}`)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Edit</button>
        </div>
      }
    >
      <div className="mb-5 flex gap-5 border-b border-slate-200 text-sm">
        {tabs.map(([k, label, count]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2 font-medium ${tab === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {label}{count ? <span className="rounded-full bg-slate-100 px-1.5 text-[11px] text-slate-500">{count}</span> : null}
          </button>
        ))}
      </div>

      {!detail && <p className="py-6 text-center text-sm text-slate-400">Loading…</p>}

      {l && tab === "info" && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Name">{l.name}</Field>
          <Field label="Phone">{l.phone}</Field>
          <Field label="Alternative Phone">{l.alt_phone}</Field>
          <Field label="Status">{l.status}</Field>
          <Field label="Sub Status">{l.sub_status}</Field>
          <Field label="Lead Source">{l.source}</Field>
          <Field label="Lead Type">{l.lead_type}</Field>
          <Field label="Reference Name">{l.reference_name}</Field>
          <Field label="Email">{l.email}</Field>
          <Field label="Assigned To">{l.assigned_to_name || "Unassigned"}</Field>
          <Field label="Assigned Date">{l.assigned_date ? fmtDateTime(l.assigned_date) : null}</Field>
          <Field label="First Response">{fmtDur(l.first_response_seconds)}</Field>
          <Field label="City">{l.city}</Field>
          <Field label="State">{l.state}</Field>
          <Field label="Follow-up Date">{l.follow_date ? fmtDate(l.follow_date) : null}</Field>
          <Field label="Created Date">{l.created_date ? fmtDateTime(l.created_date) : null}</Field>
        </div>
      )}
      {detail && tab === "reminders" && (
        <ListView empty="No reminders." items={detail.reminders.map((r) => ({ id: r.id, primary: r.note || "Reminder", meta: fmtDateTime(r.remind_at) }))} />
      )}
      {detail && tab === "notes" && (
        <ListView empty="No notes." items={detail.notes.map((n) => ({ id: n.id, primary: n.body, meta: `${n.author_name || "Someone"} · ${fmtDateTime(n.created_at)}` }))} />
      )}
      {detail && tab === "calls" && (
        <ListView empty="No calls." items={detail.calls.map((c) => ({ id: c.id, primary: `${c.type || "call"}${c.call_status ? ` · ${c.call_status}` : ""}`, meta: `${fmtDur(c.duration)}${c.call_start ? ` · ${fmtDateTime(c.call_start)}` : ""}` }))} />
      )}
      {detail && tab === "activity" && (
        <ListView empty="No activity." items={detail.activity.map((a) => ({ id: a.id, primary: a.description || a.action, meta: `${a.actor_name || ""}${a.actor_name ? " · " : ""}${fmtDateTime(a.created_at)}` }))} />
      )}
    </Drawer>
  );
}

/** Task detail — the key fields, read-only. */
function TaskDetailView({ target, onClose, onOpen }: { target: SearchTarget; onClose: () => void; onOpen: (href: string) => void }) {
  const [task, setTask] = useState<Task | null>(null);
  useEffect(() => {
    let alive = true;
    getTask(target.id).then((d) => { if (alive) setTask(d.task); }).catch(() => {});
    return () => { alive = false; };
  }, [target.id]);

  const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  return (
    <Drawer
      open
      onClose={onClose}
      title={target.title}
      subtitle="Task details"
      width="max-w-xl"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Close</button>
          <button onClick={() => onOpen(target.href)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Open full record</button>
        </div>
      }
    >
      {!task && <p className="py-6 text-center text-sm text-slate-400">Loading…</p>}
      {task && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <Field label="Status">{task.status}</Field>
            <Field label="Priority">{task.priority}</Field>
            <Field label="Type">{task.type}</Field>
            <Field label="Assignee">{task.assignee_name}</Field>
            <Field label="Start Date">{task.start_date ? fmtDate(task.start_date) : null}</Field>
            <Field label="Due Date">{task.due_date ? fmtDate(task.due_date) : null}</Field>
            <Field label="Created By">{task.created_by_name}</Field>
            <Field label="Created">{task.created_at ? fmtDateTime(task.created_at) : null}</Field>
          </div>
          {task.description && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Description</p>
              <p className="mt-1 text-sm text-slate-700">{stripHtml(task.description)}</p>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

/** Team member detail — the member's info, read-only. */
function TeamDetailView({ target, onClose, onOpen }: { target: SearchTarget; onClose: () => void; onOpen: (href: string) => void }) {
  const [member, setMember] = useState<Staff | null>(null);
  useEffect(() => {
    let alive = true;
    getStaff().then((d) => { if (alive) setMember(d.staff.find((s) => s.id === target.id) ?? null); }).catch(() => {});
    return () => { alive = false; };
  }, [target.id]);

  return (
    <Drawer
      open
      onClose={onClose}
      title={target.title}
      subtitle="Team member details"
      width="max-w-xl"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Close</button>
          <button onClick={() => onOpen(target.href)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Open full record</button>
        </div>
      }
    >
      {!member && <p className="py-6 text-center text-sm text-slate-400">Loading…</p>}
      {member && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Name">{member.name}</Field>
          <Field label="Designation">{member.designation}</Field>
          <Field label="Email">{member.email}</Field>
          <Field label="Phone">{member.phone}</Field>
          <Field label="Alternative Phone">{member.alt_phone}</Field>
          <Field label="Employee Code">{member.emp_code}</Field>
          <Field label="Role">{member.role_name}</Field>
          <Field label="Reports To">{member.manager_name}</Field>
          <Field label="Department">{member.department}</Field>
          <Field label="Office">{member.office_name}</Field>
          <Field label="Reference">{member.reference_name}</Field>
          <Field label="Status">{member.status}</Field>
        </div>
      )}
    </Drawer>
  );
}

/**
 * Detail drawer for a global-search result — opens the same rich view as the
 * page it belongs to (leads get the full tabbed drawer; tasks get their details;
 * other types show their basic info). Rendered from the client layout so it works
 * on every page. Remount per target via a `key` so state resets cleanly.
 */
export default function SearchDetailDrawer({ target, onClose, onOpen }: {
  target: SearchTarget | null; onClose: () => void; onOpen: (href: string) => void;
}) {
  // The search box lives inside the top bar, whose stacking context would trap a
  // plain fixed drawer under the leads table's sticky "Actions" column. Portalling
  // to document.body lifts it above everything (like the leads page's own drawer).
  if (!target || typeof document === "undefined") return null;

  let content: ReactNode;
  if (target.type === "leads") content = <LeadDetailView target={target} onClose={onClose} onOpen={onOpen} />;
  else if (target.type === "tasks") content = <TaskDetailView target={target} onClose={onClose} onOpen={onOpen} />;
  else if (target.type === "team") content = <TeamDetailView target={target} onClose={onClose} onOpen={onOpen} />;
  else content = (
    // Fallback for other result types (assets, …): basic info + open.
    <Drawer open onClose={onClose} title={target.title} subtitle={target.subtitle || undefined} width="max-w-md"
      footer={<div className="flex justify-end"><button onClick={() => onOpen(target.href)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Open full record</button></div>}>
      <p className="text-sm text-slate-500">Open the full record to see all details.</p>
    </Drawer>
  );

  return createPortal(content, document.body);
}
