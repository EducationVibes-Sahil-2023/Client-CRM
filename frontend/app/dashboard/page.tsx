"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL, type SessionUser } from "../lib/api";
import { useToast } from "../components/toast/ToastProvider";

export default function Dashboard() {
  const router = useRouter();
  const toast = useToast();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/auth/me`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setUser(data.user))
      .catch(() => {
        toast.info("Please sign in to continue.", { title: "Session expired" });
        router.replace("/");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleLogout() {
    await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    toast.success("You've been signed out.", { title: "Signed out" });
    router.replace("/");
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-500">
        Loading…
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-8 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Signed in</h1>
        <p className="mt-2 text-slate-500">{user?.email}</p>
        <span className="mt-3 inline-block rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
          {user?.role}
        </span>
        <button
          onClick={handleLogout}
          className="mt-6 w-full rounded-lg bg-slate-800 hover:bg-slate-900 px-4 py-2 font-semibold text-white transition"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
