// Display metadata for permission modules, shared by the staff sidebar and
// dashboard. Keys match ClientController::MODULES on the backend.
export const MODULE_META: Record<string, { label: string; icon: string }> = {
  dashboard: { label: "Dashboard", icon: "M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 14h7v5H4z" },
  leads: { label: "Leads", icon: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8z" },
  team: { label: "Team", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2M17 11h4m-2-2v4" },
  roles: { label: "Roles & Permissions", icon: "M12 11a3 3 0 100-6 3 3 0 000 6zM4 21v-2a4 4 0 014-4h8a4 4 0 014 4v2" },
  tasks: { label: "Tasks", icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" },
  announcements: { label: "Announcements", icon: "M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 010 7M18 6a8 8 0 010 12" },
  chat: { label: "Chat", icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" },
  notifications: { label: "Notifications", icon: "M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" },
  email_config: { label: "Email Setup", icon: "M3 8l9 6 9-6M3 8v10a2 2 0 002 2h14a2 2 0 002-2V8M3 8l9-5 9 5" },
  settings: { label: "Settings", icon: "M10.3 4.3a2 2 0 013.4 0l.5.9 1-.2a2 2 0 012.4 2.4l-.2 1 .9.5a2 2 0 010 3.4l-.9.5.2 1a2 2 0 01-2.4 2.4l-1-.2-.5.9a2 2 0 01-3.4 0l-.5-.9-1 .2a2 2 0 01-2.4-2.4l.2-1-.9-.5a2 2 0 010-3.4l.9-.5-.2-1a2 2 0 012.4-2.4l1 .2z" },
};

export function moduleLabel(key: string): string {
  return MODULE_META[key]?.label ?? key.replace(/_/g, " ");
}
