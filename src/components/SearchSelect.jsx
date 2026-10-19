import { useEffect, useMemo, useRef, useState } from "react";

// A dropdown you can also type into — pick from the list, or start typing and it filters as you go
// (so with hundreds of labs you never scroll; "f" narrows to every lab matching "f"). Drop-in for a
// native <select>: `options` is [{ value, label, hint? }], `value` is the selected option's value, and
// `onChange` receives the new value (not an event). `hint` is secondary text that is also searchable
// (e.g. a Lab ID next to a lab name). `emptyLabel` adds a leading "clear" row for optional fields.
export default function SearchSelect({
  value, onChange, options, placeholder = "Select…", emptyLabel, disabled = false, style, className, inputStyle, autoFocus = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find((o) => o.value === value) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.hint || ""}`.toLowerCase().includes(q));
  }, [options, query]);

  // Rows shown = optional "clear" row + the filtered options.
  const rows = emptyLabel !== undefined && !query.trim()
    ? [{ value: "", label: emptyLabel, isEmpty: true }, ...filtered]
    : filtered;

  useEffect(() => {
    if (!open) return;
    function onDocDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) close();
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[active];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function openList() {
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
        onChange={(e) => { setQuery(e.target.value); setActive(0); if (!open) setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      <span className="ss-caret" aria-hidden="true">▾</span>
      {open && !disabled && (
        <div className="ss-list" ref={listRef} role="listbox">
          {rows.length === 0 ? (
            <div className="ss-empty">No match for “{query}”</div>
          ) : rows.map((r, i) => (
            <div
              key={r.isEmpty ? "__empty" : r.value}
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
        </div>
      )}
    </div>
  );
}
