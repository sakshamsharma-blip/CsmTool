import { supabase } from "../supabaseClient";
import { planIncludesParam } from "./plans";
import { logActivity } from "./activity";

// ============================================================================================================
// Adoption model v2 (Oct 2026)
//
// Every lab sees the WHOLE Adoption Template (no more per-module / per-parameter "in scope" switches). For each
// parameter the lab's CSM sets:
//   • In plan      → part of what the lab already pays for → treated as Adoption, tracked by rollout status.
//   • Not in plan  → an add-on → treated as Expansion: pitched through the pitch stages, then purchased
//                    ("Purchased", priced or trial), then rolled out on the In-plan track like any other feature.
// A parameter's default (until someone changes it): In plan when the lab's Plan includes it AND its template
// category is Adoption; otherwise Not in plan. Changing it is always reversible.
//
// Scoring — every parameter scores 0–100 on ONE ladder, so 100% means "everything purchased and fully adopted":
//   Not in plan, not purchased → by its Expansion stage (PITCH_SCORE)    To-Do 0 … Onboarding / Setup 50
//   In plan, or purchased      → by its In-plan status (ROLLOUT_SCORE)   To-Do 70 … Adopted 100
//   A purchased add-on joins the In-plan track at To-Do (70) — "Purchased" itself is the hand-over point.
//   "Not Required", "Did Not Meet Requirements" and both Lost stages → 0 (they still count, pulling the score down).
//   "Not Applicable" → left out of the score entirely (null).
// Module score = weighted average of its parameters (parameter weights); lab score = weighted average of its
// modules (module weights). "Mandatory completion" = the same calculation using only Mandatory parameters.
// The numbers below are the single place to tune the ladder (lists and their order: decision Oct 23 2026).
// ============================================================================================================

export const STATUS_ORDER = ["To-Do", "In Discussion / Demo", "Trial", "Onboarding / Setup", "Adopted", "Not Required", "Not Applicable", "Did Not Meet Requirements"];
export const ROLLOUT_SCORE = {
  "To-Do": 70, "In Discussion / Demo": 75, Trial: 80, "Onboarding / Setup": 90, Adopted: 100,
  "Not Required": 0, "Not Applicable": null, "Did Not Meet Requirements": 0,
};
// In-plan statuses that mean work is under way — these (and PITCH_ACTIVE_STATUSES) are what Tasks lists.
export const STATUS_ACTIVE = ["In Discussion / Demo", "Trial", "Onboarding / Setup"];
export const PITCH_SCORE = {
  "To-Do": 0, Pitching: 10, Trial: 30, "Onboarding / Setup": 50, "Not Required": 0, "Not Applicable": null,
  "Lost in Expansion": 0, "Lost after Purchase": 0,
};

// Old status names (before migration 0038) → new ones, so a row saved by a stale tab still reads correctly.
const LEGACY_STATUS = { "Not Started": "To-Do", "In Progress": "Onboarding / Setup", "Partially Adopted": "Onboarding / Setup" };
function normalizeStatus(status) {
  return LEGACY_STATUS[status] || status;
}

const EMPTY_ADOPTION = { paramState: {} };

function mapStateRow(r) {
  return {
    inPlan: r.in_plan == null ? null : !!r.in_plan,
    included: r.included,
    status: normalizeStatus(r.status),
    expValue: r.exp_value != null ? Number(r.exp_value) : null,
    expStage: r.exp_stage || null,
  };
}

// ---- reads ----
export async function fetchLabAdoption(labId) {
  const { data, error } = await supabase.from("param_states")
    .select("module_key,param_name,in_plan,included,status,exp_value,exp_stage").eq("lab_id", labId);
  if (error) throw error;
  const paramState = {};
  (data || []).forEach((r) => { paramState[`${r.module_key}|${r.param_name}`] = mapStateRow(r); });
  return { paramState };
}

