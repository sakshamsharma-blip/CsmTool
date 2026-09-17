// Horizontal "stat breakdown" bar list — reused by Dashboard (Adoption Health, Lab Health,
// Collections Aging) and My Portfolio (Pitch Pipeline, Avg Adoption by Module). Plain DOM markup
// instead of hand-drawn SVG: real text renders sharper at every zoom level than SVG <text>, and a
// colored dot bullet next to the label stays clearly visible even when a bar's value is 0 (the old
// SVG version only had a near-invisible 3px sliver of color to go on). The value is always in the
// same right-aligned column regardless of bar length, so it never crowds a short/empty bar.
//
// `maxValue` lets a caller fix the scale (e.g. 100 for a %) instead of the default "relative to the
// largest value in this dataset" — without it, percentages would scale confusingly relative to each
// other rather than to the true 0–100 range.
export default function BarChart({ data, barHeight = 24, gap = 12, labelWidth = 130, valueWidth = 40, valueFmt = (v) => String(v), maxValue }) {
  if (!data.length) return <div style={{ color: "var(--text-faint)", fontSize: 12, padding: "8px 0" }}>No data yet.</div>;
  const max = maxValue || Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      {data.map((d, i) => {
        const pct = Math.min(100, (d.value / max) * 100);
        const fillPct = d.value > 0 ? Math.max(pct, 3) : 0; // a real (if small) value should always show a sliver of fill, not nothing
        return (
          <div
            key={d.label}
            style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: i === data.length - 1 ? 0 : gap }}
            title={`${d.label}: ${valueFmt(d.value)}`}
          >
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: d.color || "var(--accent)", flex: "none" }} />
            <span style={{
              width: labelWidth, flex: "none", fontSize: 12.5, color: "var(--text-dim)", fontWeight: 500,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {d.label}
            </span>
            <div style={{ flex: 1, height: barHeight, borderRadius: 20, background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${fillPct}%`, minWidth: fillPct > 0 ? 4 : 0, borderRadius: 20,
                background: d.color || "var(--accent)", transition: "width .25s ease",
              }} />
            </div>
            <span style={{
              width: valueWidth, flex: "none", textAlign: "right", fontSize: 13.5, fontWeight: 700,
              color: "var(--text)", fontVariantNumeric: "tabular-nums",
            }}>
              {valueFmt(d.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
