"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  chatPoll,
  getChatClients,
  getConversations,
  getDirectory,
  getMessages,
  sendChatMessage,
  startConversation,
  startDm,
  type ChatArea,
  type ChatMessage,
  type Conversation,
  type DirectoryMember,
} from "../../lib/chat";
import { API_URL } from "../../lib/api";
import { notifyMessage, requestNotifyPermission } from "../../lib/notify";
import { useToast } from "../toast/ToastProvider";
import { Modal } from "../../admin/ui";
import { APP_TZ, fmtDate, fmtTime, parseServer } from "../../lib/datetime";

const styles = {
  superadmin: {
    active: "bg-indigo-50 text-indigo-700",
    badge: "bg-indigo-600",
    mine: "bg-indigo-600 text-white",
    send: "bg-indigo-600 hover:bg-indigo-700",
    ring: "focus:border-indigo-400 focus:ring-indigo-500/15",
    avatar: "bg-indigo-100 text-indigo-600",
  },
  client: {
    active: "bg-emerald-50 text-emerald-700",
    badge: "bg-emerald-600",
    mine: "bg-emerald-600 text-white",
    send: "bg-emerald-600 hover:bg-emerald-700",
    ring: "focus:border-emerald-400 focus:ring-emerald-500/15",
    avatar: "bg-emerald-100 text-emerald-600",
  },
  staff: {
    active: "bg-sky-50 text-sky-700",
    badge: "bg-sky-600",
    mine: "bg-sky-600 text-white",
    send: "bg-sky-600 hover:bg-sky-700",
    ring: "focus:border-sky-400 focus:ring-sky-500/15",
    avatar: "bg-sky-100 text-sky-600",
  },
};

const EMOJIS = ["😀","😁","😂","🤣","😊","😍","😘","😎","🤔","😅","🙌","👏","👍","🙏","🔥","🎉","❤️","💯","✅","⚡","📌","🚀","👀","😢","😡","🤝","💼","📞","📅","✨"];
const PAGE = 30;

