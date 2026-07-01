"use client";

// A single, brand-colourable loading indicator with several selectable styles.
// Colour comes from `currentColor`, so callers set the tone with a text-* class
// (e.g. `text-emerald-500`, which the client shell remaps to the brand colour).
// Sizes scale off the `size` prop (px) so one component covers boot screens,
// page loaders and inline "saving…" spinners alike.

import type { LoaderStyle } from "../lib/theme";

/** Diagonal stagger (seconds) for the 3×3 grid cells, by index 0–8. */
const GRID_DELAY = [0, 0.12, 0.24, 0.12, 0.24, 0.36, 0.24, 0.36, 0.48];

function Mark({ variant, size }: { variant: LoaderStyle; size: number }) {
  switch (variant) {
    case "ring":
      return (
        <span
          className="block animate-spin rounded-full border-current border-t-transparent"
          style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 8)) }}
        />
      );

    case "dots":
      return (
        <span className="inline-flex items-end" style={{ gap: size / 7 }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="animate-chat-dot rounded-full bg-current"
              style={{ width: size / 3.5, height: size / 3.5, animationDelay: `${i * 0.16}s` }}
            />
          ))}
        </span>
      );

    case "bars":
      return (
        <span className="inline-flex items-center" style={{ gap: size / 10, height: size }}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="animate-wave rounded-full bg-current"
              style={{ width: Math.max(2, size / 8), height: size, animationDelay: `${i * 0.12}s` }}
            />
          ))}
        </span>
      );

    case "pulse":
      return (
        <span className="relative inline-flex" style={{ width: size, height: size }}>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex rounded-full bg-current opacity-90" style={{ width: size, height: size }} />
        </span>
      );

    case "grid":
      return (
        <span className="grid grid-cols-3" style={{ width: size, height: size, gap: size / 12 }}>
          {GRID_DELAY.map((d, i) => (
            <span key={i} className="ldr-grid rounded-[1px] bg-current" style={{ animationDelay: `${d}s` }} />
          ))}
        </span>
      );

    case "spinner":
    default:
      return (
        <svg className="animate-spin" style={{ width: size, height: size }} fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
        </svg>
      );
  }
}

export default function Loader({
  variant = "spinner",
  size = 32,
  className = "",
  label,
}: {
  variant?: LoaderStyle;
  /** Overall mark size in px. */
  size?: number;
  /** Wrapper classes — set the colour here (e.g. `text-emerald-500`). */
  className?: string;
  /** Optional caption shown beneath the mark. */
  label?: string;
}) {
  return (
    <div className={`inline-flex flex-col items-center justify-center gap-3 ${className}`}>
      <Mark variant={variant} size={size} />
      {label && <span className="text-sm font-medium">{label}</span>}
    </div>
  );
}

/** Centred full-viewport loader (used by the dashboard boot screens). */
export function FullScreenLoader({ variant, className = "text-emerald-500", label }: { variant: LoaderStyle; className?: string; label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <Loader variant={variant} size={36} className={className} label={label} />
    </div>
  );
}
