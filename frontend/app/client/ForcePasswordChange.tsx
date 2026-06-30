"use client";

import { useState } from "react";
import { changePassword } from "../lib/client";
import { isStrongPassword } from "../lib/validation";
import { useToast } from "../components/toast/ToastProvider";
import PasswordChecklist from "../components/PasswordChecklist";

/**
 * Full-screen gate shown when the signed-in account is still on a weak password.
 * They can't reach the rest of the app until they set a strong one (or sign out).
 * Rendered by ClientProvider in place of the panel while `must_change_password`.
 *
 * `submit` defaults to the client password endpoint; the admin portal passes its
 * own (/superadmin/password) so the same screen works for super admins.
 */
export default function ForcePasswordChange({
  email,
  onDone,
  onLogout,
  submit,
}: {
  email: string;
  onDone: () => void;
  onLogout: () => void;
  submit?: (currentPassword: string, newPassword: string) => Promise<void>;
}) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const strong = isStrongPassword(next, email);
  const matches = next.length > 0 && next === confirm;
  const reused = next.length > 0 && next === current;
  const canSubmit = current.length > 0 && strong && matches && !reused && !saving;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!canSubmit) return;
    setSaving(true);
    try {
      if (submit) {
        await submit(current, next);
      } else {
        await changePassword({ current_password: current, new_password: next });
      }
      toast.success("Your password is now strong. Welcome aboard!", { title: "Password updated" });
      onDone();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't update your password.";
      setError(msg);
      toast.error(msg, { title: "Update failed" });
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-slate-300 bg-white py-2.5 px-3 text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl sm:p-10">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" />
          </svg>
        </div>
        <h1 className="mt-5 text-xl font-bold text-slate-900">Update your password to continue</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          For your security, your current password is too weak. Please set a stronger
          one — you&apos;ll go straight to your dashboard afterwards.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4m0 4h.01" strokeLinecap="round" /></svg>
              {error}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Current password</label>
            <input
              type={show ? "text" : "password"}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="Your current password"
              autoComplete="current-password"
              className={inputCls}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">New password</label>
            <input
              type={show ? "text" : "password"}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="Create a strong password"
              autoComplete="new-password"
              className={inputCls}
            />
            <PasswordChecklist password={next} email={email} className="mt-3" />
            {reused && (
              <p className="mt-2 text-xs font-medium text-red-600">New password must differ from your current one.</p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Confirm new password</label>
            <input
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter the new password"
              autoComplete="new-password"
              className={inputCls}
            />
            {confirm.length > 0 && !matches && (
              <p className="mt-2 text-xs font-medium text-red-600">Passwords don&apos;t match.</p>
            )}
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
            Show passwords
          </label>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 font-semibold text-white shadow-lg shadow-indigo-600/30 transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Updating…" : "Update password & continue"}
          </button>
        </form>

        <button
          onClick={onLogout}
          className="mt-4 w-full text-center text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          Sign out instead
        </button>
      </div>
    </div>
  );
}
