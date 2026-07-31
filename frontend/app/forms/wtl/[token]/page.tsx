"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "../../../lib/api";

/**
 * PUBLIC, embeddable Web-to-Lead form (rendered inside an <iframe> on external
 * sites). Self-contained: no client auth/context. Fetches its config from the
 * backend by token and posts submissions back to the same public endpoint.
 */

interface PublicField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
  builtin: boolean;
  options: string[];
}
interface PublicForm {
  name: string;
  language: string;
  submit_text: string;
  success_message: string;
  fields: PublicField[];
}

const inp = "w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20";

export default function PublicWebForm() {
  const params = useParams();
  const token = String(params.token ?? "");

  const [form, setForm] = useState<PublicForm | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/public/forms/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("unavailable"))))
      .then((d: PublicForm & { status: number }) => { if (alive) setForm(d); })
      .catch(() => { if (alive) setNotFound(true); });
    return () => { alive = false; };
  }, [token]);

  const setVal = (f: PublicField, raw: string) => {
    let v = raw;
    if (f.type === "tel" || f.key === "phone" || f.key === "alt_phone") v = raw.replace(/\D/g, "").slice(0, 10);
    setValues((s) => ({ ...s, [f.key]: v }));
    if (errors[f.key]) setErrors((e) => { const n = { ...e }; delete n[f.key]; return n; });
  };

  function validate(): boolean {
    if (!form) return false;
    const e: Record<string, string> = {};
    for (const f of form.fields) {
      const v = (values[f.key] ?? "").trim();
      if (f.key === "phone") {
        if (v.length !== 10) e[f.key] = "Enter a valid 10-digit number.";
      } else if (f.required && !v) {
        e[f.key] = `${f.label} is required.`;
      } else if (f.key === "email" && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        e[f.key] = "Enter a valid email address.";
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!form || !validate()) return;
    setSubmitting(true);
    // Split into built-in top-level fields + a custom_fields bag (matches backend).
    const custom: Record<string, string> = {};
    const body: Record<string, unknown> = { custom_fields: custom };
    for (const f of form.fields) {
      const v = values[f.key] ?? "";
      if (f.builtin) body[f.key] = v; else custom[f.key] = v;
    }
    try {
      const res = await fetch(`${API_URL}/public/forms/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msgs = data?.messages;
        if (msgs && typeof msgs === "object") setErrors(msgs as Record<string, string>);
        throw new Error(data?.message ?? "Submission failed");
      }
      setDone(data?.message ?? form.success_message ?? "Thank you!");
    } catch (e) {
      if (!Object.keys(errors).length) setErrors({ _form: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  if (notFound) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><p className="text-sm text-slate-500">This form is not available.</p></div>;
  }
  if (!form) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50"><div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" /></div>;
  }
  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          </div>
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{done}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <form onSubmit={submit} className="mx-auto max-w-xl space-y-4 rounded-2xl bg-white p-6 shadow-sm sm:p-8">
        {form.name && <h1 className="text-xl font-bold text-slate-900">{form.name}</h1>}
        {errors._form && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{errors._form}</p>}
        {form.fields.map((f) => (
          <div key={f.key}>
            <label className="mb-1 block text-sm font-medium text-slate-700">{f.label}{f.required && <span className="text-rose-500"> *</span>}</label>
            {f.type === "textarea" ? (
              <textarea value={values[f.key] ?? ""} onChange={(e) => setVal(f, e.target.value)} rows={3} placeholder={f.placeholder} className={`${inp} ${errors[f.key] ? "border-rose-400" : ""}`} />
            ) : f.type === "select" ? (
              <select value={values[f.key] ?? ""} onChange={(e) => setVal(f, e.target.value)} className={`${inp} ${errors[f.key] ? "border-rose-400" : ""}`}>
                <option value="">{f.placeholder || "— Select —"}</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                value={values[f.key] ?? ""}
                onChange={(e) => setVal(f, e.target.value)}
                type={f.type === "email" ? "email" : f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "tel" ? "tel" : "text"}
                inputMode={f.type === "tel" || f.key === "phone" ? "numeric" : undefined}
                placeholder={f.placeholder}
                className={`${inp} ${errors[f.key] ? "border-rose-400" : ""}`}
              />
            )}
            {errors[f.key] && <p className="mt-1 text-xs text-rose-600">{errors[f.key]}</p>}
          </div>
        ))}
        <button type="submit" disabled={submitting} className="w-full rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60">
          {submitting ? "Submitting…" : (form.submit_text || "Submit")}
        </button>
      </form>
    </div>
  );
}
