import { useEffect, useMemo, useState } from "react";
import { fetchLabAdoption, computeLabScores, groupScores, tagScoresWithLab, fmtScore } from "../lib/adoption";
import { fetchLabPitchStatus } from "../lib/pitch";
import AdoptionPies from "./AdoptionPies";
import InfoTip from "./InfoTip";
import { Heat } from "./Analytics";

// A parent lab's "Lab Overall Adoption" tab (decision Nov 2 2026): the same four scores and pies as a lab's Adoption tab, for the
// parent and its child labs together. Each score is the simple average across the labs (groupScores); the slices count
// every lab's parameters. The parent's own data stays on its Adoption tab. RLS applies: someone who can't see a child lab
// isn't shown it, and it isn't in their average.
export default function LabOverallAdoptionTab({ lab, childLabs, modules, plans, onOpenLab }) {
  const [perLab, setPerLab] = useState(null);
  const [error, setError] = useState("");
  const members = useMemo(() => [lab, ...childLabs], [lab, childLabs]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(members.map(async (l) => {
      const [adoption, pitch] = await Promise.all([fetchLabAdoption(l.id), fetchLabPitchStatus(l.id)]);
      const plan = plans.find((p) => p.id === l.plan) || plans[0];
      return { lab: l, scores: tagScoresWithLab(computeLabScores(modules, plan, adoption, pitch), l) };
    }))
      .then((rows) => { if (!cancelled) setPerLab(rows); })
      .catch((err) => { if (!cancelled) setError(err.message || "Couldn't load adoption."); });
    return () => { cancelled = true; };
  }, [members, modules, plans]);

  if (error) return <div className="error-banner">Couldn't load adoption — {error}</div>;
  if (!perLab) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading…</div>;

  const scores = groupScores(perLab.map((r) => r.scores));
  return (
    <div>
      <div className="adopt-score-head">
        <span>
          Overall <b>{fmtScore(scores.overallPct)}</b> · Adoption pipeline <b>{fmtScore(scores.adoptionPct)}</b>
          {" "}· Expansion pipeline <b>{fmtScore(scores.expansionPct)}</b> · Mandatory <b>{fmtScore(scores.mandatoryPct)}</b>
        </span>
        <InfoTip>Each score is the simple average of that score across {lab.name} and its child labs. A lab with nothing counted in a score is left out of that average.</InfoTip>
      </div>
      <AdoptionPies scores={scores} foot={`Averages across ${perLab.length} lab${perLab.length === 1 ? "" : "s"}. Slices count the parameters of all of them at each stage; the centre is the average of each lab's score. Hover a slice for the stages, parameters and labs.`} />
      {!childLabs.length && <div className="adopt-note" style={{ margin: "0 0 12px" }}>{lab.name} has no child labs yet, so these are its own scores.</div>}

      <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>By lab</h3>
      <div className="table-card"><div className="table-scroll"><table className="child-mini an-table">
        <thead><tr><th>Lab</th><th>Hierarchy</th><th>CSM</th><th className="c">Overall</th><th className="c">Adoption pipeline</th><th className="c">Expansion pipeline</th><th className="c">Mandatory</th></tr></thead>
        <tbody>
          {perLab.map(({ lab: l, scores: s }) => (
            <tr key={l.id}>
              <td className="lab-name clickable" onClick={() => onOpenLab(l.id, "adoption")}>{l.name}</td><td>{l.type}</td><td>{l.csm || "—"}</td>
              <td className="c"><Heat value={s.overallPct} /></td><td className="c"><Heat value={s.adoptionPct} /></td><td className="c"><Heat value={s.expansionPct} /></td><td className="c"><Heat value={s.mandatoryPct} /></td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700 }}>
            <td colSpan={3}>Average</td>
            <td className="c"><Heat value={scores.overallPct} /></td><td className="c"><Heat value={scores.adoptionPct} /></td><td className="c"><Heat value={scores.expansionPct} /></td><td className="c"><Heat value={scores.mandatoryPct} /></td>
          </tr>
        </tbody>
      </table></div></div>

      <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>By module</h3>
      <div className="table-card"><div className="table-scroll"><table className="child-mini an-table">
        <thead><tr><th>Module</th><th className="c">Overall</th><th className="c">Adoption pipeline</th><th className="c">Expansion pipeline</th><th className="c">Mandatory</th></tr></thead>
        <tbody>{scores.moduleResults.map((m) => (
          <tr key={m.mod.key}><td>{m.mod.name}</td><td className="c"><Heat value={m.overallPct} /></td><td className="c"><Heat value={m.adoptionPct} /></td><td className="c"><Heat value={m.expansionPct} /></td><td className="c"><Heat value={m.mandPct} /></td></tr>
        ))}</tbody>
      </table></div></div>
    </div>
  );
}
