import { fmtScore } from "../lib/adoption";

// The two pipeline scores side by side (decision Oct 30 2026 — every screen that measures performance shows both):
// "Adoption 40% · Expansion 100%". "—" = nothing counted in that pipeline.
export default function PipelineScores({ adoption, expansion }) {
  return (
    <span className="pipe-scores">
      <span title="Adoption pipeline — In plan + purchased add-ons"><i style={{ background: "var(--stg-plan-2)" }} />Adoption <b>{fmtScore(adoption)}</b></span>
      <span title="Expansion pipeline — Not-in-plan add-ons (Purchased = 100)"><i style={{ background: "var(--stg-exp-2)" }} />Expansion <b>{fmtScore(expansion)}</b></span>
    </span>
  );
}
