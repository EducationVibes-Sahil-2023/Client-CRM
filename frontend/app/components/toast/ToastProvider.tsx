"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  type: ToastType;
  title?: string;
  message: string;
  duration: number;
}

interface ToastOptions {
  title?: string;
  duration?: number;
}

interface ToastApi {
  success: (message: string, opts?: ToastOptions) => void;
  error: (message: string, opts?: ToastOptions) => void;
  info: (message: string, opts?: ToastOptions) => void;
  warning: (message: string, opts?: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (type: ToastType, message: string, opts?: ToastOptions) => {
      counter.current += 1;
      const id = counter.current;
      setToasts((list) => [
        ...list,
        { id, type, message, title: opts?.title, duration: opts?.duration ?? 4500 },
      ]);
    },
    [],
  );

  const api = useRef<ToastApi>({
    success: (m, o) => push("success", m, o),
    error: (m, o) => push("error", m, o),
    info: (m, o) => push("info", m, o),
    warning: (m, o) => push("warning", m, o),
  }).current;

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed right-0 top-0 z-[100] flex w-full max-w-sm flex-col gap-3 p-4 sm:p-6"
        role="region"
        aria-live="polite"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const styles: Record<
  ToastType,
  { ring: string; icon: string; bar: string; path: React.ReactNode; defaultTitle: string }
> = {
  success: {
    ring: "border-emerald-200",
    icon: "bg-emerald-100 text-emerald-600",
    bar: "bg-emerald-500",
    defaultTitle: "Success",
    path: <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />,
  },
  error: {
    ring: "border-red-200",
    icon: "bg-red-100 text-red-600",
    bar: "bg-red-500",
    defaultTitle: "Something went wrong",
    path: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4m0 4h.01" strokeLinecap="round" />
      </>
    ),
  },
  info: {
    ring: "border-indigo-200",
    icon: "bg-indigo-100 text-indigo-600",
    bar: "bg-indigo-500",
    defaultTitle: "Heads up",
    path: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 16v-4m0-4h.01" strokeLinecap="round" />
      </>
    ),
  },
  warning: {
    ring: "border-amber-200",
    icon: "bg-amber-100 text-amber-600",
    bar: "bg-amber-500",
    defaultTitle: "Warning",
    path: (
      <>
        <path d="M10.3 3.9l-8 13.8A2 2 0 004 21h16a2 2 0 001.7-3.3l-8-13.8a2 2 0 00-3.4 0z" strokeLinejoin="round" />
        <path d="M12 9v4m0 4h.01" strokeLinecap="round" />
      </>
    ),
  },
};

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const s = styles[toast.type];

  // Begin the exit animation, then remove after it finishes.
  const dismiss = useCallback(() => {
    setLeaving(true);
    window.setTimeout(onClose, 340);
  }, [onClose]);

  return (
    <div
      role="alert"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-xl border ${s.ring} bg-white/95 p-4 pr-10 shadow-xl backdrop-blur ${
        leaving ? "animate-toast-out" : "animate-toast-in"
      }`}
    >
      <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${s.icon}`}>
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
          {s.path}
        </svg>
      </span>

      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-sm font-semibold text-slate-900">
          {toast.title ?? s.defaultTitle}
        </div>
        <div className="mt-0.5 break-words text-sm text-slate-600">{toast.message}</div>
      </div>

      <button
        onClick={dismiss}
        aria-label="Dismiss notification"
        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>

      {/* Auto-close progress bar — pauses on hover, dismisses on completion */}
      <span
        data-paused={paused}
        onAnimationEnd={dismiss}
        style={{ animationDuration: `${toast.duration}ms` }}
        className={`toast-progress absolute bottom-0 left-0 h-1 w-full ${s.bar}`}
      />
    </div>
  );
}
