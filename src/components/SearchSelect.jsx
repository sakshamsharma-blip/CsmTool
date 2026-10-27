import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// A dropdown you can also type into — pick from the list, or start typing and it filters as you go
// (so with hundreds of labs you never scroll; "f" narrows to every lab matching "f"). Drop-in for a
// native <select>: `options` is [{ value, label, hint? }], `value` is the selected option's value, and
// `onChange` receives the new value (not an event). `hint` is secondary text that is also searchable
// (e.g. a Lab ID next to a lab name). `emptyLabel` adds a leading "clear" row for optional fields.
export default function SearchSelect({
  value, onChange, options, placeholder = "Select…", emptyLabel, disabled = false, style, className, inputStyle, autoFocus = false,
  allowCustom = false, // also accept text that isn't in the list ("Use “…”" row) — e.g. a city we don't have listed
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find((o) => o.value === value) || (allowCustom && value ? { value, label: value } : null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.hint || ""}`.toLowerCase().includes(q));
  }, [options, query]);

  // Rows shown = optional "clear" row + the filtered options.
  const typed = query.trim();
  const customRow = allowCustom && typed && !options.some((o) => o.label.toLowerCase() === typed.toLowerCase())
    ? [{ value: typed, label: `Use “${typed}”`, isCustom: true }] : [];
  const rows = emptyLabel !== undefined && !query.trim()
    ? [{ value: "", label: emptyLabel, isEmpty: true }, ...filtered]
    : [...filtered, ...customRow];

  useEffect(() => {
    if (!open) return;
    function onDocDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target) && !(listRef.current && listRef.current.contains(e.target))) close();
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  // The list is rendered into <body> (a portal) in a fixed layer positioned under (or, near the bottom of the screen,
  // above) the input, so a parent that scrolls or clips — a popup, a table card — can never cut it off.
  const [pos, setPos] = useState(null);
  function measure() {
    const el = wrapRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const up = below < 250 && r.top > below;
    return {
      left: r.left, width: Math.max(r.width, 200),
      ...(up ? { top: "auto", bottom: window.innerHeight - r.top + 3 } : { top: r.bottom + 3, bottom: "auto" }),
      maxHeight: Math.max(120, Math.min(240, (up ? r.top : below) - 12)),
    };
  }
  useEffect(() => {
    if (!open) return undefined;
    // Re-measure every frame while open (cheap; only re-renders when the spot actually moved) — this also covers a
    // drawer or popup that is still sliding in when the list opens, and any scroll or resize.
    let raf = 0;
    let last = "";
    const follow = () => {
      const next = measure();
      const sig = JSON.stringify(next);
      if (sig !== last) { last = sig; setPos(next); }
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[active];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function openList() {
    setPos(measure());
    setOpen(true);
    setActive(0);
  }
  function close() {
    setOpen(false);
    setQuery("");
  }
  function pick(row) {
    onChange(row.value);
    close();
  }
  function onKeyDown(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) openList(); else setActive((a) => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { if (open && rows[active]) { e.preventDefault(); pick(rows[active]); } }
    else if (e.key === "Escape") { if (open) { e.preventDefault(); close(); } }
    else if (e.key === "Tab") { close(); }
  }

  // Closed: show the chosen label. Open: show what's being typed (empty until they type).
  const shown = open ? query : (selected ? selected.label : "");

  return (
    <div ref={wrapRef} className={`ss-wrap${className ? " " + className : ""}`} style={style}>
      <input
        type="text"
        className="ss-input"
        style={inputStyle}
        value={shown}
        placeholder={open && selected ? selected.label : placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        name="ss-no-autofill"
        data-lpignore="true"
        data-1p-ignore="true"
        role="combobox"
        aria-expanded={open}
        onFocus={() => { if (!disabled && !open) openList(); }}
        onClick={() => { if (!disabled && !open) openList(); }}
        onChange={(e) => { setQuery(e.target.value); setActive(0); if (!open) { setPos(measure()); setOpen(true); } }}
        onKeyDown={onKeyDown}
      />
      <span className="ss-caret" aria-hidden="true">▾</span>
      {open && !disabled && createPortal(
        <div className="ss-list ss-floating" ref={listRef} role="listbox" style={pos || undefined}>
          {rows.length === 0 ? (
            <div className="ss-empty">No match for “{query}”</div>
          ) : rows.map((r, i) => (
            <div
              key={r.isEmpty ? "__empty" : r.isCustom ? "__custom" : r.value}
              role="option"
              aria-selected={r.value === value}
              className={`ss-row${i === active ? " active" : ""}${r.value === value && !r.isEmpty ? " selected" : ""}${r.isEmpty ? " empty-row" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(r); }}
            >
              <span className="ss-label">{r.label}</span>
              {r.hint && <span className="ss-hint">{r.hint}</span>}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
