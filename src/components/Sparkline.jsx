import { useState } from "react";

// Inline-SVG trend line — one series, no axes, with a filled endpoint on the latest value. Hovering (or tapping)
// anywhere along it shows the nearest point's date and value in a tooltip, with a guide line and highlighted dot.
export default function Sparkline({ points, width = 420, height = 64, color = "var(--accent)", valueFmt = (v) => String(v) }) {
  const [hover, setHover] = useState(null); // index of the point under the cursor
  if (!points || points.length < 2) {
    return <div style={{ color: "var(--text-faint)", fontSize: 12, padding: "10px 0" }}>Not enough history yet — one point so far.</div>;
  }
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padY = 8;
  const stepX = width / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = padY + (1 - (p.value - min) / range) * (height - padY * 2);
    return { x, y, value: p.value, label: p.label };
  });
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const areaPath = `${path} L ${coords[coords.length - 1].x.toFixed(1)} ${height} L 0 ${height} Z`;
  const last = coords[coords.length - 1];
  const active = hover != null ? coords[hover] : null;

  // Map the pointer's x position (in the SVG's own coordinate space) to the nearest point.
  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    setHover(Math.max(0, Math.min(coords.length - 1, Math.round(x / stepX))));
  }

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ overflow: "visible", display: "block", cursor: "crosshair" }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)} onTouchStart={(e) => { const t = e.touches[0]; if (t) onMove({ clientX: t.clientX, currentTarget: e.currentTarget }); }}
        role="img" aria-label="Trend"
      >
        <rect x="0" y="0" width={width} height={height} fill="transparent" />
        <path d={areaPath} fill={color} opacity="0.08" />
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {active && <line x1={active.x} x2={active.x} y1="0" y2={height} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" />}
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={i === hover ? 4.5 : i === coords.length - 1 ? 3.5 : 2}
            fill={i === hover || i === coords.length - 1 ? color : "var(--surface)"} stroke={color} strokeWidth="1.5" />
        ))}
        {!active && <text x={last.x} y={last.y - 10} textAnchor="end" fontSize="11" fontWeight="700" fill={color}>{valueFmt(last.value)}</text>}
      </svg>
      {active && (
        <div style={{
          position: "absolute", top: -6, left: `${(active.x / width) * 100}%`,
          transform: `translate(${hover === 0 ? "0" : hover === coords.length - 1 ? "-100%" : "-50%"}, -100%)`,
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 7, boxShadow: "var(--shadow-card-hover)",
          padding: "5px 9px", fontSize: 11.5, whiteSpace: "nowrap", pointerEvents: "none", zIndex: 5,
        }}>
          <div style={{ color: "var(--text-dim)" }}>{active.label}</div>
          <div style={{ fontWeight: 700, color: "var(--text)" }}>{valueFmt(active.value)}</div>
        </div>
      )}
    </div>
  );
}
