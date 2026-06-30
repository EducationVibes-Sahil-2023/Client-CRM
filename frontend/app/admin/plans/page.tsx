"use client";

import { useEffect, useState } from "react";
import { getLanding, saveLanding, type PricingPlan } from "../../lib/admin";
import { useToast } from "../../components/toast/ToastProvider";
import { Card, PageHeader, SkeletonCards } from "../ui";

export default function PlansPage() {
  const toast = useToast();
  const [plans, setPlans] = useState<PricingPlan[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getLanding().then((d) => setPlans(d.pricing_plans.length ? d.pricing_plans : defaults));
  }, []);

  function update(i: number, patch: Partial<PricingPlan>) {
    setPlans((p) => p!.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function remove(i: number) {
    setPlans((p) => p!.filter((_, idx) => idx !== i));
  }
  function add() {
    setPlans((p) => [...p!, { name: "New plan", price: "$0", period: "/mo", description: "", features: [], highlight: false }]);
  }

  async function save() {
    setSaving(true);
    try {
      await saveLanding({ pricing_plans: plans! });
      toast.success("Pricing plans saved — live on the landing page.", { title: "Saved" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  if (!plans) return (<><PageHeader title="Plans & Subscription" /><SkeletonCards count={3} /></>);

  return (
    <>
      <PageHeader
        title="Plans & Subscription"
        subtitle="Manage the pricing plans shown on your landing page"
        action={
          <div className="flex gap-2">
            <button onClick={add} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">+ Add plan</button>
            <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? "Saving…" : "Save changes"}</button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {plans.map((plan, i) => (
          <Card key={i} className={plan.highlight ? "ring-2 ring-indigo-500" : ""}>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <input value={plan.name} onChange={(e) => update(i, { name: e.target.value })} className="w-full rounded-lg border border-slate-200 px-2 py-1 text-lg font-bold text-slate-900 focus:border-indigo-400 focus:outline-none" />
                <button onClick={() => remove(i)} className="ml-2 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </div>
              <div className="flex gap-2">
                <input value={plan.price} onChange={(e) => update(i, { price: e.target.value })} placeholder="$29" className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
                <input value={plan.period ?? ""} onChange={(e) => update(i, { period: e.target.value })} placeholder="/mo" className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
              </div>
              <textarea value={plan.description ?? ""} onChange={(e) => update(i, { description: e.target.value })} placeholder="Short description" rows={2} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Features (one per line)</label>
                <textarea
                  value={(plan.features ?? []).join("\n")}
                  onChange={(e) => update(i, { features: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
                  rows={4}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={!!plan.highlight} onChange={(e) => update(i, { highlight: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                Highlight as “Most popular”
              </label>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

const defaults: PricingPlan[] = [
  { name: "Starter", price: "$0", period: "/mo", description: "For small teams getting started.", features: ["Up to 3 users", "1,000 leads", "Email support"], highlight: false },
  { name: "Growth", price: "$29", period: "/user/mo", description: "For growing sales teams.", features: ["Unlimited users", "50,000 leads", "Automation", "Priority support"], highlight: true },
  { name: "Enterprise", price: "Custom", period: "", description: "For organizations at scale.", features: ["Unlimited everything", "SSO & roles", "API & webhooks", "Dedicated manager"], highlight: false },
];
