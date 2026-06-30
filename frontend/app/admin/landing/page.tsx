"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { adminUpload, getLanding, saveLanding, type Landing } from "../../lib/admin";
import { API_URL } from "../../lib/api";
import { useToast } from "../../components/toast/ToastProvider";
import { Card, PageHeader, SkeletonText } from "../ui";

export default function LandingPage() {
  const toast = useToast();
  const [data, setData] = useState<Landing | null>(null);
  const [name, setName] = useState("");
  const [logo, setLogo] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getLanding().then((d) => {
      setData(d);
      setName(d.company_name);
      setLogo(d.logo_url);
    });
  }, []);

  async function save() {
    setSaving(true);
    try {
      await saveLanding({ company_name: name });
      toast.success("Landing page settings saved.", { title: "Saved" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    try {
      const res = await adminUpload<{ logo_url: string }>("/landing/logo", "logo", file);
      setLogo(res.logo_url);
      toast.success("Logo updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    }
  }

  if (!data) return (<><PageHeader title="Landing Page" /><Card><SkeletonText lines={6} /></Card></>);

  return (
    <>
      <PageHeader
        title="Landing Page"
        subtitle="Control the content shown on your public marketing site"
        action={
          <div className="flex gap-2">
            <Link href="/" target="_blank" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">View site ↗</Link>
            <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 font-semibold text-slate-900">Brand</h3>
          <label className="mb-1 block text-sm font-medium text-slate-700">Company name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="mb-5 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15" />

          <label className="mb-1 block text-sm font-medium text-slate-700">Logo</label>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo.startsWith("http") ? logo : `${API_URL}${logo}`} alt="logo" className="h-full w-full object-contain" />
              ) : (
                <span className="text-2xl font-bold text-indigo-600">{name.slice(0, 1) || "L"}</span>
              )}
            </div>
            <button onClick={() => fileRef.current?.click()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Upload logo</button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
          </div>
        </Card>

        <Card>
          <h3 className="mb-4 font-semibold text-slate-900">Page sections</h3>
          <div className="space-y-3">
            <Link href="/admin/plans" className="flex items-center justify-between rounded-xl border border-slate-200 p-4 transition hover:border-indigo-300 hover:bg-indigo-50/40">
              <div>
                <div className="font-medium text-slate-800">Pricing plans</div>
                <div className="text-sm text-slate-500">{data.pricing_plans.length} plans configured</div>
              </div>
              <svg className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </Link>
            <Link href="/admin/reviews" className="flex items-center justify-between rounded-xl border border-slate-200 p-4 transition hover:border-indigo-300 hover:bg-indigo-50/40">
              <div>
                <div className="font-medium text-slate-800">Customer reviews</div>
                <div className="text-sm text-slate-500">{data.testimonials.length} testimonials</div>
              </div>
              <svg className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </Link>
          </div>
        </Card>
      </div>
    </>
  );
}
