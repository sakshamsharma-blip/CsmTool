// Tiny inline-SVG horizontal bar chart, reused by Dashboard and My Portfolio. One series, direct-
// labeled (category name + value on every bar) so no legend box is needed; thin rounded bars, a faint
// track so short bars are still visible against the max.
export default function BarChart({ data, width = 480, barHeight = 18, gap = 10, labelWidth = 130, valueFmt = (v) => String(v) }) {
  const plotW = width - labelWidth - 50;
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <div style={{ color: "var(--text-faint)", fontSize: 12, padding: "8px 0" }}>No data yet.</div>;
  const totalH = data.length * (barHeight + gap) - gap;
  return (
    <svg viewBox={`0 0 ${width} ${totalH}`} width="100%" height={totalH} style={{ overflow: "visible", display: "block" }}>
      {data.map((d, i) => {
        const y = i * (barHeight + gap);
        const bw = Math.max(3, (d.value / max) * plotW);
        return (
          <g key={d.label}>
            <text x={labelWidth - 8} y={y + barHeight * 0.72} textAnchor="end" fontSize="11" fill="var(--text-dim)">{d.label}</text>
            <rect x={labelWidth} y={y} width={plotW} height={barHeight} rx="4" fill="var(--border)" opacity="0.45" />
            <rect x={labelWidth} y={y} width={bw} height={barHeight} rx="4" fill={d.color || "var(--accent)"}>
              <title>{d.label}: {valueFmt(d.value)}</title>
            </rect>
            <text x={labelWidth + bw + 8} y={y + barHeight * 0.72} fontSize="11" fontWeight="700" fill="var(--text)">{valueFmt(d.value)}</text>
          </g>
        );
      })}
    </svg>
  );
}
