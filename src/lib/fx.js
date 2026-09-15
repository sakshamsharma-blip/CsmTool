// Live USD→INR exchange rate, used app-wide so a ROW (USD) lab's numbers can be shown
// side-by-side with their INR equivalent, and so cross-currency totals (Total MRR, segment
// bucketing, Collections aggregates) can be normalized to one currency before summing.
//
// Frankfurter (https://api.frankfurter.app) is a free, no-API-key, CORS-friendly rate service
// backed by the ECB — good enough for this use (not for financial settlement). We cache the
// last good rate in localStorage so a page load never blocks on the network and never shows a
// broken number if the fetch fails or the person is offline.

const DEFAULT_USD_INR = 83; // sane fallback if we've never successfully fetched a rate
const STORAGE_KEY = "csm_fx_usd_inr_v1";
const MAX_CACHE_AGE_MS = 6 * 60 * 60 * 1000; // 6h — plenty fresh for MRR display, avoids hammering the API

function readCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { rate, at } = JSON.parse(raw);
    if (!rate || !Number.isFinite(rate) || Date.now() - at > MAX_CACHE_AGE_MS) return null;
    return rate;
  } catch {
    return null;
  }
}
function writeCache(rate) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rate, at: Date.now() }));
  } catch {
    // best-effort only — private browsing / storage-disabled shouldn't break the app
  }
}

let currentRate = (typeof localStorage !== "undefined" && readCache()) || DEFAULT_USD_INR;
let listeners = [];

export function getUsdInrRate() {
  return currentRate;
}

// Subscribe to rate updates (used once at the app root to force a re-render when the live
// rate arrives, since components read the rate via getUsdInrRate() rather than React state).
export function onFxRateChange(fn) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export async function refreshUsdInrRate() {
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=INR");
    if (!res.ok) throw new Error(`FX rate fetch failed (${res.status})`);
    const data = await res.json();
    const rate = data && data.rates && data.rates.INR;
    if (rate && Number.isFinite(rate)) {
      currentRate = rate;
      writeCache(rate);
      listeners.forEach((fn) => fn(rate));
    }
  } catch (err) {
    // Silent by design — the app keeps working off the cached/default rate. Surfacing this as
    // a toast on every load would be noise; it only matters if it fails for days in a row.
    console.warn("Live USD→INR rate unavailable, using cached/default rate.", err);
  }
  return currentRate;
}
