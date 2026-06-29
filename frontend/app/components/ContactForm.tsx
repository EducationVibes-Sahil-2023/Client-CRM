"use client";

import { useState } from "react";
import { sendContact } from "../lib/api";
import { isEmail, type Errors } from "../lib/validation";
import { Field, TextAreaField, SubmitButton, SuccessCard } from "./FormBits";
import { useToast } from "./toast/ToastProvider";

type Form = { name: string; email: string; company: string; message: string };
const empty: Form = { name: "", email: "", company: "", message: "" };

const mailIcon = (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 8l9 6 9-6M3 8v10a2 2 0 002 2h14a2 2 0 002-2V8M3 8l9-5 9 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const userIcon = (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 21a8 8 0 10-16 0M12 11a4 4 0 100-8 4 4 0 000 8z" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const bldgIcon = (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 21h18M5 21V5a2 2 0 012-2h6a2 2 0 012 2v16M9 7h2M9 11h2M9 15h2M17 21v-8a2 2 0 012-2h0a2 2 0 012 2v8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export default function ContactForm() {
  const toast = useToast();
  const [form, setForm] = useState<Form>(empty);
  const [errors, setErrors] = useState<Errors<Form>>({});
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const set = (k: keyof Form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  function validate(): boolean {
    const e: Errors<Form> = {};
    if (!form.name.trim()) e.name = "Please enter your name";
    if (!form.email.trim()) e.email = "Email is required";
    else if (!isEmail(form.email)) e.email = "Enter a valid email address";
    if (form.message.trim().length < 10) e.message = "Please add a bit more detail (10+ characters)";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setServerError("");
    if (!validate()) {
      toast.warning("Please fix the highlighted fields.", { title: "Check your details" });
      return;
    }
    setLoading(true);
    try {
      const { message } = await sendContact(form);
      setDone(message);
      toast.success("Thanks! We'll get back to you shortly.", { title: "Message sent 🎉" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setServerError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <SuccessCard
        title="Message sent! 🎉"
        message={done}
        onReset={() => {
          setForm(empty);
          setDone(null);
        }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {serverError && (
        <div className="animate-shake flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4m0 4h.01" strokeLinecap="round" /></svg>
          {serverError}
        </div>
      )}

      <Field label="Your name" value={form.name} onChange={set("name")} error={errors.name} placeholder="Jane Doe" icon={userIcon} />
      <Field label="Email" type="email" value={form.email} onChange={set("email")} error={errors.email} placeholder="jane@company.com" icon={mailIcon} />
      <Field label="Company" value={form.company} onChange={set("company")} error={errors.company} placeholder="Acme Inc." icon={bldgIcon} optional />
      <TextAreaField label="How can we help?" value={form.message} onChange={set("message")} error={errors.message} rows={4} placeholder="Tell us what you're looking for…" />

      <SubmitButton loading={loading}>Send message</SubmitButton>
    </form>
  );
}
