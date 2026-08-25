"use client";

import { useState } from "react";
import NotificationsView from "../../components/notifications/NotificationsView";
import { testWebPush } from "../../lib/push";
import { useToast } from "../../components/toast/ToastProvider";

export default function NotificationsPage() {
  const toast = useToast();
  const [testing, setTesting] = useState(false);

  async function runTest() {
    setTesting(true);
    try {
      const r = await testWebPush();
      if (r.sent > 0) {
        toast.success(`Test sent — check for the notification on ${r.sent} browser(s).`);
      } else if (!r.vapid) {
        toast.error("Web push keys aren't set up on the server (VAPID missing).");
      } else if (!r.feature) {
        toast.warning("Web push isn't enabled for this account — ask your admin to turn it on.");
      } else if (r.subscriptions === 0) {
        toast.warning("Allow notifications when your browser prompts, then click Test again.");
      } else {
        toast.warning("Subscribed, but delivery failed — reload the page and try once more.");
      }
    } catch {
      toast.error("Could not send a test notification.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <NotificationsView
      area="client"
      headerExtra={
        <button
          onClick={runTest}
          disabled={testing}
          title="Send yourself a test notification to check web push"
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {testing ? "Testing…" : "Test notification"}
        </button>
      }
    />
  );
}
