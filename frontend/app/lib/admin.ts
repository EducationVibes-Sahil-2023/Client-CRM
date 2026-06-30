import { API_URL, downloadFile, redirectToLogin, type SessionUser } from "./api";

const today = () => new Date().toISOString().slice(0, 10);
/** Download a SQL dump of the main (shared) database. */
export const backupMainDb = () => downloadFile("/superadmin/backup/main", `backup-main-${today()}.sql`);
/** Download a SQL dump of one client's tenant database. */
export const backupClientDb = (id: number, dbName: string) =>
  downloadFile(`/superadmin/clients/${id}/backup`, `backup-${dbName}-${today()}.sql`);

// ---- automatic (scheduled) backups ----
export interface BackupSettings {
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly";
  retention_days: number;
  scope: "main" | "all";
  last_run: string | null;
  last_status: string | null;
}
export interface BackupFile { name: string; size: number; created: string }

export const getBackupSettings = () =>
  adminGet<{ settings: BackupSettings; files: BackupFile[]; frequencies: string[] }>("/backup-settings");
export const saveBackupSettings = (b: Partial<BackupSettings>) =>
  adminPost<{ settings: BackupSettings; files: BackupFile[] }>("/backup-settings", b as Record<string, unknown>);
export const runBackupNow = (scope?: "main" | "all") =>
  adminPost<{ status: string; errors: string[]; settings: BackupSettings; files: BackupFile[] }>("/backup-run", scope ? { scope } : {});
export const downloadBackupFile = (name: string) =>
  downloadFile(`/superadmin/backup-files/${encodeURIComponent(name)}`, name);

