"use client";

import { passwordRules } from "../lib/validation";

/**
 * Live "your new password must…" checklist. Mirrors the backend PasswordPolicy
 * so the user sees exactly what's still missing before they submit.
 */
export default function PasswordChecklist({
  password,
  email,
  className = "",
}: {
  password: string;
  email?: string;
  className?: string;
}) {
  const rules = passwordRules(password, email);
  return (
    <ul className={`space-y-1.5 ${className}`}>
      {rules.map((r) => (
        <li
          key={r.label}
          className={`flex items-center gap-2 text-xs transition-colors ${
            r.met ? "text-emerald-600" : "text-slate-400"
          }`}
        >
          <span
            className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
              r.met ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300"
            }`}
          >
            {r.met ? (
              <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </span>
          {r.label}
        </li>
      ))}
    </ul>
  );
}
