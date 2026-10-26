import { useState } from "react";
import { STAGE_GROUPS, stageGroupOf, currentStage, LIVE_STAGES } from "../lib/adoption";
import { PITCH_STATUSES, PITCH_OPEN_STATUSES } from "../lib/pitch";
import { useChartTooltip } from "../lib/useChartTooltip";
import { TipCard } from "./ChartTooltip";
import InfoTip from "./InfoTip";

// My Portfolio analytics (decision Oct 26 2026: "detailed, and hover gives more and more detail"). Everything is
// computed from the same per-lab scores the lab Adoption tabs use, for the labs in view (My Labs / Team View):
//   • KPI row — average adoption, labs at 85%+, parameters adopted, items in Live, add-ons open to pitch, purchased.
//   • Labs by adoption — how many labs sit in each score band; hover lists the labs and their scores.
//   • Pitch pipeline — Not-in-plan add-ons by Expansion stage; hover lists lab · feature.
//   • Adoption by module — each module's parameters (across these labs) split by stage, weakest module first; hover a
//     segment for the stage count, share and which labs; hover the module name for its best / worst labs.
// Colours: the In-plan stages are one blue ramp (light → dark), Expansion orange, closed grey (see STAGE_GROUPS).
const LIST_MAX = 8;
const BANDS = [
  { key: "b1", label: "Below 30%", min: -Infinity, max: 30, color: "var(--stg-plan-1)" },
  { key: "b2", label: "30–69%", min: 30, max: 70, color: "var(--stg-plan-2)" },
  { key: "b3", label: "70–84%", min: 70, max: 85, color: "var(--stg-plan-3)" },
  { key: "b4", label: "85–100%", min: 85, max: Infinity, color: "var(--stg-plan-5)" },
];
const PITCH_COLOR = {
  "To-Do": "var(--stg-exp-1)", Pitching: "var(--stg-exp-2)", Trial: "var(--stg-exp-3)", Purchased: "var(--stg-plan-3)",
};
const pctTxt = (v) => (v == null ? "—" : `${Math.round(v)}%`);