// ---- low-level helpers (session-cookie auth) ----
async function handle(res: Response) {
  if (res.status === 401) {
    redirectToLogin();
    throw new Error("Your session has expired. Please sign in again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msgs = (data as Record<string, unknown>)?.messages;
    const first =
      msgs && typeof msgs === "object" ? Object.values(msgs)[0] : undefined;
    throw new Error(
      (first as string) ??
        (data as Record<string, string>)?.message ??
        `Request failed (${res.status})`,
    );
  }
  return data;
}

export function adminGet<T = unknown>(path: string): Promise<T> {
  return fetch(`${API_URL}/superadmin${path}`, {
    credentials: "include",
  }).then(handle) as Promise<T>;
}

export function adminPost<T = unknown>(
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  return fetch(`${API_URL}/superadmin${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body ?? {}),
  }).then(handle) as Promise<T>;
}

export function adminUpload<T = unknown>(
  path: string,
  field: string,
  file: File,
): Promise<T> {
  const fd = new FormData();
  fd.append(field, file);
  return fetch(`${API_URL}/superadmin${path}`, {
    method: "POST",
    credentials: "include",
    body: fd,
  }).then(handle) as Promise<T>;
}

// ---- types ----
export interface Overview {
  stats: {
    clients: number;
    clients_active: number;
    clients_new_30d: number;
    client_admins: number;
    users_total: number;
    demo_total: number;
    demo_new: number;
    contact_total: number;
    contact_new: number;
  };
  plans: Record<string, number>;
  client_status: Record<string, number>;
  series: { date: string; demos: number; contacts: number }[];
  recent_demos: DemoRequest[];
  recent_contacts: ContactMessage[];
  recent_clients: Client[];
}

export interface DemoRequest {
  id: number;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  team_size: string | null;
  interest: string | null;
  message: string | null;
  status: string;
  created_at: string;
}

export interface ContactMessage {
  id: number;
  name: string;
  email: string;
  company: string | null;
  message: string;
  status: string;
  created_at: string;
}

export interface Client {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  subdomain: string | null;
  plan: string;
  status: string;
  plan_start: string | null;
  plan_end: string | null;
  created_at: string;
}

export const updateClient = (id: number, body: Partial<Client>) =>
  adminPost<{ message: string; client: Client }>(`/clients/${id}`, body);

export const deleteClient = (id: number) =>
  adminPost<{ message: string }>(`/clients/${id}/delete`);

/** Impersonate a client's admin (super-admin "login as client"). */
export const loginAsClient = (id: number) =>
  adminPost<{ ok: boolean }>(`/clients/${id}/login-as`);

// ---- per-client feature entitlements (checkboxes + numeric quotas) ----
export interface ClientFeatureItem {
  key: string;
  label: string;
  core: boolean;
  quota: string | null;        // limit field label, or null = no quota
  enabled: boolean;
  limit: number | null;        // null = unlimited
}

/** Static catalog mirroring FeatureService::CATALOG (for the create form). */
export const FEATURE_CATALOG: { key: string; label: string; core: boolean; quota: string | null }[] = [
  { key: "dashboard", label: "Dashboard", core: true, quota: null },
  { key: "leads", label: "Leads", core: false, quota: "Max leads" },
  { key: "lead_import", label: "Lead import", core: false, quota: "Max imports" },
  { key: "team", label: "Team / staff", core: false, quota: "Max staff" },
  { key: "tasks", label: "Tasks", core: false, quota: null },
  { key: "roles", label: "Roles & permissions", core: false, quota: null },
  { key: "assets", label: "Assets", core: false, quota: null },
  { key: "announcements", label: "Announcements", core: false, quota: null },
  { key: "chat", label: "Chat", core: false, quota: null },
  { key: "email_config", label: "Email setup", core: false, quota: null },
  { key: "notifications", label: "Notifications", core: true, quota: null },
  { key: "settings", label: "Settings", core: true, quota: null },
  { key: "web_push", label: "Web push notifications", core: false, quota: null },
];

// ---- per-client database schema viewer ----
export interface SchemaColumn {
  name: string;
  type: string;
  null: boolean;
  key: string | null;       // PRI | UNI | MUL | null
  default: string | null;
  extra: string | null;     // e.g. auto_increment
  comment: string | null;
}

export interface SchemaIndex {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface SchemaTable {
  name: string;
  engine: string | null;
  comment: string | null;
  rows: number;
  size: number;             // bytes (data + index)
  columns: SchemaColumn[];
  indexes: SchemaIndex[];
}

export interface ClientSchema {
  client: { id: number; name: string; db_name: string };
  summary: { tables: number; total_rows: number; total_size: number };
  tables: SchemaTable[];
}

export const getClientSchema = (id: number) =>
  adminGet<ClientSchema>(`/clients/${id}/schema`);

// ---- per-client table data browser (paginated + searchable + sortable) ----
export interface TableData {
  table: string;
  columns: string[];
  rows: Record<string, string | number | null>[];
  sort: { column: string | null; dir: "asc" | "desc" };
  search: string;
  pagination: { page: number; per_page: number; total: number; total_pages: number };
}

export const getClientTableData = (
  id: number,
  table: string,
  opts: { page?: number; perPage?: number; search?: string; sort?: string; dir?: "asc" | "desc" } = {},
) => {
  const qs = new URLSearchParams();
  if (opts.page) qs.set("page", String(opts.page));
  if (opts.perPage) qs.set("per_page", String(opts.perPage));
  if (opts.search) qs.set("search", opts.search);
  if (opts.sort) qs.set("sort", opts.sort);
  if (opts.dir) qs.set("dir", opts.dir);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return adminGet<TableData>(`/clients/${id}/data/${encodeURIComponent(table)}${suffix}`);
};

export const getClientFeatures = (id: number) =>
  adminGet<{ client_id: number; plan: string; features: ClientFeatureItem[] }>(`/clients/${id}/features`);

export const saveClientFeatures = (
  id: number,
  features: { key: string; enabled: boolean; limit: number | null }[],
) => adminPost(`/clients/${id}/features`, { features });

export interface NotificationItem {
  id: number;
  type: "demo" | "contact";
  title: string;
  name: string;
  email: string;
  company: string;
  created_at: string;
}

export interface ActivityItem {
  id: number;
  actor_id: number | null;
  actor_role: string;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  description: string | null;
  client_id: number | null;
  created_at: string;
}

export interface CalendarEvent {
  id: number;
  title: string;
  description: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  color: string;
}

export interface Landing {
  logo_url: string;
  company_name: string;
  pricing_plans: PricingPlan[];
  testimonials: Testimonial[];
}

export interface PricingPlan {
  name: string;
  price: string;
  period?: string;
  description?: string;
  features?: string[];
  highlight?: boolean;
}

export interface Testimonial {
  quote: string;
  name: string;
  role: string;
}

// ---- typed endpoints ----
export const getOverview = () => adminGet<Overview>("/overview");

export const getNotifications = () =>
  adminGet<{ notifications: NotificationItem[]; count: number }>("/notifications");

export const markNotificationRead = (n: NotificationItem) =>
  adminPost(
    n.type === "demo"
      ? `/demo-requests/${n.id}/read`
      : `/contact-messages/${n.id}/read`,
  );

export const markAllNotificationsRead = () => adminPost("/notifications/read-all");

export interface ActivityStats {
  today: number;
  active: number;
  created_week: number;
  deleted_week: number;
  total: number;
  by_action: Record<string, number>;
}

export const getActivity = (opts: { limit?: number; offset?: number; action?: string } = {}) => {
  const { limit = 20, offset = 0, action } = opts;
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (action && action !== "all") qs.set("action", action);
  return adminGet<{ activity: ActivityItem[]; count: number; has_more: boolean; stats?: ActivityStats }>(
    `/activity?${qs.toString()}`,
  );
};

export const getDemoRequests = (params = "") =>
  adminGet<{ demo_requests: DemoRequest[]; pagination: Pagination }>(
    `/demo-requests${params}`,
  );

export const getContactMessages = (params = "") =>
  adminGet<{ contact_messages: ContactMessage[]; pagination: Pagination }>(
    `/contact-messages${params}`,
  );

export const markContactReplied = (id: number) => adminPost(`/contact-messages/${id}/replied`);
export const deleteContactMessage = (id: number) => adminPost(`/contact-messages/${id}/delete`);
export const markDemoReplied = (id: number) => adminPost(`/demo-requests/${id}/replied`);
export const deleteDemoRequest = (id: number) => adminPost(`/demo-requests/${id}/delete`);

export const getLanding = () => adminGet<Landing>("/landing");
export const saveLanding = (body: Partial<Landing>) =>
  adminPost<{ message: string; content: Landing }>("/landing", body);

export const getProfile = () =>
  adminGet<{ profile: SessionUser & { name?: string; avatar?: string } }>("/profile");
export const updateProfile = (body: { name?: string; email?: string }) =>
  adminPost("/profile", body);
export const changePassword = (body: {
  current_password: string;
  new_password: string;
}) => adminPost("/password", body);

export interface Message {
  id: number;
  to_email: string;
  to_name: string | null;
  subject: string | null;
  body: string | null;
  folder: string;
  created_at: string;
}

export const getMessages = (folder = "sent") =>
  adminGet<{ messages: Message[]; folder: string }>(`/messages?folder=${folder}`);
export const sendMessage = (body: {
  to_email: string;
  to_name?: string;
  subject?: string;
  body?: string;
}) => adminPost<{ mail: Message | null; sent: boolean; error: string | null }>("/messages", body);

/** Send a test email to verify outgoing mail is configured correctly. */
export const sendTestEmail = (to: string) =>
  adminPost<{ ok: boolean; error: string | null }>("/integrations/email-test", { to });
export const deleteMessage = (id: number) => adminPost(`/messages/${id}/delete`);

// ---- Gmail inbox (IMAP) ----
export interface GmailEmail {
  uid: number;
  name: string;
  email: string;
  subject: string;
  snippet: string;
  date: string;
  seen: boolean;
}

export interface GmailMessage {
  uid: number;
  name: string;
  email: string;
  to: string;
  subject: string;
  date: string;
  html: string;
  text: string;
}

export interface InboxResponse {
  configured: boolean;
  error?: string;
  emails: GmailEmail[];
  pagination: Pagination;
}

export const getInbox = (params = "") => adminGet<InboxResponse>(`/inbox${params}`);

export const getInboxMessage = (uid: number) =>
  adminGet<{ email: GmailMessage }>(`/inbox/${uid}`);

export interface GmailSettings {
  user: string;
  mailbox: string;
  has_password: boolean;
  configured: boolean;
  default_mailbox: string;
  signature: string;
}

export const getGmailSettings = () =>
  adminGet<GmailSettings>("/integrations/gmail");

export const saveGmailSettings = (body: {
  user: string;
  app_password?: string;
  mailbox?: string;
}) => adminPost<GmailSettings>("/integrations/gmail", body);

/** Save the company email signature (HTML). */
export const saveEmailSignature = (signature: string) =>
  adminPost<{ signature: string }>("/integrations/signature", { signature });

/** Just the saved company email signature (HTML), for the reply composer. */
export const getEmailSignature = () =>
  getGmailSettings().then((s) => s.signature ?? "").catch(() => "");

export const testGmailSettings = (body: {
  user?: string;
  app_password?: string;
  mailbox?: string;
}) => adminPost<{ ok: boolean; error?: string; total?: number }>(
  "/integrations/gmail/test",
  body,
);

// A meeting pulled from the connected Google Calendar (read-only in the app).
export interface GoogleEvent {
  id: string;
  title: string;
  description: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  all_day: boolean;
  location: string | null;
  html_link: string | null;
  meet_link: string | null;
  attendees: string[];
  organizer: string | null;
  source: "google";
}

export interface EventsResponse {
  events: CalendarEvent[];
  google_events: GoogleEvent[];
  google_connected: boolean;
  google_error?: string;
  month: string;
}

export const getEvents = (month: string) =>
  adminGet<EventsResponse>(`/events?month=${month}`);
export const createEvent = (body: Record<string, unknown>) =>
  adminPost<{ event: CalendarEvent }>("/events", body);
export const updateEvent = (id: number, body: Record<string, unknown>) =>
  adminPost(`/events/${id}`, body);
export const deleteEvent = (id: number) => adminPost(`/events/${id}/delete`);

export interface MeetingDraft {
  title: string;
  event_date: string;
  start_time?: string;
  end_time?: string;
  description?: string;
  location?: string;
  attendees?: string;
  with_meet?: boolean;
}
export const createMeeting = (body: MeetingDraft) =>
  adminPost<{ message: string; event: GoogleEvent }>(
    "/meetings",
    body as unknown as Record<string, unknown>,
  );

// ---- Google Calendar integration settings ----
export interface GoogleCalendarSettings {
  calendar_id: string;
  has_service_account: boolean;
  service_account_email: string | null;
  configured: boolean;
}

export const getGoogleCalendarSettings = () =>
  adminGet<GoogleCalendarSettings>("/integrations/google-calendar");

export const saveGoogleCalendarSettings = (body: {
  calendar_id: string;
  service_account?: string;
}) => adminPost<GoogleCalendarSettings>("/integrations/google-calendar", body);

export const testGoogleCalendarSettings = (body: {
  calendar_id?: string;
  service_account?: string;
}) => adminPost<{ ok: boolean; error?: string; calendar?: string }>(
  "/integrations/google-calendar/test",
  body,
);

export interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}
