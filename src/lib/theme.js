// Light / Dark / System display mode. The choice is remembered in this browser (localStorage — wrapped in
// try/catch because it can be unavailable in private windows) and applied by setting data-theme="light" |
// "dark" on <html>; the colour variables for each live in src/index.css. "system" follows the operating
// system's setting and updates live when that changes.
export const THEME_MODES = ["light", "system", "dark"];
const KEY = "csm-theme-mode";

export function getStoredMode() {
  try {
    const v = localStorage.getItem(KEY);
    return THEME_MODES.includes(v) ? v : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark() {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(mode) {
  const resolved = mode === "dark" || (mode === "system" && systemPrefersDark()) ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", resolved);
  return resolved;
}

export function saveMode(mode) {
  try { localStorage.setItem(KEY, mode); } catch { /* storage unavailable — the choice just won't persist */ }
}

// Calls `onChange` whenever the OS light/dark setting flips. Returns an unsubscribe function.
export function watchSystemTheme(onChange) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
