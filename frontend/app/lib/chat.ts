import { API_URL, redirectToLogin } from "./api";

export type ChatArea = "superadmin" | "client" | "staff";

async function handle(res: Response) {
  if (res.status === 401) {
    redirectToLogin();
    throw new Error("Your session has expired. Please sign in again.");
  }
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

function apiGet<T>(path: string): Promise<T> {
  return fetch(`${API_URL}${path}`, { credentials: "include" }).then(handle) as Promise<T>;
}
function apiPost<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  return fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body ?? {}),
  }).then(handle) as Promise<T>;
}
// Multipart variant — used when a message carries a file attachment. The browser
// sets the Content-Type (with boundary), so we must NOT set it ourselves.
function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  return fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    body: form,
  }).then(handle) as Promise<T>;
}

export interface Conversation {
  id: number;
  type: string;
  client_id: number | null;
  title: string;
  last_message: string | null;
  last_message_at: string | null;
  unread: number;
}

export interface ChatMessage {
  id: number;
  body: string;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_size: number | null;
  sender_type: string;
  sender_id: number;
  sender_name: string;
  is_mine: boolean;
  created_at: string;
}

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface ChatPollResult {
  conversations: { id: number; unread: number; last_message_at: string | null }[];
  chat_unread: number;
  notif_unread: number;
}

export const getConversations = (area: ChatArea) =>
  apiGet<{ conversations: Conversation[] }>(`/${area}/chat/conversations`);

export const startConversation = (area: ChatArea, clientId?: number) =>
  apiPost<{ conversation: Conversation }>(
    `/${area}/chat/conversations/start`,
    clientId ? { client_id: clientId } : {},
  );

// A person in my client I can start a direct message with.
export interface DirectoryMember {
  party_type: "user" | "staff";
  party_id: number;
  name: string;
  role_label: string;
}

// Team-chat directory (client admins + staff). Only the client/staff areas.
export const getDirectory = (area: ChatArea) =>
  apiGet<{ members: DirectoryMember[] }>(`/${area}/chat/directory`);

// Open (or fetch) a 1:1 thread with another member of my client.
export const startDm = (area: ChatArea, partyType: "user" | "staff", partyId: number) =>
  apiPost<{ conversation: Conversation }>(`/${area}/chat/dm/start`, {
    party_type: partyType,
    party_id: partyId,
  });

export interface MessagePage {
  messages: ChatMessage[];
  has_more: boolean;
}

/**
 * Load thread messages. Pass `after` to poll for new ones, `before` to page
 * older history (infinite scroll up), or neither for the latest page.
 */
export const getMessages = (
  area: ChatArea,
  convId: number,
  opts: { after?: number; before?: number; limit?: number } = {},
) => {
  const q = new URLSearchParams();
  if (opts.after) q.set("after", String(opts.after));
  if (opts.before) q.set("before", String(opts.before));
  if (opts.limit) q.set("limit", String(opts.limit));
  return apiGet<MessagePage>(`/${area}/chat/conversations/${convId}/messages?${q.toString()}`);
};

export const sendChatMessage = (area: ChatArea, convId: number, body: string, file?: File | null) => {
  const path = `/${area}/chat/conversations/${convId}/messages`;
  if (file) {
    const form = new FormData();
    form.append("body", body);
    form.append("file", file);
    return apiPostForm<{ message: ChatMessage }>(path, form);
  }
  return apiPost<{ message: ChatMessage }>(path, { body });
};

export const chatPoll = (area: ChatArea) => apiGet<ChatPollResult>(`/${area}/chat/poll`);

// Super admin starts chats by picking a client.
export const getChatClients = () =>
  apiGet<{ clients: { id: number; name: string }[] }>("/superadmin/clients");

// Notifications live at different paths per area.
function notifBase(area: ChatArea) {
  if (area === "superadmin") return "/superadmin/chat/notifications";
  if (area === "staff") return "/staff/chat/notifications";
  return "/client/notifications";
}
export type NotificationFilter = "all" | "unread" | "read";

export interface NotificationPage {
  notifications: AppNotification[];
  unread: number;
  has_more: boolean;
}

/**
 * Load my in-app notifications. Pass `before` (the last item's id) to page older
 * ones for infinite scroll, and `filter` to restrict by read state.
 */
export const getNotifications = (
  area: ChatArea,
  opts: { limit?: number; before?: number; filter?: NotificationFilter } = {},
) => {
  const q = new URLSearchParams();
  if (opts.limit) q.set("limit", String(opts.limit));
  if (opts.before) q.set("before", String(opts.before));
  if (opts.filter && opts.filter !== "all") q.set("filter", opts.filter);
  return apiGet<NotificationPage>(`${notifBase(area)}?${q.toString()}`);
};
export const readNotification = (area: ChatArea, id: number) =>
  apiPost(`${notifBase(area)}/${id}/read`);
export const readAllNotifications = (area: ChatArea) => apiPost(`${notifBase(area)}/read-all`);
