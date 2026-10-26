import { useState } from "react";
import { createPortal } from "react-dom";

// Hover details for charts. `useChartTooltip()` returns `bind(content)` — spread it on any SVG/HTML mark — and the
// `tooltip` element to render once. The card follows the pointer in a fixed layer on <body> (never clipped by a
// card), flips left/up near the screen edge, and also shows on keyboard focus. Tooltips add detail; every value is
// also visible in a legend or table.
export function useChartTooltip() {
  const [tip, setTip] = useState(null); // { x, y, content }
  const place = (x, y, content) => setTip({ x, y, content });
  function bind(content) {
    return {
      onMouseEnter: (e) => place(e.clientX, e.clientY, content),
      onMouseMove: (e) => place(e.clientX, e.clientY, content),
      onMouseLeave: () => setTip(null),
      onFocus: (e) => { const r = e.currentTarget.getBoundingClientRect(); place(r.right, r.top + r.height / 2, content); },
      onBlur: () => setTip(null),
      tabIndex: 0,
    };
  }
  const tooltip = tip && createPortal(
    <div className="chart-tip" role="tooltip"
      style={{
        left: tip.x > window.innerWidth - 300 ? undefined : tip.x + 14,
        right: tip.x > window.innerWidth - 300 ? window.innerWidth - tip.x + 14 : undefined,
        top: tip.y > window.innerHeight - 260 ? undefined : tip.y + 14,
        bottom: tip.y > window.innerHeight - 260 ? window.innerHeight - tip.y + 14 : undefined,
      }}>
      {tip.content}
    </div>,
    document.body,
  );
  return { bind, tooltip, hovered: tip ? tip.content : null };
}
