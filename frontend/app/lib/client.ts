import { API_URL } from "./api";

async function handle(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msgs = (data as Record<string, unknown>)?.messages;
    const first = msgs && typeof msgs === "object" ? Object.values(msgs)[0] : undefined;
    throw new Error((first as string) ?? (data as { message?: string })?.message ?? `Request failed (${res.status})`);
  }
  return data;
}

export const clientGet = <T = unknown>(path: string): Promise<T> =>
  fetch(`${API_URL}/client${path}`, { credentials: "include" }).then(handle) as Promise<T>;

export const clientPost = <T = unknown>(path: string, body?: Record<string, unknown>): Promise<T> =>
  fetch(`${API_URL}/client${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body ?? {}),
  }).then(handle) as Promise<T>;

// ---- types ----
export interface ClientInfo {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  plan: string;
  status: string;
  subdomain: string | null;
  plan_start: string | null;
  plan_end: string | null;
  created_at: string;
}

export interface ClientFeature {
  feature_key: string;
  enabled: boolean | number;
  [k: string]: unknown;
}

export type Perm = { view: boolean; create: boolean; update: boolean; delete: boolean };

export interface Role {
  id: number;
  name: string;
  description: string | null;
  permissions: Record<string, Perm>;
  staff_count?: number;
  is_system?: boolean | number;
}

export interface Staff {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  avatar: string | null;
  emp_code: string | null;
  designation: string | null;
  alt_phone: string | null;
  role_id: number | null;
  reports_to: number | null;
  lead_type_id: number | null;
  office_location_id: number | null;
  department_id: number | null;
  facebook: string | null;
  linkedin: string | null;
  skype: string | null;
  email_signature: string | null;
  status: string;
  role_name: string | null;
  manager_name: string | null;
  lead_type: string | null;
  office_name: string | null;
  department: string | null;
  has_password: boolean;
  extra_permissions?: Record<string, Perm>;
}

export interface LookupItem {
  id: number;
  category: string;
  name: string;
}

export interface Department {
  id: number;
  name: string;
  sequence: number;
  enabled: number | boolean;
}

export interface OfficeLocation {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  pincode: string | null;
  phone: string | null;
  latitude: string | null;
  longitude: string | null;
  map_url: string | null;
  sequence: number;
  enabled: number | boolean;
}

export interface Asset {
  id: number;
  asset_code: string | null;
  name: string;
  quantity: number;
  unit: string | null;
  series_model: string | null;
  asset_group: string | null;
  managed_by: number | null;
  managed_by_name: string | null;
  asset_location: string | null;
  purchase_date: string | null;
  warranty_months: number | null;
  unit_price: string | null;
  depreciation_months: number | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  supplier_address: string | null;
  description: string | null;
  attachment: string | null;
  status: string;
  allocated_to: string | null;
  allocated_to_id: number | null;
}

export interface AssetAllocation {
  id: number;
  staff_id: number;
  staff_name: string | null;
  allocated_at: string | null;
  revoked_at: string | null;
  status: string;
  notes: string | null;
}

/** A row in the asset tracker timeline. */
export interface AssetLog {
  id: number;
  action: "created" | "updated" | "allocated" | "transferred" | "revoked" | "note" | "deleted";
  from_staff_id: number | null;
  to_staff_id: number | null;
  from_name: string | null;
  to_name: string | null;
  note: string | null;
  actor_name: string | null;
  created_at: string;
}

export interface LeadStatus {
  id: number;
  name: string;
  parent_id: number | null;
  parent_ids: number[];
  parent_names?: string[];
  color: string;
  conversion_type: string;
  sequence: number;
  enabled: number | boolean;
}

export interface Lead {
  id: number;
  name: string | null;
  phone: string;
  alt_phone: string | null;
  status_id: number | null;
  sub_status_id: number | null;
  status: string | null;
  sub_status: string | null;
  source_id: number | null;
  source: string | null;
  lead_type_id: number | null;
  lead_type: string | null;
  reference_name: string | null;
  email: string | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
  assigned_date: string | null;
  city: string | null;
  state: string | null;
  follow_date: string | null;
  created_date: string | null;
  created_at: string;
  updated_at: string | null;
  /** Latest reminder datetime for this lead (max remind_at), or null if none. */
  last_reminder_at: string | null;
  /**
   * Follow-up status flag, computed server-side from the follow-up date,
   * reminders and notes: "upcoming" (future, orange), "overdue" (past with no
   * follow-up note, red), "done" (past with a note logged after the reminder,
   * green), or null when the lead has no follow-up date.
   */
  follow_flag: "upcoming" | "overdue" | "done" | null;
  /** Latest connected (answered) call to this lead's phone, or null if none. */
  last_call_at?: string | null;
}

/** A logged phone call, ingested from a client's external call-tracking app. */
export interface CallLog {
  id: number;
  lead_id: number | null;
  lead_name?: string | null;
  staff_id: number | null;
  staff_name?: string | null;
  staff_contact: string | null;
  contact: string | null;
  call_status: string | null;
  /** Where the call ran: IVR system or a phone dialer. */
  source: "ivr" | "phone" | null;
  /** Call direction. */
  type: "incoming" | "outgoing" | "missed" | null;
  /** Duration in seconds. */
  duration: number;
  /** True when the call was answered (duration > 0). */
  connected: boolean;
  call_start: string | null;
  call_end: string | null;
  created_at: string;
}

export const getCalls = () => clientGet<{ calls: CallLog[] }>("/calls");

// ---- call-tracking dashboard (aggregated analytics) ----
export interface CallKpi {
  total: number;
  unique: number;
  connected: number;
  talk_sec: number;
  avg_sec: number;
  connect_rate: number;
}
export interface CallRep {
  id: number;
  name: string;
  total: number;
  unique: number;
  connected: number;
  talk_sec: number;
  avg_sec: number;
  fresh: number;
  fresh_connected: number;
  fresh_talk_sec: number;
  connect_pct: number;
}
export interface CallDashboard {
  date: string;
  kpis: {
    today: CallKpi;
    prev: CallKpi;
    delta: { total: number | null; unique: number | null; avg_sec: number | null; connect_rate: number | null; talk_sec: number | null };
  };
  hourly: { hour: number; calls: number; talk_sec: number }[];
  by_status: { label: string; color: string; calls: number; talk_sec: number }[];
  reps: CallRep[];
  trend: { date: string; calls: number; avg_sec: number }[];
}
export const getCallDashboard = (params: Record<string, string | undefined> = {}) => {
  const q = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join("&");
  return clientGet<CallDashboard>(`/call-dashboard${q ? `?${q}` : ""}`);
};

// ---- follow-up tracker dashboard ----
export interface FollowupRep {
  id: number;
  name: string;
  total: number;
  upcoming: number;
  due_today: number;
  overdue: number;
  done: number;
  on_time_pct: number;
  /** Pending (not-done) follow-ups split by top-level status id. */
  buckets?: Record<string, number>;
}
export interface FollowupBucket {
  id: number;
  name: string;
  color: string;
  value: number;
  breakdown?: { label: string; color: string; value: number }[];
}
export interface FollowupOverview {
  total_due: number;
  scheduled: number;
  completed: number;
  completion: number;
  target: number;
  overdue: number;
  future: number;
  ghosted: number;
}
export interface FollowupDashboard {
  date: string;
  /** Echo of the active follow-up date range (blank = all dates). */
  from?: string;
  to?: string;
  kpis: { total: number; upcoming: number; due_today: number; overdue: number; done: number; completion: number };
  by_flag: { key: string; label: string; value: number; color: string }[];
  upcoming_days: { date: string; count: number }[];
  overdue_aging: { key: string; label: string; count: number }[];
  by_status: { label: string; color: string; count: number; completed: number; pending: number; upcoming: number; due_today: number; overdue: number }[];
  reps: FollowupRep[];
  /** Top summary cards (screenshot): due / completed / overdue / pending buckets / ghosted / future. */
  overview?: FollowupOverview;
  /** Pending-today follow-ups grouped by top-level status (each with sub-status breakdown). */
  pending_buckets?: FollowupBucket[];
  /** Overdue follow-ups grouped by top-level status (for the alert banner). */
  overdue_buckets?: FollowupBucket[];
  /** All top-level statuses → per-bucket columns of the accountability table. */
  top_statuses?: { id: number; name: string; color: string }[];
  /** Ghosted leads — open follow-ups with 3+ call attempts and no connection. */
  ghosted_leads?: GhostedLead[];
}
export interface GhostedLead {
  id: number;
  name: string | null;
  phone: string | null;
  counsellor: string | null;
  status: string | null;
  color: string;
  attempts: number;
  last_call: string | null;
}
export const getFollowupDashboard = (params: Record<string, string | undefined> = {}) => {
  const q = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join("&");
  return clientGet<FollowupDashboard>(`/followup-dashboard${q ? `?${q}` : ""}`);
};

export interface LeadImportResult {
  inserted: number;
  failed: number;
  errors: { row: number; message: string }[];
}

export interface LeadCount {
  /** The grouped entity's id (status/sub-status/type/source id), when applicable. */
  id?: number;
  label: string;
  value: number;
  color: string;
}

export interface LeadAnalytics {
  total: number;
  by_status: LeadCount[];
  by_sub_status: LeadCount[];
  by_lead_type: LeadCount[];
  by_source: LeadCount[];
  by_marketing: LeadCount[];
  by_conversion: LeadCount[];
}

export const getLeads = () => clientGet<{ leads: Lead[] }>("/leads");
export const getLeadAnalytics = () => clientGet<LeadAnalytics>("/lead-analytics");
export const createLead = (b: Record<string, unknown>) => clientPost("/leads", b);
export const updateLead = (id: number, b: Record<string, unknown>) => clientPost(`/leads/${id}`, b);
export const deleteLead = (id: number) => clientPost(`/leads/${id}/delete`);
export const importLeads = (rows: Record<string, string>[]) =>
  clientPost<LeadImportResult>("/leads/import", { rows });

export interface LeadReminder {
  id: number;
  lead_id: number;
  remind_at: string;
  note: string | null;
  notified_at: string | null;
  done: number | boolean;
  due: boolean;
  created_at: string;
}

export interface LeadNote {
  id: number;
  lead_id: number;
  author_id: number | null;
  author_name: string | null;
  body: string;
  created_at: string;
}

export interface LeadActivity {
  id: number;
  actor_name: string | null;
  action: string;
  description: string | null;
  created_at: string;
}

export interface LeadDetail {
  lead: Lead;
  reminders: LeadReminder[];
  notes: LeadNote[];
  activity: LeadActivity[];
  calls: CallLog[];
}

export const getLeadDetail = (id: number) => clientGet<LeadDetail>(`/leads/${id}/detail`);
export const createLeadReminder = (id: number, body: { remind_at: string; note?: string }) =>
  clientPost(`/leads/${id}/reminders`, body);
export const deleteLeadReminder = (rid: number) => clientPost(`/lead-reminders/${rid}/delete`);
export const createLeadNote = (id: number, body: string) => clientPost(`/leads/${id}/notes`, { body });
export const deleteLeadNote = (nid: number) => clientPost(`/lead-notes/${nid}/delete`);
export const pollReminders = () => clientGet<{ due: number }>("/reminders/poll");

export interface MarketingType {
  id: number;
  name: string;
  color: string;
  sequence: number;
  enabled: number | boolean;
}

export interface LeadSource {
  id: number;
  name: string;
  color: string;
  sequence: number;
  marketing_type_id: number | null;
  marketing_type: string | null;
  enabled: number | boolean;
}

export const CONVERSION_TYPES = ["open", "won", "lost", "nurturing"] as const;

export interface LeadType {
  id: number;
  name: string;
  color: string;
  sequence: number;
  enabled: number | boolean;
}

export interface ConversionType {
  id: number;
  name: string;
  color: string;
  sequence: number;
  enabled: number | boolean;
  percentage: number;
  auto_percentage: boolean;
  lead_status_ids: number[];
  lead_statuses: { id: number; name: string; color: string }[];
}

export interface FollowupGroup {
  id: number;
  name: string;
  color: string;
  sequence: number;
  enabled: number | boolean;
  lead_status_ids: number[];
  lead_statuses: { id: number; name: string; color: string }[];
}

export interface AnnouncementAttachment {
  url: string;
  name: string;
  type: string;
  size: number;
}

export type AnnouncementAudience = "all" | "department" | "staff";

export interface Announcement {
  id: number;
  title: string;
  body: string | null;
  pinned: boolean;
  audience: AnnouncementAudience;
  target_ids: number[];
  target_names: string[];
  attachments: AnnouncementAttachment[];
  require_ack: boolean;
  created_at: string;
  recipient_count: number;
  read_count: number;
  ack_count: number;
}

export interface AnnouncementReader {
  staff_id: number;
  name: string;
  read_at: string | null;
  acknowledged_at: string | null;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  assigned_to: number | null;
  assignee_name: string | null;
  due_date: string | null;
  start_date: string | null;
  priority: string;
  type: string;
  status: string;
  completed_at: string | null;
  created_at: string;
  created_by: number | null;
  created_by_name: string | null;
  updated_by: number | null;
  updated_by_name: string | null;
  updated_at?: string | null;
  overdue?: boolean;
  comment_count?: number;
}

export interface TaskComment {
  id: number;
  task_id: number;
  author_type: string;
  author_id: number;
  author_name: string | null;
  body: string;
  created_at: string;
}

export interface TaskSummary {
  total: number;
  open: number;
  in_progress: number;
  done: number;
  overdue: number;
  due_today: number;
}

export interface ClientActivity {
  id: number;
  actor_name: string | null;
  actor_role: string;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  description: string | null;
  created_at: string;
}

export const MODULES = [
  "dashboard", "leads", "leads_setup", "team", "roles", "tasks", "assets",
  "announcements", "chat", "notifications", "email_config", "settings",
] as const;

// ---- endpoints ----
/** feature_key -> enabled, the client's effective plan features. */
export type FeatureMap = Record<string, boolean>;
export type LimitMap = Record<string, number | null>; // null = unlimited
export type UsageMap = Record<string, number>;

export const getFeatures = () =>
  clientGet<{ features: FeatureMap; limits: LimitMap; usage: UsageMap }>("/features");

// ---- current user access (admin vs staff, effective permissions) ----
export interface MeInfo {
  user: { id: number; email: string; role: string; name?: string; staff_id?: number; role_id?: number | null; client_id?: number | null };
  is_admin: boolean;
  role: string;
  permissions: Record<string, Perm>;
  modules: string[];
}
export const getMe = () => clientGet<MeInfo>("/me");

// ---- per-user table layout (visible columns, order, widths, alignment) ----
/** Saved layout for one data table; `null` keys fall back to the column default. */
export interface TableConfig {
  /** Column keys in display order. Keys not listed keep their natural order at the end. */
  order?: string[];
  /** Column keys the user has hidden. */
  hidden?: string[];
  /** Pixel widths per column key. */
  widths?: Record<string, number>;
  /** Alignment per column key. */
  aligns?: Record<string, "left" | "center" | "right">;
}
export const getTableConfig = (tableKey: string) =>
  clientGet<{ config: TableConfig | null }>(`/table-prefs/${tableKey}`);
export const saveTableConfig = (tableKey: string, config: TableConfig) =>
  clientPost<{ message: string; config: TableConfig }>(`/table-prefs/${tableKey}`, { config } as Record<string, unknown>);

// ---- client-wide custom column names (read by all; written by client admin) ----
export const getTableLabels = (tableKey: string) =>
  clientGet<{ labels: Record<string, string> }>(`/table-labels/${tableKey}`);
export const saveTableLabels = (tableKey: string, labels: Record<string, string>) =>
  clientPost<{ message: string; labels: Record<string, string> }>(`/table-labels/${tableKey}`, { labels } as Record<string, unknown>);

// ---- branding / appearance ----
import type { Branding } from "./theme";
export const getBranding = () => clientGet<{ branding: Branding }>("/branding");
export const saveBranding = (b: Partial<Branding>) =>
  clientPost<{ message: string; branding: Branding }>("/settings", b as Record<string, unknown>);

// ---- billing ----
export interface PlanCatalogItem {
  key: string;
  name: string;
  price: number;
  cycle: string;
  blurb: string;
}
export interface BillingFeature {
  key: string;
  label: string;
  enabled: boolean;
  quota: boolean;
  limit: number | null; // null = unlimited
  usage: number | null;
}
export interface Billing {
  currency: string;
  client: {
    name: string;
    plan: string;
    status: string;
    plan_start: string | null;
    plan_end: string | null;
    created_at: string;
  };
  plan: PlanCatalogItem;
  catalog: PlanCatalogItem[];
  features: BillingFeature[];
}

export const getBilling = () => clientGet<Billing>("/billing");

export const getClientDashboard = () =>
  clientGet<{
    client: ClientInfo;
    features: ClientFeature[];
    stats: Record<string, number>;
    task_summary: TaskSummary;
    recent_tasks: Task[];
    upcoming_tasks: Task[];
  }>("/dashboard");

export const getRoles = () => clientGet<{ roles: Role[]; modules: string[] }>("/roles");
export const createRole = (b: Record<string, unknown>) => clientPost("/roles", b);
export const updateRole = (id: number, b: Record<string, unknown>) => clientPost(`/roles/${id}`, b);
export const deleteRole = (id: number) => clientPost(`/roles/${id}/delete`);

export const getStaff = () => clientGet<{ staff: Staff[]; modules: string[] }>("/staff");

export interface StaffLeadBrief {
  id: number;
  name: string | null;
  phone: string | null;
  status: string | null;
  sub_status: string | null;
  assigned_name: string | null;
  creator_name: string | null;
  follow_date: string | null;
  created_at: string | null;
}

export interface StaffLeads {
  member: { id: number; name: string };
  reports_count: number;
  assigned: StaffLeadBrief[];
  created: StaffLeadBrief[];
  team: StaffLeadBrief[];
  counts: { assigned: number; created: number; team: number };
}

export const getStaffLeads = (id: number) => clientGet<StaffLeads>(`/staff/${id}/leads`);
export const createStaff = (b: Record<string, unknown>) => clientPost("/staff", b);
export const updateStaff = (id: number, b: Record<string, unknown>) => clientPost(`/staff/${id}`, b);
export const deleteStaff = (id: number) => clientPost(`/staff/${id}/delete`);

export const getLeadStatuses = () => clientGet<{ lead_statuses: LeadStatus[] }>("/lead-statuses");
export const createLeadStatus = (b: Record<string, unknown>) => clientPost("/lead-statuses", b);
export const updateLeadStatus = (id: number, b: Record<string, unknown>) => clientPost(`/lead-statuses/${id}`, b);
export const deleteLeadStatus = (id: number) => clientPost(`/lead-statuses/${id}/delete`);
export const reorderLeadStatuses = (order: number[]) => clientPost("/lead-statuses/reorder", { order });

// ---- leads setup: marketing types + sources ----
export const getLeadsSetup = () =>
  clientGet<{
    lead_statuses: LeadStatus[];
    lead_sources: LeadSource[];
    marketing_types: MarketingType[];
    lead_types: LeadType[];
    conversion_types: ConversionType[];
    followup_groups: FollowupGroup[];
  }>("/leads-setup");

export const getLeadTypes = () => clientGet<{ lead_types: LeadType[] }>("/lead-types");
export const createLeadType = (b: Record<string, unknown>) => clientPost("/lead-types", b);
export const updateLeadType = (id: number, b: Record<string, unknown>) => clientPost(`/lead-types/${id}`, b);
export const deleteLeadType = (id: number) => clientPost(`/lead-types/${id}/delete`);
export const reorderLeadTypes = (order: number[]) => clientPost("/lead-types/reorder", { order });

export const getConversionTypes = () => clientGet<{ conversion_types: ConversionType[] }>("/conversion-types");
export const createConversionType = (b: Record<string, unknown>) => clientPost("/conversion-types", b);
export const updateConversionType = (id: number, b: Record<string, unknown>) => clientPost(`/conversion-types/${id}`, b);
export const deleteConversionType = (id: number) => clientPost(`/conversion-types/${id}/delete`);
export const reorderConversionTypes = (order: number[]) => clientPost("/conversion-types/reorder", { order });

export const getFollowupGroups = () => clientGet<{ followup_groups: FollowupGroup[] }>("/followup-groups");
export const createFollowupGroup = (b: Record<string, unknown>) => clientPost("/followup-groups", b);
export const updateFollowupGroup = (id: number, b: Record<string, unknown>) => clientPost(`/followup-groups/${id}`, b);
export const deleteFollowupGroup = (id: number) => clientPost(`/followup-groups/${id}/delete`);
export const reorderFollowupGroups = (order: number[]) => clientPost("/followup-groups/reorder", { order });

export const getMarketingTypes = () => clientGet<{ marketing_types: MarketingType[] }>("/marketing-types");
export const createMarketingType = (b: Record<string, unknown>) => clientPost("/marketing-types", b);
export const updateMarketingType = (id: number, b: Record<string, unknown>) => clientPost(`/marketing-types/${id}`, b);
export const deleteMarketingType = (id: number) => clientPost(`/marketing-types/${id}/delete`);
export const reorderMarketingTypes = (order: number[]) => clientPost("/marketing-types/reorder", { order });

export const getLeadSources = () => clientGet<{ lead_sources: LeadSource[] }>("/lead-sources");
export const createLeadSource = (b: Record<string, unknown>) => clientPost("/lead-sources", b);
export const updateLeadSource = (id: number, b: Record<string, unknown>) => clientPost(`/lead-sources/${id}`, b);
export const deleteLeadSource = (id: number) => clientPost(`/lead-sources/${id}/delete`);
export const reorderLeadSources = (order: number[]) => clientPost("/lead-sources/reorder", { order });

export const getAnnouncements = (params: { limit?: number; offset?: number } = {}) => {
  const q = new URLSearchParams();
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  return clientGet<{
    announcements: Announcement[];
    has_more: boolean;
    departments?: { id: number; name: string }[];
    staff?: { id: number; name: string; department_id: number | null }[];
  }>(`/announcements?${q.toString()}`);
};
export const createAnnouncement = (b: Record<string, unknown>) => clientPost("/announcements", b);
export const deleteAnnouncement = (id: number) => clientPost(`/announcements/${id}/delete`);
export const getAnnouncementReaders = (id: number) =>
  clientGet<{ readers: AnnouncementReader[]; require_ack: boolean }>(`/announcements/${id}/readers`);

/** Upload one file to /client/upload; returns its served URL. */
export const uploadFile = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return fetch(`${API_URL}/client/upload`, { method: "POST", credentials: "include", body: form }).then(
    handle,
  ) as Promise<{ url: string }>;
};

export const getTasks = () => clientGet<{ tasks: Task[] }>("/tasks");
export const getTask = (id: number) => clientGet<{ task: Task }>(`/tasks/${id}`);
export const createTask = (b: Record<string, unknown>) => clientPost("/tasks", b);
export const updateTask = (id: number, b: Record<string, unknown>) => clientPost(`/tasks/${id}`, b);
export const deleteTask = (id: number) => clientPost(`/tasks/${id}/delete`);

export const getTaskComments = (id: number) => clientGet<{ comments: TaskComment[] }>(`/tasks/${id}/comments`);
export const addTaskComment = (id: number, body: string) => clientPost<{ comment: TaskComment }>(`/tasks/${id}/comments`, { body });
export const deleteTaskComment = (taskId: number, commentId: number) => clientPost(`/tasks/${taskId}/comments/${commentId}/delete`);
export const getTaskActivity = (id: number) => clientGet<{ activity: ClientActivity[] }>(`/tasks/${id}/activity`);

export interface ClientActivityStats {
  total: number;
  today: number;
  active: number;
  created_week: number;
  deleted_week: number;
  by_action: Record<string, number>;
}

export const getClientActivity = (params: { limit?: number; offset?: number; action?: string } = {}) => {
  const q = new URLSearchParams();
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  if (params.action && params.action !== "all") q.set("action", params.action);
  return clientGet<{ activity: ClientActivity[]; has_more: boolean; stats?: ClientActivityStats }>(
    `/activity?${q.toString()}`,
  );
};

// ---- file upload (staff photo, asset attachment) ----
export const clientUpload = (file: File): Promise<{ url: string }> => {
  const fd = new FormData();
  fd.append("file", file);
  return fetch(`${API_URL}/client/upload`, { method: "POST", credentials: "include", body: fd }).then(handle) as Promise<{ url: string }>;
};

// ---- admin-managed lookup lists ----
export const LOOKUP_CATEGORIES = ["lead_type", "office_location", "department"] as const;
export const getLookups = () =>
  clientGet<{ lookups: Record<string, LookupItem[]>; categories: string[] }>("/lookups");

// ---- departments (own table, soft-deletable, gated by the Team module) ----
export const getDepartments = () =>
  clientGet<{ departments: Department[]; archived: Department[] }>("/departments");
export const createDepartment = (name: string) => clientPost("/departments", { name });
export const updateDepartment = (id: number, name: string) => clientPost(`/departments/${id}`, { name });
export const deleteDepartment = (id: number) => clientPost(`/departments/${id}/delete`);
export const restoreDepartment = (id: number) => clientPost(`/departments/${id}/restore`);

// ---- office locations (own table, soft-deletable, gated by the Team module) ----
export const getOfficeLocations = () =>
  clientGet<{ office_locations: OfficeLocation[]; archived: OfficeLocation[] }>("/office-locations");
export const createOfficeLocation = (b: Record<string, unknown>) => clientPost("/office-locations", b);
export const updateOfficeLocation = (id: number, b: Record<string, unknown>) => clientPost(`/office-locations/${id}`, b);
export const deleteOfficeLocation = (id: number) => clientPost(`/office-locations/${id}/delete`);
export const restoreOfficeLocation = (id: number) => clientPost(`/office-locations/${id}/restore`);

// ---- assets ----
export const getAssets = () => clientGet<{ assets: Asset[] }>("/assets");
export const createAsset = (b: Record<string, unknown>) => clientPost("/assets", b);
export const updateAsset = (id: number, b: Record<string, unknown>) => clientPost(`/assets/${id}`, b);
export const deleteAsset = (id: number) => clientPost(`/assets/${id}/delete`);
export const allocateAsset = (id: number, staff_id: number, notes?: string) => clientPost(`/assets/${id}/allocate`, { staff_id, notes });
export const transferAsset = (id: number, staff_id: number, notes?: string) => clientPost(`/assets/${id}/transfer`, { staff_id, notes });
export const revokeAsset = (id: number, notes?: string) => clientPost(`/assets/${id}/revoke`, { notes });
export const addAssetNote = (id: number, note: string) => clientPost(`/assets/${id}/note`, { note });
export const getAssetHistory = (id: number) => clientGet<{ history: AssetLog[] }>(`/assets/${id}/history`);

// ---- Email (Gmail/IMAP) + Google Calendar integrations ----
export interface GmailSettings {
  user: string;
  mailbox: string;
  has_password: boolean;
  configured: boolean;
  default_mailbox: string;
}

export const getGmailSettings = () =>
  clientGet<GmailSettings>("/integrations/gmail");
export const saveGmailSettings = (body: {
  user: string;
  app_password?: string;
  mailbox?: string;
}) => clientPost<GmailSettings>("/integrations/gmail", body);
export const testGmailSettings = (body: {
  user?: string;
  app_password?: string;
  mailbox?: string;
}) => clientPost<{ ok: boolean; error?: string; total?: number }>(
  "/integrations/gmail/test",
  body,
);
export const sendTestEmail = (to: string) =>
  clientPost<{ ok: boolean; error: string | null }>("/integrations/email-test", { to });

export interface GoogleCalendarSettings {
  calendar_id: string;
  has_service_account: boolean;
  service_account_email: string | null;
  configured: boolean;
}

export const getGoogleCalendarSettings = () =>
  clientGet<GoogleCalendarSettings>("/integrations/google-calendar");
export const saveGoogleCalendarSettings = (body: {
  calendar_id: string;
  service_account?: string;
}) => clientPost<GoogleCalendarSettings>("/integrations/google-calendar", body);
export const testGoogleCalendarSettings = (body: {
  calendar_id?: string;
  service_account?: string;
}) => clientPost<{ ok: boolean; error?: string; calendar?: string }>(
  "/integrations/google-calendar/test",
  body,
);
