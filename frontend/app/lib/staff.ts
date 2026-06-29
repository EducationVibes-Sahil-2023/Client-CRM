import { API_URL } from "./api";

async function handle(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msgs = (data as Record<string, unknown>)?.messages;
    const first = msgs && typeof msgs === "object" ? Object.values(msgs)[0] : undefined;
    throw new Error(
      (first as string) ?? (data as Record<string, string>)?.message ?? `Request failed (${res.status})`,
    );
  }
  return data;
}

const staffGet = <T = unknown>(path: string): Promise<T> =>
  fetch(`${API_URL}/staff${path}`, { credentials: "include" }).then(handle) as Promise<T>;

const staffPost = <T = unknown>(path: string, body?: Record<string, unknown>): Promise<T> =>
  fetch(`${API_URL}/staff${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body ?? {}),
  }).then(handle) as Promise<T>;

export interface Perm {
  view: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
}
export type Permissions = Record<string, Perm>;

export interface StaffMe {
  user: { name: string; email: string; role: string; client_id: number };
  client: { name: string } | null;
  permissions: Permissions;
  modules: string[];
}

export interface StaffTask {
  id: number;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
}

export interface StaffAnnouncement {
  id: number;
  title: string;
  body: string | null;
  pinned: number | boolean;
  created_at: string;
}

export interface StaffDashboard {
  permissions: Permissions;
  modules: string[];
  stats: Record<string, number>;
  my_tasks: StaffTask[];
  announcements: StaffAnnouncement[];
}

export interface StaffAnnouncementAttachment {
  url: string;
  name: string;
  type: string;
  size: number;
}

export interface StaffAnnouncementItem {
  id: number;
  title: string;
  body: string | null;
  pinned: boolean;
  require_ack: boolean;
  attachments: StaffAnnouncementAttachment[];
  author: string;
  created_at: string;
  read_at: string | null;
  acknowledged_at: string | null;
}

export const getStaffMe = () => staffGet<StaffMe>("/me");
export const getStaffDashboard = () => staffGet<StaffDashboard>("/dashboard");

export const getStaffAnnouncements = () =>
  staffGet<{ announcements: StaffAnnouncementItem[]; unread: number }>("/announcements");
export const markStaffAnnouncementRead = (id: number) => staffPost(`/announcements/${id}/read`);
export const ackStaffAnnouncement = (id: number) => staffPost(`/announcements/${id}/ack`);
