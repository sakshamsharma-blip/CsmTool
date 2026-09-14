import { supabase } from "../supabaseClient";
import { planIncludesModule, planIncludesParam } from "./plans";

export const STATUS_ORDER = ["Not Started", "In Progress", "Partially Adopted", "Adopted"];
export const STATUS_WEIGHT = { "Not Started": 0, "In Progress": 25, "Partially Adopted": 50, "Adopted": 100 };
export const EXP_STAGES = ["Opportunity Identified", "Discussion", "Quotation Shared", "Negotiation"];

const EMPTY_ADOPTION = { scope: {}, paramScope: {}, paramState: {} };

// A param that's never been touched for this lab gets this default: Adoption-category features are
// part of the base plan (always "included", tracked purely on rollout status); Expansion-category
// features are add-ons the lab hasn't bought yet, so they start excluded with no pipeline value —
// unlike the old single-file prototype, nothing here is guessed/randomized.
export function defaultParamState(paramDef) {
  return {
    included: paramDef?.category === "Adoption",
    status: "Not Started",
    expValue: null,
    expStage: null,
  };
}

// ---- reads ----
export async function fetchLabAdoption(labId) {
  const [{ data: so, error: e1 }, { data: pso, error: e2 }, { data: ps, error: e3 }] = await Promise.all([
    supabase.from("scope_overrides").select("module_key,in_scope").eq("lab_id", labId),
    supabase.from("param_scope_overrides").select("module_key,param_name,in_scope").eq("lab_id", labId),
    supabase.from("param_states").select("module_key,param_name,included,status,exp_value,exp_stage").eq("lab_id", labId),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;

  const scope = {};
  (so || []).forEach((r) => { scope[r.module_key] = r.in_scope; });
  const paramScope = {};
  (pso || []).forEach((r) => { paramScope[`${r.module_key}|${r.param_name}`] = r.in_scope; });
  const paramState = {};
  (ps || []).forEach((r) => {
    paramState[`${r.module_key}|${r.param_name}`] = {
      included: r.included,
      status: r.status,
      expValue: r.exp_value != null ? Number(r.exp_value) : null,
      expStage: r.exp_stage || null,
    };
  });
  return { scope, paramScope, paramState };
}

// Bulk variant of fetchLabAdoption — one query per table across every lab, grouped client-side, so
// Portfolio/Dashboard can compute every lab's scores without one round-trip per lab.
export async function fetchAllLabsAdoption() {
  const [{ data: so, error: e1 }, { data: pso, error: e2 }, { data: ps, error: e3 }] = await Promise.all([
    supabase.from("scope_overrides").select("lab_id,module_key,in_scope"),
    supabase.from("param_scope_overrides").select("lab_id,module_key,param_name,in_scope"),
    supabase.from("param_states").select("lab_id,module_key,param_name,included,status,exp_value,exp_stage"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;

  const byLab = {};
  const ensure = (labId) => (byLab[labId] = byLab[labId] || { scope: {}, paramScope: {}, paramState: {} });
  (so || []).forEach((r) => { ensure(r.lab_id).scope[r.module_key] = r.in_scope; });
  (pso || []).forEach((r) => { ensure(r.lab_id).paramScope[`${r.module_key}|${r.param_name}`] = r.in_scope; });
  (ps || []).forEach((r) => {
    ensure(r.lab_id).paramState[`${r.module_key}|${r.param_name}`] = {
      included: r.included,
      status: r.status,
      expValue: r.exp_value != null ? Number(r.exp_value) : null,
      expStage: r.exp_stage || null,
    };
  });
  return byLab; // labId -> { scope, paramScope, paramState } — a lab with no rows anywhere is simply absent
}

// Scores a lab from already-saved adoption data only (no draft layer) — what Portfolio/Dashboard need,
// as opposed to LabDetailView's computeLabScores which also layers unsaved local edits.
export function computeSavedLabScores(modules, plan, adoption) {
  const a = adoption || EMPTY_ADOPTION;
  const effectiveScope = (moduleKey) =>
    Object.prototype.hasOwnProperty.call(a.scope, moduleKey) ? a.scope[moduleKey] : planIncludesModule(plan, moduleKey);
  const effectiveParamScope = (moduleKey, paramName) => {
    const key = `${moduleKey}|${paramName}`;
    return Object.prototype.hasOwnProperty.call(a.paramScope, key) ? a.paramScope[key] : planIncludesParam(plan, moduleKey, paramName);
  };
  const effectiveParamState = (moduleKey, paramName) => {
    const key = `${moduleKey}|${paramName}`;
    const mod = modules.find((m) => m.key === moduleKey);
    const paramDef = mod && mod.params.find((p) => p.name === paramName);
    return a.paramState[key] || defaultParamState(paramDef);
  };
  return computeLabScores(modules, effectiveScope, effectiveParamScope, effectiveParamState);
}

// A single param graduating from "pitched" to "Added" (My Portfolio) needs to flip included=true on
// its param_states row without disturbing status/expValue/expStage if a row already exists.
export async function markParamIncluded(labId, moduleKey, paramName, existingState) {
  const base = existingState || defaultParamState(null);
  const { error } = await supabase.from("param_states").upsert(
    {
      lab_id: labId,
      module_key: moduleKey,
      param_name: paramName,
      included: true,
      status: base.status,
      exp_value: base.expValue,
      exp_stage: base.expStage,
    },
    { onConflict: "lab_id,module_key,param_name" }
  );
  if (error) throw error;
}

// A whole module graduating from "pitched as new" to "Added" — same mechanism the Adoption tab's
// scope toggle already uses.
export async function markModuleInScope(labId, moduleKey) {
  const { error } = await supabase.from("scope_overrides").upsert(
    { lab_id: labId, module_key: moduleKey, in_scope: true },
    { onConflict: "lab_id,module_key" }
  );
  if (error) throw error;
}

// ---- writes: only persist what actually changed, mirroring the original prototype's rule of only
// writing an override row when it deviates from the Plan's default (and clearing it if a change moves
// it back to matching the default) ----
export async function saveLabAdoption(labId, { plan, modules, saved, draft }) {
  const ops = [];

  Object.entries(draft.scope || {}).forEach(([moduleKey, val]) => {
    const planDefault = planIncludesModule(plan, moduleKey);
    const current = Object.prototype.hasOwnProperty.call(saved.scope, moduleKey) ? saved.scope[moduleKey] : planDefault;
    if (val === current) return;
    ops.push(
      val === planDefault
        ? supabase.from("scope_overrides").delete().eq("lab_id", labId).eq("module_key", moduleKey)
        : supabase.from("scope_overrides").upsert(
            { lab_id: labId, module_key: moduleKey, in_scope: val },
            { onConflict: "lab_id,module_key" }
          )
    );
  });

  Object.entries(draft.paramScope || {}).forEach(([key, val]) => {
    const [moduleKey, paramName] = key.split("|");
    const planDefault = planIncludesParam(plan, moduleKey, paramName);
    const current = Object.prototype.hasOwnProperty.call(saved.paramScope, key) ? saved.paramScope[key] : planDefault;
    if (val === current) return;
    ops.push(
      val === planDefault
        ? supabase.from("param_scope_overrides").delete().eq("lab_id", labId).eq("module_key", moduleKey).eq("param_name", paramName)
        : supabase.from("param_scope_overrides").upsert(
            { lab_id: labId, module_key: moduleKey, param_name: paramName, in_scope: val },
            { onConflict: "lab_id,module_key,param_name" }
          )
    );
  });

  Object.entries(draft.params || {}).forEach(([key, delta]) => {
    const [moduleKey, paramName] = key.split("|");
    const mod = modules.find((m) => m.key === moduleKey);
    const paramDef = mod && mod.params.find((p) => p.name === paramName);
    const base = saved.paramState[key] || defaultParamState(paramDef);
    const next = { ...base, ...delta };
    ops.push(
      supabase.from("param_states").upsert(
        {
          lab_id: labId,
          module_key: moduleKey,
          param_name: paramName,
          included: next.included,
          status: next.status,
          exp_value: next.expValue,
          exp_stage: next.expStage,
        },
        { onConflict: "lab_id,module_key,param_name" }
      )
    );
  });

  const results = await Promise.all(ops);
  const firstError = results.find((r) => r && r.error)?.error;
  if (firstError) throw firstError;
}

// ---- scoring (pure functions — take getter closures so the caller can layer local draft edits over
// the saved/default state before anything is persisted) ----
export function computeModuleProgress(mod, effectiveParamScope, effectiveParamState, mandatoryOnly) {
  let totalW = 0, doneW = 0;
  mod.params.forEach((p) => {
    if (mandatoryOnly && p.type !== "M") return;
    if (!effectiveParamScope(mod.key, p.name)) return;
    const st = effectiveParamState(mod.key, p.name);
    if (!st.included) return;
    totalW += p.weight;
    doneW += p.weight * (STATUS_WEIGHT[st.status] / 100);
  });
  return totalW ? (doneW / totalW) * 100 : null;
}

export function computeLabScores(modules, effectiveScope, effectiveParamScope, effectiveParamState) {
  let mandSum = 0, overallSum = 0, weightTotal = 0;
  const moduleResults = modules.map((mod) => {
    const inScope = effectiveScope(mod.key);
    const mandPct = inScope ? computeModuleProgress(mod, effectiveParamScope, effectiveParamState, true) : null;
    const overallPct = inScope ? computeModuleProgress(mod, effectiveParamScope, effectiveParamState, false) : null;
    if (inScope) {
      weightTotal += mod.weight;
      mandSum += (mandPct || 0) * mod.weight;
      overallSum += (overallPct || 0) * mod.weight;
    }
    return { mod, mandPct, overallPct, inScope };
  });
  return {
    mandatoryPct: weightTotal ? mandSum / weightTotal : 0,
    overallPct: weightTotal ? overallSum / weightTotal : 0,
    moduleResults,
  };
}
