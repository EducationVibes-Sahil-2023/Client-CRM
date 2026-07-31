// Real .xlsx export via SheetJS, lazy-loaded (matches the leads-page convention —
// `xlsx` is heavy, so it's never statically imported). Also a CSV fallback that
// needs no library. Used by the Excel Data Hub.

/** Download `rows` as a real .xlsx file. `headers` is the first row; `rows` are data. */
export async function exportXlsx(
  filename: string,
  headers: string[],
  rows: (string | number)[][],
  sheetName = "Sheet1",
): Promise<void> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

const csvCell = (v: string | number) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Download `rows` as a UTF-8 (BOM) CSV — no library needed. */
export function exportCsvGrid(filename: string, headers: string[], rows: (string | number)[][]): void {
  const body = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
