"use client";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

const badgeStyles: Record<string, string> = {
  new: "bg-amber-100 text-amber-700",
  read: "bg-slate-100 text-slate-600",
  replied: "bg-emerald-100 text-emerald-700",
  active: "bg-emerald-100 text-emerald-700",
  trial: "bg-sky-100 text-sky-700",
  suspended: "bg-red-100 text-red-700",
  inactive: "bg-slate-100 text-slate-600",
  starter: "bg-slate-100 text-slate-600",
  growth: "bg-indigo-100 text-indigo-700",
  enterprise: "bg-violet-100 text-violet-700",
};

export function Badge({ value }: { value: string }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${badgeStyles[value] ?? "bg-slate-100 text-slate-600"}`}>
      {value}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <svg className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M3 7h18M3 12h18M3 17h12" strokeLinecap="round" /></svg>
      </span>
      <p className="font-medium text-slate-600">{title}</p>
      {hint && <p className="text-sm text-slate-400">{hint}</p>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16 text-slate-400">
      <svg className="h-7 w-7 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
      </svg>
    </div>
  );
}

// Re-exported from the shared util so every importer renders in IST (Asia/Kolkata).
export { fmtDate, fmtDateTime, fmtTime, timeAgo } from "../lib/datetime";

/** Describe a subscription window for badges/cards. */
export function planValidity(start?: string | null, end?: string | null): {
  text: string;
  tone: "emerald" | "amber" | "red" | "slate";
  daysLeft: number | null;
  expired: boolean;
} {
  if (!end) return { text: "No expiry", tone: "slate", daysLeft: null, expired: false };
  const endDate = new Date(`${end.slice(0, 10)}T23:59:59`);
  if (Number.isNaN(endDate.getTime())) return { text: "—", tone: "slate", daysLeft: null, expired: false };
  const days = Math.ceil((endDate.getTime() - Date.now()) / 86400000);
  if (days < 0) return { text: `Expired ${Math.abs(days)}d ago`, tone: "red", daysLeft: days, expired: true };
  if (days === 0) return { text: "Expires today", tone: "amber", daysLeft: 0, expired: false };
  if (days <= 7) return { text: `Expires in ${days}d`, tone: "amber", daysLeft: days, expired: false };
  return { text: `${days} days left`, tone: "emerald", daysLeft: days, expired: false };
}

const validityTone: Record<string, string> = {
  emerald: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
  slate: "bg-slate-100 text-slate-600",
};

export function ValidityBadge({ start, end }: { start?: string | null; end?: string | null }) {
  const v = planValidity(start, end);
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${validityTone[v.tone]}`}>{v.text}</span>;
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "max-w-md",
  z = "z-50",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
  z?: string;
}) {
  if (!open) return null;
  return (
    <div className={`fixed inset-0 ${z}`}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`animate-slide-in absolute inset-y-0 right-0 flex w-full ${width} flex-col bg-white shadow-2xl`}>
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
        {footer && <div className="border-t border-slate-200 bg-slate-50/60 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-fade-up relative w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

/**
 * A styled confirmation dialog — a proper replacement for the browser's native
 * window.confirm(). Sits above Modal/Drawer (z-60). The confirm button shows a
 * "Working…" state while `busy`, and the backdrop is click-locked during it.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  const confirmCls = tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700";
  const iconCls = tone === "danger" ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-600";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="animate-fade-up relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-4">
          <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${iconCls}`}>
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            <div className="mt-1 text-sm leading-relaxed text-slate-600">{message}</div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">{cancelLabel}</button>
          <button onClick={onConfirm} disabled={busy} className={`rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-60 ${confirmCls}`}>{busy ? "Working…" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
      />
    </label>
  );
}
