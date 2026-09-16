// Tiny inline-SVG trend line — one series, no axes, with a filled endpoint on the latest value
// so a one-glance "is this going up or down" reads even at a small size.
export default function Sparkline({ points, width = 420, height = 64, color = "var(--accent)", valueFmt = (v) => String(v) }) {
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
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ overflow: "visible", display: "block" }}>
      <path d={areaPath} fill={color} opacity="0.08" />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={i === coords.length - 1 ? 3.5 : 2} fill={i === coords.length - 1 ? color : "var(--surface)"} stroke={color} strokeWidth="1.5">
          <title>{c.label}: {valueFmt(c.value)}</title>
        </circle>
      ))}
      <text x={last.x} y={last.y - 10} textAnchor="end" fontSize="11" fontWeight="700" fill={color}>{valueFmt(last.value)}</text>
    </svg>
  );
}
