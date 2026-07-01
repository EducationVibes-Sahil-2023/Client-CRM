"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * False during SSR and the first (hydration) client render, true afterwards.
 * Hydration-safe (no setState-in-effect): lets a component defer rendering
 * client-only values — e.g. a loader style stored in localStorage — until the
 * client knows them, so no placeholder/default flashes before the real value.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
