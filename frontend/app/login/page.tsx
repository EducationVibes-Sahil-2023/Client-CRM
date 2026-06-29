"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { login, type Role } from "../lib/api";
import { isEmail } from "../lib/validation";
import { useToast } from "../components/toast/ToastProvider";

// Where each account type lands after signing in.
const dashboards: Record<Role, string> = {
  super_admin: "/admin",
  client_admin: "/client",
  staff: "/client", // staff share the client dashboard, scoped by their permissions
  user: "/dashboard",
};

const highlights = [
  "Real-time dashboard & call tracker",
  "Auto lead transfer & staff chat",
  "Follow-ups, reports & permissions",
];

export default function Login() {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);

  function validate(): boolean {
    const e: { email?: string; password?: string } = {};
    if (!email.trim()) e.email = "Email is required";
    else if (!isEmail(email)) e.email = "Enter a valid email address";
    if (!password) e.password = "Password is required";
    else if (password.length < 6) e.password = "Password must be at least 6 characters";
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!validate()) {
      toast.warning("Please fix the highlighted fields.", { title: "Check your details" });
      return;
    }
    setLoading(true);
    try {
      const { user } = await login(email, password);
      toast.success("Redirecting to your dashboard…", { title: "Welcome back!" });
      router.push(dashboards[user.role] ?? "/dashboard");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      setError(msg);
      toast.error(msg, { title: "Login failed" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* ───────────── Left — branded, animated showcase ───────────── */}
      <div className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        {/* Animated aurora base */}
        <div className="animate-aurora absolute inset-0 bg-gradient-to-br from-indigo-600 via-violet-700 to-indigo-900" />
        {/* Grid overlay + glowing blobs */}
        <div className="bg-grid absolute inset-0 opacity-60" />
        <div className="pointer-events-none absolute inset-0">
          <div className="animate-blob animate-glow absolute -left-16 -top-16 h-72 w-72 rounded-full bg-fuchsia-400/40 blur-3xl" />
          <div className="animate-blob absolute bottom-0 right-0 h-80 w-80 rounded-full bg-sky-400/40 blur-3xl [animation-delay:4s]" />
          <div className="animate-blob absolute left-1/3 top-1/2 h-56 w-56 rounded-full bg-violet-300/40 blur-3xl [animation-delay:7s]" />
        </div>

        <Link href="/" className="animate-fade-up relative flex items-center gap-2 text-2xl font-bold text-white">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path d="M3 3v18h18M9 17V9m4 8V5m4 12v-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          LeadFlow
        </Link>

        {/* Floating glass dashboard card */}
        <div className="animate-fade-up relative [animation-delay:120ms]">
          <div className="animate-float-slow rounded-2xl border border-white/20 bg-white/10 p-5 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-white/70">Today&apos;s pipeline</span>
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping-dot absolute inline-flex h-full w-full rounded-full bg-emerald-300" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                Live
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {[
                { l: "Leads", v: "342" },
                { l: "Calls", v: "1.2k" },
                { l: "Won", v: "$48k" },
              ].map((k) => (
                <div key={k.l} className="rounded-xl bg-white/10 p-3">
                  <div className="text-[10px] text-white/60">{k.l}</div>
                  <div className="text-lg font-bold text-white">{k.v}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex h-20 items-end justify-between gap-2">
              {["h-8", "h-12", "h-9", "h-16", "h-11", "h-20", "h-14"].map((h, i) => (
                <div key={i} className={`bar-grow w-full rounded-t bg-gradient-to-t from-white/40 to-white ${h}`} style={{ animationDelay: `${i * 130}ms` }} />
              ))}
            </div>
          </div>

          {/* Floating toast */}
          <div className="absolute -right-4 -top-5 animate-float-slow rounded-xl border border-white/20 bg-white px-3 py-2 shadow-xl [animation-delay:1s]">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 animate-pulse-ring items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">+1</span>
              <div>
                <div className="text-[11px] font-semibold text-slate-900">New lead · Score 92</div>
                <div className="text-[10px] text-slate-400">Auto-assigned to you</div>
              </div>
            </div>
          </div>
        </div>

        <div className="animate-fade-up relative text-white [animation-delay:220ms]">
          <h2 className="text-3xl font-extrabold leading-tight">
            Close more deals,
            <br />
            with less busywork.
          </h2>
          <ul className="mt-6 space-y-2.5">
            {highlights.map((h, i) => (
              <li key={h} className="animate-fade-up flex items-center gap-3 text-indigo-50" style={{ animationDelay: `${300 + i * 90}ms` }}>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/90">
                  <svg className="h-3 w-3 text-indigo-900" fill="none" stroke="currentColor" strokeWidth="3.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                {h}
              </li>
            ))}
          </ul>

          <div className="mt-8 flex items-center gap-3">
            <div className="flex -space-x-2">
              {["PS", "ML", "ER", "+"].map((i) => (
                <span key={i} className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-indigo-700 bg-white text-[11px] font-bold text-indigo-700">{i}</span>
              ))}
            </div>
            <span className="text-sm text-indigo-100">Trusted by 12,000+ sales teams</span>
          </div>
        </div>
      </div>

      {/* ───────────── Right — login form ───────────── */}
      <div className="relative flex items-center justify-center overflow-hidden bg-slate-50 px-6 py-12">
        <div className="pointer-events-none absolute inset-0">
          <div className="animate-blob absolute -right-24 -top-24 h-72 w-72 rounded-full bg-indigo-200/50 blur-3xl" />
          <div className="animate-blob absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-violet-200/50 blur-3xl [animation-delay:5s]" />
        </div>

        <div className="relative w-full max-w-md">
          {/* Glow behind card */}
          <div className="animate-glow absolute -inset-1 rounded-3xl bg-gradient-to-tr from-indigo-400/40 to-violet-400/40 blur-xl" />

          <div className="animate-fade-up relative rounded-3xl border border-white/60 bg-white/80 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
            {/* Gradient top accent */}
            <div className="absolute inset-x-0 top-0 h-1.5 rounded-t-3xl bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500" />

            <Link href="/" className="mb-6 flex items-center justify-center gap-2 text-xl font-bold text-indigo-600 lg:hidden">
              LeadFlow
            </Link>

            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-600" />
              Secure sign in
            </span>
            <h1 className="mt-4 text-2xl font-bold text-slate-900">Welcome back 👋</h1>
            <p className="mt-1.5 text-sm text-slate-500">
              One login for super admins, clients & staff — we&apos;ll open the
              right dashboard for you.
            </p>

            <form onSubmit={handleSubmit} noValidate className="mt-7 space-y-5">
              {error && (
                <div className="animate-shake flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4m0 4h.01" strokeLinecap="round" /></svg>
                  {error}
                </div>
              )}

              {/* Email */}
              <div className="animate-fade-up [animation-delay:80ms]">
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
                <div className="group relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 transition group-focus-within:text-indigo-600">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 8l9 6 9-6M3 8v10a2 2 0 002 2h14a2 2 0 002-2V8M3 8l9-5 9 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
                    }}
                    placeholder="you@company.com"
                    aria-invalid={!!fieldErrors.email}
                    className={`w-full rounded-xl border bg-white/70 py-2.5 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 transition focus:outline-none focus:ring-4 ${
                      fieldErrors.email
                        ? "border-red-400 focus:border-red-500 focus:ring-red-500/15"
                        : "border-slate-300 focus:border-indigo-500 focus:ring-indigo-500/15"
                    }`}
                  />
                </div>
                {fieldErrors.email && (
                  <p className="animate-fade-up mt-1 flex items-center gap-1 text-xs font-medium text-red-600">
                    <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4m0 4h.01" strokeLinecap="round" /></svg>
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              {/* Password */}
              <div className="animate-fade-up [animation-delay:140ms]">
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-700">Password</label>
                  <button type="button" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Forgot password?</button>
                </div>
                <div className="group relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 transition group-focus-within:text-indigo-600">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
                  </span>
                  <input
                    type={show ? "text" : "password"}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
                    }}
                    placeholder="••••••••"
                    aria-invalid={!!fieldErrors.password}
                    className={`w-full rounded-xl border bg-white/70 py-2.5 pl-10 pr-10 text-slate-900 placeholder:text-slate-400 transition focus:outline-none focus:ring-4 ${
                      fieldErrors.password
                        ? "border-red-400 focus:border-red-500 focus:ring-red-500/15"
                        : "border-slate-300 focus:border-indigo-500 focus:ring-indigo-500/15"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
                  >
                    {show ? (
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.4 5.1A9.9 9.9 0 0112 5c5 0 9 4 10 7a12 12 0 01-2.2 3.2M6.2 6.2A12 12 0 002 12c1 3 5 7 10 7a9.9 9.9 0 004.5-1" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    ) : (
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" /></svg>
                    )}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p className="animate-fade-up mt-1 flex items-center gap-1 text-xs font-medium text-red-600">
                    <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4m0 4h.01" strokeLinecap="round" /></svg>
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              {/* Remember me */}
              <label className="animate-fade-up flex cursor-pointer items-center gap-2 text-sm text-slate-600 [animation-delay:200ms]">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                Keep me signed in
              </label>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="animate-fade-up group relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 font-semibold text-white shadow-lg shadow-indigo-600/30 transition hover:-translate-y-0.5 hover:shadow-xl disabled:translate-y-0 disabled:opacity-70 [animation-delay:260ms]"
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {loading ? (
                    <>
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>
                      Signing in…
                    </>
                  ) : (
                    <>
                      Sign in
                      <svg className="h-4 w-4 transition group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </>
                  )}
                </span>
                {/* Shine sweep */}
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-500">
              <Link href="/" className="font-medium text-indigo-600 hover:text-indigo-700">← Back to home</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
