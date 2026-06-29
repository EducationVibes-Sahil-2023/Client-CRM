"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "../lib/api";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from "../lib/admin";
import { useToast } from "../components/toast/ToastProvider";

interface AdminUser {
  id: number;
  email: string;
  role: string;
  name?: string;
  avatar?: string;
}

interface AdminContextValue {
  user: AdminUser | null;
  collapsed: boolean;
  toggleCollapsed: () => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  notifications: NotificationItem[];
  refreshNotifications: () => void;
  dismissNotification: (n: NotificationItem) => void;
  clearAllNotifications: () => void;
  logout: () => void;
}

const Ctx = createContext<AdminContextValue | null>(null);

export const useAdmin = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdmin must be used inside AdminProvider");
  return v;
};

export function AdminProvider({
  user,
  children,
}: {
  user: AdminUser;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const refreshNotifications = useCallback(() => {
    getNotifications()
      .then((d) => setNotifications(d.notifications))
      .catch(() => {});
  }, []);

  // Initial load + poll every 30s for new submissions.
  useEffect(() => {
    refreshNotifications();
    const t = window.setInterval(refreshNotifications, 30000);
    return () => window.clearInterval(t);
  }, [refreshNotifications]);

  const dismissNotification = useCallback(
    (n: NotificationItem) => {
      setNotifications((list) =>
        list.filter((x) => !(x.id === n.id && x.type === n.type)),
      );
      markNotificationRead(n).catch(() => {});
    },
    [],
  );

  const clearAllNotifications = useCallback(() => {
    setNotifications([]);
    markAllNotificationsRead().catch(() => {});
  }, []);

  const logout = useCallback(async () => {
    await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
    toast.success("You've been signed out.", { title: "Signed out" });
    router.replace("/login");
  }, [router, toast]);

  return (
    <Ctx.Provider
      value={{
        user,
        collapsed,
        toggleCollapsed: () => setCollapsed((c) => !c),
        mobileOpen,
        setMobileOpen,
        notifications,
        refreshNotifications,
        dismissNotification,
        clearAllNotifications,
        logout,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
