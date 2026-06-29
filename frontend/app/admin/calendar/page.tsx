"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  createEvent,
  createMeeting,
  deleteEvent,
  getEvents,
  updateEvent,
  type CalendarEvent,
  type GoogleEvent,
} from "../../lib/admin";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import { Field, Modal, PageHeader } from "../ui";

// Per-color tints used across the calendar: dot/swatch, filled chip, date pill, left bar.
const TONES: Record<string, { dot: string; chip: string; pill: string; bar: string }> = {
  indigo: { dot: "bg-indigo-500", chip: "bg-indigo-50 text-indigo-700", pill: "bg-indigo-100 text-indigo-700", bar: "bg-indigo-500" },
  violet: { dot: "bg-violet-500", chip: "bg-violet-50 text-violet-700", pill: "bg-violet-100 text-violet-700", bar: "bg-violet-500" },
  emerald: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700", pill: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-500" },
  amber: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700", pill: "bg-amber-100 text-amber-700", bar: "bg-amber-500" },
  rose: { dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700", pill: "bg-rose-100 text-rose-700", bar: "bg-rose-500" },
  sky: { dot: "bg-sky-500", chip: "bg-sky-50 text-sky-700", pill: "bg-sky-100 text-sky-700", bar: "bg-sky-500" },
};
const colorClasses: Record<string, string> = Object.fromEntries(
  Object.entries(TONES).map(([k, v]) => [k, v.dot]),
);
const colors = Object.keys(TONES);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toneFor(e: Item) {
  return e.source === "google" ? TONES.sky : TONES[(e as LocalItem).color] ?? TONES.indigo;
}
// 24h "14:00" -> "2:00 PM"; falsy -> "All day".
function fmtTime(t?: string | null) {
  if (!t) return "All day";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${pad(m || 0)} ${ampm}`;
}

type LocalItem = CalendarEvent & { source: "local" };
type Item = LocalItem | GoogleEvent;

interface Draft {
  id?: number;
  title: string;
  description: string;
  event_date: string;
  start_time: string;
  end_time: string;
  color: string;
}
const emptyDraft = (date: string): Draft => ({
  title: "",
  description: "",
  event_date: date,
  start_time: "",
  end_time: "",
  color: "indigo",
});

interface MeetingForm {
  title: string;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string;
  attendees: string;
  description: string;
  with_meet: boolean;
}
const emptyMeeting = (date: string): MeetingForm => ({
  title: "",
  event_date: date,
  start_time: "10:00",
  end_time: "10:30",
  location: "",
  attendees: "",
  description: "",
  with_meet: true,
});

function sortByTime(a: Item, b: Item) {
  return (a.start_time || "").localeCompare(b.start_time || "");
}

export default function CalendarPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [cursor, setCursor] = useState(() => new Date());
  const [events, setEvents] = useState<LocalItem[]>([]);
  const [meetings, setMeetings] = useState<GoogleEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [meeting, setMeeting] = useState<MeetingForm | null>(null);
  const [viewing, setViewing] = useState<GoogleEvent | null>(null);
  const [saving, setSaving] = useState(false);

  const monthStr = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`;

  const load = useCallback(() => {
    getEvents(monthStr)
      .then((d) => {
        setEvents(d.events.map((e) => ({ ...e, source: "local" as const })));
        setMeetings(d.google_events ?? []);
        setConnected(d.google_connected);
        setGoogleError(d.google_error ?? null);
      })
      .catch(() => {
        setEvents([]);
        setMeetings([]);
      });
  }, [monthStr]);

  useEffect(() => load(), [load]);

  // 6-week grid.
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  const todayStr = ymd(new Date());
  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const e of [...events, ...meetings]) {
      const list = map.get(e.event_date) ?? [];
      list.push(e);
      map.set(e.event_date, list);
    }
    for (const list of map.values()) list.sort(sortByTime);
    return map;
  }, [events, meetings]);

  const upcoming = useMemo(
    () =>
      [...events, ...meetings]
        .filter((e) => e.event_date >= todayStr)
        .sort((a, b) => a.event_date.localeCompare(b.event_date) || sortByTime(a, b))
        .slice(0, 8),
    [events, meetings, todayStr],
  );

  async function saveEvent() {
    if (!draft) return;
    if (!draft.title.trim()) return toast.warning("Please enter a title.");
    setSaving(true);
    try {
      const body = {
        title: draft.title,
        description: draft.description,
        event_date: draft.event_date,
        start_time: draft.start_time,
        end_time: draft.end_time,
        color: draft.color,
      };
      if (draft.id) {
        await updateEvent(draft.id, body);
        toast.success("Event updated.");
      } else {
        await createEvent(body);
        toast.success("Event added.");
      }
      setDraft(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save event");
    } finally {
      setSaving(false);
    }
  }

  async function removeEvent() {
    if (!draft?.id) return;
    const ok = await confirm({
      danger: true,
      title: "Delete this event?",
      message: (
        <>
          Delete <b>{draft.title || "this event"}</b> from your calendar? You can&apos;t undo this from here.
        </>
      ),
      confirmLabel: "Yes, delete",
      cancelLabel: "No, keep it",
    });
    if (!ok) return;
    try {
      await deleteEvent(draft.id);
      toast.success("Event deleted.");
      setDraft(null);
      load();
    } catch {
      toast.error("Could not delete event");
    }
  }

  async function saveMeeting() {
    if (!meeting) return;
    if (!meeting.title.trim()) return toast.warning("Please enter a meeting title.");
    setSaving(true);
    try {
      await createMeeting({
        title: meeting.title,
        event_date: meeting.event_date,
        start_time: meeting.start_time,
        end_time: meeting.end_time,
        location: meeting.location,
        attendees: meeting.attendees,
        description: meeting.description,
        with_meet: meeting.with_meet,
      });
      toast.success("Meeting scheduled on Google Calendar.");
      setMeeting(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not schedule meeting");
    } finally {
      setSaving(false);
    }
  }

  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Schedule demos, reminders and meetings"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDraft(emptyDraft(todayStr))}
              className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
              New event
            </button>
            {connected && (
              <button
                onClick={() => setMeeting(emptyMeeting(todayStr))}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 10l4.5-2.5v9L15 14M4 6h9a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                New meeting
              </button>
            )}
          </div>
        }
      />

      {!connected && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          <svg className="h-5 w-5 flex-shrink-0 text-sky-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 3v4M16 3v4M4 9h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="flex-1">Connect Google Calendar to see all your meetings here and schedule new ones.</span>
          <Link href="/admin/integrations" className="rounded-lg bg-sky-600 px-3 py-1.5 font-semibold text-white hover:bg-sky-700">Connect</Link>
        </div>
      )}
      {connected && googleError && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Couldn’t load Google Calendar meetings: {googleError}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        {/* Calendar grid */}
        <div className="xl:col-span-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                </div>
                <h2 className="text-xl font-bold text-slate-900">{monthLabel}</h2>
              </div>
              <button onClick={() => setCursor(new Date())} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Today</button>
            </div>

            <div className="grid grid-cols-7 border-b border-slate-100 pb-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-400">
              {WEEKDAYS.map((d) => <div key={d}>{d}</div>)}
            </div>

            <div className="grid grid-cols-7 border-l border-t border-slate-100">
              {cells.map((d, i) => {
                const inMonth = d.getMonth() === cursor.getMonth();
                const ds = ymd(d);
                const isToday = ds === todayStr;
                const dayItems = byDay.get(ds) ?? [];
                return (
                  <div
                    key={i}
                    onClick={() => setDraft(emptyDraft(ds))}
                    className={`min-h-28 cursor-pointer border-b border-r border-slate-100 p-1.5 transition hover:bg-slate-50 ${inMonth ? "" : "bg-slate-50/50"}`}
                  >
                    <div className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${isToday ? "bg-indigo-600 text-white" : inMonth ? "text-slate-700" : "text-slate-300"}`}>
                      {d.getDate()}
                    </div>
                    <div className="space-y-1">
                      {dayItems.slice(0, 3).map((e) => {
                        const tone = toneFor(e);
                        return e.source === "google" ? (
                          <button
                            key={`g-${e.id}`}
                            onClick={(ev) => { ev.stopPropagation(); setViewing(e); }}
                            className={`flex w-full items-center gap-1 truncate rounded px-1.5 py-1 text-left text-[11px] font-medium ${tone.chip} hover:brightness-95`}
                          >
                            <svg className="h-3 w-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 10l4.5-2.5v9L15 14M4 6h9a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            <span className="truncate">{e.start_time ? `${e.start_time} ` : ""}{e.title}</span>
                          </button>
                        ) : (
                          <button
                            key={`l-${e.id}`}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setDraft({
                                id: e.id,
                                title: e.title,
                                description: e.description || "",
                                event_date: e.event_date,
                                start_time: e.start_time || "",
                                end_time: e.end_time || "",
                                color: e.color,
                              });
                            }}
                            className={`flex w-full items-center gap-1.5 truncate rounded px-1.5 py-1 text-left text-[11px] font-medium ${tone.chip} hover:brightness-95`}
                          >
                            <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${tone.dot}`} />
                            <span className="truncate">{e.start_time ? `${e.start_time.slice(0, 5)} ` : ""}{e.title}</span>
                          </button>
                        );
                      })}
                      {dayItems.length > 3 && (
                        <div className="px-1.5 text-[10px] text-slate-400">+{dayItems.length - 3} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Upcoming panel */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-lg font-bold text-slate-900">Upcoming Events</h3>
          {upcoming.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing scheduled. Create an event or meeting to get started.</p>
          ) : (
            <ul className="space-y-3">
              {upcoming.map((e) => {
                const d = new Date(e.event_date.replace(" ", "T"));
                const isGoogle = e.source === "google";
                const tone = toneFor(e);
                return (
                  <li key={`${e.source}-${e.id}`}>
                    <button
                      onClick={() => (isGoogle ? setViewing(e) : setDraft({
                        id: (e as LocalItem).id,
                        title: e.title,
                        description: e.description || "",
                        event_date: e.event_date,
                        start_time: e.start_time || "",
                        end_time: e.end_time || "",
                        color: (e as LocalItem).color,
                      }))}
                      className="flex w-full items-stretch gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:bg-slate-50 hover:shadow-sm"
                    >
                      <span className={`w-1 flex-shrink-0 rounded-full ${tone.bar}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-bold text-slate-900">{e.title}</span>
                          {isGoogle && e.meet_link && (
                            <svg className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" fill="currentColor" viewBox="0 0 24 24"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" /></svg>
                          )}
                        </span>
                        <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                          <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          {d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {fmtTime(e.start_time)}
                        </span>
                      </span>
                      <span className={`flex-shrink-0 self-center rounded-md px-2 py-1 text-xs font-semibold ${tone.pill}`}>
                        {d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Event types legend */}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Event Types</h4>
            <div className="space-y-2 text-sm text-slate-600">
              <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-indigo-500" /> Local event</span>
              <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-sky-500" /> Google meeting</span>
            </div>
          </div>
        </div>
      </div>

      {/* Local event modal */}
      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? "Edit event" : "New event"}>
        {draft && (
          <div className="space-y-4">
            <Field label="Title" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} placeholder="Demo with Acme Corp" />
            <Field label="Date" type="date" value={draft.event_date} onChange={(v) => setDraft({ ...draft, event_date: v })} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Start time" type="time" value={draft.start_time} onChange={(v) => setDraft({ ...draft, start_time: v })} />
              <Field label="End time" type="time" value={draft.end_time} onChange={(v) => setDraft({ ...draft, end_time: v })} />
            </div>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Notes</span>
              <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15" />
            </label>
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Color</span>
              <div className="flex gap-2">
                {colors.map((c) => (
                  <button key={c} onClick={() => setDraft({ ...draft, color: c })} className={`h-7 w-7 rounded-full ${colorClasses[c]} ${draft.color === c ? "ring-2 ring-slate-900 ring-offset-2" : ""}`} aria-label={c} />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 pt-2">
              {draft.id ? (
                <button onClick={removeEvent} className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">Delete</button>
              ) : <span />}
              <div className="flex gap-2">
                <button onClick={() => setDraft(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                <button onClick={saveEvent} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                  {saving ? "Saving…" : "Save event"}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Google meeting modal */}
      <Modal open={!!meeting} onClose={() => setMeeting(null)} title="New meeting">
        {meeting && (
          <div className="space-y-4">
            <Field label="Title" value={meeting.title} onChange={(v) => setMeeting({ ...meeting, title: v })} placeholder="Product walkthrough" />
            <Field label="Date" type="date" value={meeting.event_date} onChange={(v) => setMeeting({ ...meeting, event_date: v })} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Start time" type="time" value={meeting.start_time} onChange={(v) => setMeeting({ ...meeting, start_time: v })} />
              <Field label="End time" type="time" value={meeting.end_time} onChange={(v) => setMeeting({ ...meeting, end_time: v })} />
            </div>
            <Field label="Attendees" value={meeting.attendees} onChange={(v) => setMeeting({ ...meeting, attendees: v })} placeholder="alice@acme.com, bob@acme.com" />
            <Field label="Location" value={meeting.location} onChange={(v) => setMeeting({ ...meeting, location: v })} placeholder="Office / address (optional)" />
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Description</span>
              <textarea value={meeting.description} onChange={(e) => setMeeting({ ...meeting, description: e.target.value })} rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15" />
            </label>
            <label className="flex items-center gap-2.5 text-sm text-slate-700">
              <input type="checkbox" checked={meeting.with_meet} onChange={(e) => setMeeting({ ...meeting, with_meet: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
              Add a Google Meet video link
            </label>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button onClick={() => setMeeting(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={saveMeeting} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                {saving ? "Scheduling…" : "Schedule meeting"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Google meeting details (read-only) */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title="Meeting">
        {viewing && (
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900">{viewing.title}</h3>
              <p className="mt-0.5 text-sm text-slate-500">
                {new Date(viewing.event_date.replace(" ", "T")).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                {viewing.start_time ? ` · ${viewing.start_time}${viewing.end_time ? `–${viewing.end_time}` : ""}` : " · All day"}
              </p>
            </div>
            {viewing.location && (
              <div className="flex items-start gap-2 text-sm text-slate-600">
                <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
                {viewing.location}
              </div>
            )}
            {viewing.description && (
              <p className="whitespace-pre-line rounded-xl border border-slate-200 p-3 text-sm text-slate-600">{viewing.description}</p>
            )}
            {viewing.attendees.length > 0 && (
              <div>
                <div className="mb-1.5 text-sm font-medium text-slate-700">Attendees ({viewing.attendees.length})</div>
                <div className="flex flex-wrap gap-1.5">
                  {viewing.attendees.map((a) => (
                    <span key={a} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{a}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              {viewing.meet_link && (
                <a href={viewing.meet_link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" /></svg>
                  Join Google Meet
                </a>
              )}
              {viewing.html_link && (
                <a href={viewing.html_link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Open in Google Calendar
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17 17 7M7 7h10v10" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </a>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
