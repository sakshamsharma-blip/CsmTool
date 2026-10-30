import { supabase } from "../supabaseClient";
import { planIncludesParam } from "./plans";
import { logActivity } from "./activity";
import { syncItemTask, closeItemTasks } from "./tasks";

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
//
// The In-plan list only moves FORWARD: To-Do → In Discussion / Demo → Trial → Onboarding / Setup → Live 1 → Live 2 →
// Live 3 → Live 4 → Adopted. Anyone may skip ahead (decision Oct 28 2026 — new labs need their current stage set
// directly). There are no waiting times — Live steps and Adopted can be set whenever the CSM decides (the 7-day and
// 30-day waits were removed Oct 28 2026); the Adopted comment is the adoption note. Not Required / Not Applicable /
// Did Not Meet Requirements can be set from any stage. Only a CSM Lead / Admin can step an item back. See statusOptions /
// setParamStatus.
// ============================================================================================================

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

// The In-plan status choices for one resolved parameter: every status, each with `disabled` + a `note` saying why
// (e.g. "can't go back"). `canStepBack` = the viewer is a CSM Lead / Admin.
export function statusOptions(r, { canStepBack = false } = {}) {
  const cur = r.status;
  const i = STATUS_PROGRESS.indexOf(cur);
  return STATUS_ORDER.map((value) => {
    if (value === cur) return { value, disabled: false, note: "" };
    if (STATUS_EXITS.includes(value)) return { value, disabled: false, note: "" };
    const j = STATUS_PROGRESS.indexOf(value);
    if (i < 0) return canStepBack ? { value, disabled: false, note: "" } : { value, disabled: true, note: "Lead / Admin only" };
    if (j < i) return canStepBack ? { value, disabled: false, note: "step back" } : { value, disabled: true, note: "can't go back" };
    // Forward — any later stage, skipping allowed, no waiting.
    return { value, disabled: false, note: "" };
  });
}

// Old status names (before migration 0038) → new ones, so a row saved by a stale tab still reads correctly.
const LEGACY_STATUS = { "Not Started": "To-Do", "In Progress": "Onboarding / Setup", "Partially Adopted": "Onboarding / Setup" };
// (Expansion "Onboarding / Setup" was removed Oct 26 2026 — migration 0040 moved those rows to Trial.)
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
    statusChangedAt: r.status_changed_at || null,
    liveStartedAt: r.live_started_at || null,
  };
}

// ---- reads ----
export async function fetchLabAdoption(labId) {
  const { data, error } = await supabase.from("param_states").select("*").eq("lab_id", labId);
  if (error) throw error;
  const paramState = {};
  (data || []).forEach((r) => { paramState[`${r.module_key}|${r.param_name}`] = mapStateRow(r); });
  return { paramState };
}

