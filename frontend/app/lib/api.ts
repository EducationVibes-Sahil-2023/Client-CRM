// Base URL of the CodeIgniter backend. Override with NEXT_PUBLIC_API_URL in .env.local.
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

let _redirecting = false;
/**
 * Bounce to the login page on an expired / missing session (HTTP 401). Called by
 * the per-area fetch handlers so any request — initial load or a tab click —
 * sends the user back to login automatically. Guarded against redirect loops.
 */
export function redirectToLogin(): void {
  if (typeof window === "undefined" || _redirecting) return;
  if (window.location.pathname.startsWith("/login")) return;
  _redirecting = true;
  window.location.assign("/login");
}

/**
 * Fetch a file from the backend (with the session cookie) and trigger a browser
 * download. Used for SQL backups / exports. Throws the server message on error.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, { credentials: "include" });
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try {
      const j = await res.json();
      msg = j?.messages?.error ?? j?.message ?? msg;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  const m = /filename="?([^"]+)"?/.exec(cd);
  const name = m ? m[1] : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type Role = "super_admin" | "client_admin" | "staff" | "user";

export interface SessionUser {
  id: number;
  email: string;
  role: Role;
  client_id: number | null;
  /** Set when the account signed in with a weak password and must change it. */
  must_change_password?: boolean;
}

export interface LoginResult {
  message: string;
  user: SessionUser;
}

/**
 * POST /auth/login — sends credentials and stores the backend session cookie.
 * Throws an Error with the server message on failure.
 */
export async function login(
  email: string,
  password: string,
): Promise<LoginResult> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include", // keep the CodeIgniter session cookie
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.messages?.error ?? data?.message ?? "Login failed");
  }

  return data as LoginResult;
}

async function postPublic(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msgs = data?.messages;
    const first =
      msgs && typeof msgs === "object" ? Object.values(msgs)[0] : undefined;
    throw new Error(
      (first as string) ?? data?.message ?? "Something went wrong",
    );
  }

  return data as { message: string; id: number };
}

/** POST /contact — { name, email, company?, message } */
export function sendContact(body: {
  name: string;
  email: string;
  company?: string;
  message: string;
}) {
  return postPublic("/contact", body);
}

/** POST /demo-request — { name, email, company, phone?, teamSize?, interest?, message? } */
export function requestDemo(body: {
  name: string;
  email: string;
  company: string;
  phone?: string;
  teamSize?: string;
  message?: string;
}) {
  return postPublic("/demo-request", body);
}