export default function PortfolioCharts({ labs, scoresByLab }) {
  const tip = useChartTooltip();
  const [showTable, setShowTable] = useState(false);

  const labScores = labs.map((lab) => ({ lab, score: scoresByLab[lab.id].overallPct, mand: scoresByLab[lab.id].mandatoryPct }));
  const allParams = labs.flatMap((lab) => scoresByLab[lab.id].moduleResults.flatMap((m) => m.params.map((r) => ({ r, lab, mod: m.mod }))));

  // ---- KPIs ----
  const avg = labScores.length ? labScores.reduce((s, x) => s + x.score, 0) / labScores.length : null;
  const top = labScores.filter((x) => x.score >= 85);
  const onPlan = allParams.filter(({ r }) => (r.inPlan || r.purchased) && stageGroupOf(r) !== "closed");
  const adopted = onPlan.filter(({ r }) => r.status === "Adopted");
  const live = onPlan.filter(({ r }) => LIVE_STAGES.includes(r.status));
  const toPitch = allParams.filter(({ r }) => !r.inPlan && !r.purchased && !r.lost && PITCH_OPEN_STATUSES.includes(r.pitch));
  // Bought = purchased and not lost — counted the same way as the pipeline's "Purchased" bar.
  const bought = allParams.filter(({ r }) => !r.inPlan && !r.lost && (r.purchased || r.pitch === "Purchased"));
  const listOf = (items, fmt) => items.slice(0, LIST_MAX).map(fmt);
  const kpis = [
    { label: "Avg adoption", value: pctTxt(avg), tipBody: <TipCard title="Average adoption" rows={[["Labs", labScores.length], ["Highest", labScores.length ? pctTxt(Math.max(...labScores.map((x) => x.score))) : "—"], ["Lowest", labScores.length ? pctTxt(Math.min(...labScores.map((x) => x.score))) : "—"]]} /> },
    { label: "Labs at 85%+", value: `${top.length} / ${labScores.length}`, tipBody: <TipCard title="Labs at 85% or more" rows={[["Labs", top.length]]} listTitle="Labs" list={listOf([...top].sort((a, b) => b.score - a.score), (x) => `${x.lab.name} — ${pctTxt(x.score)}`)} more={top.length - LIST_MAX} /> },
    { label: "Parameters adopted", value: `${adopted.length} / ${onPlan.length}`, tipBody: <TipCard title="Adopted (In plan + purchased)" rows={[["Adopted", adopted.length], ["On the In-plan list", onPlan.length], ["Share", onPlan.length ? `${Math.round((adopted.length / onPlan.length) * 100)}%` : "—"]]} /> },
    { label: "In Live", value: live.length, tipBody: <TipCard title="In Live 1–4" rows={LIVE_STAGES.map((st) => [st, live.filter(({ r }) => r.status === st).length])} listTitle="Items" list={listOf(live, ({ r, lab }) => `${lab.name} · ${r.def.name} (${r.status})`)} more={live.length - LIST_MAX} /> },
    { label: "Add-ons to pitch", value: toPitch.length, tipBody: <TipCard title="Not in plan, still open" rows={PITCH_OPEN_STATUSES.map((st) => [st, toPitch.filter(({ r }) => r.pitch === st).length])} listTitle="Labs with the most" list={listOf(topLabs(toPitch), ([name, n]) => `${name} — ${n}`)} /> },
    { label: "Purchased add-ons", value: bought.length, tipBody: <TipCard title="Purchased add-ons" rows={[["Purchased", bought.length], ["Of which Adopted", bought.filter(({ r }) => r.status === "Adopted").length]]} listTitle="Items" list={listOf(bought, ({ r, lab }) => `${lab.name} · ${r.def.name} (${r.status})`)} more={bought.length - LIST_MAX} /> },
  ];

  // ---- labs by adoption band ----
  const bands = BANDS.map((b) => ({ ...b, labs: labScores.filter((x) => x.score >= b.min && x.score < b.max).sort((a, c) => a.score - c.score) }));
  const bandMax = Math.max(1, ...bands.map((b) => b.labs.length));

  // ---- pitch pipeline ----
  const pipeline = PITCH_STATUSES.map((st) => {
    const items = allParams.filter(({ r }) => !r.inPlan && r.pitch === st);
    return { st, items, color: PITCH_COLOR[st] || "var(--stg-closed)" };
  });
  const pipeMax = Math.max(1, ...pipeline.map((p) => p.items.length));

  // ---- adoption by module ----
  const modules = [];
  labs.forEach((lab) => scoresByLab[lab.id].moduleResults.forEach((m) => {
    let row = modules.find((x) => x.key === m.mod.key);
    if (!row) { row = { key: m.mod.key, name: m.mod.name, items: [], labScores: [] }; modules.push(row); }
    m.params.forEach((r) => row.items.push({ r, lab }));
    if (m.overallPct != null) row.labScores.push({ lab, score: m.overallPct });
  }));
  modules.forEach((m) => {
    m.avg = m.labScores.length ? m.labScores.reduce((s, x) => s + x.score, 0) / m.labScores.length : null;
    m.segs = STAGE_GROUPS.map((g) => {
      const items = m.items.filter(({ r }) => stageGroupOf(r) === g.key);
      return { ...g, items, share: m.items.length ? items.length / m.items.length : 0 };
    });
  });
  const modRows = modules.filter((m) => m.items.length).sort((a, b) => (a.avg ?? 0) - (b.avg ?? 0));

  function segTip(m, s) {
    const exact = {};
    s.items.forEach(({ r }) => { const st = currentStage(r); exact[st] = (exact[st] || 0) + 1; });
    return (
      <TipCard color={s.color} title={`${m.name} · ${s.label}`}
        rows={[["Parameters", `${s.items.length} of ${m.items.length}`], ["Share of module", `${Math.round(s.share * 100)}%`],
          ...(Object.keys(exact).length > 1 ? Object.entries(exact).map(([st, n]) => [`· ${st}`, n]) : [])]}
        listTitle="Labs" list={topLabs(s.items).slice(0, LIST_MAX).map(([name, n]) => `${name} — ${n}`)} more={topLabs(s.items).length - LIST_MAX} />
    );
  }
  function modTip(m) {
    const sorted = [...m.labScores].sort((a, b) => b.score - a.score);
    return (
      <TipCard title={m.name}
        rows={[["Average adoption", pctTxt(m.avg)], ["Labs", m.labScores.length], ["Parameters (all labs)", m.items.length],
          ["Adopted", m.segs.find((s) => s.key === "adopted").items.length], ["In Live", m.segs.find((s) => s.key === "live").items.length]]}
        listTitle="Labs, best first" list={sorted.slice(0, LIST_MAX).map((x) => `${x.lab.name} — ${pctTxt(x.score)}`)} more={sorted.length - LIST_MAX} />
    );
  }

  return (
    <div className="pf-charts">
      <div className="pf-kpis">
        {kpis.map((k) => (
          <div key={k.label} className="stile pf-kpi" {...tip.bind(k.tipBody)}>
            <div className="sval">{k.value}</div><div className="slabel">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="pf-grid">
        <div className="table-card pf-card">
          <div className="pf-card-title">Labs by adoption <InfoTip>How many of these labs fall in each adoption-score band. Hover a bar for the labs and their scores.</InfoTip></div>
          <div className="pf-cols">
            {bands.map((b) => (
              <div key={b.key} className="pf-col" {...tip.bind(
                <TipCard color={b.color} title={`Adoption ${b.label}`} rows={[["Labs", `${b.labs.length} of ${labScores.length}`]]}
                  listTitle="Labs, lowest first" list={b.labs.slice(0, LIST_MAX).map((x) => `${x.lab.name} — ${pctTxt(x.score)} (mandatory ${pctTxt(x.mand)})`)} more={b.labs.length - LIST_MAX} />,
              )}>
                <div className="pf-col-val">{b.labs.length}</div>
                <div className="pf-col-track">{b.labs.length > 0 && <div className="pf-col-bar" style={{ height: `${(b.labs.length / bandMax) * 100}%`, background: b.color }} />}</div>
                <div className="pf-col-label">{b.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="table-card pf-card">
          <div className="pf-card-title">Pitch pipeline <InfoTip>Not-in-plan add-ons across these labs by Expansion stage. Hover a bar for the labs and features.</InfoTip></div>
          {pipeline.map((p) => (
            <div key={p.st} className="pf-hbar" {...tip.bind(
              <TipCard color={p.color} title={p.st} rows={[["Add-ons", p.items.length], ["Labs", new Set(p.items.map(({ lab }) => lab.id)).size]]}
                listTitle="Lab · feature" list={p.items.slice(0, LIST_MAX).map(({ r, lab }) => `${lab.name} · ${r.def.name}`)} more={p.items.length - LIST_MAX} />,
            )}>
              <span className="pf-hbar-label">{p.st}</span>
              <div className="pf-hbar-track"><div style={{ width: `${(p.items.length / pipeMax) * 100}%`, background: p.color }} /></div>
              <b className="pf-hbar-val">{p.items.length}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="table-card pf-card" style={{ marginTop: 14 }}>
        <div className="pf-card-title" style={{ justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center" }}>
            Adoption by module <span className="pie-sub">&nbsp;· weakest first</span>
            <InfoTip>Each bar splits the module's parameters across all these labs by stage; the number on the right is the module's average adoption score. Hover a segment for the stage and the labs in it, or the module name for its best and worst labs.</InfoTip>
          </span>
          <button type="button" className="mark-purchased" onClick={() => setShowTable((t) => !t)}>{showTable ? "Show chart" : "Show table"}</button>
        </div>
        <div className="modseg-legend">
          {STAGE_GROUPS.map((b) => <span key={b.key}><i style={{ background: b.color }} />{b.label}</span>)}
        </div>
        {!modRows.length ? <div style={{ color: "var(--text-faint)", fontSize: 12, padding: "8px 0" }}>No data yet.</div> : showTable ? (
          <div className="table-scroll"><table className="child-mini">
            <thead><tr><th>Module</th><th>Avg adoption</th>{STAGE_GROUPS.map((g) => <th key={g.key}>{g.label}</th>)}<th>Total</th></tr></thead>
            <tbody>{modRows.map((m) => (
              <tr key={m.key}><td>{m.name}</td><td><b>{pctTxt(m.avg)}</b></td>{m.segs.map((s) => <td key={s.key}>{s.items.length}</td>)}<td>{m.items.length}</td></tr>
            ))}</tbody>
          </table></div>
        ) : modRows.map((m) => (
          <div key={m.key} className="modseg-row">
            <span className="modseg-label" {...tip.bind(modTip(m))}>{m.name}</span>
            <div className="modseg-bar">
              {m.segs.map((s) => s.share > 0 && (
                <div key={s.key} style={{ width: `${s.share * 100}%`, background: s.color, color: s.ink }} {...tip.bind(segTip(m, s))}>
                  {s.share >= 0.12 ? `${Math.round(s.share * 100)}%` : ""}
                </div>
              ))}
            </div>
            <b className="modseg-val">{pctTxt(m.avg)}</b>
          </div>
        ))}
      </div>
      {tip.tooltip}
    </div>
  );

  // Lab name → how many of `items` belong to it, most first.
  function topLabs(items) {
    const n = {};
    items.forEach(({ lab }) => { n[lab.name] = (n[lab.name] || 0) + 1; });
    return Object.entries(n).sort((a, b) => b[1] - a[1]);
  }
}
