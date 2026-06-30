"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "../../admin/ui";

/**
 * In-app user manual. Content is data-driven (the DOCS array below) so it's easy
 * to keep in step with the product — add a new module by adding a section, or
 * edit a step by editing its string. Nothing here calls the backend.
 *
 * HOW TO UPDATE: when a feature changes or a module is added, update the matching
 * section in DOCS (or add a new one). Keep steps short and action-first.
 */

type Group = { heading?: string; numbered?: boolean; items: string[] };
type Section = {
  id: string;
  title: string;
  icon: string;
  summary: string;
  groups: Group[];
  tips?: string[];
  /** Optional per-module clip — a YouTube/Vimeo embed URL or a /docs/<id>.mp4 path. */
  video?: string;
};

// Last reviewed — bump when the manual is refreshed.
const DOC_VERSION = "Reviewed June 2026";

// Optional overview walkthrough video. Set to an embed URL
// (e.g. "https://www.youtube.com/embed/VIDEO_ID") or a self-hosted file placed
// under public (e.g. "/docs/walkthrough.mp4"). Leave "" to show a how-to placeholder.
const WALKTHROUGH_VIDEO = "";

/** A file extension that should render as an HTML5 <video> rather than an iframe. */
const isVideoFile = (url: string) => /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);

/** Per-module screenshots live in public/docs/<section id>.png — drop a file and
 *  it appears automatically; until then a labelled placeholder is shown. */
function Shot({ id, title, onZoom }: { id: string; title: string; onZoom: (src: string) => void }) {
  const [failed, setFailed] = useState(false);
  const src = `/docs/${id}.png`;

  if (failed) {
    return (
      <div className="mt-4 flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
        <svg className="h-6 w-6 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M4 16l4-4a3 3 0 014 0l4 4M14 14l1-1a3 3 0 014 0l1 1M4 6h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="9" cy="10" r="1.4" /></svg>
        <p className="text-xs font-medium text-slate-400">Screenshot coming soon</p>
        <p className="text-[11px] text-slate-400">Add an image at <code className="rounded bg-slate-200/70 px-1 py-0.5 text-slate-500">public/docs/{id}.png</code></p>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`${title} screenshot`}
      onError={() => setFailed(true)}
      onClick={() => onZoom(src)}
      className="mt-4 w-full cursor-zoom-in rounded-xl border border-slate-200 shadow-sm transition hover:shadow-md"
    />
  );
}

/** Responsive video embed (iframe for streaming URLs, <video> for hosted files). */
function VideoEmbed({ url, title }: { url: string; title: string }) {
  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-900 shadow-sm">
      {isVideoFile(url) ? (
        <video src={url} controls className="h-full w-full" />
      ) : (
        <iframe src={url} title={title} className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
      )}
    </div>
  );
}

