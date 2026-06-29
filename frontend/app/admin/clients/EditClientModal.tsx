"use client";

import { useEffect, useState } from "react";
import { updateClient, getClientFeatures, saveClientFeatures, type Client, type ClientFeatureItem } from "../../lib/admin";
import { useToast } from "../../components/toast/ToastProvider";
import { Drawer } from "../ui";
import { FieldRow, inputCls, isEmail, isPhone } from "./formKit";
import FeatureEditor from "./FeatureEditor";

// DATE columns may come back as "YYYY-MM-DD" or with a time — keep the date part.
const dateOnly = (v?: string | null) => (v ? v.slice(0, 10) : "");

interface Form {
  name: string;
  email: string;
  phone: string;
  subdomain: string;
  plan: string;
  status: string;
  plan_start: string;
  plan_end: string;
}

export default function EditClientModal({
  client,
  onClose,
  onSaved,
}: {
  client: Client | null;
  onClose: () => void;
  onSaved: (c: Client) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [saving, setSaving] = useState(false);
  const [features, setFeatures] = useState<ClientFeatureItem[]>([]);

  /* eslint-disable react-hooks/set-state-in-effect -- intentional prop→state sync when the drawer opens */
  useEffect(() => {
    if (client) {
      setForm({
        name: client.name ?? "",
        email: client.email ?? "",
        phone: client.phone ?? "",
        subdomain: client.subdomain ?? "",
        plan: client.plan || "starter",
        status: client.status || "active",
        plan_start: dateOnly(client.plan_start),
        plan_end: dateOnly(client.plan_end),
      });
      setErrors({});
      getClientFeatures(client.id).then((d) => setFeatures(d.features)).catch(() => setFeatures([]));
    }
  }, [client]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!client || !form) return null;

  const set = (k: keyof Form) => (v: string) => {
    setForm((f) => ({ ...f!, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  function validate(f: Form) {
    const e: Partial<Record<keyof Form, string>> = {};
    if (f.name.trim().length < 2) e.name = "Company name is required (min 2 characters).";
    if (f.email && !isEmail(f.email)) e.email = "Enter a valid email address.";
    if (f.phone && !isPhone(f.phone)) e.phone = "Enter a valid phone number.";
    if (f.subdomain && !/^[a-z0-9-]+$/.test(f.subdomain)) e.subdomain = "Use lowercase letters, numbers and hyphens only.";
    if (f.plan_start && f.plan_end && f.plan_end < f.plan_start) e.plan_end = "End date must be after the start date.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!form || !validate(form)) {
      toast.warning("Please fix the highlighted fields.");
      return;
    }
    setSaving(true);
    try {
      const res = await updateClient(client!.id, {
        name: form.name,
        email: form.email,
        phone: form.phone,
        subdomain: form.subdomain,
        plan: form.plan,
        status: form.status,
        plan_start: form.plan_start,
        plan_end: form.plan_end,
      } as Partial<Client>);
      if (features.length) {
        await saveClientFeatures(client!.id, features.map((f) => ({ key: f.key, enabled: f.enabled, limit: f.limit })));
      }
      toast.success("Client updated.", { title: "Saved" });
      onSaved(res.client);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update client");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={!!client}
      onClose={() => !saving && onClose()}
      title={`Edit ${client.name}`}
      subtitle="Update company details, subscription and feature limits"
      width="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={() => !saving && onClose()} disabled={saving} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {saving && <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>}
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Company details</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldRow label="Company name" required error={errors.name} full>
              <input className={inputCls(errors.name)} placeholder="Acme Inc." value={form.name} onChange={(e) => set("name")(e.target.value)} />
            </FieldRow>
            <FieldRow label="Email" error={errors.email}>
              <input className={inputCls(errors.email)} placeholder="hello@acme.com" value={form.email} onChange={(e) => set("email")(e.target.value)} />
            </FieldRow>
            <FieldRow label="Phone" error={errors.phone}>
              <input className={inputCls(errors.phone)} placeholder="+91 98765 43210" value={form.phone} onChange={(e) => set("phone")(e.target.value)} />
            </FieldRow>
            <FieldRow label="Workspace / subdomain" error={errors.subdomain} hint="Lowercase letters, numbers and hyphens." full>
              <input className={inputCls(errors.subdomain)} placeholder="acme" value={form.subdomain} onChange={(e) => set("subdomain")(e.target.value)} />
            </FieldRow>
          </div>
        </section>

        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Subscription</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldRow label="Plan">
              <select className={inputCls()} value={form.plan} onChange={(e) => set("plan")(e.target.value)}>
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </FieldRow>
            <FieldRow label="Status">
              <select className={inputCls()} value={form.status} onChange={(e) => set("status")(e.target.value)}>
                <option value="active">Active</option>
                <option value="trial">Trial</option>
                <option value="suspended">Suspended</option>
                <option value="inactive">Inactive</option>
              </select>
            </FieldRow>
            <FieldRow label="Plan start">
              <input type="date" className={inputCls()} value={form.plan_start} onChange={(e) => set("plan_start")(e.target.value)} />
            </FieldRow>
            <FieldRow label="Plan end" error={errors.plan_end} hint="Leave empty for open-ended.">
              <input type="date" className={inputCls(errors.plan_end)} value={form.plan_end} min={form.plan_start || undefined} onChange={(e) => set("plan_end")(e.target.value)} />
            </FieldRow>
          </div>
        </section>

        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Features &amp; limits</h4>
          {features.length === 0 ? (
            <p className="text-sm text-slate-400">Loading features…</p>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 p-3">
              <FeatureEditor items={features} onChange={setFeatures} />
            </div>
          )}
        </section>
      </div>
    </Drawer>
  );
}
