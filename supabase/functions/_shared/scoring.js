// Adoption scoring rules — ONE copy, shared by the web app (src/lib/adoption.js re-exports everything here) and the
// CSM GROWTH MCP connector (supabase/functions/csm-mcp). Pure functions only: no database, no browser, no Deno APIs.
//
// Scoring — TWO pipelines, each scored 0–100 on its own (decision Oct 30 2026):
//   • Adoption pipeline  = In-plan parameters, plus purchased add-ons (ROLLOUT_SCORE):
//       To-Do 0 · In Discussion / Demo 10 · Trial 15 · Onboarding / Setup 35 · Live 1 50 · Live 2 60 · Live 3 70 ·
//       Live 4 80 · Adopted 100 · Did Not Meet Requirements 0 · Not Required / Not Applicable left out.
//     A purchased add-on joins this pipeline at Onboarding / Setup (35) — its pitch / trial already happened.
//   • Expansion pipeline = Not-in-plan parameters (PITCH_SCORE): To-Do 0 · Pitching 10 · Trial 15 · Purchased 100
//       (the sale completes this cycle) · Lost in Expansion / Lost after Purchase 0 · Not Required / Not Applicable
//       left out. A purchased add-on is therefore counted in BOTH pipelines (100 here, its rollout there); a lost one
//       only here (0).
//   • Overall = the simple average of the two pipeline scores (just the one that has parameters, if only one does).
// Module pipeline score = weighted average of its parameters (parameter weights); lab pipeline score = weighted
// average of the modules (module weights). "Mandatory" = the same calculation using only Mandatory parameters.
// The numbers below are the single place to tune the ladders.

export const LIVE_STAGES = ["Live 1", "Live 2", "Live 3", "Live 4"];
export const STATUS_PROGRESS = ["To-Do", "In Discussion / Demo", "Trial", "Onboarding / Setup", ...LIVE_STAGES, "Adopted"];
export const STATUS_EXITS = ["Not Required", "Not Applicable", "Did Not Meet Requirements"];
export const STATUS_ORDER = [...STATUS_PROGRESS, ...STATUS_EXITS];
export const ROLLOUT_SCORE = {
  "To-Do": 0, "In Discussion / Demo": 10, Trial: 15, "Onboarding / Setup": 35,
  "Live 1": 50, "Live 2": 60, "Live 3": 70, "Live 4": 80, Adopted: 100,
  "Not Required": null, "Not Applicable": null, "Did Not Meet Requirements": 0,
};
// Where a purchased add-on starts on the In-plan list.
export const PURCHASED_START_STATUS = "Onboarding / Setup";
// In-plan statuses that mean work is under way — while an item is at one of these (or PITCH_ACTIVE_STATUSES) it has an
// open task (syncItemTask in lib/tasks.js).
export const STATUS_ACTIVE = ["In Discussion / Demo", "Trial", "Onboarding / Setup", ...LIVE_STAGES];
export const PITCH_SCORE = {
  "To-Do": 0, Pitching: 10, Trial: 15, Purchased: 100, "Not Required": null, "Not Applicable": null,
  "Lost in Expansion": 0, "Lost after Purchase": 0,
};

// Old status names (before migration 0038) → new ones, so a row saved by a stale tab still reads correctly.
const LEGACY_STATUS = { "Not Started": "To-Do", "In Progress": "Onboarding / Setup", "Partially Adopted": "Onboarding / Setup" };
// (Expansion "Onboarding / Setup" was removed Oct 26 2026 — migration 0040 moved those rows to Trial.)
export function normalizeStatus(status) {
  return LEGACY_STATUS[status] || status;
}

const EMPTY_ADOPTION = { paramState: {} };

// A param_states row → what resolveParam reads.
export function mapStateRow(r) {
  return {
    inPlan: r.in_plan == null ? null : !!r.in_plan,
    included: r.included,
    status: normalizeStatus(r.status),
    expValue: r.exp_value != null ? Number(r.exp_value) : null,
    expStage: r.exp_stage || null,
    statusChangedAt: r.status_changed_at || null,
    liveStartedAt: r.live_started_at || null,
  };
}

// Does a Plan include this parameter by default? (plan = { modules: [keys], excludedParams: { moduleKey: [names] } })
export function planIncludesParam(plan, moduleKey, paramName) {
  if (!plan.modules.includes(moduleKey)) return false;
  const excluded = plan.excludedParams && plan.excludedParams[moduleKey];
  return !(excluded && excluded.includes(paramName));
}

// ---- resolving one parameter for one lab ----
const LEGACY_PITCH = { "To Do": "To-Do", "In Progress": "Trial", "Onboarding / Setup": "Trial", Added: "Purchased" };
export function normalizePitch(stage) {
  return stage ? LEGACY_PITCH[stage] || stage : stage;
}

export function defaultInPlan(plan, moduleKey, paramDef) {
  return !!plan && planIncludesParam(plan, moduleKey, paramDef.name) && paramDef.category === "Adoption";
}

