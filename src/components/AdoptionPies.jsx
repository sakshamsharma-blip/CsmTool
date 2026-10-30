import { useState } from "react";
import {
  STAGE_GROUPS, EXPANSION_GROUPS, stageGroupOf, expansionGroupOf, currentStage, STATUS_ORDER,
} from "../lib/adoption";
import { PITCH_STATUSES } from "../lib/pitch";
import { useChartTooltip } from "../lib/useChartTooltip";
import { TipCard } from "./ChartTooltip";

// A lab's adoption analytics as four pies (decision Oct 26 2026): Overall, Mandatory, In plan, Not in plan.
//   • Slice size = how many of that group's parameters sit at each stage. In-plan stages run pale blue (To-Do) →
//     indigo → teal → light green (Live) → dark green (Adopted); Not-in-plan add-ons coral / orange; closed grey.
//   • Centre = that group's SCORE from computeLabScores: Overall (average of the two pipelines), Mandatory, Adoption
//     pipeline, Expansion pipeline — which is why it can differ from the share of the "Adopted" slice.
//   • Slices of 8%+ carry their % on the slice; the legend lists every stage (same order and colour in all four
//     pies) with count and share; hovering a slice or legend row shows the exact stages and which parameters.
//   • "Show details" = a table of every exact stage × group count.
const GROUPS = [
  { key: "overall", title: "Overall", score: "overallPct", pred: () => true, slices: STAGE_GROUPS, groupOf: stageGroupOf },
  { key: "mandatory", title: "Mandatory", score: "mandatoryPct", pred: (r) => r.def.type === "M", slices: STAGE_GROUPS, groupOf: stageGroupOf },
  // Adoption pipeline = In plan + purchased add-ons (r.category is "Adoption" for both).
  { key: "inplan", title: "Adoption pipeline", score: "adoptionPct", pred: (r) => r.category === "Adoption", slices: STAGE_GROUPS.filter((g) => g.key !== "notinplan"), groupOf: stageGroupOf },
  // Expansion pipeline = every Not-in-plan parameter, purchased ones included (they scored 100 here).
  { key: "notinplan", title: "Expansion pipeline", score: "expansionPct", pred: (r) => !r.inPlan, slices: EXPANSION_GROUPS, groupOf: expansionGroupOf },
];
const LIST_MAX = 8;

