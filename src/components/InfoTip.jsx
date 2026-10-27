import { useRef, useState } from "react";
import { createPortal } from "react-dom";

// Small "ⓘ" hover/focus tooltip for explainer text (module / parameter descriptions, chart notes…). The bubble is
// rendered into <body> in a fixed layer positioned next to the icon, so it is never cut off or hidden behind the next
// row by a card or list that clips its content. It opens below the icon, or above when there's no room, and long
// text scrolls inside it. Keyboard-accessible (focus the icon).
export default function InfoTip({ children, label = "More info" }) {
  const iconRef = useRef(null);
  const timer = useRef(0);
  const [pos, setPos] = useState(null);
  function show() {
    clearTimeout(timer.current);
    const el = iconRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12));
    const below = window.innerHeight - r.bottom;
    const up = below < 220 && r.top > below;
    setPos({
      left, width,
      ...(up ? { top: "auto", bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6, bottom: "auto" }),
      maxHeight: Math.max(120, (up ? r.top : below) - 18),
    });
  }
  // A short delay lets the pointer move from the icon onto the bubble (to scroll long text) without it closing.
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setPos(null), 120); };
  const keep = () => clearTimeout(timer.current);
  return (
    <span className="info-tip" onMouseEnter={show} onMouseLeave={hide}>
      <span ref={iconRef} className="info-tip-icon" tabIndex={0} aria-label={label} onFocus={show} onBlur={hide}>i</span>
      {pos && createPortal(
        <span className="info-tip-content info-tip-floating" role="tooltip" style={pos} onMouseEnter={keep} onMouseLeave={hide}>{children}</span>,
        document.body,
      )}
    </span>
  );
}
