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
//   Not in plan, not purchased → by its Expansion stage (PITCH_SCORE)    To-Do 0 · Pitching 10 · Trial 30
//   In plan, or purchased      → by its In-plan status (ROLLOUT_SCORE)   To-Do 70 … Live 4 98 · Adopted 100
//   A purchased add-on joins the In-plan track at To-Do (70) — "Purchased" itself is the hand-over point.
//   "Not Required", "Did Not Meet Requirements" and both Lost stages → 0 (they still count, pulling the score down).
//   "Not Applicable" → left out of the score entirely (null).
// Module score = weighted average of its parameters (parameter weights); lab score = weighted average of its
// modules (module weights). "Mandatory completion" = the same calculation using only Mandatory parameters.
// The numbers below are the single place to tune the ladder (lists and their order: decisions Oct 23 & 26 2026).
//
// The In-plan list is STRICTLY one step forward at a time (decision Oct 26 2026, migration 0040): To-Do → In
// Discussion / Demo → Trial → Onboarding / Setup → Live 1 → Live 2 → Live 3 → Live 4 → Adopted. Each Live step
// unlocks 7 days after the previous one; Adopted unlocks 30 days after Live 1 started (a month of monitoring) and
// its comment is the adoption note. Not Required / Not Applicable / Did Not Meet Requirements can be set from any
// stage. Only a CSM Lead / Admin can step an item back. See statusOptions / setParamStatus.
// ============================================================================================================

export const LIVE_STAGES = ["Live 1", "Live 2", "Live 3", "Live 4"];
export const STATUS_PROGRESS = ["To-Do", "In Discussion / Demo", "Trial", "Onboarding / Setup", ...LIVE_STAGES, "Adopted"];
export const STATUS_EXITS = ["Not Required", "Not Applicable", "Did Not Meet Requirements"];
export const STATUS_ORDER = [...STATUS_PROGRESS, ...STATUS_EXITS];
export const ROLLOUT_SCORE = {
  "To-Do": 70, "In Discussion / Demo": 75, Trial: 80, "Onboarding / Setup": 90,
  "Live 1": 92, "Live 2": 94, "Live 3": 96, "Live 4": 98, Adopted: 100,
  "Not Required": 0, "Not Applicable": null, "Did Not Meet Requirements": 0,
};
export const LIVE_STEP_DAYS = 7;       // each Live step waits this long after the previous one
export const LIVE_MONITOR_DAYS = 30;   // Adopted waits this long after Live 1 started
// In-plan statuses that mean work is under way — these (and PITCH_ACTIVE_STATUSES) are what Tasks lists.
export const STATUS_ACTIVE = ["In Discussion / Demo", "Trial", "Onboarding / Setup", ...LIVE_STAGES];
export const PITCH_SCORE = {
  "To-Do": 0, Pitching: 10, Trial: 30, "Not Required": 0, "Not Applicable": null,
  "Lost in Expansion": 0, "Lost after Purchase": 0,
};

const DAY_MS = 86400000;
const shortDate = (ms) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });

