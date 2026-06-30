"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getInbox,
  getInboxMessage,
  getMessages,
  sendMessage,
  deleteMessage,
  type GmailEmail,
  type GmailMessage,
} from "../../lib/admin";
import { useToast } from "../../components/toast/ToastProvider";
import { useConfirm } from "../../components/confirm/ConfirmProvider";
import { Modal, SkeletonText } from "../ui";
import { APP_TZ, parseServer } from "../../lib/datetime";

const PER_PAGE = 12;
const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: APP_TZ });

/** Short, list-friendly timestamp (IST): time for today, else "5 Jun". */
function timeShort(iso: string) {
  const d = parseServer(iso);
  if (!d) return "";
  const day = istDay(d);
  const today = istDay(new Date());
  if (day === today)
    return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: APP_TZ });
  if (day.slice(0, 4) === today.slice(0, 4))
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: APP_TZ });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: APP_TZ });
}

/** Full timestamp for the reading pane (IST). */
function timeLong(iso: string) {
  const d = parseServer(iso);
  if (!d) return "";
  return d.toLocaleString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: APP_TZ,
  });
}

const AVATAR_COLORS = [
  "bg-indigo-100 text-indigo-600",
  "bg-emerald-100 text-emerald-600",
  "bg-amber-100 text-amber-600",
  "bg-rose-100 text-rose-600",
  "bg-sky-100 text-sky-600",
  "bg-violet-100 text-violet-600",
  "bg-teal-100 text-teal-600",
];

/** Stable colour per sender so avatars don't flicker between renders. */
function avatarColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initial(name: string, email: string) {
  const s = (name || email || "?").trim();
  return (s[0] || "?").toUpperCase();
}

interface Compose {
  to_email: string;
  to_name: string;
  subject: string;
  body: string;
}

interface SentMail {
  id: number;
  name: string;
  email: string;
  subject: string;
  body: string;
  created_at: string;
}

