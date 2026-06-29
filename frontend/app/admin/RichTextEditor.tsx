"use client";

import { useEffect, useRef } from "react";

interface ToolButton {
  cmd: string;
  arg?: string;
  title: string;
  icon: React.ReactNode;
  prompt?: string; // when set, ask for a value (e.g. link URL)
}

const I = ({ d }: { d: string }) => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={d} strokeLinecap="round" strokeLinejoin="round" /></svg>
);

const BUTTONS: ToolButton[] = [
  { cmd: "bold", title: "Bold", icon: <span className="text-[13px] font-bold">B</span> },
  { cmd: "italic", title: "Italic", icon: <span className="text-[13px] italic">I</span> },
  { cmd: "underline", title: "Underline", icon: <span className="text-[13px] underline">U</span> },
  { cmd: "insertUnorderedList", title: "Bullet list", icon: <I d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /> },
  { cmd: "insertOrderedList", title: "Numbered list", icon: <I d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 16H4v4h2" /> },
  { cmd: "createLink", prompt: "Link URL:", title: "Insert link", icon: <I d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" /> },
];

/**
 * Lightweight rich-text editor (contentEditable + execCommand). Uncontrolled:
 * seeded once from `initialHTML` and reports edits via `onChange`. Remount it
 * (with a `key`) to re-seed with new content.
 */
export default function RichTextEditor({
  initialHTML = "",
  onChange,
  placeholder,
  minHeight = 180,
}: {
  initialHTML?: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHTML;
    // Seed once on mount; remount via key to change content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = () => onChange(ref.current?.innerHTML ?? "");

  const run = (b: ToolButton) => {
    ref.current?.focus();
    if (b.prompt) {
      const url = window.prompt(b.prompt, "https://");
      if (!url) return;
      document.execCommand(b.cmd, false, url);
    } else {
      document.execCommand(b.cmd);
    }
    emit();
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-300 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/15">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
        {BUTTONS.map((b) => (
          <button
            key={b.cmd}
            type="button"
            title={b.title}
            onMouseDown={(e) => { e.preventDefault(); run(b); }}
            className="flex h-7 w-7 items-center justify-center rounded text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
          >
            {b.icon}
          </button>
        ))}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        data-placeholder={placeholder}
        className="rte-content w-full overflow-y-auto px-3 py-2.5 text-sm leading-relaxed text-slate-800 focus:outline-none"
        style={{ minHeight, maxHeight: 360 }}
      />
    </div>
  );
}
