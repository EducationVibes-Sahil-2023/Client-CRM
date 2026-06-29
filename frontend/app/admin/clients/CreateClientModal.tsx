"use client";

import { useState } from "react";
import { adminPost, saveClientFeatures, FEATURE_CATALOG, type ClientFeatureItem } from "../../lib/admin";
import { useToast } from "../../components/toast/ToastProvider";
import { Drawer } from "../ui";
import { FieldRow, inputCls, isEmail, isPhone } from "./formKit";
import FeatureEditor from "./FeatureEditor";

// Fresh matrix for a new client: everything on, quotas blank (unlimited).
const defaultFeatures = (): ClientFeatureItem[] =>
  FEATURE_CATALOG.map((c) => ({ ...c, enabled: true, limit: null }));

interface Form {
  name: string;
  email: string;
  phone: string;
  plan: string;
  status: string;
  admin_name: string;
  admin_email: string;
  admin_password: string;
}

const empty: Form = {
  name: "", email: "", phone: "", plan: "starter", status: "active",
  admin_name: "", admin_email: "", admin_password: "",
};

interface CreateResult {
  client_id: number;
  db_name: string;
  db_provisioned: boolean;
  admin_email: string | null;
}

export default function CreateClientModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<Form>(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [saving, setSaving] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [features, setFeatures] = useState<ClientFeatureItem[]>(defaultFeatures);

  const set = (k: keyof Form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  function validate() {
    const e: Partial<Record<keyof Form, string>> = {};
    if (form.name.trim().length < 2) e.name = "Company name is required (min 2 characters).";
    if (form.email && !isEmail(form.email)) e.email = "Enter a valid email address.";
    if (form.phone && !isPhone(form.phone)) e.phone = "Enter a valid phone number.";
    // Admin account is required so the client can sign in to their panel.
    if (!form.admin_email.trim()) e.admin_email = "Admin email is required.";
    else if (!isEmail(form.admin_email)) e.admin_email = "Enter a valid email address.";
    if (form.admin_password.length < 8) e.admin_password = "Password must be at least 8 characters.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function reset() {
    setForm(empty);
    setErrors({});
    setShowPwd(false);
    setFeatures(defaultFeatures());
  }

  async function submit() {
    if (!validate()) {
      toast.warning("Please fix the highlighted fields.");
      return;
    }
    setSaving(true);
    try {
      const res = await adminPost<CreateResult>("/clients", { ...form });
      if (res.client_id) {
        await saveClientFeatures(res.client_id, features.map((f) => ({ key: f.key, enabled: f.enabled, limit: f.limit })))
          .catch(() => {});
      }
      toast.success(
        res.db_provisioned
          ? `Database "${res.db_name}" provisioned. Admin: ${res.admin_email}`
          : `Client created. Database "${res.db_name}" needs manual setup.`,
        { title: "Client created 🎉", duration: 7000 },
      );
      reset();
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create client");
    } finally {
      setSaving(false);
    }
  }

  function close() {
    if (saving) return;
    reset();
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={close}
      title="Create a new client"
      subtitle="Onboard a tenant organization and its admin account"
      width="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={close} disabled={saving} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {saving && <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>}
            {saving ? "Creating…" : "Create client"}
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Company */}
        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Company details</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldRow label="Company name" required error={errors.name} full>
              <input className={inputCls(errors.name)} placeholder="Acme Inc." value={form.name} onChange={(e) => set("name")(e.target.value)} />
            </FieldRow>
            <FieldRow label="Company email" error={errors.email}>
              <input className={inputCls(errors.email)} placeholder="hello@acme.com" value={form.email} onChange={(e) => set("email")(e.target.value)} />
            </FieldRow>
            <FieldRow label="Phone" error={errors.phone}>
              <input className={inputCls(errors.phone)} placeholder="+91 98765 43210" value={form.phone} onChange={(e) => set("phone")(e.target.value)} />
            </FieldRow>
            <FieldRow label="Plan">
              <select className={inputCls()} value={form.plan} onChange={(e) => set("plan")(e.target.value)}>
                <option value="starter">Starter plan</option>
                <option value="growth">Growth plan</option>
                <option value="enterprise">Enterprise plan</option>
              </select>
            </FieldRow>
            <FieldRow label="Status">
              <select className={inputCls()} value={form.status} onChange={(e) => set("status")(e.target.value)}>
                <option value="active">Active</option>
                <option value="trial">Trial</option>
                <option value="suspended">Suspended</option>
              </select>
            </FieldRow>
          </div>
        </section>

        {/* Admin account */}
        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Admin account</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldRow label="Admin name" hint="Shown as the client's primary contact." full>
              <input className={inputCls()} placeholder="Jane Doe" value={form.admin_name} onChange={(e) => set("admin_name")(e.target.value)} />
            </FieldRow>
            <FieldRow label="Admin email" required error={errors.admin_email}>
              <input className={inputCls(errors.admin_email)} placeholder="admin@acme.com" value={form.admin_email} onChange={(e) => set("admin_email")(e.target.value)} />
            </FieldRow>
            <FieldRow label="Password" required error={errors.admin_password} hint="Minimum 8 characters.">
              <div className="relative">
                <input type={showPwd ? "text" : "password"} className={`${inputCls(errors.admin_password)} pr-10`} placeholder="••••••••" value={form.admin_password} onChange={(e) => set("admin_password")(e.target.value)} />
                <button type="button" onClick={() => setShowPwd((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600" title={showPwd ? "Hide" : "Show"}>
                  {showPwd ? (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.5 9.5 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 3.9M6.2 6.2A17 17 0 002 12s4 7 10 7a9.5 9.5 0 003.9-.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </div>
            </FieldRow>
          </div>
        </section>

        {/* Features & limits */}
        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Features &amp; limits</h4>
          <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 p-3">
            <FeatureEditor items={features} onChange={setFeatures} />
          </div>
        </section>

        {/* DB note */}
        <div className="flex items-start gap-2 rounded-lg bg-indigo-50 px-3 py-2.5 text-xs text-indigo-700">
          <svg className="mt-0.5 h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" strokeLinecap="round" /></svg>
          A dedicated database is provisioned automatically for this client, and they get their own admin panel.
        </div>
      </div>
    </Drawer>
  );
}
