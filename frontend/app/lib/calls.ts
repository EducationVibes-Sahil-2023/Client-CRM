// Shared presentation helpers for call-tracking records.

export const CALL_TYPE_LABEL: Record<string, string> = {
  incoming: "Incoming",
  outgoing: "Outgoing",
  missed: "Missed",
};

export const CALL_SOURCE_LABEL: Record<string, string> = {
  ivr: "IVR",
  phone: "Phone",
};

/** Tailwind classes for a call-direction pill. */
export const callTypeChip = (type: string | null | undefined): string => {
  switch (type) {
    case "incoming": return "bg-emerald-100 text-emerald-700";
    case "outgoing": return "bg-indigo-100 text-indigo-700";
    case "missed": return "bg-rose-100 text-rose-700";
    default: return "bg-slate-100 text-slate-600";
  }
};

/** Human duration, e.g. 0 → "—", 75 → "1m 15s". */
export function formatDuration(seconds: number | null | undefined): string {
  const s = Number(seconds ?? 0);
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m ? `${m}m ${rem}s` : `${rem}s`;
}

// ----------------------------------------------------------- call statuses

export interface CallStatusMeta {
  /** Normalised key (UPPER_SNAKE). */
  key: string;
  label: string;
  /** Hex colour for charts/dots. */
  color: string;
  /** Tailwind classes for a status pill. */
  chip: string;
}

// Tone → (hex, pill classes). Keeps every status visually consistent.
const TONE = {
  good: { color: "#10b981", chip: "bg-emerald-100 text-emerald-700" },     // answered
  warn: { color: "#f59e0b", chip: "bg-amber-100 text-amber-700" },          // missed / busy
  bad: { color: "#f43f5e", chip: "bg-rose-100 text-rose-700" },             // rejected / blocked
  neutral: { color: "#94a3b8", chip: "bg-slate-100 text-slate-600" },       // unknown
};

/** Canonical call statuses (order = display order in filters/charts). */
export const CALL_STATUSES: CallStatusMeta[] = [
  { key: "ANSWERED", label: "Answered", ...TONE.good },
  { key: "ANSWER", label: "Answer", ...TONE.good },
  { key: "MISSED", label: "Missed", ...TONE.warn },
  { key: "NOTPICKED", label: "NotPicked", ...TONE.warn },
  { key: "BUSY", label: "Busy", ...TONE.warn },
  { key: "AGENT_BUSY", label: "Agent Busy", ...TONE.warn },
  { key: "REJECTED", label: "Rejected", ...TONE.bad },
  { key: "BLOCKED", label: "Blocked", ...TONE.bad },
  { key: "CANCELLED", label: "Cancelled", ...TONE.bad },
  { key: "DISCONNECTED_BY_CALLER", label: "Disconnected By Caller", ...TONE.bad },
  { key: "UNKNOWN", label: "Unknown", ...TONE.neutral },
  { key: "STATUS_UNKNOWN", label: "STATUS_UNKNOWN", ...TONE.neutral },
];

const STATUS_BY_KEY: Record<string, CallStatusMeta> = Object.fromEntries(
  CALL_STATUSES.map((s) => [s.key, s]),
);

/** Normalise a raw status string to an UPPER_SNAKE key for matching. */
export function normalizeStatusKey(raw?: string | null): string {
  return (raw ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

/** Resolve a (possibly free-text) status to its metadata, with a safe fallback. */
export function statusMeta(raw?: string | null): CallStatusMeta {
  const key = normalizeStatusKey(raw);
  if (STATUS_BY_KEY[key]) return STATUS_BY_KEY[key];
  return { key: key || "UNKNOWN", label: (raw ?? "").trim() || "Unknown", ...TONE.neutral };
}
