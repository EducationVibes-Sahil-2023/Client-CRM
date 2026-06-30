"use client";

import { useEffect, useState } from "react";
import { getLanding, saveLanding, type Testimonial } from "../../lib/admin";
import { useToast } from "../../components/toast/ToastProvider";
import { Card, EmptyState, PageHeader, SkeletonCards } from "../ui";

export default function ReviewsPage() {
  const toast = useToast();
  const [items, setItems] = useState<Testimonial[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getLanding().then((d) => setItems(d.testimonials));
  }, []);

  function update(i: number, patch: Partial<Testimonial>) {
    setItems((p) => p!.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function remove(i: number) {
    setItems((p) => p!.filter((_, idx) => idx !== i));
  }
  function add() {
    setItems((p) => [...(p ?? []), { quote: "", name: "", role: "" }]);
  }

  async function save() {
    setSaving(true);
    try {
      await saveLanding({ testimonials: items! });
      toast.success("Reviews saved — live on the landing page.", { title: "Saved" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  if (!items) return (<><PageHeader title="Customer Reviews" /><SkeletonCards count={6} /></>);

  return (
    <>
      <PageHeader
        title="Customer Reviews"
        subtitle="Testimonials displayed on your landing page"
        action={
          <div className="flex gap-2">
            <button onClick={add} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">+ Add review</button>
            <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? "Saving…" : "Save changes"}</button>
          </div>
        }
      />

      {items.length === 0 ? (
        <Card><EmptyState title="No reviews yet" hint="Add your first customer testimonial." /></Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {items.map((t, i) => (
            <Card key={i}>
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex gap-1 text-amber-400">
                    {Array.from({ length: 5 }).map((_, s) => (
                      <svg key={s} className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path d="M9.05 2.93c.3-.92 1.6-.92 1.9 0l1.34 4.12a1 1 0 00.95.69h4.33c.97 0 1.37 1.24.59 1.81l-3.5 2.54a1 1 0 00-.36 1.12l1.33 4.12c.3.92-.75 1.69-1.54 1.12l-3.5-2.54a1 1 0 00-1.18 0l-3.5 2.54c-.78.57-1.83-.2-1.53-1.12l1.33-4.12a1 1 0 00-.36-1.12L1.68 9.55c-.78-.57-.38-1.81.59-1.81h4.33a1 1 0 00.95-.69l1.5-4.12z" /></svg>
                    ))}
                  </div>
                  <button onClick={() => remove(i)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                </div>
                <textarea value={t.quote} onChange={(e) => update(i, { quote: e.target.value })} placeholder="What the customer said…" rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
                <div className="grid grid-cols-2 gap-3">
                  <input value={t.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Name" className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
                  <input value={t.role} onChange={(e) => update(i, { role: e.target.value })} placeholder="Role, Company" className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