// Bulk variant — one query across every lab, grouped client-side (Portfolio / Dashboard / Tasks).
export async function fetchAllLabsAdoption() {
  const { data, error } = await supabase.from("param_states").select("*");
  if (error) throw error;
  const byLab = {};
  (data || []).forEach((r) => {
    (byLab[r.lab_id] = byLab[r.lab_id] || { paramState: {} }).paramState[`${r.module_key}|${r.param_name}`] = mapStateRow(r);
  });
  return byLab; // labId -> { paramState } — a lab with no rows is simply absent (everything at its default)
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
// ---- stage groups (analytics) ----
// Where each parameter currently sits, bucketed for the Adoption-tab pies and My Portfolio's charts. Colours (decision
// Oct 27 2026): the In-plan progression runs pale blue (To-Do) → indigo → teal → LIGHT GREEN (Live) → DARK GREEN
// (Adopted); Not-in-plan add-ons coral; closed grey. They are CSS variables (index.css, --stg-*) with separate
// dark-mode steps, checked for colour-blind separation. "Closed" sits between Adopted and Not in plan so green and
// coral are never next to each other. Order = legend / pie / bar order.
export const STAGE_GROUPS = [
  { key: "todo", label: "To-Do", color: "var(--stg-plan-1)", ink: "var(--stg-plan-1-ink)" },
  { key: "progress", label: "Discussion / Trial", color: "var(--stg-plan-2)", ink: "var(--stg-plan-2-ink)" },
  { key: "onboarding", label: "Onboarding", color: "var(--stg-plan-3)", ink: "var(--stg-plan-3-ink)" },
  { key: "live", label: "Live 1–4", color: "var(--stg-plan-4)", ink: "var(--stg-plan-4-ink)" },
  { key: "adopted", label: "Adopted", color: "var(--stg-plan-5)", ink: "var(--stg-plan-5-ink)" },
  { key: "closed", label: "Closed (Not Required / N/A / Lost)", color: "var(--stg-closed)", ink: "var(--stg-closed-ink)" },
  { key: "notinplan", label: "Not in plan (not bought)", color: "var(--stg-notin)", ink: "var(--stg-notin-ink)" },
];
// The Expansion-pipeline pie: every Not-in-plan parameter by Expansion stage, purchased ones included.
export const EXPANSION_GROUPS = [
  { key: "exp_todo", label: "To-Do", color: "var(--stg-exp-1)", ink: "var(--stg-exp-1-ink)" },
  { key: "exp_pitching", label: "Pitching", color: "var(--stg-exp-2)", ink: "var(--stg-exp-2-ink)" },
  { key: "exp_trial", label: "Trial", color: "var(--stg-exp-3)", ink: "var(--stg-exp-3-ink)" },
  { key: "exp_purchased", label: "Purchased", color: "var(--stg-plan-5)", ink: "var(--stg-plan-5-ink)" },
  { key: "closed", label: "Closed (Not Required / N/A / Lost)", color: "var(--stg-closed)", ink: "var(--stg-closed-ink)" },
];
// The exact stage a parameter is at, as shown in its dropdown ("Adopted", "Pitching", …).
export function currentStage(r) {
  if (r.lost) return r.pitch;
  return r.inPlan || r.purchased ? r.status : r.pitch;
}
export function isClosed(r) {
  return r.lost || ["Not Required", "Not Applicable", "Did Not Meet Requirements"].includes(currentStage(r));
}
export function stageGroupOf(r) {
  if (isClosed(r)) return "closed";
  if (!(r.inPlan || r.purchased)) return "notinplan";
  const st = currentStage(r);
  if (st === "Adopted") return "adopted";
  if (LIVE_STAGES.includes(st)) return "live";
  if (st === "Onboarding / Setup") return "onboarding";
  if (st === "In Discussion / Demo" || st === "Trial") return "progress";
  return "todo";
}
// A Not-in-plan parameter's place in the Expansion pipeline (by its Expansion stage, not its rollout).
export function expansionGroupOf(r) {
  if (r.lost) return "closed";
  if (r.purchased) return "exp_purchased";
  if (["Not Required", "Not Applicable"].includes(r.pitch)) return "closed";
  return r.pitch === "Pitching" ? "exp_pitching" : r.pitch === "Trial" ? "exp_trial" : "exp_todo";
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

// `timing` (optional) = { statusChangedAt, liveStartedAt } — only sent when the status itself changes, so other
// updates (In plan ⇄ Not in plan) leave the Live timers alone.
async function upsertParamState(labId, moduleKey, paramName, next, timing) {
  const row = {
    lab_id: labId, module_key: moduleKey, param_name: paramName,
    in_plan: next.inPlan, included: !!next.included, status: next.status || "To-Do",
    exp_value: next.expValue ?? null, exp_stage: next.expStage ?? null,
  };
  if (timing) { row.status_changed_at = timing.statusChangedAt; row.live_started_at = timing.liveStartedAt; }
  const { error } = await supabase.from("param_states").upsert(row, { onConflict: "lab_id,module_key,param_name" });
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
  // Its item task belongs to the list it left; if it lands on the In-plan list mid-way, that list gets one.
  await closeItemTasks(labId, moduleKey, def.name, csmId).catch((err) => console.error(err));
  const status = base.status || "To-Do";
  if (inPlan && STATUS_ACTIVE.includes(status)) {
    await syncItemTask({ labId, moduleKey, paramName: def.name, source: "Adoption", stage: status, active: true, actorId: csmId })
      .catch((err) => console.error(err));
  }
  logActivity(labId, {
    kind: "Adoption Updated", title: `${def.name}: ${change}`, meta: comment.trim(), csmId,
    details: { param: { moduleKey, paramName: def.name, change, comment: comment.trim() } },
  }).catch((err) => console.error(err));
}

// In-plan status (To-Do … Adopted, see STATUS_ORDER) of an In-plan or purchased parameter. Enforces the one-way
// rules (statusOptions) for every caller — Adoption tab and Tasks alike. `canStepBack` = CSM Lead / Admin.
// `due` (optional) = due date for the item's task when it is (still) under way.
export async function setParamStatus(labId, resolved, status, comment, csmId, { canStepBack = false, due } = {}) {
  const { def } = resolved;
  const moduleKey = resolved.key.split("|")[0];
  const base = resolved.state || {};
  const opt = statusOptions(resolved, { canStepBack }).find((o) => o.value === status);
  if (!opt || opt.disabled) throw new Error(`${def.name} can't move to ${status} yet${opt?.note ? ` (${opt.note})` : ""}.`);
  const nowIso = new Date().toISOString();
  const liveIdx = STATUS_PROGRESS.indexOf("Live 1");
  const toIdx = STATUS_PROGRESS.indexOf(status);
  // Entering Live (at any Live step) records when it went live (shown in My Portfolio's Live monitoring); stepping
  // back before Live clears it; moving between Live steps or on to Adopted keeps it.
  const enteringLive = LIVE_STAGES.includes(status) && !LIVE_STAGES.includes(resolved.status);
  const liveStartedAt = enteringLive ? nowIso
    : toIdx >= 0 && toIdx < liveIdx ? null
      : base.liveStartedAt || null;
  await upsertParamState(labId, moduleKey, def.name, {
    ...base, inPlan: resolved.inPlan, included: resolved.inPlan || resolved.purchased, status,
  }, { statusChangedAt: nowIso, liveStartedAt });
  const change = `Status: ${resolved.status} → ${status}`;
  await recordParamChange(labId, moduleKey, def.name, change, comment, csmId);
  await syncItemTask({ labId, moduleKey, paramName: def.name, source: "Adoption", stage: status, active: STATUS_ACTIVE.includes(status), due, actorId: csmId })
    .catch((err) => console.error(err));
  logActivity(labId, {
    kind: "Adoption Updated", title: `${def.name}: ${change}`, meta: comment.trim(), csmId,
    details: { param: { moduleKey, paramName: def.name, change, comment: comment.trim() } },
  }).catch((err) => console.error(err));
}

// ---- purchase plumbing used by pitch.js ("Purchased") ----
// A feature graduating from "pitched" to "Purchased" flips included=true on its param_states row without disturbing
// the rest. in_plan is left as it is (a bought add-on stays Not in plan, tracked as purchased).
// It joins the In-plan list at Onboarding / Setup (PURCHASED_START_STATUS).
export async function markParamIncluded(labId, moduleKey, paramName, existingState) {
  const base = existingState || {};
  await upsertParamState(labId, moduleKey, paramName, {
    inPlan: base.inPlan ?? false, included: true, status: PURCHASED_START_STATUS,
    expValue: base.expValue ?? null, expStage: base.expStage ?? null,
  }, { statusChangedAt: new Date().toISOString(), liveStartedAt: null });
}

// Legacy whole-module pitch (from before every lab saw the full template). Kept so old pitch rows still work.
export async function markModuleInScope(labId, moduleKey) {
  const { error } = await supabase.from("scope_overrides").upsert(
    { lab_id: labId, module_key: moduleKey, in_scope: true },
    { onConflict: "lab_id,module_key" }
  );
  if (error) throw error;
}
