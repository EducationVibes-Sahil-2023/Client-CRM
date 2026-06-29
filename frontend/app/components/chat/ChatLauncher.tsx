"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { chatPoll, type ChatArea } from "../../lib/chat";
import { notifyMessage, requestNotifyPermission } from "../../lib/notify";
import ChatView from "./ChatView";

// Per-area theming + deep-link target for the full-screen chat page.
const AREA = {
  superadmin: { chatPath: "/admin/chat", fab: "bg-indigo-600 shadow-indigo-600/30 hover:bg-indigo-700 hover:shadow-indigo-600/40" },
  client: { chatPath: "/client/chat", fab: "bg-emerald-600 shadow-emerald-600/30 hover:bg-emerald-700 hover:shadow-emerald-600/40" },
  staff: { chatPath: "/staff/chat", fab: "bg-sky-600 shadow-sky-600/30 hover:bg-sky-700 hover:shadow-sky-600/40" },
} as const;

/**
 * Floating, messenger-style chat launcher. Shows a global unread badge (polled
 * independently so it works even while the widget is closed) and opens a compact
 * popup hosting the widget variant of ChatView. The popup can be expanded to the
 * full-screen chat page. Themed + routed per area (super-admin, client, staff).
 */
export default function ChatLauncher({ area = "superadmin" }: { area?: ChatArea }) {
  const cfg = AREA[area];
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const prevUnreadRef = useRef(0);
  const openRef = useRef(false);

  useEffect(() => { openRef.current = open; }, [open]);

  // Independent lightweight poll just for the badge + desktop notification.
  useEffect(() => {
    let cancelled = false;
    requestNotifyPermission();
    const tick = async () => {
      try {
        const { chat_unread } = await chatPoll(area);
        if (cancelled) return;
        setUnread(chat_unread);
        // Unread climbed while the widget is closed → desktop alert + badge only.
        if (chat_unread > prevUnreadRef.current && !openRef.current) {
          notifyMessage("New message", "You have a new message in chat.");
        }
        prevUnreadRef.current = chat_unread;
      } catch {
        /* keep polling */
      }
    };
    tick();
    const t = window.setInterval(tick, 3000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [area]);

  // Don't overlay the full-screen chat page with its own widget.
  if (pathname?.startsWith(cfg.chatPath)) return null;

  function expand() {
    setOpen(false);
    router.push(cfg.chatPath);
  }

  return (
    <>
      {open && (
        <div className="animate-fade-up fixed bottom-24 right-4 z-40 flex h-[560px] max-h-[calc(100vh-7rem)] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl sm:right-6">
          <ChatView area={area} variant="widget" onExpand={expand} />
        </div>
      )}

      <button
        onClick={() => { requestNotifyPermission(); setOpen((o) => !o); }}
        aria-label={open ? "Close chat" : "Open chat"}
        className={`fixed bottom-6 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-xl transition sm:right-6 ${cfg.fab}`}
      >
        {open ? (
          <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" /></svg>
        ) : (
          <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 01-9 8.4 9.6 9.6 0 01-3.7-.6L3 21l1.3-4a8.2 8.2 0 01-1-4A8.4 8.4 0 0112 3.5a8.4 8.4 0 019 8z" strokeLinecap="round" strokeLinejoin="round" /></svg>
        )}
        {!open && unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-red-500 px-1 text-[11px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </>
  );
}
