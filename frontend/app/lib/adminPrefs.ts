"use client";

// Super-admin UI preferences. The admin panel has no per-tenant branding store,
// so these are kept per-browser in localStorage. A custom event keeps every
// mounted component (boot loader + picker) in sync within the same tab.

import { useSyncExternalStore } from "react";
import { resolveLoaderStyle, type LoaderStyle } from "./theme";

const LOADER_KEY = "admin_loader_style";
const LOADER_EVENT = "admin-loader-change";

export function getAdminLoader(): LoaderStyle {
  if (typeof window === "undefined") return "spinner";
  try { return resolveLoaderStyle(localStorage.getItem(LOADER_KEY)); } catch { return "spinner"; }
}

export function setAdminLoader(value: LoaderStyle): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(LOADER_KEY, value); } catch {}
  window.dispatchEvent(new CustomEvent(LOADER_EVENT, { detail: value }));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(LOADER_EVENT, onChange);
  window.addEventListener("storage", onChange); // other tabs
  return () => {
    window.removeEventListener(LOADER_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Reactive accessor: `[style, setStyle]`, synced across components + tabs.
 *  Backed by useSyncExternalStore so it's SSR/hydration-safe (server snapshot
 *  is always "spinner"; the cached value applies after hydration). */
export function useAdminLoader(): [LoaderStyle, (v: LoaderStyle) => void] {
  const style = useSyncExternalStore<LoaderStyle>(subscribe, getAdminLoader, () => "spinner");
  return [style, setAdminLoader];
}
