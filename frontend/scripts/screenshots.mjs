// Auto-capture a screenshot of every documented module and save it where the
// in-app manual (/client/docs) reads them from: frontend/public/docs/<id>.png.
//
// USAGE (from the frontend folder, with the app already running on :3000):
//   1) One-time: install Playwright →  npm install -D @playwright/test
//      (Uses your installed Chrome via channel "chrome" — no browser download.
//       If Chrome isn't found, run once: npx playwright install chromium)
//   2) Run:  CRM_EMAIL=you@company.com CRM_PASSWORD=secret npm run shots
//
//   On Windows PowerShell:
//     $env:CRM_EMAIL="you@company.com"; $env:CRM_PASSWORD="secret"; npm run shots
//
// Optional env: CRM_URL (default http://localhost:3000).
//
// It uses your installed Chrome (channel "chrome"), so no browser download is
// needed. Pages you don't have access to are skipped with a warning.

import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const BASE = process.env.CRM_URL || "http://localhost:3000";
const EMAIL = process.env.CRM_EMAIL;
const PASSWORD = process.env.CRM_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("✗ Set CRM_EMAIL and CRM_PASSWORD environment variables first.");
  process.exit(1);
}

// section id (matches DOCS in app/client/docs/page.tsx) → route to capture.
const SHOTS = [
  ["getting-started", "/client"],
  ["dashboard", "/client"],
  ["leads", "/client/leads"],
  ["followups", "/client/followups"],
  ["calls", "/client/calls"],
  ["reports", "/client/reports"],
  ["team", "/client/team"],
  ["roles", "/client/roles"],
  ["tasks", "/client/tasks"],
  ["assets", "/client/assets"],
  ["announcements", "/client/announcements"],
  ["chat", "/client/chat"],
  ["notifications", "/client/notifications"],
  ["activity", "/client/activity"],
  ["leads-setup", "/client/leads-setup"],
  ["departments-offices", "/client/departments"],
  ["email-config", "/client/email-config"],
  ["appearance", "/client/appearance"],
  ["settings", "/client/settings"],
  ["billing", "/client/billing"],
  ["profile", "/client/profile"],
];

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "docs");
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

try {
  // ---- Log in ----
  console.log(`→ Logging in at ${BASE}/login as ${EMAIL}`);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');

  // Wait until we land inside the client panel.
  await page.waitForURL("**/client**", { timeout: 20000 }).catch(() => {});
  await sleep(1500);
  if (!page.url().includes("/client")) {
    throw new Error(`Login didn't reach /client (still at ${page.url()}). Check the credentials.`);
  }
  console.log("✓ Logged in\n");

  // ---- Capture each page ----
  let ok = 0;
  for (const [id, path] of SHOTS) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 20000 });
      await sleep(1200); // let charts/animations settle
      const file = join(outDir, `${id}.png`);
      await page.screenshot({ path: file });
      console.log(`✓ ${id.padEnd(22)} ${path}`);
      ok++;
    } catch (e) {
      console.warn(`⚠ ${id.padEnd(22)} skipped (${e.message.split("\n")[0]})`);
    }
  }
  console.log(`\nDone — ${ok}/${SHOTS.length} screenshots saved to public/docs/`);
} finally {
  await browser.close();
}
