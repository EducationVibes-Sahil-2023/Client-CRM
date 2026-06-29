"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "../lib/api";
import { useToast } from "../components/toast/ToastProvider";
import type { Permissions, StaffMe } from "../lib/staff";

interface Ctx {
  me: StaffMe;
  permissions: Permissions;
  can: (module: string, action?: keyof Permissions[string]) => boolean;
  collapsed: boolean;
  toggleCollapsed: () => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  logout: () => void;
}

const StaffCtx = createContext<Ctx | null>(null);

export const useStaff = () => {
  const v = useContext(StaffCtx);
  if (!v) throw new Error("useStaff must be used within StaffProvider");
  return v;
};

export function StaffProvider({ me, children }: { me: StaffMe; children: React.ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const can = useCallback(
    (module: string, action: keyof Permissions[string] = "view") => !!me.permissions[module]?.[action],
    [me.permissions],
  );

  const logout = useCallback(async () => {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
    toast.success("You've been signed out.", { title: "Signed out" });
    router.replace("/login");
  }, [router, toast]);

  return (
    <StaffCtx.Provider
      value={{
        me,
        permissions: me.permissions,
        can,
        collapsed,
        toggleCollapsed: () => setCollapsed((c) => !c),
        mobileOpen,
        setMobileOpen,
        logout,
      }}
    >
      {children}
    </StaffCtx.Provider>
  );
}
