"use client";

import { useEffect, useState } from "react";
import {
  getGmailSettings,
  saveGmailSettings,
  testGmailSettings,
  sendTestEmail,
  getEmailSignature,
  saveEmailSignature,
  getGoogleCalendarSettings,
  saveGoogleCalendarSettings,
  testGoogleCalendarSettings,
  type GmailSettings,
  type GoogleCalendarSettings,
} from "../../lib/admin";
import { useToast } from "../../components/toast/ToastProvider";
import { PageHeader, Card, Field, SkeletonText } from "../ui";
import RichTextEditor from "../RichTextEditor";

function StatusPill({ connected }: { connected?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${connected ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-slate-400"}`} />
      {connected ? "Connected" : "Not connected"}
    </span>
  );
}

function TestBanner({ result }: { result: { ok: boolean; text: string } | null }) {
  if (!result) return null;
  return (
    <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ${result.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
      <svg className="mt-0.5 h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        {result.ok
          ? <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          : <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
      <span className="break-words">{result.text}</span>
    </div>
  );
}

// ----------------------------------------------------------------- Gmail card

function GmailCard() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<GmailSettings | null>(null);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [mailbox, setMailbox] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testTo, setTestTo] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getGmailSettings()
      .then((s) => {
        setSettings(s);
        setUser(s.user);
        setTestTo(s.user);
        setMailbox(s.mailbox || s.default_mailbox);
      })
      .catch(() => toast.error("Could not load Gmail settings."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendTest() {
    if (!testTo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo)) {
      toast.warning("Enter a valid recipient email.");
      return;
    }
    setSendingTest(true);
    setSendResult(null);
    try {
      const r = await sendTestEmail(testTo);
      if (r.ok) {
        setSendResult({ ok: true, text: `Test email sent to ${testTo}. Check the inbox (and spam).` });
        toast.success("Test email sent.");
      } else {
        setSendResult({ ok: false, text: r.error ?? "The email could not be sent." });
      }
    } catch (e) {
      setSendResult({ ok: false, text: e instanceof Error ? e.message : "The email could not be sent." });
    } finally {
      setSendingTest(false);
    }
  }

  async function save() {
    if (user && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user)) {
      toast.warning("Enter a valid Gmail address.");
      return;
    }
    setSaving(true);
    try {
      const s = await saveGmailSettings({ user, app_password: password, mailbox });
      setSettings(s);
      setPassword("");
      setTestResult(null);
      toast.success("Gmail settings saved.", { title: "Saved" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testGmailSettings({ user, app_password: password, mailbox });
      if (r.ok) {
        setTestResult({ ok: true, text: `Connected — ${r.total ?? 0} message${r.total === 1 ? "" : "s"} in the mailbox.` });
        toast.success("Connection successful.");
      } else {
        setTestResult({ ok: false, text: r.error ?? "Connection failed." });
      }
    } catch (e) {
      setTestResult({ ok: false, text: e instanceof Error ? e.message : "Connection failed." });
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <Card className="lg:col-span-3"><SkeletonText lines={4} /></Card>;

  return (
    <>
      <Card className="lg:col-span-2">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50">
            <svg className="h-6 w-6 text-rose-500" fill="currentColor" viewBox="0 0 24 24"><path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0-8 5L4 6h16zm0 12H4V8l8 5 8-5v10z" /></svg>
          </span>
          <div className="flex-1">
            <h2 className="font-semibold text-slate-900">Gmail (IMAP)</h2>
            <p className="text-sm text-slate-500">Reads mail with a Google App Password.</p>
          </div>
          <StatusPill connected={settings?.configured} />
        </div>

        <div className="space-y-4">
          <Field label="Gmail address" value={user} onChange={setUser} type="email" placeholder="you@gmail.com" />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">App Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={settings?.has_password ? "•••••••••••• (saved — leave blank to keep)" : "xxxx xxxx xxxx xxxx"}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              autoComplete="new-password"
            />
            <span className="mt-1 block text-xs text-slate-400">
              Not your login password. Create one at Google Account → Security → 2-Step Verification → App passwords.
            </span>
          </label>

          <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
            {showAdvanced ? "Hide" : "Show"} advanced
          </button>
          {showAdvanced && (
            <Field label="IMAP mailbox" value={mailbox} onChange={setMailbox} placeholder={settings?.default_mailbox} />
          )}

          <TestBanner result={testResult} />

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60">
              {saving ? "Saving…" : "Save settings"}
            </button>
            <button onClick={test} disabled={testing} className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
              {testing ? "Testing…" : "Test connection (read)"}
            </button>
          </div>

          {/* Outgoing email test — this is what powers replies to contacts/demos */}
          <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Send a test email</h3>
            <p className="mt-0.5 text-xs text-slate-500">Verifies outgoing mail (Gmail SMTP) — the same path used when you reply to a contact or demo request.</p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="flex-1">
                <span className="mb-1 block text-xs font-medium text-slate-600">Send to</span>
                <input
                  type="email"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                />
              </label>
              <button onClick={sendTest} disabled={sendingTest} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">
                {sendingTest ? "Sending…" : "Send test"}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">Save your Gmail address &amp; App Password first. Replies won&apos;t be delivered until a test email succeeds.</p>
            {sendResult && <div className="mt-3"><TestBanner result={sendResult} /></div>}
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold text-slate-900">How to connect</h3>
        <ol className="mt-3 space-y-3 text-sm text-slate-600">
          <li className="flex gap-2.5"><span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600">1</span>Turn on <b>2-Step Verification</b> for the Google account.</li>
          <li className="flex gap-2.5"><span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600">2</span>Go to <b>Security → App passwords</b> and generate one for “Mail”.</li>
          <li className="flex gap-2.5"><span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600">3</span>Paste the Gmail address and the 16-character password here, then <b>Save</b>.</li>
        </ol>
        <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700">
          Open Google App passwords
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17 17 7M7 7h10v10" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </a>
      </Card>
    </>
  );
}

// ------------------------------------------------------- Signature card

function SignatureCard() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [initial, setInitial] = useState("");
  const [html, setHtml] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getEmailSignature()
      .then((s) => { setInitial(s); setHtml(s); })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const r = await saveEmailSignature(html);
      setInitial(r.signature);
      toast.success("Signature saved.", { title: "Saved" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save signature.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="lg:col-span-3">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50">
          <svg className="h-6 w-6 text-indigo-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 17l4-1 11-11a2.1 2.1 0 00-3-3L4 13l-1 4zM14 6l3 3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <div className="flex-1">
          <h2 className="font-semibold text-slate-900">Company email signature</h2>
          <p className="text-sm text-slate-500">Added automatically to the bottom of every reply you compose.</p>
        </div>
      </div>

      {loading ? (
        <SkeletonText lines={4} />
      ) : (
        <div className="space-y-4">
          <RichTextEditor key={initial} initialHTML={initial} onChange={setHtml} placeholder="e.g. Best regards,&#10;Acme Team · support@acme.com" minHeight={150} />
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60">
              {saving ? "Saving…" : "Save signature"}
            </button>
            <span className="text-xs text-slate-400">Supports bold, italic, lists and links.</span>
          </div>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------- Google Calendar card

function GoogleCalendarCard() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<GoogleCalendarSettings | null>(null);
  const [calendarId, setCalendarId] = useState("");
  const [serviceAccount, setServiceAccount] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getGoogleCalendarSettings()
      .then((s) => {
        setSettings(s);
        setCalendarId(s.calendar_id);
      })
      .catch(() => toast.error("Could not load Google Calendar settings."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!calendarId.trim()) {
      toast.warning("Enter the calendar ID.");
      return;
    }
    setSaving(true);
    try {
      const s = await saveGoogleCalendarSettings({ calendar_id: calendarId, service_account: serviceAccount });
      setSettings(s);
      setServiceAccount(""); // never keep the key in the field after saving
      setTestResult(null);
      toast.success("Google Calendar settings saved.", { title: "Saved" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testGoogleCalendarSettings({ calendar_id: calendarId, service_account: serviceAccount });
      if (r.ok) {
        setTestResult({ ok: true, text: `Connected to “${r.calendar ?? calendarId}”.` });
        toast.success("Connection successful.");
      } else {
        setTestResult({ ok: false, text: r.error ?? "Connection failed." });
      }
    } catch (e) {
      setTestResult({ ok: false, text: e instanceof Error ? e.message : "Connection failed." });
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <Card className="lg:col-span-3"><SkeletonText lines={4} /></Card>;

  return (
    <>
      <Card className="lg:col-span-2">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50">
            <svg className="h-6 w-6 text-sky-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 3v4M16 3v4M4 9h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <div className="flex-1">
            <h2 className="font-semibold text-slate-900">Google Calendar</h2>
            <p className="text-sm text-slate-500">Show & create meetings via a service account.</p>
          </div>
          <StatusPill connected={settings?.configured} />
        </div>

        <div className="space-y-4">
          <Field
            label="Calendar ID"
            value={calendarId}
            onChange={setCalendarId}
            placeholder="you@gmail.com  or  abc123@group.calendar.google.com"
          />

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Service account JSON key</span>
            <textarea
              value={serviceAccount}
              onChange={(e) => setServiceAccount(e.target.value)}
              rows={5}
              placeholder={settings?.has_service_account ? "•••••••• (saved — leave blank to keep)\nPaste a new key to replace it." : '{\n  "type": "service_account",\n  "client_email": "...",\n  "private_key": "..."\n}'}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              spellCheck={false}
            />
            <span className="mt-1 block text-xs text-slate-400">
              The JSON key you downloaded for the service account. Stored encrypted at rest in your database and never shown again.
            </span>
          </label>

          {settings?.service_account_email && (
            <div className="rounded-lg bg-sky-50 px-3 py-2.5 text-xs text-sky-700">
              Share your calendar with this service account (Make changes to events):
              <span className="mt-1 block font-mono font-medium break-all">{settings.service_account_email}</span>
            </div>
          )}

          <TestBanner result={testResult} />

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60">
              {saving ? "Saving…" : "Save settings"}
            </button>
            <button onClick={test} disabled={testing} className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
              {testing ? "Testing…" : "Test connection"}
            </button>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold text-slate-900">How to connect</h3>
        <ol className="mt-3 space-y-3 text-sm text-slate-600">
          <li className="flex gap-2.5"><span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600">1</span>In <b>Google Cloud Console</b>, create a project and enable the <b>Calendar API</b>.</li>
          <li className="flex gap-2.5"><span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600">2</span>Create a <b>service account</b> and download its <b>JSON key</b>.</li>
          <li className="flex gap-2.5"><span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600">3</span>In Google Calendar, <b>share</b> your calendar with the service account email (Make changes to events).</li>
          <li className="flex gap-2.5"><span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600">4</span>Paste the JSON key and the calendar ID here, then <b>Save</b>.</li>
        </ol>
        <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700">
          Open Google Cloud Console
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17 17 7M7 7h10v10" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </a>
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
          Find the <b>Calendar ID</b> in Google Calendar → calendar Settings → “Integrate calendar”.
        </p>
      </Card>
    </>
  );
}

export default function IntegrationsPage() {
  return (
    <>
      <PageHeader title="Integrations" subtitle="Connect external services like email and calendar to your admin workspace." />

      <div className="space-y-8">
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Email</h2>
          <div className="grid gap-5 lg:grid-cols-3">
            <GmailCard />
            <SignatureCard />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Calendar</h2>
          <div className="grid gap-5 lg:grid-cols-3">
            <GoogleCalendarCard />
          </div>
        </section>
      </div>
    </>
  );
}
