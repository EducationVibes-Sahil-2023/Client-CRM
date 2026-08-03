// Reusable spreadsheet-import engine for the Excel Data Hub: parse a .xlsx/.csv
// file into a grid, map arbitrary sheet headers to canonical column keys, and
// preview which rows the server will skip. Entity-agnostic (leads / tasks / team)
// — the column set + locked required key are passed in.
//
// Generalised from the leads-page importer so both can share one implementation.

import type { ImportColumn, ImportEntity } from "../../lib/client";

/** Common header spellings → canonical key (per-column label/key aliases are added on top). */
export const HEADER_ALIAS: Record<string, string> = {
  // leads
  name: "name",
  phone: "phone", phone_number: "phone", phonenumber: "phone", mobile: "phone", contact: "phone", contact_number: "phone",
  alternative_phone: "alt_phone", alt_phone: "alt_phone", alternate_phone: "alt_phone", secondary_phone: "alt_phone",
  email: "email", email_address: "email", mail: "email",
  reference: "reference_name", reference_name: "reference_name", ref_name: "reference_name",
  city: "city", state: "state",
  // tasks
  title: "title", task: "title", subject: "title",
  description: "description", details: "description", notes: "description",
  priority: "priority", type: "type", status: "status", stage: "status",
  start_date: "start_date", start: "start_date",
  due_date: "due_date", due: "due_date", deadline: "due_date",
  // team
  designation: "designation", role: "designation", position: "designation",
  emp_code: "emp_code", employee_code: "emp_code", employee_id: "emp_code", code: "emp_code",
};

export const normHeader = (h: string): string =>
  h.trim().toLowerCase().replace(/[\s./-]+/g, "_").replace(/^_+|_+$/g, "");

/** The always-required column key per entity (phone/title/name). */
export const LOCKED_KEY: Record<ImportEntity, string> = { lead: "phone", task: "title", team: "name" };

/** RFC-lite CSV parser (quotes, escaped quotes, CRLF). Drops fully-blank rows. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* ignore */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Read a .csv or .xlsx File into a raw string grid (first sheet). */
export async function parseFile(file: File): Promise<string[][]> {
  if (/\.csv$/i.test(file.name)) {
    return parseCSV(await file.text());
  }
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "", raw: false, blankrows: false });
  return grid as unknown as string[][];
}

/** An example cell value for a template column: a real allowed value for dropdown
 *  (select) columns, else a sensible sample by key. */
function sampleValue(c: ImportColumn): string {
  if ((c.options?.length ?? 0) > 0) return c.options![0];
  switch (c.key) {
    case "phone": return "9876543210";
    case "alt_phone": return "9876500000";
    case "email": return "john@example.com";
    case "name": return "John Doe";
    case "title": return "Follow up with client";
    case "city": return "Mumbai";
    case "state": return "Maharashtra";
    default: return "";
  }
}

/**
 * Build the downloadable sample/template for an import: the header row (labels of
 * the included columns), one filled-in example row, and — for every dropdown
 * (select) column — a reference note listing its allowed values. Shared by the
 * leads importer and the Excel Data Hub so both stay in sync.
 */
export function importTemplate(columns: ImportColumn[]): { headers: string[]; rows: string[][] } {
  const cols = columns.filter((c) => c.include);
  const headers = cols.map((c) => c.label);
  const rows: string[][] = [cols.map(sampleValue)];
  const dropdowns = cols.filter((c) => (c.options?.length ?? 0) > 0);
  if (dropdowns.length) {
    rows.push([]); // spacer
    rows.push(["Allowed values (reference only — delete this section before importing):"]);
    for (const c of dropdowns) rows.push([c.label, (c.options ?? []).join(", ")]);
  }
  return { headers, rows };
}

/** Header alias map for a specific column set (static aliases + each column's label & key). */
function buildAlias(columns: ImportColumn[]): Record<string, string> {
  const m: Record<string, string> = { ...HEADER_ALIAS };
  for (const c of columns) { m[normHeader(c.label)] = c.key; m[normHeader(c.key)] = c.key; }
  return m;
}

/** Map a raw grid to canonical-keyed row objects. */
export function mapGrid(grid: string[][], columns: ImportColumn[]): { rows: Record<string, string>[]; info: string } {
  if (grid.length < 2) {
    return { rows: [], info: grid.length ? "The file has a header row but no data rows." : "The file is empty." };
  }
  const alias = buildAlias(columns);
  const headers = grid[0].map((h) => alias[normHeader(String(h))] ?? normHeader(String(h)));
  const rows = grid.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((key, idx) => { obj[key] = String(cells[idx] ?? "").trim(); });
    return obj;
  });
  return { rows, info: `${rows.length} row${rows.length === 1 ? "" : "s"} found.` };
}

/** Client-side preview of rows the server will skip (server re-validates authoritatively). */
export function validateRows(
  rows: Record<string, string>[],
  columns: ImportColumn[],
  entity: ImportEntity,
): { row: number; message: string }[] {
  const req = columns.filter((c) => c.required && !c.locked && c.key !== LOCKED_KEY[entity]);
  const out: { row: number; message: string }[] = [];
  rows.forEach((r, i) => {
    const line = i + 2; // +1 header, +1 to 1-based
    if (entity === "lead") {
      const phone = (r.phone ?? "").replace(/\D/g, "");
      if (!phone) { out.push({ row: line, message: "Phone (contact) is required." }); return; }
      if (phone.length !== 10) { out.push({ row: line, message: "Phone must be exactly 10 digits." }); return; }
    } else if (entity === "task") {
      if (!(r.title ?? "").trim()) { out.push({ row: line, message: "Title is required." }); return; }
    } else {
      if ((r.name ?? "").trim().length < 2) { out.push({ row: line, message: "Name is required (min 2 characters)." }); return; }
    }
    const email = (r.email ?? "").trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { out.push({ row: line, message: "Invalid email address." }); return; }
    const miss = req.filter((c) => !(r[c.key] ?? "").trim()).map((c) => c.label);
    if (miss.length) out.push({ row: line, message: `${miss.join(", ")} ${miss.length > 1 ? "are" : "is"} required.` });
  });
  return out;
}
