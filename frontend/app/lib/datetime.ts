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

// ---- Wall-clock timestamps (already in the intended local time) --------------
// Call times are stored EXACTLY as the dialer sent them (IST wall-clock, no zone),
// so they must be shown as-is — NOT parsed as UTC and shifted by +5:30 like the
// UTC-stored columns above. These render the literal date/time digits.

/** Parse "YYYY-MM-DD HH:MM(:SS)" literally into date parts (no timezone math). */
function parseWall(s?: string | null): Date | null {
  if (!s) return null;
  const m = String(s).match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "4 Jun 2026" from a wall-clock value (no shift). */
export function fmtWallDate(s?: string | null): string {
  const d = parseWall(s);
  return d ? d.toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" }) : "—";
}

/** "4 Jun 2026, 8:30 pm" from a wall-clock value (no shift). */
export function fmtWallDateTime(s?: string | null): string {
  const d = parseWall(s);
  return d ? d.toLocaleString(LOCALE, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}

/** "8:30 pm" from a wall-clock value (no shift). */
export function fmtWallTime(s?: string | null): string {
  const d = parseWall(s);
  return d ? d.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" }) : "—";
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