// Bulk variant — one query across every lab, grouped client-side (Portfolio / Dashboard / Tasks).
export async function fetchAllLabsAdoption() {
  const { data, error } = await supabase.from("param_states")
    .select("lab_id,module_key,param_name,in_plan,included,status,exp_value,exp_stage");
  if (error) throw error;
  const byLab = {};
  (data || []).forEach((r) => {
    (byLab[r.lab_id] = byLab[r.lab_id] || { paramState: {} }).paramState[`${r.module_key}|${r.param_name}`] = mapStateRow(r);
  });
  return byLab; // labId -> { paramState } — a lab with no rows is simply absent (everything at its default)
}

// ---- resolving one parameter for one lab ----
const LEGACY_PITCH = { "To Do": "To-Do", "In Progress": "Onboarding / Setup", Added: "Purchased" };
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
  const status = (st && st.status) || "To-Do";
  const pitch = normalizePitch(pitchForLab && pitchForLab[`param:${key}`]) || (purchased ? "Purchased" : "To-Do");
  // Either Lost stage means the feature is gone — including one that had been bought (e.g. a trial that was
  // then marked Lost): it scores 0 and has no rollout or charges left to track.
  const lost = !inPlan && (pitch === "Lost after Purchase" || pitch === "Lost in Expansion");
  let score;
  if (lost) score = 0;
  else if (inPlan || purchased) score = status in ROLLOUT_SCORE ? ROLLOUT_SCORE[status] : 0;
  else score = pitch in PITCH_SCORE ? PITCH_SCORE[pitch] : 0;
  return {
    key, def: paramDef, inPlan, purchased, lost, status, pitch, score,
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

// Whole-lab scoring. Returns { overallPct, mandatoryPct, moduleResults: [{ mod, overallPct, mandPct, params }] }.
// overallPct/mandatoryPct are 0–100 (0 when nothing counts); a module with nothing counted has null scores.
export function computeLabScores(modules, plan, adoption, pitchForLab) {
  const moduleResults = modules.map((mod) => {
    const params = mod.params.map((p) => resolveParam(plan, mod, p, adoption, pitchForLab));
    const overallPct = weightedAvg(params.map((r) => ({ weight: r.def.weight, value: r.score })));
    const mandPct = weightedAvg(params.filter((r) => r.def.type === "M").map((r) => ({ weight: r.def.weight, value: r.score })));
    return { mod, params, overallPct, mandPct };
  });
  const overallPct = weightedAvg(moduleResults.map((m) => ({ weight: m.mod.weight, value: m.overallPct }))) ?? 0;
  const mandatoryPct = weightedAvg(moduleResults.map((m) => ({ weight: m.mod.weight, value: m.mandPct }))) ?? 0;
  return { overallPct, mandatoryPct, moduleResults };
}
// Adoption % of just one group of parameters (e.g. only In plan, only Optional) — same weighting as the lab
// score: parameters by weight within each module, then modules by module weight. Also returns how many
// parameters are in the group. Parameters left out of the score (Not Applicable) aren't counted.
export function groupAdoption(moduleResults, pred) {
  let count = 0;
  const pct = weightedAvg(moduleResults.map((m) => {
    const ps = m.params.filter(pred);
    count += ps.filter((r) => r.score != null).length;
    return { weight: m.mod.weight, value: weightedAvg(ps.map((r) => ({ weight: r.def.weight, value: r.score }))) };
  }));
  return { pct, count };
}

// Same thing — kept under its old name for the screens that score already-saved data (Portfolio, Dashboard…).
export const computeSavedLabScores = computeLabScores;

// ---- per-parameter audit trail (migration 0034) ----
// Every change to a lab's parameter is recorded with its REQUIRED comment; the newest comment shows next to the
// parameter on the Adoption tab and clicking the parameter opens the full trail.
export async function recordParamChange(labId, moduleKey, paramName, change, comment, csmId) {
  const { error } = await supabase.from("param_changes").insert({
    lab_id: labId, module_key: moduleKey, param_name: paramName, change, comment: comment.trim(), csm_id: csmId || null,
  });
  if (error) throw error;
}

export async function fetchParamChanges(labId) {
  const { data, error } = await supabase.from("param_changes")
    .select("id,module_key,param_name,change,comment,csm_id,created_at")
    .eq("lab_id", labId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id, moduleKey: r.module_key, paramName: r.param_name, change: r.change, comment: r.comment, csmId: r.csm_id, createdAt: r.created_at,
  }));
}