export default function InboxPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [folder, setFolder] = useState<"inbox" | "sent">("inbox");

  // Gmail inbox state
  const [emails, setEmails] = useState<GmailEmail[]>([]);
  const [configured, setConfigured] = useState(true);
  const [inboxError, setInboxError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [tick, setTick] = useState(0); // bump to force an inbox refetch

  // Sent state
  const [sent, setSent] = useState<SentMail[]>([]);
  const [loadingSent, setLoadingSent] = useState(true);

  // Reading pane
  const [activeUid, setActiveUid] = useState<number | null>(null);
  const [activeSent, setActiveSent] = useState<SentMail | null>(null);
  const [message, setMessage] = useState<GmailMessage | null>(null);
  const [loadingMsg, setLoadingMsg] = useState(false);

  const [compose, setCompose] = useState<Compose | null>(null);
  const [sending, setSending] = useState(false);

  // Debounce search; resetting the page + spinner happens here (in an async
  // callback) rather than in a separate effect, to avoid cascading renders.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
      setLoadingInbox(true);
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  // Manually trigger an inbox refetch (refresh button / pagination).
  const refreshInbox = useCallback(() => {
    setLoadingInbox(true);
    setTick((t) => t + 1);
  }, []);

  // Fetch a page of Gmail whenever the page/search/tick changes. reqId guards
  // against out-of-order responses; all state writes happen in async callbacks.
  const reqId = useRef(0);
  useEffect(() => {
    const id = ++reqId.current;
    const params = `?page=${page}&per_page=${PER_PAGE}&q=${encodeURIComponent(debouncedQ)}`;
    getInbox(params)
      .then((res) => {
        if (id !== reqId.current) return;
        setConfigured(res.configured);
        setInboxError(res.error ?? "");
        setEmails(res.emails);
        setTotal(res.pagination.total);
        setTotalPages(res.pagination.total_pages);
      })
      .catch((e) => {
        if (id !== reqId.current) return;
        setInboxError(e instanceof Error ? e.message : "Could not load the inbox.");
        setEmails([]);
      })
      .finally(() => {
        if (id === reqId.current) setLoadingInbox(false);
      });
  }, [page, debouncedQ, tick]);

  const mapSent = (messages: { id: number; to_name: string | null; to_email: string; subject: string | null; body: string | null; created_at: string }[]): SentMail[] =>
    messages.map((m) => ({
      id: m.id,
      name: m.to_name || m.to_email,
      email: m.to_email,
      subject: m.subject || "(no subject)",
      body: m.body || "",
      created_at: m.created_at,
    }));

  // Reload Sent (called from event handlers, never directly inside an effect).
  const reloadSent = useCallback(() => {
    setLoadingSent(true);
    return getMessages("sent")
      .then((d) => setSent(mapSent(d.messages)))
      .finally(() => setLoadingSent(false));
  }, []);

  useEffect(() => {
    getMessages("sent")
      .then((d) => setSent(mapSent(d.messages)))
      .finally(() => setLoadingSent(false));
  }, []);

  const unread = useMemo(() => emails.filter((e) => !e.seen).length, [emails]);

  async function openEmail(e: GmailEmail) {
    setActiveSent(null);
    setActiveUid(e.uid);
    setMessage(null);
    setLoadingMsg(true);
    try {
      const res = await getInboxMessage(e.uid);
      setMessage(res.email);
      // Mark read locally (the server flags it \Seen on open).
      setEmails((list) => list.map((x) => (x.uid === e.uid ? { ...x, seen: true } : x)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open the message.");
      setActiveUid(null);
    } finally {
      setLoadingMsg(false);
    }
  }

  function openSent(m: SentMail) {
    setActiveUid(null);
    setMessage(null);
    setActiveSent(m);
  }

  function closeReading() {
    setActiveUid(null);
    setActiveSent(null);
    setMessage(null);
  }

  function openCompose(prefill?: Partial<Compose>) {
    setCompose({ to_email: "", to_name: "", subject: "", body: "", ...prefill });
  }

  async function send() {
    if (!compose) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(compose.to_email)) {
      toast.warning("Enter a valid recipient email.");
      return;
    }
    setSending(true);
    try {
      await sendMessage(compose);
      toast.success("Message sent.", { title: "Sent" });
      setCompose(null);
      await reloadSent();
      setFolder("sent");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send");
    } finally {
      setSending(false);
    }
  }

  async function removeSent(m: SentMail) {
    const ok = await confirm({
      danger: true,
      title: "Delete this message?",
      message: (
        <>
          Delete the message to <b>{m.name || m.email}</b>? It will be moved out of your Sent folder.
        </>
      ),
      confirmLabel: "Yes, delete",
      cancelLabel: "No, keep it",
    });
    if (!ok) return;
    try {
      await deleteMessage(m.id);
      setSent((l) => l.filter((x) => x.id !== m.id));
      if (activeSent?.id === m.id) closeReading();
      toast.success("Message deleted.");
    } catch {
      toast.error("Could not delete");
    }
  }

  const folders = [
    { key: "inbox" as const, label: "Inbox", icon: "M3 13h4l2 3h6l2-3h4M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z", count: unread },
    { key: "sent" as const, label: "Sent", icon: "M2 21l21-9L2 3v7l15 2-15 2z", count: 0 },
  ];

  const readingOpen = activeUid !== null || activeSent !== null;

  // Sandboxed HTML so remote email markup can't run scripts or read the page.
  const bodyDoc = message
    ? `<!doctype html><html><head><base target="_blank"><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<style>html,body{margin:0}body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;` +
      `color:#334155;font-size:14px;line-height:1.6;padding:8px;word-break:break-word}` +
      `img{max-width:100%;height:auto}a{color:#4f46e5}table{max-width:100%}</style></head><body>` +
      (message.html || `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(message.text)}</pre>`) +
      `</body></html>`
    : "";

  return (
    <div className="-m-4 sm:-m-6">
      <div className="flex h-[calc(100vh-4rem)] bg-white">
        {/* Folders rail */}
        <div className="hidden w-56 flex-shrink-0 flex-col border-r border-slate-200 p-3 md:flex">
          <button onClick={() => openCompose()} className="mb-4 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-700">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
            Compose
          </button>
          {folders.map((f) => (
            <button key={f.key} onClick={() => { setFolder(f.key); closeReading(); }} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${folder === f.key ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100"}`}>
              <svg className={`h-5 w-5 ${folder === f.key ? "text-indigo-600" : "text-slate-400"}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={f.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="flex-1 text-left">{f.label}</span>
              {f.count > 0 && <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-bold text-white">{f.count}</span>}
            </button>
          ))}
          <div className="mt-auto flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-400">
            <svg className="h-3.5 w-3.5 text-rose-500" fill="currentColor" viewBox="0 0 24 24"><path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0-8 5L4 6h16zm0 12H4V8l8 5 8-5v10z" /></svg>
            Gmail · IMAP
          </div>
        </div>

        {/* Message list */}
        <div className={`flex w-full flex-col border-r border-slate-200 lg:w-[26rem] ${readingOpen ? "hidden lg:flex" : "flex"}`}>
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
            <h1 className="text-lg font-bold capitalize text-slate-900">{folder}</h1>
            {folder === "inbox" && (
              <button onClick={refreshInbox} title="Refresh" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
                <svg className={`h-4.5 w-4.5 ${loadingInbox ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-2.64-6.36M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
          </div>

          {/* Search (inbox only) */}
          {folder === "inbox" && (
            <div className="border-b border-slate-100 px-4 py-2.5">
              <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2">
                <svg className="h-4 w-4 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" strokeLinecap="round" /></svg>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mail" className="w-full bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none" />
                {q && <button onClick={() => setQ("")} className="text-slate-400 hover:text-slate-600" aria-label="Clear">✕</button>}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {folder === "inbox" ? (
              loadingInbox ? (
                <SkeletonText lines={4} />
              ) : !configured ? (
                <SetupNotice />
              ) : inboxError ? (
                <ErrorNotice message={inboxError} onRetry={refreshInbox} />
              ) : emails.length === 0 ? (
                <div className="py-16 text-center text-sm text-slate-400">{debouncedQ ? "No matching mail" : "Inbox is empty"}</div>
              ) : (
                emails.map((m) => (
                  <button key={m.uid} onClick={() => openEmail(m)} className={`flex w-full gap-3 border-b border-slate-50 px-5 py-3 text-left transition hover:bg-slate-50 ${activeUid === m.uid ? "bg-indigo-50/60" : ""} ${!m.seen ? "bg-white" : "bg-slate-50/30"}`}>
                    <span className={`mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${avatarColor(m.email || m.name)}`}>
                      {initial(m.name, m.email)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`truncate text-sm ${!m.seen ? "font-bold text-slate-900" : "font-medium text-slate-600"}`}>{m.name}</span>
                        <span className="flex-shrink-0 text-[11px] text-slate-400">{timeShort(m.date)}</span>
                      </div>
                      <div className={`truncate text-xs ${!m.seen ? "font-semibold text-slate-700" : "text-slate-500"}`}>{m.subject}</div>
                      <div className="truncate text-xs text-slate-400">{m.snippet}</div>
                    </div>
                    {!m.seen && <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-indigo-500" />}
                  </button>
                ))
              )
            ) : loadingSent ? (
              <SkeletonText lines={4} />
            ) : sent.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-400">No sent messages</div>
            ) : (
              sent.map((m) => (
                <button key={m.id} onClick={() => openSent(m)} className={`flex w-full gap-3 border-b border-slate-50 px-5 py-3 text-left transition hover:bg-slate-50 ${activeSent?.id === m.id ? "bg-indigo-50/60" : ""}`}>
                  <span className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-500">
                    {initial(m.name, m.email)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-700">To: {m.name}</span>
                      <span className="flex-shrink-0 text-[11px] text-slate-400">{timeShort(m.created_at)}</span>
                    </div>
                    <div className="truncate text-xs text-slate-600">{m.subject}</div>
                    <div className="truncate text-xs text-slate-400">{m.body}</div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Pagination (inbox only) */}
          {folder === "inbox" && configured && !inboxError && total > 0 && (
            <div className="flex items-center justify-between border-t border-slate-200 px-5 py-2.5 text-xs text-slate-500">
              <span>{(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} of {total}</span>
              <div className="flex items-center gap-1">
                <button disabled={page <= 1 || loadingInbox} onClick={() => { setLoadingInbox(true); setPage((p) => p - 1); }} className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 disabled:opacity-40 enabled:hover:bg-slate-50">‹</button>
                <span className="px-1">{page}/{totalPages}</span>
                <button disabled={page >= totalPages || loadingInbox} onClick={() => { setLoadingInbox(true); setPage((p) => p + 1); }} className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 disabled:opacity-40 enabled:hover:bg-slate-50">›</button>
              </div>
            </div>
          )}
        </div>

        {/* Reading pane */}
        <div className={`flex-1 ${readingOpen ? "flex" : "hidden lg:flex"} flex-col`}>
          {activeSent ? (
            <SentReader mail={activeSent} onBack={closeReading} onDelete={() => removeSent(activeSent)} onReply={() => openCompose({ to_email: activeSent.email, to_name: activeSent.name, subject: `Re: ${activeSent.subject}` })} />
          ) : activeUid !== null ? (
            <>
              <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-4">
                <button onClick={closeReading} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <h2 className="flex-1 truncate text-lg font-bold text-slate-900">{message?.subject ?? "Loading…"}</h2>
                {message && (
                  <button onClick={() => openCompose({ to_email: message.email, to_name: message.name, subject: `Re: ${message.subject}` })} className="hidden items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 sm:flex">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 10h10a4 4 0 014 4v2M3 10l4-4M3 10l4 4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    Reply
                  </button>
                )}
              </div>
              {loadingMsg || !message ? (
                <SkeletonText lines={4} />
              ) : (
                <>
                  <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
                    <span className={`flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold ${avatarColor(message.email || message.name)}`}>
                      {initial(message.name, message.email)}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-900">{message.name}</div>
                      <div className="truncate text-sm text-slate-500">{message.email}</div>
                    </div>
                    <span className="ml-auto whitespace-nowrap text-xs text-slate-400">{timeLong(message.date)}</span>
                  </div>
                  <iframe title="Email body" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={bodyDoc} className="min-h-0 flex-1 bg-white" />
                  <div className="border-t border-slate-200 p-4 sm:hidden">
                    <button onClick={() => openCompose({ to_email: message.email, to_name: message.name, subject: `Re: ${message.subject}` })} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700">
                      Reply
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400">
              <svg className="h-16 w-16 text-slate-200" fill="none" stroke="currentColor" strokeWidth="1.4" viewBox="0 0 24 24"><path d="M3 8l9 6 9-6M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <p>Select a message to read</p>
            </div>
          )}
        </div>
      </div>

      {/* Compose modal */}
      <Modal open={!!compose} onClose={() => setCompose(null)} title="New message">
        {compose && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input value={compose.to_email} onChange={(e) => setCompose({ ...compose, to_email: e.target.value })} placeholder="Recipient email" className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15" />
              <input value={compose.to_name} onChange={(e) => setCompose({ ...compose, to_name: e.target.value })} placeholder="Recipient name (optional)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15" />
            </div>
            <input value={compose.subject} onChange={(e) => setCompose({ ...compose, subject: e.target.value })} placeholder="Subject" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15" />
            <textarea value={compose.body} onChange={(e) => setCompose({ ...compose, body: e.target.value })} placeholder="Write your message…" rows={7} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15" />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={() => setCompose(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Discard</button>
              <button onClick={send} disabled={sending} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Reading pane for a sent message (plain text body). */
function SentReader({ mail, onBack, onDelete, onReply }: { mail: SentMail; onBack: () => void; onDelete: () => void; onReply: () => void }) {
  return (
    <>
      <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-4">
        <button onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <h2 className="flex-1 truncate text-lg font-bold text-slate-900">{mail.subject}</h2>
        <button onClick={onDelete} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" title="Delete">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-lg font-bold text-slate-500">{initial(mail.name, mail.email)}</span>
          <div>
            <div className="font-semibold text-slate-900">To {mail.name}</div>
            <div className="text-sm text-slate-500">{mail.email}</div>
          </div>
          <span className="ml-auto text-xs text-slate-400">{timeLong(mail.created_at)}</span>
        </div>
        <p className="whitespace-pre-line leading-relaxed text-slate-700">{mail.body}</p>
      </div>
      <div className="border-t border-slate-200 p-4">
        <button onClick={onReply} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 10h10a4 4 0 014 4v2M3 10l4-4M3 10l4 4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Forward again
        </button>
      </div>
    </>
  );
}

/** Shown when no Gmail account is connected yet. */
function SetupNotice() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-50">
        <svg className="h-7 w-7 text-rose-500" fill="currentColor" viewBox="0 0 24 24"><path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0-8 5L4 6h16zm0 12H4V8l8 5 8-5v10z" /></svg>
      </span>
      <h3 className="text-base font-bold text-slate-800">Connect a Gmail account</h3>
      <p className="max-w-xs text-sm text-slate-500">
        Add your Gmail address and a Google <b>App Password</b> in settings to start reading mail here.
      </p>
      <Link href="/admin/integrations" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
        Connect Gmail
      </Link>
    </div>
  );
}

/** Shown when the IMAP connection itself fails. */
function ErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-50">
        <svg className="h-7 w-7 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <h3 className="text-base font-bold text-slate-800">Couldn’t reach Gmail</h3>
      <p className="max-w-xs break-words text-sm text-slate-500">{message}</p>
      <button onClick={onRetry} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Try again</button>
    </div>
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
