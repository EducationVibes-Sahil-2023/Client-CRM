"use client";

/** Small shared building blocks for the client create/edit drawers. */

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** Lenient phone check: 7–15 digits, optional +/spaces/()-. */
export const isPhone = (v: string) => {
  const digits = v.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 && /^[+\d][\d\s().-]*$/.test(v.trim());
};

/** Input/select classes, with an error (rose) variant. */
export const inputCls = (err?: string) =>
  `w-full rounded-lg border px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
    err
      ? "border-rose-300 focus:border-rose-400 focus:ring-rose-500/15"
      : "border-slate-300 focus:border-indigo-500 focus:ring-indigo-500/15"
  }`;

export function FieldRow({
  label,
  required,
  error,
  hint,
  full,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="mb-1 flex items-center gap-1 text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-rose-600">
          <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4m0 4h.01" strokeLinecap="round" /></svg>
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}
