"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../components/toast/ToastProvider";
import { getStaffMe, type StaffMe } from "../lib/staff";
import { StaffProvider, useStaff } from "./StaffContext";
import StaffSidebar from "./StaffSidebar";
import ChatLauncher from "../components/chat/ChatLauncher";

function Topbar() {
  const { toggleCollapsed, setMobileOpen, me } = useStaff();
  const initials = (me.user.name || me.user.email).slice(0, 1).toUpperCase();
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
      <button onClick={toggleCollapsed} className="hidden h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:flex" aria-label="Toggle sidebar">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" /></svg>
      </button>
      <button onClick={() => setMobileOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" /></svg>
      </button>
      <div className="text-sm font-semibold text-slate-500">Welcome back, <span className="text-slate-900">{me.user.name}</span></div>
      <span className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-blue-600 text-sm font-bold text-white">{initials}</span>
    </header>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { collapsed } = useStaff();
  return (
    <div className="min-h-screen bg-slate-50">
      <StaffSidebar />
      <div className={`transition-all duration-300 ${collapsed ? "lg:ml-20" : "lg:ml-64"}`}>
        <Topbar />
        <main className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>
      </div>
      <ChatLauncher area="staff" />
    </div>
  );
}

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [me, setMe] = useState<StaffMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getStaffMe()
      .then((data) => { if (!cancelled) setMe(data); })
      .catch(() => {
        if (cancelled) return;
        toast.error("Staff access required.", { title: "Access denied" });
        router.replace("/login");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-400">
        <svg className="h-8 w-8 animate-spin text-sky-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>
      </div>
    );
  }

  return (
    <StaffProvider me={me}>
      <Shell>{children}</Shell>
    </StaffProvider>
  );
}
