"use client";

import { useEffect, useMemo, useState } from "react";
import { getEmailSignature, sendMessage } from "../lib/admin";
import { useToast } from "../components/toast/ToastProvider";
import RichTextEditor from "./RichTextEditor";

export interface ReplyTarget {
  email: string;
  name: string;
  subject?: string;
}

/**
 * Gmail-style reply composer with a rich-text editor and the saved company
 * signature pre-filled. Sends through the local /messages endpoint (Sent
 * folder) — instant, no slow Gmail-API round-trip.
 */
export default function ReplyComposer({
  target,
  onClose,
  onSent,
}: {
  target: ReplyTarget | null;
  onClose: () => void;
  onSent?: () => void;
}) {
  const toast = useToast();
  const [signature, setSignature] = useState<string | null>(null); // null = still loading
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [sending, setSending] = useState(false);

  // Load the company signature once.
  useEffect(() => {
    getEmailSignature().then((s) => setSignature(s || "")).catch(() => setSignature(""));
  }, []);

  // Body seeded with a blank line, then the signature beneath (like Gmail).
  const initialHTML = useMemo(() => {
    const sig = signature ?? "";
    return sig ? `<div><br></div><div>—</div><div class="rte-sig">${sig}</div>` : "<div><br></div>";
  }, [signature]);

  /* eslint-disable react-hooks/set-state-in-effect -- seed form fields when the composer opens */
  useEffect(() => {
    if (target) {
      setSubject(target.subject ?? "");
      setBodyHtml(initialHTML);
    }
  }, [target, initialHTML]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!target) return null;

  // Wait for the signature before mounting the editor so it seeds correctly.
  const ready = signature !== null;

  async function send() {
    const text = bodyHtml.replace(/<[^>]*>/g, "").trim();
    if (!text) {
      toast.warning("Write a message first.");
      return;
    }
    setSending(true);
    try {
      const res = await sendMessage({
        to_email: target!.email,
        to_name: target!.name || undefined,
        subject: subject.trim() || undefined,
        body: bodyHtml,
      });
      if (!res.sent) {
        // Delivery failed — keep the composer open so they can fix config / retry.
        toast.error(res.error || "The email could not be delivered. Check Integrations → Email.", { title: "Not sent", duration: 9000 });
        return;
      }
      toast.success(`Reply delivered to ${target!.name || target!.email}.`, { title: "Email sent" });
      onSent?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send message");
    } finally {
      setSending(false);
    }
  }

  const close = () => { if (!sending) onClose(); };

  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={close} />
      <div className="animate-fade-up relative flex w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl">
        {/* Gmail-style dark header */}
        <div className="flex items-center justify-between bg-slate-800 px-4 py-2.5 text-white">
          <span className="text-sm font-semibold">New message</span>
          <button onClick={close} className="flex h-7 w-7 items-center justify-center rounded text-slate-300 hover:bg-white/10 hover:text-white" title="Close">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="px-4">
          {/* To */}
          <div className="flex items-center gap-2 border-b border-slate-200 py-2.5 text-sm">
            <span className="text-slate-400">To</span>
            <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-600">
                {(target.name || target.email).slice(0, 1).toUpperCase()}
              </span>
              <span className="text-slate-700">{target.name || target.email}</span>
              <span className="text-slate-400">&lt;{target.email}&gt;</span>
            </span>
          </div>
          {/* Subject */}
          <div className="border-b border-slate-200 py-1">
            <input
              className="w-full bg-transparent py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
        </div>

        {/* Body editor */}
        <div className="px-4 py-3">
          {ready && (
            <RichTextEditor
              key={`${target.email}:${signature ? "sig" : "nosig"}`}
              initialHTML={initialHTML}
              onChange={setBodyHtml}
              placeholder="Write your reply…"
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-4 pb-4">
          <button
            onClick={send}
            disabled={sending}
            className="flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {sending ? (
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
            {sending ? "Sending…" : "Send"}
          </button>
          <span className="text-xs text-slate-400">Sent via Gmail · signature added automatically</span>
        </div>
      </div>
    </div>
  );
}
