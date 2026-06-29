"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncementReaders,
  getAnnouncements,
  uploadFile,
  type Announcement,
  type AnnouncementAttachment,
  type AnnouncementAudience,
  type AnnouncementReader,
} from "../../lib/client";
import { API_URL } from "../../lib/api";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import RichTextEditor from "../../admin/RichTextEditor";
import { PageHeader, Card, EmptyState, Spinner, Modal, Drawer, timeAgo } from "../../admin/ui";

type Dept = { id: number; name: string };
type StaffOpt = { id: number; name: string; department_id: number | null };

function fmtSize(n: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const AUDIENCE_LABEL: Record<AnnouncementAudience, string> = {
  all: "All team",
  department: "By department",
  staff: "Specific people",
};

/** A small green/slate progress chip like "3 / 8 read". */
function StatChip({ icon, value, total, label, tone }: { icon: string; value: number; total: number; label: string; tone: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
      {value}/{total} {label}
    </span>
  );
}

function AttachmentChip({ a }: { a: AnnouncementAttachment }) {
  return (
    <a
      href={`${API_URL}${a.url}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
    >
      <svg className="h-4 w-4 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21.4 11.1l-9 9a5 5 0 01-7.1-7.1l9-9a3.3 3.3 0 014.7 4.7l-9 9a1.7 1.7 0 01-2.4-2.4l8.3-8.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span className="max-w-[160px] truncate">{a.name}</span>
      {a.size > 0 && <span className="text-slate-400">{fmtSize(a.size)}</span>}
    </a>
  );
}

export default function AnnouncementsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<Announcement[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [staff, setStaff] = useState<StaffOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const sentinel = useRef<HTMLDivElement | null>(null);

  // Create form state
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<AnnouncementAudience>("all");
  const [deptIds, setDeptIds] = useState<number[]>([]);
  const [staffIds, setStaffIds] = useState<number[]>([]);
  const [requireAck, setRequireAck] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  // Readers modal state
  const [readersFor, setReadersFor] = useState<Announcement | null>(null);
  const [readers, setReaders] = useState<AnnouncementReader[] | null>(null);

  const PAGE = 15;

  // (Re)load the first page — used on mount and after create/delete.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getAnnouncements({ limit: PAGE, offset: 0 });
      setItems(d.announcements);
      setHasMore(d.has_more);
      if (d.departments) setDepartments(d.departments);
      if (d.staff) setStaff(d.staff);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load announcements");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Append the next page (infinite scroll).
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const d = await getAnnouncements({ limit: PAGE, offset: items.length });
      setItems((list) => [...list, ...d.announcements]);
      setHasMore(d.has_more);
    } catch {
      /* transient — the sentinel will retry on the next scroll */
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, items.length]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // Fetch the next page when the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && loadMore(), { rootMargin: "320px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  function resetForm() {
    setTitle(""); setBody(""); setAudience("all"); setDeptIds([]); setStaffIds([]);
    setRequireAck(false); setPinned(false); setFiles([]);
  }

  function toggle(list: number[], id: number): number[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  async function submit() {
    if (title.trim().length < 2) {
      toast.error("Please enter a title.");
      return;
    }
    if (audience === "department" && deptIds.length === 0) {
      toast.error("Pick at least one department.");
      return;
    }
    if (audience === "staff" && staffIds.length === 0) {
      toast.error("Pick at least one team member.");
      return;
    }
    setSaving(true);
    try {
      // Upload attachments first, collecting their served URLs.
      const attachments: AnnouncementAttachment[] = [];
      for (const f of files) {
        const { url } = await uploadFile(f);
        attachments.push({ url, name: f.name, type: f.type, size: f.size });
      }
      // Drop the rich-text body if it has no actual text (e.g. just "<br>").
      const plain = body.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
      await createAnnouncement({
        title: title.trim(),
        body: plain ? body : "",
        audience,
        target_ids: audience === "department" ? deptIds : audience === "staff" ? staffIds : [],
        require_ack: requireAck,
        pinned,
        attachments,
      });
      toast.success("Announcement posted.");
      setOpen(false);
      resetForm();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post announcement");
    } finally {
      setSaving(false);
    }
  }

  async function remove(a: Announcement) {
    // Soft delete — confirm first via the popup dialog (project policy).
    const ok = await confirm({
      danger: true,
      title: `Delete "${a.title}"?`,
      message: <>This hides the announcement from everyone. It&apos;s a soft delete — the record and read history are kept and can be restored later.</>,
      confirmLabel: "Yes, delete",
      cancelLabel: "No, keep it",
    });
    if (!ok) return;
    try {
      await deleteAnnouncement(a.id);
      setItems((list) => list.filter((x) => x.id !== a.id));
      toast.success("Announcement deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  async function openReaders(a: Announcement) {
    setReadersFor(a);
    setReaders(null);
    try {
      const d = await getAnnouncementReaders(a.id);
      setReaders(d.readers);
    } catch {
      setReaders([]);
    }
  }

  function audienceText(a: Announcement): string {
    if (a.audience === "all") return "All team members";
    if (a.target_names.length) return a.target_names.join(", ");
    return a.audience === "department" ? "Selected departments" : "Selected members";
  }

  const pickedFiles = useMemo(() => files.map((f) => ({ name: f.name, size: f.size })), [files]);
  const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle="Broadcast to your whole team, a department, or specific people — and track who's seen it."
        action={
          <button onClick={() => { resetForm(); setOpen(true); }} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
            New announcement
          </button>
        }
      />

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Card><EmptyState title="No announcements yet" hint="Post your first announcement to keep the team in the loop." /></Card>
      ) : (
        <div className="space-y-4">
          {items.map((a) => (
            <Card key={a.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {a.pinned && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">PINNED</span>}
                    <h3 className="font-semibold text-slate-900">{a.title}</h3>
                    {a.require_ack && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">ACK REQUIRED</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500">{AUDIENCE_LABEL[a.audience]}</span>
                    <span className="truncate">{audienceText(a)}</span>
                    <span>·</span>
                    <span>{timeAgo(a.created_at)}</span>
                  </div>
                </div>
                <button onClick={() => remove(a)} title="Delete" className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5h6v2m-1 0 .8 13H8.2L9 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </div>

              {a.body && <div className="rte-content mt-3 text-sm leading-relaxed text-slate-600" dangerouslySetInnerHTML={{ __html: a.body }} />}

              {a.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {a.attachments.map((at, i) => <AttachmentChip key={i} a={at} />)}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                <StatChip icon="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z M12 15a3 3 0 100-6 3 3 0 000 6z" value={a.read_count} total={a.recipient_count} label="read" tone="bg-emerald-50 text-emerald-700" />
                {a.require_ack && (
                  <StatChip icon="M5 13l4 4L19 7" value={a.ack_count} total={a.recipient_count} label="acknowledged" tone="bg-violet-50 text-violet-700" />
                )}
                <button onClick={() => openReaders(a)} className="ml-auto text-xs font-semibold text-emerald-600 hover:text-emerald-700">View recipients →</button>
              </div>
            </Card>
          ))}

          {/* Infinite-scroll sentinel + loader */}
          <div ref={sentinel} className="h-1" />
          {loadingMore && (
            <div className="flex justify-center py-3 text-slate-400">
              <svg className="h-5 w-5 animate-spin text-emerald-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
              </svg>
            </div>
          )}
          {!hasMore && items.length > 0 && (
            <p className="py-3 text-center text-xs text-slate-400">You&apos;ve reached the end.</p>
          )}
        </div>
      )}

      {/* Create drawer (slides in from the right) */}
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New announcement"
        subtitle="Compose your message and choose who sees it."
        width="max-w-xl"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={submit} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              {saving ? "Posting…" : "Post announcement"}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What's the update?" className={field} />
          </label>
          <div className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">Message</span>
            <RichTextEditor initialHTML="" onChange={setBody} placeholder="Write the details…" minHeight={160} />
          </div>

          {/* Audience */}
          <div className="text-sm">
            <span className="mb-1.5 block font-medium text-slate-600">Who should see this?</span>
            <div className="grid grid-cols-3 gap-2">
              {(["all", "department", "staff"] as AnnouncementAudience[]).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setAudience(opt)}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${audience === opt ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
                >
                  {AUDIENCE_LABEL[opt]}
                </button>
              ))}
            </div>
          </div>

          {audience === "department" && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {departments.length === 0 ? (
                <p className="px-1 py-3 text-center text-xs text-slate-400">No departments yet. Add them in Field Setup.</p>
              ) : (
                departments.map((d) => (
                  <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                    <input type="checkbox" checked={deptIds.includes(d.id)} onChange={() => setDeptIds((l) => toggle(l, d.id))} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                    <span className="text-slate-700">{d.name}</span>
                  </label>
                ))
              )}
            </div>
          )}

          {audience === "staff" && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {staff.length === 0 ? (
                <p className="px-1 py-3 text-center text-xs text-slate-400">No team members yet.</p>
              ) : (
                staff.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                    <input type="checkbox" checked={staffIds.includes(s.id)} onChange={() => setStaffIds((l) => toggle(l, s.id))} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                    <span className="text-slate-700">{s.name}</span>
                  </label>
                ))
              )}
            </div>
          )}

          {/* Attachments */}
          <div className="text-sm">
            <span className="mb-1.5 block font-medium text-slate-600">Attachments</span>
            {pickedFiles.length > 0 && (
              <div className="mb-2 space-y-1">
                {pickedFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-600">{f.name}</span>
                    <span className="text-slate-400">{fmtSize(f.size)}</span>
                    <button onClick={() => setFiles((l) => l.filter((_, j) => j !== i))} className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600">
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
              Add files
              <input type="file" multiple className="hidden" onChange={(e) => { const fs = Array.from(e.target.files ?? []); setFiles((l) => [...l, ...fs].slice(0, 10)); e.target.value = ""; }} />
            </label>
          </div>

          {/* Toggles */}
          <div className="flex flex-wrap gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={requireAck} onChange={(e) => setRequireAck(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
              Require acknowledgment
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
              Pin to top
            </label>
          </div>

        </div>
      </Drawer>

      {/* Recipients modal */}
      <Modal open={readersFor !== null} onClose={() => setReadersFor(null)} title="Recipients">
        {readers === null ? (
          <Spinner />
        ) : readers.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No recipients for this announcement.</p>
        ) : (
          <div className="max-h-96 space-y-1 overflow-y-auto">
            {readers.map((r) => (
              <div key={r.staff_id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-600">{r.name.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{r.name}</span>
                {r.acknowledged_at ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet-600"><svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>Acknowledged</span>
                ) : r.read_at ? (
                  <span className="text-xs font-medium text-emerald-600">Read</span>
                ) : (
                  <span className="text-xs text-slate-400">Not seen</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