const DOCS: Section[] = [
  {
    id: "getting-started",
    title: "Getting started",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
    summary: "The basics of signing in and finding your way around the workspace.",
    groups: [
      {
        heading: "Sign in",
        numbered: true,
        items: [
          "Open your workspace link and enter the email and password your administrator created for you.",
          "Forgot your password? Ask your administrator to reset it, or change it yourself later under My Profile.",
          "You stay signed in on this device until you choose Sign out from the top-right profile menu.",
        ],
      },
      {
        heading: "The layout",
        items: [
          "Left sidebar — every module you have access to. Collapse it with the ☰ button to get more room.",
          "Top bar — global search, the Announcements (📣) and Notifications (🔔) bells, and your profile menu.",
          "Main area — the page you're working on. Lists support search, filters and column customization.",
        ],
      },
      {
        heading: "Top bar tools",
        items: [
          "Global search — type 2+ letters to find leads, team members, tasks and assets across the app; click a result to jump there.",
          "Announcements bell — shows a red count of unread announcements; click to read them.",
          "Notifications bell — task, lead, reminder and chat alerts; click one to open it, or Mark all read.",
          "Profile menu — open My Profile or Sign out.",
        ],
      },
    ],
    tips: [
      "What you see depends on your permissions. If a module isn't in your sidebar, your administrator hasn't granted it (or your plan doesn't include it).",
      "Most lists remember your column layout, page size and filters per user.",
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    icon: "M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 14h7v5H4z",
    summary: "Your home screen — a quick snapshot of activity and what needs attention.",
    groups: [
      {
        items: [
          "See headline counts (team size, open tasks, etc.) at a glance.",
          "Review upcoming and recent tasks, and jump straight into any of them.",
          "Staff see only their own data; administrators see the whole workspace.",
        ],
      },
    ],
  },
  {
    id: "leads",
    title: "Leads",
    icon: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8z",
    summary: "Capture, track and work your prospects from first contact to won/lost.",
    groups: [
      {
        heading: "Add a lead",
        numbered: true,
        items: [
          "Click Add lead (top right). Fill in the details — phone is always required; your admin may require more.",
          "Pick a Status, Source and Lead type; assign it to a team member if you know who'll work it.",
          "State and City accept any value — pick from the all-India suggestions or type a new one and it's remembered next time.",
          "Save. The lead appears at the top of the table.",
        ],
      },
      {
        heading: "Find & filter",
        items: [
          "Use the search box to match name, phone, email or city instantly.",
          "Click Filters to open the side panel — filter by status, sub-status, source, assignee, type, follow-up status, dates and more, then Apply.",
          "The Lead summary card breaks leads down by status, source or type — click a slice to filter the table to it.",
          "Customize columns (show/hide, reorder, resize, rename) from the Columns menu; your layout is saved.",
        ],
      },
      {
        heading: "Work a lead",
        items: [
          "Click a row to open the detail drawer: Info, Reminders, Notes, Calls and Activity tabs.",
          "Add a Reminder to get a notification when it's time to follow up.",
          "Log Notes after each conversation — they drive the follow-up 'done' status.",
          "The Activity tab shows a full timeline (status changes, reassignments, etc.).",
        ],
      },
      {
        heading: "Assign, transfer & import",
        items: [
          "Assigning a lead notifies that team member instantly (in-app + browser push).",
          "Transfer a lead to another rep from the lead actions; depending on settings it may need admin approval.",
          "Import many leads at once from a CSV file using the Import option.",
        ],
      },
    ],
    tips: [
      "Required fields are configured by your admin under Leads Setup → Required fields.",
      "Deletes are soft — a removed lead can be restored, so you never lose history.",
    ],
  },
  {
    id: "lead-transfer",
    title: "Transfer leads",
    icon: "M4 7h16M4 7l4-4M4 7l4 4M20 17H4M20 17l-4-4M20 17l-4 4",
    summary: "Hand a lead from one rep to another — instantly, or via an admin-approved request.",
    groups: [
      {
        heading: "How it works",
        items: [
          "Every transfer moves a lead's owner from one team member to another and is recorded with who, to whom, when and why.",
          "Your admin sets the transfer mode: Direct (the lead is reassigned immediately) or Approval (an admin must approve first).",
          "In Approval mode the lead is hidden from all lists while it's pending, so two people never work it at once.",
          "Requires the Lead transfer feature (super-admin) plus the 'lead_transfer' permission.",
        ],
      },
      {
        heading: "Transfer a lead",
        numbered: true,
        items: [
          "Open Leads and find the lead in the table.",
          "Click the Transfer icon on that row (the ↔ arrows action).",
          "In the popup, choose the team member to Transfer to.",
          "Optionally add a Reason for the hand-off.",
          "Click Transfer lead (Direct mode) or Request transfer (Approval mode). The new owner is notified instantly.",
        ],
      },
      {
        heading: "Approve or reject (admins)",
        numbered: true,
        items: [
          "Open Leads → the Transfers tab to see all requests and their history.",
          "For a pending request, click Approve to reassign the lead to the new rep, or Reject to return it to the original owner.",
          "The requester is notified of the decision; on approval the new assignee is notified too.",
        ],
      },
    ],
    tips: [
      "Pending (approval-mode) leads won't show on the normal Leads list until a decision is made — check the Transfers tab.",
      "You can deep-link straight to the queue with /client/leads?tab=transfers (notifications do this for you).",
    ],
  },
  {
    id: "visitors",
    title: "Visitor logs",
    icon: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8zM21 7l-4 4-2-2",
    summary: "Record people who visit or enquire (walk-ins, callers) — on their own or linked to a lead.",
    groups: [
      {
        heading: "Open visitor logs",
        items: [
          "Go to Leads → the Visitors tab to see every logged visit.",
          "Requires the Visitors feature (super-admin) plus the 'visitors' permission.",
        ],
      },
      {
        heading: "Log a visitor",
        numbered: true,
        items: [
          "On the Visitors tab, click Log visitor.",
          "Enter the visitor's Name (required); add Phone, Email and the Visit date/time.",
          "Choose a Type (e.g. walk-in, enquiry) and a Status — both are lists your admin manages.",
          "Optionally assign it to a team member and link an existing lead.",
          "Add a Purpose and any Notes, then click Log visitor to save.",
        ],
      },
      {
        heading: "Log straight from a lead",
        items: [
          "On any lead row, click the Log visitor action — the form opens pre-filled with that lead's name, phone and email, and links the visit to the lead automatically.",
        ],
      },
      {
        heading: "Types & statuses (admin)",
        items: [
          "Configure visit Types and Statuses (with colours) so the form matches how you work.",
          "A status can be marked 'final'. Once a visit reaches a finalised status, only an admin can change it — protecting closed records.",
        ],
      },
    ],
    tips: ["A visitor can stand alone or be linked to a lead, so front-desk logs and your pipeline stay connected."],
  },
  {
    id: "followups",
    title: "Follow-up tracker",
    icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11M12 8v4l3 2",
    summary: "A dedicated view of who needs following up — upcoming, due, overdue and done.",
    groups: [
      {
        items: [
          "See follow-ups grouped as Upcoming, Due today, Overdue and Done, with completion rates.",
          "Break the numbers down per rep to see who is on top of their follow-ups.",
          "Spot 'ghosted' leads (several call attempts, no connection) that may need a different approach.",
          "Filter by date range and status to focus on what matters today.",
        ],
      },
    ],
  },
  {
    id: "calls",
    title: "Call tracking",
    icon: "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z",
    summary: "Call analytics and a searchable log, fed automatically from your calling app.",
    groups: [
      {
        heading: "Dashboard view",
        items: [
          "KPIs for the day: total calls, unique numbers, average duration, connect rate and talk time.",
          "Hourly distribution, volume by lead status, and top/least performers by calls, talk time and connect rate.",
          "Filter by date, lead source, status, department, office and rep.",
        ],
      },
      {
        heading: "Call log view",
        items: [
          "Every call with the matched lead, rep, direction, status and duration.",
          "Search by lead, number or staff, and filter by status, type, source, connected and call date.",
          "Switch between a compact table and an activity feed.",
        ],
      },
    ],
  },
  {
    id: "reports",
    title: "Reports",
    icon: "M4 19V5m0 14h16M8 17v-5m4 5V8m4 9v-7",
    summary: "Pipeline and performance analytics across your leads.",
    groups: [
      {
        items: [
          "Leads by status, source, type and stage to understand your mix.",
          "Pipeline view with weighted values and win rates.",
          "Rep performance — totals, wins and win-rate per team member.",
          "Filter by date range and other dimensions to slice the data.",
        ],
      },
    ],
  },
  {
    id: "team",
    title: "Team & org chart",
    icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2M17 11h4m-2-2v4",
    summary: "Manage staff members, their roles, reporting lines and login access.",
    groups: [
      {
        heading: "Add a team member",
        numbered: true,
        items: [
          "Click Add staff. Enter their name, employee code, email (this is their login) and a starting password.",
          "Choose a Role — this sets their permissions. You can fine-tune permissions per person if needed.",
          "Set their Reporting person, department, office and lead type as relevant.",
          "Save. They can now sign in with the email and password you set.",
        ],
      },
      {
        heading: "Views & filters",
        items: [
          "Directory shows everyone as a searchable, filterable list or cards; switch to Hierarchy to see reporting lines.",
          "Filter by role, department, office, lead type, reporting person and status.",
          "Open the Org Chart module for a clean reporting-tree view.",
        ],
      },
      {
        heading: "Remove a member (with lead hand-off)",
        numbered: true,
        items: [
          "Click the remove (trash) icon on a member and confirm — same as anywhere else in the app, removal is a soft delete that can be restored.",
          "If the member still owns leads, a transfer step opens first so no lead is left orphaned — you can't delete them until their leads are moved.",
          "Choose how to hand off: to a Single team member, or Round-robin to spread the leads evenly across several members.",
          "Optionally update the assignment date to today, and change the leads' Status, Type or Source in bulk (leave any unchanged to keep it as-is).",
          "Tick Notify the new assignee(s) to send them an in-app alert and browser push about the leads they've received.",
          "Click Transfer — each lead's move is written to its Activity timeline. Once that's done, confirm the delete to remove the member.",
        ],
      },
    ],
    tips: [
      "Removing a member is a soft delete — their history and login can be restored later.",
      "Round-robin is the quick way to share a departing rep's pipeline fairly across the remaining team.",
    ],
  },
  {
    id: "roles",
    title: "Roles & permissions",
    icon: "M12 11a3 3 0 100-6 3 3 0 000 6zM4 21v-2a4 4 0 014-4h8a4 4 0 014 4v2",
    summary: "Control exactly what each kind of user can see and do.",
    groups: [
      {
        heading: "How it works",
        items: [
          "A Role is a named set of permissions (e.g. 'Sales Rep', 'Manager').",
          "Each module has four permissions: View, Create, Update, Delete.",
          "Assign a role to a team member; they inherit its permissions. You can also grant extra permissions to a single person.",
          "The account owner (client admin) always has full access.",
        ],
      },
      {
        heading: "Create a role",
        numbered: true,
        items: [
          "Open Roles & Permissions and click Add role.",
          "Name it, then tick the View/Create/Update/Delete boxes per module.",
          "Save, then assign it to team members from the Team page.",
        ],
      },
    ],
    tips: ["A role can't be deleted while team members are still assigned to it — move them first."],
  },
  {
    id: "tasks",
    title: "Task management",
    icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
    summary: "A kanban board to plan, assign and track work to completion.",
    groups: [
      {
        items: [
          "Create tasks with a type (task, bug, feature, improvement), priority, assignee and due date.",
          "Drag cards across columns (Backlog → In progress → In review → Done) to update status.",
          "Each card shows a time bar and flags overdue / due-today work.",
          "Open a task for its description, comments and full activity timeline.",
          "Assignees are notified when a task is given to them, and everyone is alerted on stage changes and due dates.",
        ],
      },
    ],
  },
  {
    id: "assets",
    title: "Assets",
    icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-14L4 7m8 4v10M4 7v10l8 4",
    summary: "Track company equipment and who currently holds it.",
    groups: [
      {
        items: [
          "Record assets with code, group, model, supplier, purchase date, warranty and value.",
          "Allocate an asset to a staff member, transfer it to someone else, or revoke it.",
          "Every asset has a full history timeline (created, allocated, transferred, revoked, notes).",
          "Search and filter by status; switch between cards and a table.",
        ],
      },
    ],
  },
  {
    id: "announcements",
    title: "Announcements",
    icon: "M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 010 7M18 6a8 8 0 010 12",
    summary: "Broadcast updates to the whole team, a department, or specific people.",
    groups: [
      {
        heading: "Post an announcement",
        numbered: true,
        items: [
          "Click New announcement, add a title and a rich-text message.",
          "Choose the audience: all team, selected departments, or specific people.",
          "Optionally attach files, pin it to the top, or require acknowledgement.",
          "Post it — recipients get an in-app alert and a browser push.",
        ],
      },
      {
        heading: "Track & read",
        items: [
          "The 📣 bell in the top bar shows your unread count; click it to read.",
          "As an author, open View recipients to see who has read and acknowledged.",
          "Use the filter rail to narrow by audience, attributes and date.",
        ],
      },
    ],
  },
  {
    id: "chat",
    title: "Chat",
    icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
    summary: "Talk to your team and to support without leaving the app.",
    groups: [
      {
        items: [
          "A shared team room plus 1:1 direct messages with admins and colleagues.",
          "New messages raise a notification so you don't miss them.",
          "Open chat from the floating launcher or the Chat module.",
        ],
      },
    ],
  },
  {
    id: "notifications",
    title: "Notifications & alerts",
    icon: "M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
    summary: "Stay on top of assignments, reminders, tasks and messages.",
    groups: [
      {
        items: [
          "The 🔔 bell collects alerts: lead assignments, task changes, due reminders and chat messages.",
          "Click an alert to jump straight to the item; use Mark all read to clear them.",
          "Browser push: when enabled, you'll get desktop notifications even when the tab isn't focused — accept the browser prompt the first time.",
          "The full history lives on the Notifications page.",
        ],
      },
    ],
  },
  {
    id: "activity",
    title: "Activity log",
    icon: "M22 12h-4l-3 9L9 3l-3 9H2",
    summary: "An audit trail of everything that happens in your workspace.",
    groups: [
      {
        items: [
          "See who created, updated or deleted what, and when.",
          "Filter by action type and page through the history.",
          "Staff see their own activity; admins see the whole workspace.",
        ],
      },
    ],
  },
  {
    id: "leads-setup",
    title: "Leads setup",
    icon: "M3 6h18M3 6l2 13a1 1 0 001 1h12a1 1 0 001-1l2-13M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2",
    summary: "Configure the building blocks your leads use (admin).",
    groups: [
      {
        items: [
          "Statuses & sub-statuses — your pipeline stages, with colours; a sub-status can sit under multiple parents.",
          "Lead sources & marketing types — where leads come from, rolled up into channels.",
          "Lead types and conversion stages — categorise leads and map stages to won/open/lost.",
          "Follow-up groups — group statuses for the follow-up tracker.",
          "Required fields — choose which lead fields are mandatory when adding a lead.",
        ],
      },
    ],
    tips: ["Reorder lists by dragging; colours flow through to the lead table and the summary charts."],
  },
  {
    id: "departments-offices",
    title: "Departments & offices",
    icon: "M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01",
    summary: "Your org structure — used for staff, announcements and filtering (admin).",
    groups: [
      {
        items: [
          "Departments — create the teams staff belong to; used for targeting announcements and filtering.",
          "Office locations — addresses with map links; assign staff to an office.",
          "Both support soft delete + restore.",
        ],
      },
    ],
  },
  {
    id: "email-config",
    title: "Email & calendar setup",
    icon: "M3 8l9 6 9-6M3 8v10a2 2 0 002 2h14a2 2 0 002-2V8M3 8l9-5 9 5",
    summary: "Connect your own Gmail and Google Calendar (admin).",
    groups: [
      {
        heading: "Gmail",
        numbered: true,
        items: [
          "Enter your Gmail address and an App Password (not your normal password).",
          "Save, then use Test to confirm the connection works, and send a test email.",
        ],
      },
      {
        heading: "Google Calendar",
        items: [
          "Paste a service-account JSON key and the calendar ID, then Test to verify access.",
        ],
      },
    ],
  },
  {
    id: "appearance",
    title: "Appearance & branding",
    icon: "M12 2a10 10 0 100 20 2 2 0 002-2 2 2 0 00-.5-1.3 2 2 0 01-.5-1.2 2 2 0 012-2H19a3 3 0 003-3 8 8 0 00-8-8z",
    summary: "Make the workspace your own — logo, colours, fonts and menu (admin).",
    groups: [
      {
        items: [
          "Set your Workspace name and Tagline (both may be left blank).",
          "Upload a Logo (sidebar) and a separate Favicon (browser tab icon).",
          "Choose your brand colour, light/dark/system theme, density and fonts.",
          "Reorder the sidebar menu and set the default rows-per-page for tables.",
        ],
      },
    ],
    tips: ["After changing the favicon, do a hard refresh (Ctrl+F5) to see the new tab icon."],
  },
  {
    id: "settings",
    title: "Dashboard config",
    icon: "M10.3 4.3a2 2 0 013.4 0l.5.9 1-.2a2 2 0 012.4 2.4l-.2 1 .9.5a2 2 0 010 3.4l-.9.5.2 1a2 2 0 01-2.4 2.4l-1-.2-.5.9a2 2 0 01-3.4 0l-.5-.9-1 .2a2 2 0 01-2.4-2.4l.2-1-.9-.5a2 2 0 010-3.4l.9-.5-.2-1a2 2 0 012.4-2.4l1 .2z",
    summary: "Workspace-wide preferences and table column names (admin).",
    groups: [
      {
        items: [
          "Rename table columns so they match your team's language.",
          "Tune workspace defaults that apply to everyone.",
        ],
      },
    ],
  },
  {
    id: "billing",
    title: "Billing & plan",
    icon: "M3 10h18M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2zM7 15h3",
    summary: "See your plan, what's included and your usage (admin).",
    groups: [
      {
        items: [
          "View your current plan, status and subscription dates.",
          "See which features are included and your usage against any limits.",
          "Plan changes are handled by the platform team — reach out via chat to upgrade.",
        ],
      },
    ],
  },
  {
    id: "profile",
    title: "My profile",
    icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-2a6 6 0 0112 0v2",
    summary: "Manage your own account details and password.",
    groups: [
      {
        numbered: true,
        items: [
          "Open My Profile from the top-right profile menu.",
          "Update your name, email and photo, then Save.",
          "Change your password under Security (you'll need your current one).",
        ],
      },
    ],
  },
];

export default function DocsPage() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string>(DOCS[0].id);
  const [zoom, setZoom] = useState<string | null>(null); // screenshot lightbox

  // Sections matching the search (matches title, summary, or any step text).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DOCS;
    return DOCS.filter((s) =>
      [s.title, s.summary, ...s.groups.flatMap((g) => [g.heading ?? "", ...g.items]), ...(s.tips ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [query]);

  function jump(id: string) {
    setActive(id);
    document.getElementById(`doc-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <PageHeader title="Documentation" subtitle="Your step-by-step guide to every part of the workspace." />

      {/* Hero / intro */}
      <div className="mb-6 overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-teal-50 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-lg font-bold text-slate-900">Welcome to your CRM 👋</h2>
            <p className="mt-1 text-sm text-slate-600">
              New here? Start with <button onClick={() => jump("getting-started")} className="font-semibold text-emerald-700 hover:underline">Getting started</button>, then explore each module below. Use the search to jump straight to a topic.
            </p>
          </div>
          <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">{DOC_VERSION}</span>
        </div>
        <div className="relative mt-4 max-w-md">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the manual…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
          />
        </div>
      </div>

      {/* Video walkthrough */}
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10 8l6 4-6 4V8z" strokeLinecap="round" strokeLinejoin="round" /><rect x="3" y="5" width="18" height="14" rx="2" /></svg>
          </span>
          <div>
            <h3 className="text-base font-bold text-slate-900">Video walkthrough</h3>
            <p className="text-xs text-slate-500">A guided tour of the workspace, module by module.</p>
          </div>
        </div>
        {WALKTHROUGH_VIDEO ? (
          <VideoEmbed url={WALKTHROUGH_VIDEO} title="Workspace walkthrough" />
        ) : (
          <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center">
            <svg className="h-7 w-7 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M10 8l6 4-6 4V8z" strokeLinecap="round" strokeLinejoin="round" /><rect x="3" y="5" width="18" height="14" rx="2" /></svg>
            <p className="text-sm font-medium text-slate-500">No walkthrough video yet</p>
            <p className="max-w-md text-[11px] text-slate-400">Add one by setting <code className="rounded bg-slate-200/70 px-1 py-0.5 text-slate-500">WALKTHROUGH_VIDEO</code> in this page to a YouTube/Vimeo embed link, or drop an MP4 at <code className="rounded bg-slate-200/70 px-1 py-0.5 text-slate-500">public/docs/walkthrough.mp4</code> and use that path.</p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Table of contents */}
        <aside className="lg:sticky lg:top-20 lg:w-64 lg:flex-shrink-0">
          <nav className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
            <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Contents</div>
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-400">No topics match “{query}”.</p>
            ) : (
              filtered.map((s) => (
                <button
                  key={s.id}
                  onClick={() => jump(s.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition ${active === s.id ? "bg-emerald-50 font-semibold text-emerald-700" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  <svg className={`h-4 w-4 flex-shrink-0 ${active === s.id ? "text-emerald-600" : "text-slate-400"}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={s.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <span className="truncate">{s.title}</span>
                </button>
              ))
            )}
          </nav>
        </aside>

        {/* Sections */}
        <div className="min-w-0 flex-1 space-y-5">
          {filtered.map((s) => (
            <section key={s.id} id={`doc-${s.id}`} className="scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={s.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-slate-900">{s.title}</h3>
                  <p className="mt-0.5 text-sm text-slate-500">{s.summary}</p>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                {s.groups.map((g, gi) => (
                  <div key={gi}>
                    {g.heading && <h4 className="mb-2 text-sm font-semibold text-slate-700">{g.heading}</h4>}
                    {g.numbered ? (
                      <ol className="space-y-2">
                        {g.items.map((it, i) => (
                          <li key={i} className="flex gap-3 text-sm text-slate-600">
                            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-700">{i + 1}</span>
                            <span className="leading-relaxed">{it}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <ul className="space-y-1.5">
                        {g.items.map((it, i) => (
                          <li key={i} className="flex gap-2.5 text-sm text-slate-600">
                            <svg className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 text-emerald-500" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="currentColor" /></svg>
                            <span className="leading-relaxed">{it}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>

              {s.tips && s.tips.length > 0 && (
                <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 p-3">
                  {s.tips.map((t, i) => (
                    <p key={i} className="flex gap-2 text-xs text-amber-800">
                      <span className="font-bold">Tip</span>
                      <span className="leading-relaxed">{t}</span>
                    </p>
                  ))}
                </div>
              )}

              {/* Per-module clip (optional) + screenshot. */}
              {s.video && <div className="mt-4"><VideoEmbed url={s.video} title={`${s.title} video`} /></div>}
              <Shot id={s.id} title={s.title} onZoom={setZoom} />
            </section>
          ))}
        </div>
      </div>

      {/* Screenshot lightbox */}
      {zoom && (
        <div onClick={() => setZoom(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-sm">
          <button onClick={() => setZoom(null)} className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20" aria-label="Close">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" onClick={(e) => e.stopPropagation()} className="max-h-[90vh] max-w-[92vw] rounded-xl shadow-2xl" />
        </div>
      )}
    </>
  );
}
