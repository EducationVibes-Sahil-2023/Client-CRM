"use client";

import type { ClientFeatureItem } from "../../lib/admin";

/**
 * Per-client feature matrix editor: a checkbox per feature plus a numeric
 * quota box for features that carry one. Controlled via items/onChange.
 */
export default function FeatureEditor({
  items,
  onChange,
}: {
  items: ClientFeatureItem[];
  onChange: (items: ClientFeatureItem[]) => void;
}) {
  const update = (key: string, patch: Partial<ClientFeatureItem>) =>
    onChange(items.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <div key={it.key} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2">
          <label className="flex flex-1 items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              disabled={it.core}
              checked={it.enabled}
              onChange={(e) => update(it.key, { enabled: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
            />
            <span className={it.enabled ? "font-medium text-slate-800" : "text-slate-500"}>{it.label}</span>
            {it.core && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">always on</span>}
          </label>
          {it.quota && (
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              {it.quota}
              <input
                type="number"
                min="0"
                placeholder="∞"
                disabled={!it.enabled}
                value={it.limit ?? ""}
                onChange={(e) => update(it.key, { limit: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                className="w-20 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900 disabled:bg-slate-50 disabled:opacity-50"
              />
            </label>
          )}
        </div>
      ))}
      <p className="text-[11px] text-slate-400">Blank quota = unlimited. These override the plan defaults.</p>
    </div>
  );
}
