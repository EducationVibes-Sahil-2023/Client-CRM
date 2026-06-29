"use client";

const base =
  "w-full rounded-xl border bg-white/80 text-slate-900 placeholder:text-slate-400 transition focus:outline-none focus:ring-4 focus:ring-indigo-500/15";

function ring(error?: string) {
  return error
    ? "border-red-400 focus:border-red-500 focus:ring-red-500/15"
    : "border-slate-300 focus:border-indigo-500";
}

function ErrorText({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p className="animate-fade-up mt-1 flex items-center gap-1 text-xs font-medium text-red-600">
      <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4m0 4h.01" strokeLinecap="round" />
      </svg>
      {error}
    </p>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  type?: string;
  placeholder?: string;
  icon?: React.ReactNode;
  optional?: boolean;
}

export function Field({
  label,
  value,
  onChange,
  error,
  type = "text",
  placeholder,
  icon,
  optional,
}: FieldProps) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {label}
        {optional && <span className="text-xs font-normal text-slate-400">(optional)</span>}
      </label>
      <div className="group relative">
        {icon && (
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 transition group-focus-within:text-indigo-600">
            {icon}
          </span>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={!!error}
          className={`${base} ${ring(error)} py-2.5 ${icon ? "pl-10" : "pl-3"} pr-3`}
        />
      </div>
      <ErrorText error={error} />
    </div>
  );
}

interface SelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  optional?: boolean;
}

export function SelectField({ label, value, onChange, options, optional }: SelectProps) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {label}
        {optional && <span className="text-xs font-normal text-slate-400">(optional)</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${base} ${ring()} px-3 py-2.5`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

interface TextAreaProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  placeholder?: string;
  rows?: number;
  optional?: boolean;
}

export function TextAreaField({ label, value, onChange, error, placeholder, rows = 4, optional }: TextAreaProps) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {label}
        {optional && <span className="text-xs font-normal text-slate-400">(optional)</span>}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        aria-invalid={!!error}
        className={`${base} ${ring(error)} px-3 py-2.5`}
      />
      <ErrorText error={error} />
    </div>
  );
}

/** Submit button with spinner + hover shine. */
export function SubmitButton({
  loading,
  children,
}: {
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="group relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:-translate-y-0.5 hover:shadow-xl disabled:translate-y-0 disabled:opacity-70"
    >
      <span className="relative z-10 flex items-center justify-center gap-2">
        {loading ? (
          <>
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
            </svg>
            Sending…
          </>
        ) : (
          children
        )}
      </span>
      <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
    </button>
  );
}

const confetti = [
  { c: "bg-indigo-500", l: "20%", d: "0ms" },
  { c: "bg-violet-500", l: "38%", d: "120ms" },
  { c: "bg-emerald-500", l: "55%", d: "60ms" },
  { c: "bg-amber-400", l: "70%", d: "180ms" },
  { c: "bg-rose-400", l: "84%", d: "100ms" },
];

/** Animated success state shown after a form submits. */
export function SuccessCard({
  title,
  message,
  onReset,
}: {
  title: string;
  message: string;
  onReset: () => void;
}) {
  return (
    <div className="relative flex flex-col items-center py-6 text-center">
      {/* Confetti */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 overflow-hidden">
        {confetti.map((p, i) => (
          <span
            key={i}
            className={`animate-confetti absolute top-0 h-2 w-2 rounded-sm ${p.c}`}
            style={{ left: p.l, animationDelay: p.d }}
          />
        ))}
      </div>

      {/* Animated check badge */}
      <div className="animate-pop relative flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
        <span className="absolute inset-0 animate-ping-dot rounded-full bg-emerald-200" />
        <svg className="relative h-8 w-8 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
          <path className="check-path" d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <h3 className="animate-fade-up mt-5 text-lg font-bold text-slate-900 [animation-delay:150ms]">{title}</h3>
      <p className="animate-fade-up mt-2 max-w-sm text-sm text-slate-600 [animation-delay:220ms]">{message}</p>

      <button
        onClick={onReset}
        className="animate-fade-up mt-6 text-sm font-medium text-indigo-600 hover:text-indigo-700 [animation-delay:300ms]"
      >
        ← Send another
      </button>
    </div>
  );
}
