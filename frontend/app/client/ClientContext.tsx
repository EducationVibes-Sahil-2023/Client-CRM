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
import { getBranding, getFeatures, getMe, pollReminders, getAnnouncementsUnread, markAllAnnouncementsRead, stopImpersonation, type FeatureMap, type LimitMap, type Perm, type UsageMap } from "../lib/client";
import { requestNotifyPermission, notifyMessage } from "../lib/notify";
import { subscribeToPush } from "../lib/push";
import { DEFAULT_BRANDING, resolvePageSize, resolveLoaderStyle, type Branding, type LoaderStyle } from "../lib/theme";
import Loader from "../components/Loader";
import { useMounted } from "../lib/useMounted";
import ForcePasswordChange from "./ForcePasswordChange";

/** localStorage keys caching the last-known loader style + brand colour, so the
 *  boot screen shows the client's chosen animation in their brand colour
 *  immediately — before branding loads (the .client-shell isn't mounted yet, so
 *  the brand CSS vars aren't applied during boot). */
const LOADER_CACHE_KEY = "client_loader_style";
const BRAND_CACHE_KEY = "client_brand_color";

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
  setCollapsed: (v: boolean) => void;
  /** When true the main content drops its max-width cap and spans full width
   *  (used while a full-height filter rail is open). */
  contentFull: boolean;
  setContentFull: (v: boolean) => void;
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
  /** True when the signed-in user is a reference-scoped "agent" (sees only their
   *  reference's leads; assignment doesn't apply, so the UI hides it). */
  isAgent: boolean;
  permissionsLoaded: boolean;
  can: (module: string, action?: keyof Perm) => boolean;
  // super-admin "login as client" impersonation (null when not impersonating)
  impersonation: { name: string | null; client: string | null } | null;
  exitImpersonation: () => void;
  // branding / appearance
  branding: Branding;
  brandingLoaded: boolean;
  updateBranding: (b: Branding) => void;
  /** Admin-configured default rows-per-page for every data table. */
  defaultPageSize: number;
  // notifications
  notifications: AppNotification[];
  unread: number;
  refreshNotifications: () => void;
  markRead: (id: number) => void;
  markAllRead: () => void;
  // announcements (navbar badge)
  announcementsUnread: number;
  refreshAnnouncements: () => void;
  markAnnouncementsRead: () => void;
}

const ClientCtx = createContext<Ctx | null>(null);

export const useClient = () => {
  const v = useContext(ClientCtx);
  if (!v) throw new Error("useClient must be used within ClientProvider");
  return v;
};

const POLL_MS = 30_000;