// Every lab's audit trail at once (Tasks needs it to work out how long each item has been under way).
export async function fetchAllParamChanges() {
  const { data, error } = await supabase.from("param_changes")
    .select("lab_id,module_key,param_name,change,created_at").order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function upsertParamState(labId, moduleKey, paramName, next) {
  const { error } = await supabase.from("param_states").upsert({
    lab_id: labId, module_key: moduleKey, param_name: paramName,
    in_plan: next.inPlan, included: !!next.included, status: next.status || "To-Do",
    exp_value: next.expValue ?? null, exp_stage: next.expStage ?? null,
  }, { onConflict: "lab_id,module_key,param_name" });
  if (error) throw error;
}

// In plan ⇄ Not in plan. Switching to In plan makes it part of the lab's plan (counts as had); switching to Not
// in plan makes it an add-on that hasn't been bought (purchased cleared) — it can be pitched from there.
export async function setParamInPlan(labId, resolved, inPlan, comment, csmId) {
  const { def } = resolved;
  const moduleKey = resolved.key.split("|")[0];
  const base = resolved.state || {};
  await upsertParamState(labId, moduleKey, def.name, { ...base, inPlan, included: inPlan, status: base.status || "To-Do" });
  const change = inPlan ? "Not in plan → In plan" : "In plan → Not in plan";
  await recordParamChange(labId, moduleKey, def.name, change, comment, csmId);
  logActivity(labId, {
    kind: "Adoption Updated", title: `${def.name}: ${change}`, meta: comment.trim(), csmId,
    details: { param: { moduleKey, paramName: def.name, change, comment: comment.trim() } },
  }).catch((err) => console.error(err));
}

// In-plan status (To-Do … Adopted, see STATUS_ORDER) of an In-plan or purchased parameter.
export async function setParamStatus(labId, resolved, status, comment, csmId) {
  const { def } = resolved;
  const moduleKey = resolved.key.split("|")[0];
  const base = resolved.state || {};
  await upsertParamState(labId, moduleKey, def.name, {
    ...base, inPlan: resolved.inPlan, included: resolved.inPlan || resolved.purchased, status,
  });
  const change = `Status: ${resolved.status} → ${status}`;
  await recordParamChange(labId, moduleKey, def.name, change, comment, csmId);
  logActivity(labId, {
    kind: "Adoption Updated", title: `${def.name}: ${change}`, meta: comment.trim(), csmId,
    details: { param: { moduleKey, paramName: def.name, change, comment: comment.trim() } },
  }).catch((err) => console.error(err));
}

// ---- purchase plumbing used by pitch.js ("Purchased") ----
// A feature graduating from "pitched" to "Purchased" flips included=true on its param_states row without disturbing
// the rest. in_plan is left as it is (a bought add-on stays Not in plan, tracked as purchased).
export async function markParamIncluded(labId, moduleKey, paramName, existingState) {
  const base = existingState || {};
  await upsertParamState(labId, moduleKey, paramName, {
    inPlan: base.inPlan ?? false, included: true, status: "To-Do",
    expValue: base.expValue ?? null, expStage: base.expStage ?? null,
  });
}

// Legacy whole-module pitch (from before every lab saw the full template). Kept so old pitch rows still work.
export async function markModuleInScope(labId, moduleKey) {
  const { error } = await supabase.from("scope_overrides").upsert(
    { lab_id: labId, module_key: moduleKey, in_scope: true },
    { onConflict: "lab_id,module_key" }
  );
  if (error) throw error;
}
