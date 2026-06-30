"use client";

import { useEffect, useState } from "react";
import {
  ackStaffAnnouncement,
  getStaffAnnouncements,
  markStaffAnnouncementRead,
  type StaffAnnouncementAttachment,
  type StaffAnnouncementItem,
} from "../../lib/staff";
import { API_URL } from "../../lib/api";
import { useToast } from "../../components/toast/ToastProvider";
import { PageHeader, Card, EmptyState, SkeletonBlock, timeAgo } from "../../admin/ui";

function fmtSize(n: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentChip({ a }: { a: StaffAnnouncementAttachment }) {
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

export default function StaffAnnouncementsPage() {
  const toast = useToast();
  const [items, setItems] = useState<StaffAnnouncementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [acking, setAcking] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await getStaffAnnouncements();
        if (cancelled) return;
        setItems(d.announcements);
        // Mark everything I can see as read (I'm looking at it now).
        const unread = d.announcements.filter((a) => !a.read_at);
        if (unread.length) {
          await Promise.allSettled(unread.map((a) => markStaffAnnouncementRead(a.id)));
          if (!cancelled) {
            const now = new Date().toISOString();
            setItems((list) => list.map((a) => (a.read_at ? a : { ...a, read_at: now })));
          }
        }
      } catch {
        /* transient */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function acknowledge(a: StaffAnnouncementItem) {
    setAcking(a.id);
    try {
      await ackStaffAnnouncement(a.id);
      const now = new Date().toISOString();
      setItems((list) => list.map((x) => (x.id === a.id ? { ...x, acknowledged_at: now, read_at: x.read_at ?? now } : x)));
      toast.success("Acknowledged.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not acknowledge");
    } finally {
      setAcking(null);
    }
  }

  return (
    <>
      <PageHeader title="Announcements" subtitle="Updates from your team — read and acknowledge where asked." />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonBlock key={i} className="h-24" />)}
        </div>
      ) : items.length === 0 ? (
        <Card><EmptyState title="No announcements" hint="Announcements addressed to you will appear here." /></Card>
      ) : (
        <div className="space-y-4">
          {items.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-center gap-2">
                {a.pinned && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">PINNED</span>}
                <h3 className="font-semibold text-slate-900">{a.title}</h3>
                {a.require_ack && !a.acknowledged_at && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">ACTION NEEDED</span>}
                {!a.read_at && <span className="h-2 w-2 rounded-full bg-sky-500" title="New" />}
              </div>
              <div className="mt-1 text-xs text-slate-400">{a.author} · {timeAgo(a.created_at)}</div>

              {a.body && <div className="rte-content mt-3 text-sm leading-relaxed text-slate-600" dangerouslySetInnerHTML={{ __html: a.body }} />}

              {a.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {a.attachments.map((at, i) => <AttachmentChip key={i} a={at} />)}
                </div>
              )}

              {a.require_ack && (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  {a.acknowledged_at ? (
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-600">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      Acknowledged
                    </span>
                  ) : (
                    <button
                      onClick={() => acknowledge(a)}
                      disabled={acking === a.id}
                      className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-50"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      {acking === a.id ? "Saving…" : "Acknowledge"}
                    </button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