export function ClientProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [contentFull, setContentFull] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // The signed-in user, resolved from /client/me (which also carries
  // permissions). This is the single auth source — no separate /auth/me hop.
  const [user, setUser] = useState<ClientUser | null>(null);
  // True when the account signed in on a weak password — the whole panel is
  // replaced by a forced password-change screen until they set a strong one.
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [announcementsUnread, setAnnouncementsUnread] = useState(0);

  const [features, setFeatures] = useState<FeatureMap>({});
  const [limits, setLimits] = useState<LimitMap>({});
  const [usage, setUsage] = useState<UsageMap>({});
  const [featuresLoaded, setFeaturesLoaded] = useState(false);

  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [brandingLoaded, setBrandingLoaded] = useState(false);
  // Loader style to show on the boot screen (before branding loads), seeded from
  // the cached choice so the chosen animation shows on every reload. Read lazily
  // (once) from localStorage; the wrapper carries suppressHydrationWarning since
  // this is a client-only value the server can't know.
  const [bootLoader] = useState<LoaderStyle>(() =>
    resolveLoaderStyle(typeof window !== "undefined" ? localStorage.getItem(LOADER_CACHE_KEY) : null),
  );
  const [bootBrand] = useState<string>(() =>
    (typeof window !== "undefined" && localStorage.getItem(BRAND_CACHE_KEY)) || DEFAULT_BRANDING.brand_color,
  );
  // Whether a brand colour was cached. When it wasn't (first-ever load), we hold
  // the boot loader back until branding loads rather than flash the default
  // colour — so the loader is *always* shown in the tenant's theme colour.
  const [bootBrandCached] = useState<boolean>(() =>
    typeof window !== "undefined" && !!localStorage.getItem(BRAND_CACHE_KEY),
  );
  // Gate the boot loader until the client knows the chosen style, so the first
  // loader painted is the selected one (no default-then-selected flash).
  const mounted = useMounted();

  const [permissions, setPermissions] = useState<Record<string, Perm>>({});
  const [isAdmin, setIsAdmin] = useState(true); // assume admin until /me resolves
  const [isAgent, setIsAgent] = useState(false);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [impersonation, setImpersonation] = useState<{ name: string | null; client: string | null } | null>(null);

  const exitImpersonation = useCallback(() => {
    stopImpersonation().catch(() => {}).finally(() => { window.location.href = "/admin"; });
  }, []);

  // Resolve the current user + role + effective permissions in one call
  // (drives the greeting, avatar and nav gating). /client/me is auth-guarded,
  // so a failure means the session is invalid → bounce to login.
  useEffect(() => {
    getMe()
      .then((d) => {
        setUser({ id: d.user.id, email: d.user.email, role: d.user.role, name: d.user.name });
        setIsAdmin(d.is_admin);
        setIsAgent(!!d.is_agent);
        setPermissions(d.permissions ?? {});
        setMustChangePassword(!!d.user.must_change_password);
        setImpersonation(d.impersonating ? { name: d.impersonator_name ?? null, client: d.client_name ?? null } : null);
      })
      .catch(() => {
        toast.error("Please sign in to continue.", { title: "Session expired" });
        router.replace("/login");
      })
      .finally(() => setPermissionsLoaded(true));
  }, [router, toast]);

  // Admins can do everything; staff are limited by their effective matrix.
  const can = useCallback(
    (module: string, action: keyof Perm = "view") => isAdmin || !!permissions[module]?.[action],
    [isAdmin, permissions],
  );

  // Load the client's branding/appearance config once (themes the whole panel).
  useEffect(() => {
    getBranding()
      .then((d) => {
        const b = { ...DEFAULT_BRANDING, ...d.branding };
        setBranding(b);
        // Cache the chosen loader + brand colour so the next boot screen shows
        // the right animation in the right colour instantly.
        try {
          localStorage.setItem(LOADER_CACHE_KEY, resolveLoaderStyle(b.loader_style));
          localStorage.setItem(BRAND_CACHE_KEY, b.brand_color);
        } catch {}
      })
      .catch(() => {})
      .finally(() => setBrandingLoaded(true));
  }, []);

  // Reflect the client's branding in the browser tab: title from the app name,
  // and a favicon from their dedicated favicon (falling back to the logo). We
  // manage a single dedicated <link> so it can be cleanly removed (falling back
  // to the default /favicon.ico) when a client hasn't set either.
  useEffect(() => {
    const name = branding.app_name?.trim();
    if (name) document.title = name;

    // Prefer the dedicated favicon; fall back to the logo when none is set.
    const src = branding.favicon_url || branding.logo_url || "";
    const href = src ? (src.startsWith("http") ? src : `${API_URL}${src}`) : "";

    let link = document.querySelector<HTMLLinkElement>("link#client-favicon");
    if (href) {
      if (!link) {
        link = document.createElement("link");
        link.id = "client-favicon";
        link.rel = "icon";
      }
      // Hint the type so browsers pick up .ico/.png/.svg reliably.
      const ext = src.split("?")[0].split(".").pop()?.toLowerCase();
      link.type = ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : ext === "ico" ? "image/x-icon" : "";
      link.href = href;
      // Re-append last so our icon wins over any build-time <link rel="icon">.
      document.head.appendChild(link);
    } else if (link) {
      link.remove(); // no favicon/logo → let the default favicon show
    }
  }, [branding.app_name, branding.favicon_url, branding.logo_url]);

  // On leaving the client panel (e.g. logout → /login), drop the branded favicon
  // so the default returns instead of the previous client's logo lingering.
  useEffect(() => () => {
    document.querySelector("link#client-favicon")?.remove();
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

  // Web push: once features are known, if the client has `web_push`, register the
  // service worker and subscribe this browser (auto-prompts for permission). Runs
  // once per session; a no-op when unsupported, denied, or the feature is off.
  const pushTried = useRef(false);
  useEffect(() => {
    if (pushTried.current || !featuresLoaded || !hasFeature("web_push")) return;
    pushTried.current = true;
    subscribeToPush().catch(() => {});
  }, [featuresLoaded, hasFeature]);

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

  // Unread announcements — its own navbar badge (separate from notifications).
  const refreshAnnouncements = useCallback(() => {
    getAnnouncementsUnread().then((d) => setAnnouncementsUnread(d.unread)).catch(() => {});
  }, []);
  const markAnnouncementsRead = useCallback(() => {
    setAnnouncementsUnread(0);
    markAllAnnouncementsRead().catch(() => {});
  }, []);

  // Poll the unread-announcement count, but only when the feature is on and the
  // user is allowed to view announcements.
  useEffect(() => {
    if (!featuresLoaded || !permissionsLoaded) return;
    if (!hasFeature("announcements") || !can("announcements")) { setAnnouncementsUnread(0); return; }
    refreshAnnouncements();
    const t = setInterval(refreshAnnouncements, POLL_MS);
    return () => clearInterval(t);
  }, [featuresLoaded, permissionsLoaded, hasFeature, can, refreshAnnouncements]);

  const logout = useCallback(async () => {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
    toast.success("You've been signed out.", { title: "Signed out" });
    router.replace("/login");
  }, [router, toast]);

  // Preload everything that shapes the first paint — branding (logo + name +
  // theme), plan features and permissions (the menu) — before rendering the
  // shell. These three requests run in parallel, so we wait for the slowest,
  // not the sum, and the panel appears fully built instead of popping in.
  // (Notifications load lazily afterwards and don't block the shell.)
  const booted = !!user && brandingLoaded && featuresLoaded && permissionsLoaded;

  return (
    <ClientCtx.Provider
      value={{
        user: user ?? { id: 0, email: "", role: "" },
        collapsed,
        toggleCollapsed: () => setCollapsed((c) => !c),
        setCollapsed,
        contentFull,
        setContentFull,
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
        isAgent,
        permissionsLoaded,
        can,
        impersonation,
        exitImpersonation,
        branding,
        brandingLoaded,
        updateBranding: (b: Branding) => {
          setBranding(b);
          try {
            localStorage.setItem(LOADER_CACHE_KEY, resolveLoaderStyle(b.loader_style));
            localStorage.setItem(BRAND_CACHE_KEY, b.brand_color);
          } catch {}
        },
        defaultPageSize: resolvePageSize(branding.default_page_size),
        notifications,
        unread,
        refreshNotifications,
        markRead,
        markAllRead,
        announcementsUnread,
        refreshAnnouncements,
        markAnnouncementsRead,
      }}
    >
      {!booted ? (
        <div className="flex min-h-screen items-center justify-center bg-slate-50" style={{ color: brandingLoaded ? branding.brand_color : bootBrand }} suppressHydrationWarning>
          {mounted && (brandingLoaded || bootBrandCached) && (
            <Loader variant={brandingLoaded ? branding.loader_style : bootLoader} size={36} />
          )}
        </div>
      ) : mustChangePassword ? (
        <ForcePasswordChange
          email={user?.email ?? ""}
          onDone={() => setMustChangePassword(false)}
          onLogout={logout}
        />
      ) : (
        children
      )}
    </ClientCtx.Provider>
  );
}
