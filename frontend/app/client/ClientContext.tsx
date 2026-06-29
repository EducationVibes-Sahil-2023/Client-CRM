"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "../lib/api";
import { useToast } from "../components/toast/ToastProvider";
import {
  getNotifications,
  readAllNotifications,
  readNotification,
  type AppNotification,
} from "../lib/chat";
import { getBranding, getFeatures, getMe, pollReminders, type FeatureMap, type LimitMap, type Perm, type UsageMap } from "../lib/client";
import { requestNotifyPermission, notifyMessage } from "../lib/notify";
import { DEFAULT_BRANDING, type Branding } from "../lib/theme";

interface ClientUser {
  id: number;
  email: string;
  role: string;
  name?: string;
}

interface Ctx {
  user: ClientUser;
  collapsed: boolean;
  toggleCollapsed: () => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  logout: () => void;
  // plan features (effective: plan preset + per-client overrides)
  features: FeatureMap;
  limits: LimitMap;
  usage: UsageMap;
  featuresLoaded: boolean;
  hasFeature: (key: string) => boolean;
  limitFor: (key: string) => number | null;
  usageFor: (key: string) => number;
  // access control (admin vs staff + effective per-module permissions)
  isAdmin: boolean;
  permissionsLoaded: boolean;
  can: (module: string, action?: keyof Perm) => boolean;
  // branding / appearance
  branding: Branding;
  brandingLoaded: boolean;
  updateBranding: (b: Branding) => void;
  // notifications
  notifications: AppNotification[];
  unread: number;
  refreshNotifications: () => void;
  markRead: (id: number) => void;
  markAllRead: () => void;
}

const ClientCtx = createContext<Ctx | null>(null);

export const useClient = () => {
  const v = useContext(ClientCtx);
  if (!v) throw new Error("useClient must be used within ClientProvider");
  return v;
};

const POLL_MS = 30_000;

export function ClientProvider({ user, children }: { user: ClientUser; children: React.ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);

  const [features, setFeatures] = useState<FeatureMap>({});
  const [limits, setLimits] = useState<LimitMap>({});
  const [usage, setUsage] = useState<UsageMap>({});
  const [featuresLoaded, setFeaturesLoaded] = useState(false);

  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [brandingLoaded, setBrandingLoaded] = useState(false);

  const [permissions, setPermissions] = useState<Record<string, Perm>>({});
  const [isAdmin, setIsAdmin] = useState(true); // assume admin until /me resolves
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);

  // Resolve the current user's role + effective permissions (drives nav gating).
  useEffect(() => {
    getMe()
      .then((d) => { setIsAdmin(d.is_admin); setPermissions(d.permissions ?? {}); })
      .catch(() => {})
      .finally(() => setPermissionsLoaded(true));
  }, []);

  // Admins can do everything; staff are limited by their effective matrix.
  const can = useCallback(
    (module: string, action: keyof Perm = "view") => isAdmin || !!permissions[module]?.[action],
    [isAdmin, permissions],
  );

  // Load the client's branding/appearance config once (themes the whole panel).
  useEffect(() => {
    getBranding()
      .then((d) => setBranding({ ...DEFAULT_BRANDING, ...d.branding }))
      .catch(() => {})
      .finally(() => setBrandingLoaded(true));
  }, []);

  // Load the effective plan features once (drives sidebar/page gating).
  useEffect(() => {
    getFeatures()
      .then((d) => {
        setFeatures(d.features ?? {});
        setLimits(d.limits ?? {});
        setUsage(d.usage ?? {});
      })
      .catch(() => {})
      .finally(() => setFeaturesLoaded(true));
  }, []);

  // A feature is usable unless it's explicitly disabled (default-allow while
  // the map is still loading avoids a flash of hidden nav).
  const hasFeature = useCallback((key: string) => features[key] !== false, [features]);
  const limitFor = useCallback((key: string) => limits[key] ?? null, [limits]);
  const usageFor = useCallback((key: string) => usage[key] ?? 0, [usage]);

  // Highest notification id we've already shown a desktop alert for. Seeded on
  // the first poll so we don't alert for the backlog that existed at load.
  const seenMaxId = useRef<number | null>(null);

  const loadNotifications = useCallback(() => {
    getNotifications("client")
      .then((d) => {
        setNotifications(d.notifications);
        setUnread(d.unread);

        const maxId = d.notifications.reduce((m, n) => Math.max(m, n.id), 0);
        if (seenMaxId.current === null) {
          seenMaxId.current = maxId; // first load — don't alert for existing items
        } else if (maxId > seenMaxId.current) {
          // Fire a desktop notification for the newest unread arrival (reminders, etc.).
          const fresh = d.notifications.find((n) => n.id > (seenMaxId.current ?? 0) && !n.read_at);
          if (fresh) notifyMessage(fresh.title, fresh.body ?? "");
          seenMaxId.current = maxId;
        }
      })
      .catch(() => {});
  }, []);

  // Materialise any now-due lead reminders into notifications, then refresh.
  const refreshNotifications = useCallback(() => {
    pollReminders().catch(() => {}).finally(() => loadNotifications());
  }, [loadNotifications]);

  // Ask for desktop-notification permission once (needed for reminder alerts).
  useEffect(() => { requestNotifyPermission(); }, []);

  // Poll for new notifications. refreshNotifications is stable (useCallback)
  // and only writes state inside async callbacks, so no cascading renders.
  useEffect(() => {
    refreshNotifications();
    const t = setInterval(refreshNotifications, POLL_MS);
    return () => clearInterval(t);
  }, [refreshNotifications]);

  const markRead = useCallback((id: number) => {
    setNotifications((list) =>
      list.map((n) => (n.read_at || n.id !== id ? n : { ...n, read_at: new Date().toISOString() })),
    );
    setUnread((u) => Math.max(0, u - 1));
    readNotification("client", id).catch(() => {});
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((list) => list.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
    setUnread(0);
    readAllNotifications("client").catch(() => {});
  }, []);

  const logout = useCallback(async () => {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
    toast.success("You've been signed out.", { title: "Signed out" });
    router.replace("/login");
  }, [router, toast]);

  return (
    <ClientCtx.Provider
      value={{
        user,
        collapsed,
        toggleCollapsed: () => setCollapsed((c) => !c),
        mobileOpen,
        setMobileOpen,
        logout,
        features,
        limits,
        usage,
        featuresLoaded,
        hasFeature,
        limitFor,
        usageFor,
        isAdmin,
        permissionsLoaded,
        can,
        branding,
        brandingLoaded,
        updateBranding: setBranding,
        notifications,
        unread,
        refreshNotifications,
        markRead,
        markAllRead,
      }}
    >
      {children}
    </ClientCtx.Provider>
  );
}
