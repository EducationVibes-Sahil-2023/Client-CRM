# Documentation media (screenshots + walkthrough video)

Files dropped here are served at `/docs/<filename>` and show up automatically in
the in-app manual at **/client/docs**. No code change needed for screenshots.

## Fastest way — auto-capture all screenshots

With the app running, from the `frontend` folder:

```bash
npm install -D @playwright/test          # one-time
# macOS/Linux:
CRM_EMAIL=you@company.com CRM_PASSWORD=secret npm run shots
# Windows PowerShell:
$env:CRM_EMAIL="you@company.com"; $env:CRM_PASSWORD="secret"; npm run shots
```

This logs in and saves a `<module>.png` here for every module automatically
(see `frontend/scripts/screenshots.mjs`). Or add files manually using the table
below.

## Screenshots (one per module)

Save a PNG named after the module's section id. Until a file exists, the manual
shows a "Screenshot coming soon" placeholder for that module.

Recommended: capture at ~1440px wide, PNG.

| Module                | File to add                     |
| --------------------- | ------------------------------- |
| Getting started       | `getting-started.png`           |
| Dashboard             | `dashboard.png`                 |
| Leads                 | `leads.png`                     |
| Follow-up tracker     | `followups.png`                 |
| Call tracking         | `calls.png`                     |
| Reports               | `reports.png`                   |
| Team & org chart      | `team.png`                      |
| Roles & permissions   | `roles.png`                     |
| Task management       | `tasks.png`                     |
| Assets                | `assets.png`                    |
| Announcements         | `announcements.png`             |
| Chat                  | `chat.png`                      |
| Notifications         | `notifications.png`             |
| Activity log          | `activity.png`                  |
| Leads setup           | `leads-setup.png`               |
| Departments & offices | `departments-offices.png`       |
| Email & calendar      | `email-config.png`              |
| Appearance & branding | `appearance.png`                |
| Dashboard config      | `settings.png`                  |
| Billing & plan        | `billing.png`                   |
| My profile            | `profile.png`                   |

## Walkthrough video

Two options:

1. **Hosted (YouTube/Vimeo)** — in `frontend/app/client/docs/page.tsx`, set
   `WALKTHROUGH_VIDEO` to the embed URL, e.g. `https://www.youtube.com/embed/VIDEO_ID`.
2. **Self-hosted** — drop `walkthrough.mp4` in this folder and set
   `WALKTHROUGH_VIDEO = "/docs/walkthrough.mp4"`.

### Per-module clips (optional)

Add a `video` field to any section in the `DOCS` array (an embed URL or a
`/docs/<id>.mp4` path) to show a short clip inside that module's section.
