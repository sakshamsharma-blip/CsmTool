import { useEffect, useState } from "react";

// useState that survives a page refresh: the value is kept in sessionStorage (this browser tab only — a new tab
// starts fresh, nothing is shared or sent anywhere). Used for filters, sorts, searches and sub-tabs so a refresh
// reopens the screen exactly as it was, with the data reloaded. Keys look like "tasks.fLab". Storage can be
// unavailable (private mode, blocked site data) — then it simply behaves like useState.
const PREFIX = "csm.ui.";
function read(key, fallback) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function useSessionState(key, initial) {
  const [value, setValue] = useState(() => read(key, typeof initial === "function" ? initial() : initial));
  useEffect(() => {
    try { sessionStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage unavailable — fine */ }
  }, [key, value]);
  return [value, setValue];
}
