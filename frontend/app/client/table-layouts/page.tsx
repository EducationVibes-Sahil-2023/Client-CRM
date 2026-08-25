"use client";

import { useEffect, useState } from "react";
import { getTableLayoutDefaults, saveTableLayoutDefault, saveBranding, type TableLayoutDefault } from "../../lib/client";
import { useToast } from "../../components/toast/ToastProvider";
import { Card, PageHeader, EmptyState, Spinner } from "../../admin/ui";
import { useClient } from "../ClientContext";

export default function TableLayoutsPage() {
  const toast = useToast();
  const { isAdmin, branding, updateBranding } = useClient();
  const [tables, setTables] = useState<TableLayoutDefault[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [savingWrap, setSavingWrap] = useState(false);
  const wrapHeaders = branding.table_header_wrap === "1";

  async function toggleWrap(next: boolean) {
    setSavingWrap(true);
    try {
      const r = await saveBranding({ table_header_wrap: next ? "1" : "0" });
      updateBranding(r.branding); // applies to every table immediately
      toast.success(next ? "Column headers now wrap." : "Column headers stay on one line.");
    } catch {
      toast.error("Could not update. Try again.");
    } finally {
      setSavingWrap(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    getTableLayoutDefaults()
      .then((d) => setTables(d.tables ?? []))
      .catch(() => setTables([]));
  }, [isAdmin]);

  async function toggle(key: string, active: boolean) {
    setSaving(key);
    // Optimistic flip; revert on failure.
    setTables((ts) => ts?.map((t) => (t.key === key ? { ...t, active } : t)) ?? ts);
    try {
      await saveTableLayoutDefault(key, active);
      toast.success(active ? "Your layout is now the team default." : "Team default turned off.");
    } catch {
      setTables((ts) => ts?.map((t) => (t.key === key ? { ...t, active: !active } : t)) ?? ts);
      toast.error("Could not update. Try again.");
    } finally {
      setSaving(null);
    }
  }

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Table Layouts" subtitle="Publish your column layouts as the team default." />
        <EmptyState title="Admins only" hint="Only the client admin can manage team table layouts." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Table Layouts" subtitle="Publish your column layouts as the team default." />

      <Card className="mb-4 !p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-800">Wrap column headers</div>
            <div className="text-xs text-slate-400">
              {wrapHeaders
                ? "Long column headers wrap onto multiple lines across every table."
                : "Column headers stay on a single line (long ones are shortened). Applies to all tables."}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={wrapHeaders}
            aria-label="Wrap column headers"
            disabled={savingWrap}
            onClick={() => toggleWrap(!wrapHeaders)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition disabled:opacity-50 ${wrapHeaders ? "bg-emerald-600" : "bg-slate-300"}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${wrapHeaders ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </div>
      </Card>

      <Card className="mb-4 !p-4">
        <p className="text-sm leading-relaxed text-slate-600">
          Turn a table on to make <b>your current column layout</b> for it — which columns show, their order,
          width and alignment — the <b>default</b> for everyone on your team. Team members who haven&apos;t
          arranged that table themselves will see your layout; anyone can still customise their own columns
          (their choice always wins over the default). Turning it off doesn&apos;t touch anyone&apos;s saved layout.
        </p>
        <p className="mt-2 text-xs text-slate-400">
          Tip: open the table (e.g. Leads), arrange its columns with the <b>Columns</b> menu the way you want,
          then come back here and switch it on to push that arrangement out as the default.
        </p>
      </Card>

      {tables === null ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : tables.length === 0 ? (
        <EmptyState title="No tables" hint="No customizable tables are available for your plan." />
      ) : (
        <Card className="!p-0">
          <ul className="divide-y divide-slate-100">
            {tables.map((t) => (
              <li key={t.key} className="flex items-center justify-between gap-4 px-4 py-3.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800">{t.label}</div>
                  <div className="text-xs text-slate-400">
                    {t.active ? "Your layout is the team default." : "Each member uses their own (or the built-in) layout."}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={t.active}
                  aria-label={`Team default for ${t.label}`}
                  disabled={saving === t.key}
                  onClick={() => toggle(t.key, !t.active)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition disabled:opacity-50 ${t.active ? "bg-emerald-600" : "bg-slate-300"}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${t.active ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