function Pie({ group, params, pct, modName, tip }) {
  const [hot, setHot] = useState(null);
  const total = params.length;
  const slices = group.slices.map((g) => {
    const items = params.filter((r) => group.groupOf(r) === g.key);
    return { ...g, items, count: items.length, share: total ? items.length / total : 0 };
  });
  const C = 80, R = 72, IR = 44;
  const pt = (deg, r) => [C + r * Math.sin((deg * Math.PI) / 180), C - r * Math.cos((deg * Math.PI) / 180)];
  const arcs = slices.map((s, i) => {
    const start = slices.slice(0, i).reduce((a, x) => a + x.share, 0) * 360;
    return { ...s, start, end: start + s.share * 360 };
  });
  function wedge(a) {
    const big = a.end - a.start > 180 ? 1 : 0;
    const [x1, y1] = pt(a.start, R), [x2, y2] = pt(a.end, R), [x3, y3] = pt(a.end, IR), [x4, y4] = pt(a.start, IR);
    return `M${x1},${y1} A${R},${R} 0 ${big} 1 ${x2},${y2} L${x3},${y3} A${IR},${IR} 0 ${big} 0 ${x4},${y4} Z`;
  }
  function tipFor(s) {
    const exact = {};
    s.items.forEach((r) => { const st = group.key === "notinplan" ? r.pitch : currentStage(r); exact[st] = (exact[st] || 0) + 1; });
    const rows = [
      ["Parameters", `${s.count} of ${total}`],
      ["Share of " + group.title.toLowerCase(), `${Math.round(s.share * 100)}%`],
      ...Object.entries(exact).filter(() => Object.keys(exact).length > 1).map(([st, n]) => [`· ${st}`, n]),
    ];
    const list = s.items.slice(0, LIST_MAX).map((r) => `${r.def.name} — ${modName(r)}${r.def.type === "M" ? " · M" : ""}`);
    return <TipCard color={s.color} title={`${group.title} · ${s.label}`} rows={rows} listTitle={s.count ? "Parameters" : null} list={list} more={s.count - LIST_MAX} />;
  }
  const hotKey = hot;
  // Slice + legend row share these: highlight that stage and show its hover card.
  const hover = (sl) => {
    const b = tip.bind(tipFor(sl));
    return {
      ...b,
      onMouseEnter: (e) => { setHot(sl.key); b.onMouseEnter(e); },
      onMouseLeave: () => { setHot(null); b.onMouseLeave(); },
      onFocus: (e) => { setHot(sl.key); b.onFocus(e); },
      onBlur: () => { setHot(null); b.onBlur(); },
    };
  };
  return (
    <div className="pie-card">
      <div className="pie-title">{group.title} <span className="pie-sub">· {total} parameter{total === 1 ? "" : "s"}</span></div>
      <div className="pie-body">
        <svg viewBox="0 0 160 160" width="150" height="150" role="img" aria-label={`${group.title}: adoption ${pct == null ? "not scored" : Math.round(pct) + "%"}; ${slices.filter((s) => s.count).map((s) => `${s.label} ${s.count}`).join(", ")}`} style={{ flex: "none", overflow: "visible" }}>
          {!total && <circle cx={C} cy={C} r={(R + IR) / 2} fill="none" stroke="var(--surface-3)" strokeWidth={R - IR} />}
          {arcs.map((a) => a.count > 0 && (a.share >= 0.9999
            // A single stage = a whole ring (no seam).
            ? <circle key={a.key} cx={C} cy={C} r={(R + IR) / 2} fill="none" stroke={a.color} strokeWidth={R - IR}
              style={{ cursor: "pointer", outline: "none" }} {...hover(a)} />
            : <path key={a.key} d={wedge(a)} fill={a.color} stroke="var(--surface)" strokeWidth="2" strokeLinejoin="round"
              style={{ opacity: hotKey && hotKey !== a.key ? 0.35 : 1, transition: "opacity .12s", cursor: "pointer", outline: "none" }}
              {...hover(a)} />
          ))}
          {arcs.map((a) => {
            if (a.share < 0.08) return null;
            const [x, y] = pt((a.start + a.end) / 2, (R + IR) / 2);
            return <text key={`l-${a.key}`} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="700" fill={a.ink} style={{ pointerEvents: "none", opacity: hotKey && hotKey !== a.key ? 0.35 : 1 }}>{Math.round(a.share * 100)}%</text>;
          })}
          <text x={C} y={C - 5} textAnchor="middle" dominantBaseline="central" fontSize="22" fontWeight="700" fill="var(--text)">{pct == null ? "—" : `${Math.round(pct)}%`}</text>
          <text x={C} y={C + 15} textAnchor="middle" dominantBaseline="central" fontSize="9.5" fill="var(--text-dim)">adoption score</text>
        </svg>
        <div className="pie-legend">
          {slices.map((s) => (
            <div key={s.key} className={`pie-leg-row${s.count ? "" : " zero"}${hotKey === s.key ? " hot" : ""}`}
              {...(s.count ? hover(s) : {})}>
              <span className="pie-dot" style={{ background: s.color }} />
              <span className="pie-leg-label">{s.label}</span>
              <b>{s.count}</b>
              <span className="pie-leg-count">{total ? `${Math.round(s.share * 100)}%` : ""}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AdoptionPies({ scores }) {
  const { moduleResults } = scores;
  const [details, setDetails] = useState(false);
  const tip = useChartTooltip();
  const all = moduleResults.flatMap((m) => m.params);
  const modByKey = {};
  moduleResults.forEach((m) => m.params.forEach((r) => { modByKey[r.key] = m.mod.name; }));
  const modName = (r) => modByKey[r.key] || "";
  const groups = GROUPS.map((g) => ({ ...g, params: all.filter(g.pred), pct: scores[g.score] }));
  // Every exact stage that occurs, In-plan list first, then the Expansion stages.
  const stages = [...STATUS_ORDER, ...PITCH_STATUSES.map((s) => `exp:${s}`)];
  // The Expansion-pipeline column counts by Expansion stage (a purchased add-on = "Purchased"); the others by the
  // stage the parameter is at now.
  const stageOf = (r, g) => (g.key === "notinplan" ? `exp:${r.pitch}`
    : (r.inPlan || r.purchased) && !r.lost ? currentStage(r) : `exp:${currentStage(r)}`);
  const rows = stages.map((st) => ({ st, counts: groups.map((g) => g.params.filter((r) => stageOf(r, g) === st).length) }))
    .filter((row) => row.counts.some(Boolean));
  return (
    <div className="adopt-pies">
      <div className="adopt-pies-grid">
        {groups.map((g) => <Pie key={g.key} group={g} params={g.params} pct={g.pct} modName={modName} tip={tip} />)}
      </div>
      <div className="pie-foot">
        Slices show how many parameters are at each stage; the centre is the weighted score (Overall = average of the Adoption and Expansion pipelines). Hover a slice for
        the exact stages and parameters.
        <button type="button" className="mark-purchased" style={{ marginLeft: 8 }} onClick={() => setDetails((d) => !d)}>
          {details ? "Hide details" : "Show details — count per stage"}
        </button>
      </div>
      {details && (
        <div className="table-card" style={{ marginTop: 8 }}>
          <div className="table-scroll"><table className="child-mini">
            <thead><tr><th>Stage</th>{groups.map((g) => <th key={g.key}>{g.title}</th>)}</tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.st}>
                  <td>{row.st.startsWith("exp:") ? <>Not in plan — {row.st.slice(4)}</> : <>In plan — {row.st}</>}</td>
                  {row.counts.map((c, i) => <td key={i}>{c || <span style={{ color: "var(--text-faint)" }}>0</span>}</td>)}
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}><td>Total parameters</td>{groups.map((g) => <td key={g.key}>{g.params.length}</td>)}</tr>
              <tr style={{ fontWeight: 700 }}><td>Score</td>{groups.map((g) => <td key={g.key}>{g.pct == null ? "—" : `${Math.round(g.pct)}%`}</td>)}</tr>
            </tbody>
          </table></div>
        </div>
      )}
      {tip.tooltip}
    </div>
  );
}
