"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "../lib/api";
import { changePassword } from "../lib/admin";
import { AdminProvider, useAdmin } from "./AdminContext";
import { useToast } from "../components/toast/ToastProvider";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import ChatLauncher from "../components/chat/ChatLauncher";
import ForcePasswordChange from "../client/ForcePasswordChange";
import Loader from "../components/Loader";
import { useAdminLoader } from "../lib/adminPrefs";
import { useMounted } from "../lib/useMounted";

interface AdminUser {
  id: number;
  email: string;
  role: string;
  name?: string;
  avatar?: string;
  must_change_password?: boolean;
}

function Shell({ children }: { children: React.ReactNode }) {
  const { collapsed } = useAdmin();
  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar />
      <div className={`transition-all duration-300 ${collapsed ? "lg:ml-20" : "lg:ml-64"}`}>
        <Topbar />
        <main className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>
      </div>
      <ChatLauncher />
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [loaderStyle] = useAdminLoader();
  const mounted = useMounted();

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/auth/me`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return;
        if (data.user?.role !== "super_admin") {
          toast.error("Super admin access required.", { title: "Access denied" });
          router.replace("/login");
          return;
        }
        setUser(data.user);
        setMustChangePassword(!!data.user?.must_change_password);
      })
      .catch(() => {
        if (cancelled) return;
        toast.info("Please sign in to continue.", { title: "Session expired" });
        router.replace("/login");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        {mounted && <Loader variant={loaderStyle} size={36} className="text-indigo-500" label="Loading dashboard…" />}
      </div>
    );
  }

  if (mustChangePassword) {
    return (
      <ForcePasswordChange
        email={user.email}
        submit={(current_password, new_password) =>
          changePassword({ current_password, new_password }).then(() => undefined)
        }
        onDone={() => setMustChangePassword(false)}
        onLogout={async () => {
          await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
          router.replace("/login");
        }}
      />
    );
  }

  return (
    <AdminProvider user={user}>
      <Shell>{children}</Shell>
    </AdminProvider>
  );
}
