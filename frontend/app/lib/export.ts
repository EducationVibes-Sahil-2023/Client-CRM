// Client-side CSV export — turns a header row + value rows into a downloadable
// .csv (UTF-8 with BOM so Excel opens it cleanly). Values are quoted when they
// contain a comma, quote or newline.
export function exportCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  const body = [headers, ...rows]
    .map((row) => row.map((c) => esc(String(c ?? ""))).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
