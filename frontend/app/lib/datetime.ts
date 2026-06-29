/**
 * Centralised date/time formatting for the whole app. Backend timestamps are
 * stored in UTC ("YYYY-MM-DD HH:MM:SS", no zone); every value here is parsed as
 * UTC and rendered in India Standard Time (Asia/Kolkata) so the entire website
 * shows consistent IST regardless of the viewer's machine timezone.
 */

export const APP_TZ = "Asia/Kolkata";
const LOCALE = "en-IN";

/** Parse a backend timestamp into a Date, treating zone-less values as UTC. */
export function parseServer(iso?: string | null): Date | null {
  if (!iso) return null;
  let s = String(iso).trim().replace(" ", "T");
  // No timezone designator → backend value is UTC, so mark it as such.
  if (!/([zZ])|([+-]\d{2}:?\d{2})$/.test(s)) s += "Z";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "4 Jun 2026" */
export function fmtDate(iso?: string | null): string {
  const d = parseServer(iso);
  if (!d) return "—";
  return d.toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone: APP_TZ });
}

/** "4 Jun 2026, 8:30 pm" */
export function fmtDateTime(iso?: string | null): string {
  const d = parseServer(iso);
  if (!d) return "—";
  return d.toLocaleString(LOCALE, {
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: APP_TZ,
  });
}

/** "8:30 pm" */
export function fmtTime(iso?: string | null): string {
  const d = parseServer(iso);
  if (!d) return "—";
  return d.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit", timeZone: APP_TZ });
}

/** Relative "just now / 5 min ago / 3h ago / 2d ago", then falls back to a date. */
export function timeAgo(iso?: string | null): string {
  const d = parseServer(iso);
  if (!d) return "";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const day = Math.floor(h / 24);
  if (day < 7) return `${day}d ago`;
  return fmtDate(iso);
}
