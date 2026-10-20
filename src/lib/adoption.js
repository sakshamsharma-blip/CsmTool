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
//                    ("Added", priced or trial), then rolled out like any other feature.
// A parameter's default (until someone changes it): In plan when the lab's Plan includes it AND its template
// category is Adoption; otherwise Not in plan. Changing it is always reversible.
//
// Scoring — every parameter scores 0–100 on ONE ladder, so 100% means "everything purchased and fully adopted":
//   Not in plan, not purchased → by pitch stage (PITCH_SCORE)          e.g. To Do 0 … In Progress 30
//   In plan, or purchased      → by rollout status (ROLLOUT_SCORE)      Not Started 70 … Adopted 100
//   "Not Required", "Lost in Expansion", "Lost after Purchase" → 0 (they still count, pulling the score down)
// Module score = weighted average of its parameters (parameter weights); lab score = weighted average of its
// modules (module weights). "Mandatory completion" = the same calculation using only Mandatory parameters.
// The numbers below are the single place to tune the ladder.
// ============================================================================================================

export const STATUS_ORDER = ["Not Started", "In Progress", "Adopted"];
export const ROLLOUT_SCORE = { "Not Started": 70, "In Progress": 85, Adopted: 100 };
export const PITCH_SCORE = { "To Do": 0, Pitching: 10, "In Progress": 30, "Not Required": 0, "Lost in Expansion": 0, "Lost after Purchase": 0 };

// "Partially Adopted" was removed as a status (migration 0018); treat any leftover as "In Progress".
function normalizeStatus(status) {
  return status === "Partially Adopted" ? "In Progress" : status;
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
export function defaultInPlan(plan, moduleKey, paramDef) {
  return !!plan && planIncludesParam(plan, moduleKey, paramDef.name) && paramDef.category === "Adoption";
}

// Everything the UI and the score need about one parameter of one lab. `pitchForLab` is that lab's map from
// fetchAllPitchStatus / fetchLabPitchStatus ("param:<module>|<param>" → stage).
export function resolveParam(plan, mod, paramDef, adoption, pitchForLab) {
  const key = `${mod.key}|${paramDef.name}`;
  const st = (adoption || EMPTY_ADOPTION).paramState[key] || null;
  const inPlan = st && st.inPlan != null ? st.inPlan : defaultInPlan(plan, mod.key, paramDef);
  // Purchased = an add-on that was bought (Added). Only meaningful while Not in plan. Rows written before this
  // model existed defaulted `included` to true for Adoption-category params, so for those it only counts when
  // the row explicitly says Not in plan (migration 0034 cleared the ones that mattered).
  const purchased = !inPlan && !!st && !!st.included && (st.inPlan === false || paramDef.category === "Expansion");
  const status = (st && st.status) || "Not Started";
  const pitch = (pitchForLab && pitchForLab[`param:${key}`]) || (purchased ? "Added" : "To Do");
  // Either Lost stage means the feature is gone — including one that had been bought (e.g. a trial that was
  // then marked Lost): it scores 0 and has no rollout or charges left to track.
  const lost = !inPlan && (pitch === "Lost after Purchase" || pitch === "Lost in Expansion");
  let score;
  if (lost) score = 0;
  else if (inPlan || purchased) score = ROLLOUT_SCORE[status] ?? 0;
  else score = PITCH_SCORE[pitch] ?? 0;
  return {
    key, def: paramDef, inPlan, purchased, lost, status, pitch, score,
    category: inPlan ? "Adoption" : "Expansion",   // what this parameter is for THIS lab
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

async function upsertParamState(labId, moduleKey, paramName, next) {
  const { error } = await supabase.from("param_states").upsert({
    lab_id: labId, module_key: moduleKey, param_name: paramName,
    in_plan: next.inPlan, included: !!next.included, status: next.status || "Not Started",
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
  await upsertParamState(labId, moduleKey, def.name, { ...base, inPlan, included: inPlan, status: base.status || "Not Started" });
  const change = inPlan ? "Not in plan → In plan" : "In plan → Not in plan";
  await recordParamChange(labId, moduleKey, def.name, change, comment, csmId);
  logActivity(labId, {
    kind: "Adoption Updated", title: `${def.name}: ${change}`, meta: comment.trim(), csmId,
    details: { param: { moduleKey, paramName: def.name, change, comment: comment.trim() } },
  }).catch((err) => console.error(err));
}

// Rollout status (Not Started / In Progress / Adopted) of an In-plan or purchased parameter.
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

// ---- purchase plumbing used by pitch.js ("Added") ----
// A feature graduating from "pitched" to "Added" flips included=true on its param_states row without disturbing
// the rest. in_plan is left as it is (a bought add-on stays Not in plan, tracked as purchased).
export async function markParamIncluded(labId, moduleKey, paramName, existingState) {
  const base = existingState || {};
  await upsertParamState(labId, moduleKey, paramName, {
    inPlan: base.inPlan ?? false, included: true, status: base.status || "Not Started",
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
