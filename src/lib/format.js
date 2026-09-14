export const SEG_BANDS = [
  { min: 90000, code: "A", color: "var(--segA)" },
  { min: 50000, code: "B", color: "var(--segB)" },
  { min: 25000, code: "C", color: "var(--segC)" },
  { min: 15000, code: "D", color: "var(--segD)" },
  { min: 0, code: "E", color: "var(--segE)" },
];
export function segmentFor(mrr) {
  return SEG_BANDS.find((b) => mrr >= b.min);
}
export function fmtINR(n) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