// IST calendar-day key (YYYY-MM-DD) for "is it today?" comparisons.
function istDayKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: APP_TZ });
}
function timeLabel(iso: string): string {
  return parseServer(iso) ? fmtTime(iso) : "";
}
function dayLabel(iso: string): string {
  const d = parseServer(iso);
  if (!d) return "";
  return istDayKey(d) === istDayKey(new Date()) ? "Today" : fmtDate(iso);
}
function fmtSize(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function initial(name: string): string {
  return (name.trim().slice(0, 1) || "?").toUpperCase();
}

/** Image thumbnail or a downloadable file chip for a message attachment. */
function Attachment({ m, mine }: { m: ChatMessage; mine: boolean }) {
  if (!m.attachment_url) return null;
  const url = `${API_URL}${m.attachment_url}`;
  const isImage = (m.attachment_type ?? "").startsWith("image/");
  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mt-1 block overflow-hidden rounded-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={m.attachment_name ?? "image"} className="max-h-60 w-auto max-w-full rounded-xl object-cover" />
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`mt-1 flex items-center gap-2.5 rounded-xl border px-3 py-2 transition ${mine ? "border-white/25 bg-white/10 hover:bg-white/15" : "border-slate-200 bg-slate-50 hover:bg-slate-100"}`}
    >
      <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${mine ? "bg-white/20" : "bg-slate-200 text-slate-500"}`}>
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span className="min-w-0">
        <span className="block max-w-[180px] truncate text-xs font-semibold">{m.attachment_name}</span>
        <span className={`block text-[10px] ${mine ? "text-white/70" : "text-slate-400"}`}>{fmtSize(m.attachment_size)}</span>
      </span>
    </a>
  );
}

export default function ChatView({
  area,
  variant = "full",
  onExpand,
}: {
  area: ChatArea;
  variant?: "full" | "widget";
  onExpand?: () => void;
}) {
  const toast = useToast();
  const s = styles[area];
  const isSuper = area === "superadmin";
  // Client admins and staff can start 1:1 DMs with other members of their team.
  const canDirectMessage = area === "client" || area === "staff";
  const compact = variant === "widget";

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");

  const [emojiOpen, setEmojiOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [clients, setClients] = useState<{ id: number; name: string }[]>([]);
  const [dirOpen, setDirOpen] = useState(false);
  const [directory, setDirectory] = useState<DirectoryMember[]>([]);
  const [dirLoading, setDirLoading] = useState(false);

  const activeIdRef = useRef<number | null>(null);
  const lastIdRef = useRef(0);
  const firstIdRef = useRef(0);
  const hasMoreRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const unreadMapRef = useRef<Map<number, number>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const infoRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  const isNearBottom = () => {
    const el = scrollRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // Close emoji / info popovers on an outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setEmojiOpen(false);
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) setInfoOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const openConversation = useCallback(
    async (id: number) => {
      setActiveId(id);
      activeIdRef.current = id;
      setInfoOpen(false);
      lastIdRef.current = 0;
      firstIdRef.current = 0;
      hasMoreRef.current = false;
      setMessages([]);
      setLoadingThread(true);
      try {
        const { messages: msgs, has_more } = await getMessages(area, id, { limit: PAGE });
        setMessages(msgs);
        lastIdRef.current = msgs.length ? msgs[msgs.length - 1].id : 0;
        firstIdRef.current = msgs.length ? msgs[0].id : 0;
        hasMoreRef.current = has_more;
        setHasMore(has_more);
        setConversations((cs) => cs.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
        unreadMapRef.current.set(id, 0);
        scrollToBottom();
      } catch {
        /* transient */
      } finally {
        setLoadingThread(false);
      }
    },
    [area],
  );

  const loadConversations = useCallback(
    async (autoOpen: boolean) => {
      const { conversations: list } = await getConversations(area);
      setConversations(list);
      list.forEach((c) => unreadMapRef.current.set(c.id, c.unread));
      if (autoOpen && activeIdRef.current === null && list.length > 0) {
        await openConversation(list[0].id);
      }
    },
    [area, openConversation],
  );

  // Prepend the next page of older history, preserving the scroll position.
  const loadOlder = useCallback(async () => {
    const id = activeIdRef.current;
    if (id === null || loadingOlderRef.current || !hasMoreRef.current || !firstIdRef.current) return;
    loadingOlderRef.current = true;
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const { messages: older, has_more } = await getMessages(area, id, { before: firstIdRef.current, limit: PAGE });
      if (older.length) {
        setMessages((m) => [...older, ...m]);
        firstIdRef.current = older[0].id;
      }
      hasMoreRef.current = has_more;
      setHasMore(has_more);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch {
      /* transient */
    } finally {
      loadingOlderRef.current = false;
    }
  }, [area]);

  function onThreadScroll() {
    const el = scrollRef.current;
    if (el && el.scrollTop < 64 && hasMoreRef.current && !loadingOlderRef.current) loadOlder();
  }

  // Initial load (client auto-opens its single support thread).
  useEffect(() => {
    let cancelled = false;
    requestNotifyPermission();
    (async () => {
      try {
        const { conversations: list } = await getConversations(area);
        if (cancelled) return;
        setConversations(list);
        list.forEach((c) => unreadMapRef.current.set(c.id, c.unread));
        if (!isSuper && list.length > 0) await openConversation(list[0].id);
      } catch {
        /* transient */
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (isSuper) {
        try {
          const { clients: cl } = await getChatClients();
          if (!cancelled) setClients(cl);
        } catch {
          /* optional */
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2s poll: refresh unread badges + append new messages to the open thread.
  useEffect(() => {
    const tick = async () => {
      try {
        const poll = await chatPoll(area);

        let sawNew = false;
        const known = new Set(conversations.map((c) => c.id));
        for (const p of poll.conversations) {
          const prev = unreadMapRef.current.get(p.id) ?? 0;
          if (p.id !== activeIdRef.current && p.unread > prev) sawNew = true;
          if (!known.has(p.id)) sawNew = true; // a brand-new conversation appeared
        }

        setConversations((cs) =>
          cs.map((c) => {
            const p = poll.conversations.find((x) => x.id === c.id);
            const unread = c.id === activeIdRef.current ? 0 : p?.unread ?? c.unread;
            return p ? { ...c, unread, last_message_at: p.last_message_at } : c;
          }),
        );
        poll.conversations.forEach((p) => {
          if (p.id !== activeIdRef.current) unreadMapRef.current.set(p.id, p.unread);
        });

        if (poll.conversations.some((p) => !known.has(p.id))) {
          await loadConversations(false);
        }
        // New message in a thread I'm not currently viewing → desktop alert only
        // (the unread badge is the in-app cue; no top-right toast).
        if (sawNew) notifyMessage("New message", "You have a new message in chat.");

        if (activeIdRef.current !== null && lastIdRef.current >= 0) {
          const { messages: fresh } = await getMessages(area, activeIdRef.current, { after: lastIdRef.current });
          if (fresh.length) {
            const stick = isNearBottom();
            setMessages((m) => [...m, ...fresh]);
            lastIdRef.current = fresh[fresh.length - 1].id;
            if (stick) scrollToBottom();
            // Incoming message while the tab isn't focused → desktop alert.
            if (typeof document !== "undefined" && document.hidden) {
              const last = [...fresh].reverse().find((msg) => !msg.is_mine);
              if (last) notifyMessage(last.sender_name || "New message", last.body || "📎 Attachment");
            }
          }
        }
      } catch {
        /* keep polling */
      }
    };
    const t = window.setInterval(tick, 2000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area, conversations]);

  function addEmoji(e: string) {
    setDraft((d) => d + e);
  }

  function pickFile(f: File | null) {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      toast.error("File must be 10MB or smaller.");
      return;
    }
    setFile(f);
  }

  async function send() {
    const body = draft.trim();
    if ((!body && !file) || activeId === null || sending) return;
    setSending(true);
    try {
      const { message } = await sendChatMessage(area, activeId, body, file);
      setMessages((m) => [...m, message]);
      lastIdRef.current = message.id;
      setDraft("");
      setFile(null);
      const preview = body || `📎 ${message.attachment_name ?? "Attachment"}`;
      setConversations((cs) =>
        cs.map((c) => (c.id === activeId ? { ...c, last_message: preview, last_message_at: message.created_at } : c)),
      );
      scrollToBottom();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send message");
    } finally {
      setSending(false);
    }
  }

  async function startWithClient(clientId: number) {
    setPickerOpen(false);
    try {
      const { conversation } = await startConversation(area, clientId);
      await loadConversations(false);
      await openConversation(conversation.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start conversation");
    }
  }

  async function openDirectory() {
    setDirOpen(true);
    setDirLoading(true);
    try {
      const { members } = await getDirectory(area);
      setDirectory(members);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load people");
    } finally {
      setDirLoading(false);
    }
  }

  async function startWithMember(m: DirectoryMember) {
    setDirOpen(false);
    try {
      const { conversation } = await startDm(area, m.party_type, m.party_id);
      await loadConversations(false);
      await openConversation(conversation.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start conversation");
    }
  }

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const visible = search.trim()
    ? conversations.filter((c) => c.title.toLowerCase().includes(search.trim().toLowerCase()))
    : conversations;

  const listCls = compact
    ? `w-full ${activeId !== null ? "hidden" : "flex"}`
    : `w-72 flex-shrink-0 ${activeId !== null ? "hidden md:flex" : "flex"}`;
  const threadCls = compact
    ? `flex-1 ${activeId === null ? "hidden" : "flex"}`
    : `flex-1 ${activeId === null ? "hidden md:flex" : "flex"}`;

  const shell = compact
    ? "flex h-full w-full overflow-hidden bg-white"
    : "flex h-[calc(100vh-9rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm";

  return (
    <div className={shell}>
      {/* Conversation list */}
      <div className={`flex-col border-r border-slate-200 ${listCls}`}>
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-3">
          <h2 className="font-semibold text-slate-900">Messages</h2>
          <div className="flex items-center gap-1">
            {compact && onExpand && (
              <button onClick={onExpand} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" title="Open full screen">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
            {(isSuper || canDirectMessage) && (
              <button onClick={() => (isSuper ? setPickerOpen(true) : openDirectory())} className={`flex h-8 w-8 items-center justify-center rounded-lg text-white ${s.send}`} title="New chat">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
              </button>
            )}
          </div>
        </div>
        {/* Search */}
        <div className="border-b border-slate-100 px-3 py-2.5">
          <div className="relative">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations…"
              className={`w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 ${s.ring}`}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-sm text-slate-400">Loading…</div>
          ) : visible.length === 0 ? (
            <div className="p-4 text-sm text-slate-400">
              {search.trim() ? "No matches." : isSuper ? "No conversations yet. Start one with a client." : "No conversations yet."}
            </div>
          ) : (
            visible.map((c) => (
              <button
                key={c.id}
                onClick={() => openConversation(c.id)}
                className={`flex w-full items-center gap-3 border-b border-slate-50 px-3 py-3 text-left transition hover:bg-slate-50 ${c.id === activeId ? s.active : ""}`}
              >
                <span className="relative flex-shrink-0">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold ${s.avatar}`}>{initial(c.title)}</span>
                  <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-slate-800">{c.title}</span>
                    {c.last_message_at && <span className="flex-shrink-0 text-[11px] text-slate-400">{timeLabel(c.last_message_at)}</span>}
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className={`truncate text-xs ${c.unread > 0 ? "font-semibold text-slate-600" : "text-slate-400"}`}>{c.last_message ?? "No messages yet"}</span>
                    {c.unread > 0 && (
                      <span className={`flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white ${s.badge}`}>{c.unread}</span>
                    )}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Thread */}
      <div className={`flex-col ${threadCls}`}>
        {active ? (
          <>
            <div className="relative flex items-center gap-3 border-b border-slate-100 px-3 py-2.5">
              <button onClick={() => { setActiveId(null); activeIdRef.current = null; }} className={`flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 ${compact ? "flex" : "md:hidden"}`}>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <span className="relative flex-shrink-0">
                <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${s.avatar}`}>{initial(active.title)}</span>
                <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-slate-900">{active.title}</div>
                <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Online</div>
              </div>

              <div className="flex items-center gap-0.5 text-slate-400">
                {!compact && (
                  <>
                    <button disabled title="Voice call (coming soon)" className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-slate-100 disabled:opacity-50">
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012 4.2 2 2 0 014 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.6a2 2 0 01-.4 2.1L8 9.6a16 16 0 006 6l1.2-1.2a2 2 0 012.1-.5c.8.3 1.7.6 2.6.7a2 2 0 011.7 2z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    <button disabled title="Video call (coming soon)" className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-slate-100 disabled:opacity-50">
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M23 7l-7 5 7 5V7z M1 5h13a2 2 0 012 2v10a2 2 0 01-2 2H3a2 2 0 01-2-2V5z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  </>
                )}
                <div ref={infoRef} className="relative">
                  <button onClick={() => setInfoOpen((o) => !o)} title="Details" className={`flex h-9 w-9 items-center justify-center rounded-lg hover:bg-slate-100 ${infoOpen ? "bg-slate-100 text-slate-600" : ""}`}>
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" strokeLinecap="round" /></svg>
                  </button>
                  {infoOpen && (
                    <div className="animate-fade-up absolute right-0 top-11 z-10 w-60 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-2xl">
                      <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold ${s.avatar}`}>{initial(active.title)}</span>
                      <div className="mt-2 font-semibold text-slate-900">{active.title}</div>
                      <div className="text-xs text-slate-400">{active.type === "team" ? "Team room" : active.type === "dm" ? "Direct message" : "Support conversation"}</div>
                      <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-left text-xs text-slate-500">
                        <div className="flex justify-between"><span>Status</span><span className="font-medium text-emerald-600">Online</span></div>
                        {active.client_id != null && <div className="flex justify-between"><span>Client ID</span><span className="font-medium text-slate-700">#{active.client_id}</span></div>}
                        {active.last_message_at && <div className="flex justify-between"><span>Last active</span><span className="font-medium text-slate-700">{dayLabel(active.last_message_at)}</span></div>}
                      </div>
                    </div>
                  )}
                </div>
                {compact && onExpand && (
                  <button onClick={onExpand} title="Open full screen" className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-slate-100">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                )}
              </div>
            </div>

            <div ref={scrollRef} onScroll={onThreadScroll} className="flex-1 space-y-2 overflow-y-auto bg-slate-50/60 p-4">
              {hasMore && (
                <div className="flex justify-center py-1"><span className="text-[11px] text-slate-400">Loading earlier messages…</span></div>
              )}
              {loadingThread && messages.length === 0 && <div className="py-10 text-center text-sm text-slate-400">Loading…</div>}
              {!loadingThread && messages.length === 0 && <div className="py-10 text-center text-sm text-slate-400">No messages yet. Say hello 👋</div>}
              {messages.map((m, i) => {
                const showDay = i === 0 || dayLabel(messages[i - 1].created_at) !== dayLabel(m.created_at);
                return (
                  <div key={m.id}>
                    {showDay && (
                      <div className="my-3 flex justify-center"><span className="rounded-full bg-slate-200/70 px-3 py-0.5 text-[11px] font-medium text-slate-500">{dayLabel(m.created_at)}</span></div>
                    )}
                    <div className={`flex ${m.is_mine ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${m.is_mine ? s.mine : "bg-white text-slate-700"}`}>
                        {!m.is_mine && !compact && <div className="mb-0.5 text-[11px] font-semibold opacity-70">{m.sender_name}</div>}
                        {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                        <Attachment m={m} mine={m.is_mine} />
                        <div className={`mt-0.5 text-[10px] ${m.is_mine ? "text-white/70" : "text-slate-400"}`}>{timeLabel(m.created_at)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Composer */}
            <div className="border-t border-slate-100 p-3">
              {file && (
                <div className="mb-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                  <svg className="h-4 w-4 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21.4 11.1l-9 9a5 5 0 01-7.1-7.1l9-9a3.3 3.3 0 014.7 4.7l-9 9a1.7 1.7 0 01-2.4-2.4l8.3-8.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{file.name}</span>
                  <span className="flex-shrink-0 text-slate-400">{fmtSize(file.size)}</span>
                  <button onClick={() => setFile(null)} className="flex-shrink-0 rounded-md p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" /></svg>
                  </button>
                </div>
              )}
              <div className="flex items-end gap-1.5">
                <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                <button onClick={() => fileInputRef.current?.click()} title="Attach file" className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21.4 11.1l-9 9a5 5 0 01-7.1-7.1l9-9a3.3 3.3 0 014.7 4.7l-9 9a1.7 1.7 0 01-2.4-2.4l8.3-8.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  rows={1}
                  placeholder="Type a message…"
                  className={`max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 ${s.ring}`}
                />
                <div ref={emojiRef} className="relative">
                  <button onClick={() => setEmojiOpen((o) => !o)} title="Emoji" className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 ${emojiOpen ? "bg-slate-100 text-slate-600" : ""}`}>
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  {emojiOpen && (
                    <div className="animate-fade-up absolute bottom-12 right-0 z-10 grid w-64 grid-cols-8 gap-0.5 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
                      {EMOJIS.map((e) => (
                        <button key={e} onClick={() => addEmoji(e)} className="flex h-7 w-7 items-center justify-center rounded-lg text-lg hover:bg-slate-100">{e}</button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={send} disabled={sending || (!draft.trim() && !file)} className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-white transition disabled:opacity-50 ${s.send}`} title="Send">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-slate-400">
            <svg className="h-12 w-12 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Select a conversation to start chatting
          </div>
        )}
      </div>

      {isSuper && (
        <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="Start a chat">
          <div className="max-h-96 space-y-1 overflow-y-auto">
            {clients.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">No clients yet.</p>
            ) : (
              clients.map((c) => (
                <button key={c.id} onClick={() => startWithClient(c.id)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-slate-50">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${s.avatar}`}>{initial(c.name)}</span>
                  <span className="font-medium text-slate-800">{c.name}</span>
                </button>
              ))
            )}
          </div>
        </Modal>
      )}

      {canDirectMessage && (
        <Modal open={dirOpen} onClose={() => setDirOpen(false)} title="New message">
          <div className="max-h-96 space-y-1 overflow-y-auto">
            {dirLoading ? (
              <p className="py-6 text-center text-sm text-slate-400">Loading…</p>
            ) : directory.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">No one else in your team yet.</p>
            ) : (
              directory.map((m) => (
                <button
                  key={`${m.party_type}:${m.party_id}`}
                  onClick={() => startWithMember(m)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-slate-50"
                >
                  <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${s.avatar}`}>{initial(m.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">{m.name}</span>
                    <span className="block text-xs text-slate-400">{m.role_label}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
