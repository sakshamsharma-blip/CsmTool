import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";
import { syncItemTask, closeItemTasks } from "./tasks";
import {
  LIVE_STAGES, STATUS_PROGRESS, STATUS_EXITS, STATUS_ORDER, ROLLOUT_SCORE, PURCHASED_START_STATUS, STATUS_ACTIVE, PITCH_SCORE,
  normalizeStatus, normalizePitch, mapStateRow, planIncludesParam, defaultInPlan, resolveParam, computeLabScores,
  subsetScore, fmtScore, averageScores,
} from "../../supabase/functions/_shared/scoring.js";

export {
  LIVE_STAGES, STATUS_PROGRESS, STATUS_EXITS, STATUS_ORDER, ROLLOUT_SCORE, PURCHASED_START_STATUS, STATUS_ACTIVE, PITCH_SCORE,
  normalizeStatus, normalizePitch, mapStateRow, planIncludesParam, defaultInPlan, resolveParam, computeLabScores,
  subsetScore, fmtScore, averageScores,
};

// ============================================================================================================
// Adoption model v2 (Oct 2026). The scoring rules themselves (the two pipelines, their ladders, resolveParam,
// computeLabScores…) live in supabase/functions/_shared/scoring.js so the MCP connector scores exactly like the app;
// they are re-exported below.
//
// Every lab sees the WHOLE Adoption Template (no more per-module / per-parameter "in scope" switches). For each
// parameter the lab's CSM sets:
//   • In plan      → part of what the lab already pays for → treated as Adoption, tracked by rollout status.
//   • Not in plan  → an add-on → treated as Expansion: pitched through the pitch stages, then purchased
//                    ("Purchased", priced or trial), then rolled out on the In-plan track like any other feature.
// A parameter's default (until someone changes it): In plan when the lab's Plan includes it AND its template
// category is Adoption; otherwise Not in plan. Changing it is always reversible.
//
//
// The In-plan list only moves FORWARD: To-Do → In Discussion / Demo → Trial → Onboarding / Setup → Live 1 → Live 2 →
// Live 3 → Live 4 → Adopted. Anyone may skip ahead (decision Oct 28 2026 — new labs need their current stage set
// directly). There are no waiting times — Live steps and Adopted can be set whenever the CSM decides (the 7-day and
// 30-day waits were removed Oct 28 2026); the Adopted comment is the adoption note. Not Required / Not Applicable /
// Did Not Meet Requirements can be set from any stage. Only a CSM Lead / Admin can step an item back. See statusOptions /
// setParamStatus.
// ============================================================================================================


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
