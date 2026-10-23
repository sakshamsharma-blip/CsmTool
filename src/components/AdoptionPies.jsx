import { groupAdoption } from "../lib/adoption";

// Adoption split four ways (In plan, Not in plan, Mandatory, Optional), shown as two pies: In plan vs Not in plan,
// and Mandatory vs Optional. A slice's SIZE is how many parameters fall in that group; its legend row gives the
// group's adoption % (same weighting as the lab score — see groupAdoption) and the count.
const COLORS = ["var(--accent)", "var(--purple-text)"];

function Pie({ title, groups }) {
  const total = groups.reduce((s, g) => s + g.count, 0);
  const R = 40, C = 50;
  const slices = groups.map((g, i) => {
    const frac = total ? g.count / total : 0;
    const start = groups.slice(0, i).reduce((sum, x) => sum + (total ? x.count / total : 0), 0) * 360;
    return { ...g, frac, start, end: start + frac * 360, color: COLORS[i] };
  });
  const pt = (deg) => [C + R * Math.sin((deg * Math.PI) / 180), C - R * Math.cos((deg * Math.PI) / 180)];
  return (
    <div className="pie-card">
      <div className="pie-title">{title}</div>
      <div className="pie-body">
        <svg viewBox="0 0 100 100" width="92" height="92" role="img" aria-label={title}>
          {!total && <circle cx={C} cy={C} r={R} fill="var(--surface-3)" />}
          {slices.map((s) => {
            if (!s.frac) return null;
            if (s.frac >= 0.9999) return <circle key={s.label} cx={C} cy={C} r={R} fill={s.color} />;
            const [x1, y1] = pt(s.start), [x2, y2] = pt(s.end);
            return <path key={s.label} d={`M${C},${C} L${x1},${y1} A${R},${R} 0 ${s.end - s.start > 180 ? 1 : 0} 1 ${x2},${y2} Z`} fill={s.color} stroke="var(--surface)" strokeWidth="1.5" />;
          })}
        </svg>
        <div className="pie-legend">
          {slices.map((s) => (
            <div key={s.label} className="pie-leg-row">
              <span className="pie-dot" style={{ background: s.color }} />
              <span className="pie-leg-label">{s.label}</span>
              <b>{s.pct == null ? "—" : `${Math.round(s.pct)}%`}</b>
              <span className="pie-leg-count">{s.count} param{s.count === 1 ? "" : "s"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AdoptionPies({ moduleResults }) {
  const g = (label, pred) => ({ label, ...groupAdoption(moduleResults, pred) });
  // A purchased add-on is on the In-plan track (adoption model v2 — r.category is "Adoption" for it).
  return (
    <>
      <Pie title="In plan vs Not in plan" groups={[g("In-Plan Adoption", (r) => r.category === "Adoption"), g("Not-in-Plan Adoption", (r) => r.category !== "Adoption")]} />
      <Pie title="Mandatory vs Optional" groups={[g("Mandatory Adoption", (r) => r.def.type === "M"), g("Optional Adoption", (r) => r.def.type !== "M")]} />
    </>
  );
}