// Everything the UI and the score need about one parameter of one lab. `pitchForLab` is that lab's map from
// fetchAllPitchStatus / fetchLabPitchStatus ("param:<module>|<param>" → stage).
export function resolveParam(plan, mod, paramDef, adoption, pitchForLab) {
  const key = `${mod.key}|${paramDef.name}`;
  const st = (adoption || EMPTY_ADOPTION).paramState[key] || null;
  const inPlan = st && st.inPlan != null ? st.inPlan : defaultInPlan(plan, mod.key, paramDef);
  // Purchased = an add-on that was bought ("Purchased"). Only meaningful while Not in plan. Rows written before this
  // model existed defaulted `included` to true for Adoption-category params, so for those it only counts when
  // the row explicitly says Not in plan (migration 0034 cleared the ones that mattered).
  const purchased = !inPlan && !!st && !!st.included && (st.inPlan === false || paramDef.category === "Expansion");
  const status = (st && st.status) || (purchased ? PURCHASED_START_STATUS : "To-Do");
  const pitch = normalizePitch(pitchForLab && pitchForLab[`param:${key}`]) || (purchased ? "Purchased" : "To-Do");
  // Either Lost stage means the feature is gone — including one that had been bought (e.g. a trial that was
  // then marked Lost): 0 in the Expansion pipeline, no longer in the Adoption pipeline, no rollout or charges left.
  const lost = !inPlan && (pitch === "Lost after Purchase" || pitch === "Lost in Expansion");
  const onPlanTrack = (inPlan || purchased) && !lost;
  // null = not part of that pipeline (or left out of its score, e.g. Not Applicable).
  const adoptionScore = onPlanTrack ? (status in ROLLOUT_SCORE ? ROLLOUT_SCORE[status] : 0) : null;
  const expansionScore = inPlan ? null : lost ? 0 : purchased ? PITCH_SCORE.Purchased : pitch in PITCH_SCORE ? PITCH_SCORE[pitch] : 0;
  // The score on the list it's on now (what the parameter row shows).
  const score = onPlanTrack ? adoptionScore : expansionScore;
  return {
    key, def: paramDef, inPlan, purchased, lost, status, pitch, score, adoptionScore, expansionScore,
    // What this parameter is for THIS lab. A purchased add-on has moved onto the In-plan track.
    category: inPlan || (purchased && !lost) ? "Adoption" : "Expansion",
    state: st,
  };
}

function weightedAvg(items) {
  let w = 0, sum = 0;
  items.forEach(({ weight, value }) => { if (value == null) return; const ww = Number(weight) || 0; w += ww; sum += ww * value; });
  return w ? sum / w : null;
}

// Simple average of the two pipeline scores; just the one that is scored if the other has nothing counted.
function averageOfPipelines(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return (a + b) / 2;
}
const paramAvg = (params, field) => weightedAvg(params.map((r) => ({ weight: r.def.weight, value: r[field] })));
const moduleAvg = (moduleResults, field) => weightedAvg(moduleResults.map((m) => ({ weight: m.mod.weight, value: m[field] })));

// Whole-lab scoring. Returns { overallPct, adoptionPct, expansionPct, mandatoryPct, moduleResults: [{ mod, params,
// overallPct, adoptionPct, expansionPct, mandPct }] }. adoptionPct / expansionPct are null when that pipeline has no
// counted parameter; the lab's overallPct / mandatoryPct are 0 when nothing counts. A module with nothing counted has
// null scores.
export function computeLabScores(modules, plan, adoption, pitchForLab) {
  const moduleResults = modules.map((mod) => {
    const params = mod.params.map((p) => resolveParam(plan, mod, p, adoption, pitchForLab));
    const mand = params.filter((r) => r.def.type === "M");
    const adoptionPct = paramAvg(params, "adoptionScore");
    const expansionPct = paramAvg(params, "expansionScore");
    const mandAdoptionPct = paramAvg(mand, "adoptionScore");
    const mandExpansionPct = paramAvg(mand, "expansionScore");
    return {
      mod, params, adoptionPct, expansionPct, overallPct: averageOfPipelines(adoptionPct, expansionPct),
      mandAdoptionPct, mandExpansionPct, mandPct: averageOfPipelines(mandAdoptionPct, mandExpansionPct),
    };
  });
  const adoptionPct = moduleAvg(moduleResults, "adoptionPct");
  const expansionPct = moduleAvg(moduleResults, "expansionPct");
  const overallPct = averageOfPipelines(adoptionPct, expansionPct) ?? 0;
  const mandatoryPct = averageOfPipelines(moduleAvg(moduleResults, "mandAdoptionPct"), moduleAvg(moduleResults, "mandExpansionPct")) ?? 0;
  return { overallPct, adoptionPct, expansionPct, mandatoryPct, moduleResults };
}

// One pipeline's score for just some of the parameters (e.g. the purchased add-ons inside the Adoption pipeline) — weighted
// exactly like the lab score: parameters by weight inside a module, then modules by module weight. null = nothing counted.
export function subsetScore(moduleResults, pred, field) {
  return moduleAvg(moduleResults.map((m) => ({ mod: m.mod, value: paramAvg(m.params.filter(pred), field) })), "value");
}

// "42%" / "—" (not scored) — every screen shows the three scores the same way.
export function fmtScore(v) {
  return v == null ? "—" : `${Math.round(v)}%`;
}
// Average Overall / Adoption pipeline / Expansion pipeline across several labs' computeLabScores results. A lab whose
// pipeline has nothing counted (null) is left out of that pipeline's average (null when no lab has it).
export function averageScores(scoreList) {
  const avgOf = (field) => {
    const vals = scoreList.map((s) => s[field]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return { overall: scoreList.length ? avgOf("overallPct") : null, adoption: avgOf("adoptionPct"), expansion: avgOf("expansionPct") };
}
