import { getUsdInrRate } from "./fx";

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

export function fmtUSD(n) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

// A lab's own billing currency, derived from its region — Domestic labs are invoiced in INR,
// ROW (Rest of World) labs in USD. No separate `currency` column needed: region already
// determines it 1:1.
export function nativeCurrency(region) {
  return region === "ROW" ? "USD" : "INR";
}

// Converts an amount that's already in a lab's own native currency into INR/USD — used to
// normalize mixed-currency amounts (e.g. some labs Domestic, some ROW) before summing them into
// a single total, bucketing into a segment band, or sorting.
export function toINR(amount, region) {
  return region === "ROW" ? amount * getUsdInrRate() : amount;
}
export function toUSD(amount, region) {
  return region === "ROW" ? amount : amount / getUsdInrRate();
}

// The main "everywhere" display helper — shows a lab's own amount in its own native currency,
// with the other currency converted alongside in brackets. A Domestic lab's ₹55,000 becomes
// "₹55,000 ($663)"; a ROW lab's $1,200 becomes "$1,200 (₹99,600)". For a figure that's already
// an aggregate across many labs (so there's no single "native currency" to anchor on), just use
// fmtINR directly instead of this — that's the existing behavior and it's still correct once the
// summing itself has normalized every lab's amount to INR first via toINR().
export function fmtMoney(amount, region) {
  if (region === "ROW") return `${fmtUSD(amount)} (${fmtINR(toINR(amount, region))})`;
  return `${fmtINR(amount)} (${fmtUSD(toUSD(amount, region))})`;
}