// The In-plan status choices for one resolved parameter: every status, each with `disabled` + a `note` saying why
// (e.g. "unlocks 3 Nov"). `canStepBack` = the viewer is a CSM Lead / Admin.
export function statusOptions(r, { canStepBack = false, now = Date.now() } = {}) {
  const cur = r.status;
  const st = r.state || {};
  const i = STATUS_PROGRESS.indexOf(cur);
  return STATUS_ORDER.map((value) => {
    if (value === cur) return { value, disabled: false, note: "" };
    if (STATUS_EXITS.includes(value)) return { value, disabled: false, note: "" };
    const j = STATUS_PROGRESS.indexOf(value);
    if (i < 0) return canStepBack ? { value, disabled: false, note: "" } : { value, disabled: true, note: "Lead / Admin only" };
    if (j < i) return canStepBack ? { value, disabled: false, note: "step back" } : { value, disabled: true, note: "can't go back" };
    if (j > i + 1) return { value, disabled: true, note: "one step at a time" };
    // j === i + 1 — the next step; Live and Adopted have waiting periods.
    if (LIVE_STAGES.includes(cur) && value !== "Adopted" && st.statusChangedAt) {
      const at = new Date(st.statusChangedAt).getTime() + LIVE_STEP_DAYS * DAY_MS;
      if (now < at) return { value, disabled: true, note: `unlocks ${shortDate(at)}` };
    }
    if (value === "Adopted" && st.liveStartedAt) {
      const at = new Date(st.liveStartedAt).getTime() + LIVE_MONITOR_DAYS * DAY_MS;
      if (now < at) return { value, disabled: true, note: `unlocks ${shortDate(at)} (1 month of Live)` };
    }
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
// ---- stage groups (analytics) ----
// Where each parameter currently sits, bucketed for the Adoption-tab pies and My Portfolio's charts. The In-plan
// stages are an ORDERED progression, so they use one blue ramp light → dark (To-Do lightest, Adopted darkest);
// Not-in-plan stages use an orange ramp; closed items are neutral grey. Colours are CSS variables (index.css,
// --stg-*) so dark mode gets its own validated steps. Order = legend / pie order.
export const STAGE_GROUPS = [
  { key: "todo", label: "To-Do", color: "var(--stg-plan-1)", ink: "var(--stg-plan-1-ink)" },
  { key: "progress", label: "Discussion / Trial", color: "var(--stg-plan-2)", ink: "var(--stg-plan-2-ink)" },
  { key: "onboarding", label: "Onboarding", color: "var(--stg-plan-3)", ink: "var(--stg-plan-3-ink)" },
  { key: "live", label: "Live 1–4", color: "var(--stg-plan-4)", ink: "var(--stg-plan-4-ink)" },
  { key: "adopted", label: "Adopted", color: "var(--stg-plan-5)", ink: "var(--stg-plan-5-ink)" },
  { key: "notinplan", label: "Not in plan (not bought)", color: "var(--stg-exp-2)", ink: "var(--stg-exp-2-ink)" },
  { key: "closed", label: "Closed (Not Required / N/A / Lost)", color: "var(--stg-closed)", ink: "var(--stg-closed-ink)" },
];
// The Not-in-plan pie splits the add-ons that haven't been bought by Expansion stage.
export const EXPANSION_GROUPS = [
  { key: "exp_todo", label: "To-Do", color: "var(--stg-exp-1)", ink: "var(--stg-exp-1-ink)" },
  { key: "exp_pitching", label: "Pitching", color: "var(--stg-exp-2)", ink: "var(--stg-exp-2-ink)" },
  { key: "exp_trial", label: "Trial", color: "var(--stg-exp-3)", ink: "var(--stg-exp-3-ink)" },
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
export function expansionGroupOf(r) {
  if (isClosed(r)) return "closed";
  const st = currentStage(r);
  return st === "Pitching" ? "exp_pitching" : st === "Trial" ? "exp_trial" : "exp_todo";
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
  logActivity(labId, {
    kind: "Adoption Updated", title: `${def.name}: ${change}`, meta: comment.trim(), csmId,
    details: { param: { moduleKey, paramName: def.name, change, comment: comment.trim() } },
  }).catch((err) => console.error(err));
}

// In-plan status (To-Do … Adopted, see STATUS_ORDER) of an In-plan or purchased parameter. Enforces the one-way
// rules (statusOptions) for every caller — Adoption tab and Tasks alike. `canStepBack` = CSM Lead / Admin.
export async function setParamStatus(labId, resolved, status, comment, csmId, { canStepBack = false } = {}) {
  const { def } = resolved;
  const moduleKey = resolved.key.split("|")[0];
  const base = resolved.state || {};
  const opt = statusOptions(resolved, { canStepBack }).find((o) => o.value === status);
  if (!opt || opt.disabled) throw new Error(`${def.name} can't move to ${status} yet${opt?.note ? ` (${opt.note})` : ""}.`);
  const nowIso = new Date().toISOString();
  const liveIdx = STATUS_PROGRESS.indexOf("Live 1");
  const toIdx = STATUS_PROGRESS.indexOf(status);
  // Live 1 starts the month of monitoring; stepping back before Live clears it; anything else keeps it.
  const liveStartedAt = status === "Live 1" ? nowIso
    : toIdx >= 0 && toIdx < liveIdx ? null
      : base.liveStartedAt || null;
  await upsertParamState(labId, moduleKey, def.name, {
    ...base, inPlan: resolved.inPlan, included: resolved.inPlan || resolved.purchased, status,
  }, { statusChangedAt: nowIso, liveStartedAt });
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
