// Shared by the Adoption, Expansion and KPI screens.
export const fmtPct = (v) => (v == null ? "—" : `${Math.round(v)}%`);
export const fmtPP = (v) => (v == null ? "—" : `${Math.round(v) > 0 ? "+" : ""}${Math.round(v)} pp`);
// ₹10,44,00,000 → "₹10.44 Cr", ₹3,20,000 → "₹3.20 L" — for tiles and tight table columns.
export function fmtCompactINR(n) {
  const v = Math.abs(n || 0);
  if (v >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${Math.round(n || 0).toLocaleString("en-IN")}`;
}

// Score bands used by the heat cells and "Labs by range".
export const RANGES = [
  { key: "r80", label: "80% and above", min: 80, color: "var(--stg-plan-5)", ink: "var(--stg-plan-5-ink)" },
  { key: "r60", label: "60–79%", min: 60, color: "var(--stg-plan-4)", ink: "var(--stg-plan-4-ink)" },
  { key: "r40", label: "40–59%", min: 40, color: "var(--stg-exp-1)", ink: "var(--stg-exp-1-ink)" },
  { key: "r0", label: "Below 40%", min: -Infinity, color: "var(--stg-exp-3)", ink: "var(--stg-exp-3-ink)" },
];
export const rangeOf = (v) => RANGES.find((r) => v >= r.min);

// Downloads rows (first row = headers) as a CSV file.
export function downloadCsv(filename, rows) {
  const esc = (c) => { const s = c == null ? "" : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
