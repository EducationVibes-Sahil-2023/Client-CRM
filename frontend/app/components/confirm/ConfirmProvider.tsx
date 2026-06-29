"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export interface ConfirmOptions {
  title?: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Imperatively ask the user a yes/no question; resolves true on confirm. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setState(opts);
    });
  }, []);

  const settle = useCallback((result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setState(null);
  }, []);

  // Keyboard: Esc cancels, Enter confirms.
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(false);
      else if (e.key === "Enter") settle(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state, settle]);

  const danger = state?.danger ?? false;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => settle(false)} />
          <div className="animate-fade-up relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" role="alertdialog" aria-modal="true">
            <div className="flex items-start gap-4">
              <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${danger ? "bg-rose-100 text-rose-600" : "bg-indigo-100 text-indigo-600"}`}>
                {danger ? (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4m0 4h.01" strokeLinecap="round" strokeLinejoin="round" /></svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4m0-4h.01" strokeLinecap="round" /></svg>
                )}
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-slate-900">{state.title ?? "Are you sure?"}</h3>
                <div className="mt-1 text-sm leading-relaxed text-slate-500">{state.message}</div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => settle(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                {state.cancelLabel ?? "No, cancel"}
              </button>
              <button
                onClick={() => settle(true)}
                className={`rounded-lg px-5 py-2 text-sm font-semibold text-white transition ${danger ? "bg-rose-600 hover:bg-rose-700" : "bg-indigo-600 hover:bg-indigo-700"}`}
              >
                {state.confirmLabel ?? "Yes, continue"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
