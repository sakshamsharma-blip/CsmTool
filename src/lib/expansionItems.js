import { resolveParam } from "./adoption";
import { expansionRows } from "./expansion";
import { toLocalISODate } from "./dates";

// The list on Expansion → Deals & Purchases: every feature under way or decided (type Feature, from each lab's Adoption tab) and
// every deal added on the page (type Manual). A feature still being pitched has no purchase record, so it's added here from its
// stage; it brings no revenue until bought. To-Do, Not Required and Not Applicable features aren't expansions yet, so they stay out.
const PITCH_LIST_STATUS = { Pitching: "Pipeline", Trial: "Onboarding", Purchased: "Live", "Lost in Expansion": "Lost", "Lost after Purchase": "Lost" };
const keyOf = (labId, moduleKey, paramName) => `${labId}|${moduleKey}|${paramName}`;

export function buildExpansionItems({ opps, purchases, labs, modules, plans, adoptionByLab, pitchByLab, details }) {
  const rows = expansionRows(opps, purchases, (ts) => toLocalISODate(new Date(ts)));
  const resolved = {};
  const pitched = [];
  labs.forEach((lab) => {
    const plan = plans.find((p) => p.id === lab.plan) || plans[0];
    modules.forEach((mod) => mod.params.forEach((def) => {
      const r = resolveParam(plan, mod, def, adoptionByLab[lab.id], pitchByLab[lab.id]);
      if (r.inPlan || !PITCH_LIST_STATUS[r.pitch]) return;
      const key = keyOf(lab.id, mod.key, def.name);
      resolved[key] = { r, mod, lab };
      pitched.push({ key, lab, mod, r });
    }));
  });
  const bought = new Set(rows.filter((x) => x.kind === "Feature").map((x) => keyOf(x.labId, x.moduleKey, x.paramName)));
  const fromStage = pitched.filter((p) => !bought.has(p.key)).map(({ key, lab, mod, r }) => ({
    id: `pitch-${key}`, kind: "Feature", labId: lab.id, title: r.def.name, moduleKey: mod.key, paramName: r.def.name,
    monthly: 0, annual: 0, status: PITCH_LIST_STATUS[r.pitch], isTrial: false, startedOn: null, expectedLive: null, note: "", liveFrom: null, liveUntil: null,
  }));
  return [...rows, ...fromStage].map((row) => {
    if (row.kind !== "Feature") return row;
    const key = keyOf(row.labId, row.moduleKey, row.paramName);
    const d = details[key];
    return { ...row, item: resolved[key] || null, stage: resolved[key]?.r.pitch || null, expectedLive: d?.expectedLive || null, description: d?.description || "" };
  });
}
