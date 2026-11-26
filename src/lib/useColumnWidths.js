import { useCallback, useState } from "react";

// Column widths a person has dragged (decision Nov 26 2026). Per table, kept in this browser (localStorage — a viewing
// preference, like the theme), so they survive refresh and new tabs. `defaults` = { colKey: px }. Double-clicking a
// handle puts that column back to its default; `reset()` puts them all back.
const KEY = (table) => `colwidths.${table}`;
const MIN = 50;

function readSaved(table) {
  try { return JSON.parse(localStorage.getItem(KEY(table)) || "{}") || {}; } catch { return {}; }
}

export function useColumnWidths(table, defaults) {
  const [saved, setSaved] = useState(() => readSaved(table));
  const widths = Object.fromEntries(Object.entries(defaults).map(([k, w]) => [k, Number(saved[k]) >= MIN ? Number(saved[k]) : w]));
  const write = (next) => { try { localStorage.setItem(KEY(table), JSON.stringify(next)); } catch { /* private window: just not remembered */ } };
  const setWidth = useCallback((col, px) => {
    setSaved((s) => {
      const next = { ...s };
      if (px == null) delete next[col]; else next[col] = Math.max(MIN, Math.round(px));
      write(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);
  const reset = useCallback(() => { setSaved({}); write({}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [table]);
  const changed = Object.keys(saved).some((k) => k in defaults);
  return { widths, setWidth, reset, changed };
}
