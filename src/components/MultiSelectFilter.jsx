import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// A filter button that opens a checklist you can type into: tick any number of values, search to narrow the list.
// `options` = [{ value, label, hint? }]; `selected` = the ticked values, where an EMPTY list means "all" (no filter).
// The list renders in a portal on <body>, like SearchSelect, so a card that clips or scrolls can't cut it off.
export default function MultiSelectFilter({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => `${o.label} ${o.hint || ""}`.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const isOn = (v) => selected.includes(v);
  const summary = !selected.length ? "All" : selected.length === 1 ? options.find((o) => o.value === selected[0])?.label || selected[0] : `${selected.length} selected`;

  function toggle(v) { onChange(isOn(v) ? selected.filter((x) => x !== v) : [...selected, v]); }
  // "Select shown" ticks everything the search currently shows; with no search that's the same as no filter.
  function selectShown() {
    const next = [...new Set([...selected, ...filtered.map((o) => o.value)])];
    onChange(next.length === options.length ? [] : next);
  }

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (btnRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false); setQuery("");
    }
    document.addEventListener("mousedown", onDown);
    let raf = 0, last = "";
    const follow = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) {
        const below = window.innerHeight - r.bottom;
        const up = below < 300 && r.top > below;
        const next = { left: Math.min(r.left, window.innerWidth - 276), ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }), maxHeight: Math.max(160, Math.min(260, (up ? r.top : below) - 110)) };
        const sig = JSON.stringify(next);
        if (sig !== last) { last = sig; setPos(next); }
      }
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    return () => { document.removeEventListener("mousedown", onDown); cancelAnimationFrame(raf); };
  }, [open]);

  return (
    <>
      <button ref={btnRef} type="button" className={`msf-btn${selected.length ? " on" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="msf-label">{label}:</span> {summary} <span className="msf-caret">▾</span>
      </button>
      {open && pos && createPortal(
        <div ref={popRef} className="msf-pop" style={{ left: pos.left, top: pos.top, bottom: pos.bottom }} role="dialog" aria-label={`Filter ${label}`}>
          <input className="msf-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`} />
          <div className="msf-actions">
            <button type="button" onClick={selectShown}>{query ? "Select shown" : "Select all"}</button>
            <button type="button" onClick={() => onChange([])} disabled={!selected.length}>Clear</button>
          </div>
          <div className="msf-list" style={{ maxHeight: pos.maxHeight }}>
            {!filtered.length && <div className="msf-empty">No match</div>}
            {filtered.map((o) => (
              <label key={o.value} className="msf-row">
                <input type="checkbox" checked={isOn(o.value)} onChange={() => toggle(o.value)} />
                <span className="msf-text">{o.label}</span>
                {o.hint && <span className="msf-hint">{o.hint}</span>}
              </label>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
