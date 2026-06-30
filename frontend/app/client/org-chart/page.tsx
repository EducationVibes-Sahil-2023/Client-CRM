"use client";

import { useEffect, useMemo, useState } from "react";
import { getStaff, type Staff } from "../../lib/client";
import { API_URL } from "../../lib/api";
import { useToast } from "../../components/toast/ToastProvider";
import { PageHeader, Card, SkeletonBlock } from "../../admin/ui";

export default function OrgChartPage() {
  const toast = useToast();
  const [staff, setStaff] = useState<Staff[] | null>(null);

  useEffect(() => {
    getStaff().then((d) => setStaff(d.staff)).catch(() => { setStaff([]); toast.error("Could not load team."); });
  }, [toast]);

  // Build the reporting tree: childrenOf[managerId] = direct reports.
  const { childrenOf, roots } = useMemo(() => {
    const list = staff ?? [];
    const byId = new Map(list.map((s) => [s.id, s]));
    const childrenOf = new Map<number, Staff[]>();
    const roots: Staff[] = [];
    for (const s of list) {
      const mgr = s.reports_to;
      if (mgr != null && byId.has(mgr)) {
        (childrenOf.get(mgr) ?? childrenOf.set(mgr, []).get(mgr)!).push(s);
      } else {
        roots.push(s); // top-level (no manager, or manager not in the team)
      }
    }
    return { childrenOf, roots };
  }, [staff]);

  const avatarUrl = (s: Staff) => (s.avatar ? `${API_URL}${s.avatar}` : undefined);

  function PersonCard({ s }: { s: Staff }) {
    const reports = childrenOf.get(s.id)?.length ?? 0;
    const img = avatarUrl(s);
    return (
      <div className="relative z-10 flex w-44 flex-col items-center rounded-xl border border-slate-200 bg-white px-3 py-3 text-center shadow-sm transition hover:border-emerald-300 hover:shadow-md">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" className="h-11 w-11 rounded-full object-cover" />
        ) : (
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-sm font-bold text-white">{s.name.slice(0, 1).toUpperCase()}</span>
        )}
        <div className="mt-2 max-w-full truncate text-sm font-semibold text-slate-800">{s.name}</div>
        <div className="max-w-full truncate text-xs font-medium text-emerald-700">{s.designation || s.role_name || "Team member"}</div>
        {(s.department || s.office_name) && (
          <div className="max-w-full truncate text-[11px] text-slate-400">{[s.department, s.office_name].filter(Boolean).join(" · ")}</div>
        )}
        {reports > 0 && (
          <span className="mt-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">{reports} report{reports > 1 ? "s" : ""}</span>
        )}
      </div>
    );
  }

  // Recursive node: card on top, a connector, then a row of child subtrees.
  function Node({ s, seen }: { s: Staff; seen: Set<number> }) {
    if (seen.has(s.id)) return null; // guard against accidental cycles
    const next = new Set(seen).add(s.id);
    const kids = childrenOf.get(s.id) ?? [];
    return (
      <li className="relative flex flex-col items-center">
        <PersonCard s={s} />
        {kids.length > 0 && (
          <>
            <div className="h-6 w-px bg-slate-300" />
            <ul className="flex items-start">
              {kids.map((k, i) => (
                <li key={k.id} className="relative flex flex-col items-center px-3">
                  {kids.length > 1 && (
                    <span className={`absolute top-0 h-px bg-slate-300 ${i === 0 ? "left-1/2 right-0" : i === kids.length - 1 ? "left-0 right-1/2" : "left-0 right-0"}`} />
                  )}
                  <div className="h-6 w-px bg-slate-300" />
                  <Node s={k} seen={next} />
                </li>
              ))}
            </ul>
          </>
        )}
      </li>
    );
  }

  return (
    <>
      <PageHeader
        title="Org Chart"
        subtitle="Reporting hierarchy — who reports to whom across your team."
      />

      {staff === null ? (
        <SkeletonBlock className="h-96" />
      ) : staff.length === 0 ? (
        <Card><div className="py-12 text-center text-sm text-slate-400">No team members yet. Add staff and set their reporting person to see the hierarchy.</div></Card>
      ) : (
        <Card>
          <div className="mb-4 flex flex-wrap gap-4 text-sm text-slate-500">
            <span><b className="text-slate-800">{staff.length}</b> people</span>
            <span><b className="text-slate-800">{roots.length}</b> top-level</span>
            <span><b className="text-slate-800">{staff.filter((s) => (childrenOf.get(s.id)?.length ?? 0) > 0).length}</b> managers</span>
          </div>
          <div className="overflow-x-auto pb-4">
            <ul className="flex min-w-max items-start justify-center gap-8 px-2 pt-2">
              {roots.map((r) => (
                <Node key={r.id} s={r} seen={new Set()} />
              ))}
            </ul>
          </div>
        </Card>
      )}
    </>
  );
}
