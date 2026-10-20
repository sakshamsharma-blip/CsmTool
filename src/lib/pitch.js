import { supabase } from "../supabaseClient";
import { markParamIncluded, markModuleInScope, resolveParam, recordParamChange } from "./adoption";
import { addCollectionsItem } from "./collections";
import { logActivity } from "./activity";
import { updateLabMRR } from "./labs";
import { logChurn } from "./churn";
import { todayISO } from "./dates";

// The upsell/pitch worklist (My Portfolio) — for every Expansion-category feature (or whole module,
// if the module itself isn't in scope yet), a 5-state pitch status. "Added" is the one status with
// real consequences: the upsell succeeded, so the feature graduates onto the Adoption tab and a
// Collections item is created for it (see markFeatureAdded below).
export const PITCH_STATUSES = ["To Do", "Pitching", "In Progress", "Added", "Not Required", "Lost in Expansion", "Lost after Purchase"];
export const PITCH_ACTIVE_STATUSES = ["To Do", "Pitching", "In Progress"];
// Terminal "we lost it" stages — never counted as open work. "Lost in Expansion" = the pitch never
// converted (recorded + logged only). "Lost after Purchase" = it was bought (Added) and then lost: the
// lab's MRR drops by that feature's charge and it's logged as a Contraction in the churn log (Reports) —
// see markLostAfterPurchase. Scope and the Collections entry are left as they are. The next Monthly
// invoice resets MRR to the real billed figure anyway.
export const PITCH_LOST_STATUSES = ["Lost in Expansion", "Lost after Purchase"];

// Stage choices for one parameter. Once a feature has been bought, losing it must go through "Lost after
// Purchase" (which lowers MRR and logs a Contraction), so "Lost in Expansion" isn't offered — unless that's
// already its stage (older data), so the dropdown can still show it.
export function pitchOptionsFor(purchased, currentStage) {
  if (!purchased) return PITCH_STATUSES;
  return PITCH_STATUSES.filter((s) => s !== "Lost in Expansion" || s === currentStage);
}

// Bulk fetch across every lab — mirrors fetchAllLabsAdoption. Rows are keyed the same way the UI reads
// them: "mod:<moduleKey>" for a module not yet in scope, "param:<moduleKey>|<paramName>" for an
// in-scope module's Expansion feature.
export async function fetchAllPitchStatus() {
  const { data, error } = await supabase.from("pitch_status").select("lab_id,module_key,param_name,status");
  if (error) throw error;
  const byLab = {};
  (data || []).forEach((r) => {
    byLab[r.lab_id] = byLab[r.lab_id] || {};
    const key = r.param_name ? `param:${r.module_key}|${r.param_name}` : `mod:${r.module_key}`;
    byLab[r.lab_id][key] = r.status;
  });
  return byLab;
}

// One lab's pitch records, keyed the same way as fetchAllPitchStatus's per-lab map — what the lab's own
// Adoption tab needs so its stage dropdowns match My Portfolio's (same pitch_status rows).
export async function fetchLabPitchStatus(labId) {
  const { data, error } = await supabase.from("pitch_status").select("module_key,param_name,status").eq("lab_id", labId);
  if (error) throw error;
  const map = {};
  (data || []).forEach((r) => {
    map[r.param_name ? `param:${r.module_key}|${r.param_name}` : `mod:${r.module_key}`] = r.status;
  });
  return map;
}

export function getModulePitchStatus(pitchForLab, moduleKey) {
  return (pitchForLab && pitchForLab[`mod:${moduleKey}`]) || "To Do";
}
export function getParamPitchStatus(pitchForLab, moduleKey, paramName, paramIncluded) {
  const key = `param:${moduleKey}|${paramName}`;
  if (pitchForLab && pitchForLab[key]) return pitchForLab[key];
  return paramIncluded ? "Added" : "To Do";
}

async function upsertPitchStatus(labId, moduleKey, paramName, status) {
  const { error } = await supabase.from("pitch_status").upsert(
    { lab_id: labId, module_key: moduleKey, param_name: paramName, status },
    { onConflict: "lab_id,module_key,param_name" }
  );
  if (error) throw error;
}

// Every pitch-stage change — whatever the stage, with or without a comment — is written to Lab History
// as a check-in-sourced entry (activity_log.source = 'checkin'), so it sits alongside the lab's logged
// check-ins. `comment` is optional; `from` is the stage it moved away from; `label` is the human name of
// the module/feature (falls back to the raw key when a caller doesn't have one).
function logPitchChange(labId, { moduleKey, paramName, label, from, to, comment, csmId, kind = "Pitch Updated", title }) {
  const what = label || paramName || moduleKey;
  const trimmed = (comment || "").trim();
  // Also part of the parameter's own audit trail (Adoption tab → click the parameter).
  if (paramName && trimmed) {
    recordParamChange(labId, moduleKey, paramName, `Stage: ${from || "—"} → ${to}`, trimmed, csmId).catch((err) => console.error(err));
  }
  return logActivity(labId, {
    kind,
    title: title || `Pitch stage changed: ${from || "—"} → ${to}`,
    meta: `${what}: ${from || "—"} → ${to}${trimmed ? ` — ${trimmed}` : ""}`,
    csmId,
    source: "checkin",
    details: { pitch: { moduleKey, paramName: paramName || null, label: what, from: from || null, to, comment: trimmed || null } },
  }).catch((err) => console.error(err));
}

export async function setModulePitchStatus(labId, moduleKey, status, csmId, { comment, from, label } = {}) {
  await upsertPitchStatus(labId, moduleKey, null, status);
  logPitchChange(labId, { moduleKey, paramName: null, label, from, to: status, comment, csmId });
}

export async function setParamPitchStatus(labId, moduleKey, paramName, status, csmId, { comment, from, label } = {}) {
  await upsertPitchStatus(labId, moduleKey, paramName, status);
  logPitchChange(labId, { moduleKey, paramName, label, from, to: status, comment, csmId });
}

// Every open pitch across a set of labs — a read-only summary for Tasks → Pitch Reminders. Under the v2
// adoption model that's every parameter that is Not in plan, not purchased yet, and still at To Do / Pitching /
// In Progress (see resolveParam in lib/adoption.js — the same logic each lab's Adoption tab uses).
export function buildActivePitchRows({ labs, modules, plans, adoptionByLab, pitchByLab }) {
  const rows = [];
  labs.forEach((lab) => {
    const plan = plans.find((p) => p.id === lab.plan) || plans[0];
    if (!plan) return;
    const pf = pitchByLab[lab.id];
    modules.forEach((mod) => {
      mod.params.forEach((p) => {
        const r = resolveParam(plan, mod, p, adoptionByLab[lab.id], pf);
        if (r.inPlan || r.purchased || !PITCH_ACTIVE_STATUSES.includes(r.pitch)) return;
        rows.push({
          labId: lab.id, labName: lab.name, csm: lab.csm,
          level: "param", moduleKey: mod.key, paramName: p.name,
          label: `Pitch ${p.name} (${mod.name})`, status: r.pitch,
          existingParamState: r.state,
        });
      });
    });
  });
  return rows;
}

// Confirms an "Added" pitch: records the pitch status, graduates the feature/module onto the Adoption
// tab, and creates a real Collections item so there's something to collect against.
export async function markFeatureAdded(target, amount, isTrial, csmId, comment) {
  const { labId, moduleKey, paramName, level, label, existingParamState, fromStatus } = target;
  await upsertPitchStatus(labId, moduleKey, level === "param" ? paramName : null, "Added");
  if (level === "module") {
    await markModuleInScope(labId, moduleKey);
  } else {
    await markParamIncluded(labId, moduleKey, paramName, existingParamState);
  }
  await addCollectionsItem({ labId, moduleKey, paramName: level === "param" ? paramName : null, label, amount: isTrial ? 0 : amount, isTrial, csmId });
  const trimmed = (comment || "").trim();
  const sym = target.region === "ROW" ? "$" : "₹";
  if (level === "param" && trimmed) {
    await recordParamChange(labId, moduleKey, paramName,
      `Stage: ${fromStatus || "—"} → Added (${isTrial ? "trial" : `${sym}${amount.toLocaleString("en-IN")}/mo`})`, trimmed, csmId)
      .catch((err) => console.error(err));
  }
  await logActivity(labId, {
    kind: "Expansion Converted",
    title: `Pitch stage changed: ${fromStatus || "—"} → Added`,
    meta: `${label}: ${fromStatus || "—"} → Added${isTrial ? " — trial/free" : ` — ${sym}${amount.toLocaleString("en-IN")}/mo`}${trimmed ? ` — ${trimmed}` : ""}`,
    csmId,
    source: "checkin",
    details: { pitch: { moduleKey, paramName: level === "param" ? paramName : null, label, from: fromStatus || null, to: "Added", comment: trimmed || null, amount: isTrial ? 0 : amount, isTrial } },
  });
}

// The Collections entries created when this feature/module was Added (newest first). Module-level pitches
// have param_name null.
export async function fetchFeatureCollectionsItems(labId, moduleKey, paramName) {
  let q = supabase.from("collections_items")
    .select("id,amount,is_trial,collected_manual,label,added_date,created_at")
    .eq("lab_id", labId).eq("module_key", moduleKey)
    .order("created_at", { ascending: false });
  q = paramName ? q.eq("param_name", paramName) : q.is("param_name", null);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// "Lost after Purchase": records the stage (with the optional comment, logged like every stage change),
// then takes the feature's monthly charge — the newest priced Collections entry for it — off the lab's own
// MRR (never below 0) and logs it as a Contraction so it shows in Reports → Churn Report / Total MRR
// Impact. A trial/free feature has no charge, so only the stage is recorded. Returns the new MRR (or null
// when MRR didn't change) so the caller can update the screen.
export async function markLostAfterPurchase(target, { labMrr, region, csmId, comment, from }) {
  const { labId, moduleKey, paramName, level, label } = target;
  const opts = { comment, from, label };
  if (level === "module") await setModulePitchStatus(labId, moduleKey, "Lost after Purchase", csmId, opts);
  else await setParamPitchStatus(labId, moduleKey, paramName, "Lost after Purchase", csmId, opts);

  const items = await fetchFeatureCollectionsItems(labId, moduleKey, level === "param" ? paramName : null);
  const priced = items.find((i) => !i.is_trial && Number(i.amount) > 0);
  if (!priced) return { newMrr: null, lostAmount: 0 };

  const lostAmount = Number(priced.amount);
  const newMrr = Math.max(0, (Number(labMrr) || 0) - lostAmount);
  await updateLabMRR(labId, newMrr, region, "lost");
  const sym = region === "ROW" ? "$" : "₹";
  const trimmed = (comment || "").trim();
  await logChurn(labId, {
    churnType: "Contraction",
    churnMonth: todayISO(),
    mrrLost: lostAmount,
    dueAmount: Math.max(0, lostAmount - (Number(priced.collected_manual) || 0)),
    reason: `Lost after purchase: ${label}${trimmed ? ` — ${trimmed}` : ""}`,
  }, csmId);
  await logActivity(labId, {
    kind: "MRR Updated",
    title: `MRR set to ${sym}${newMrr.toLocaleString("en-IN")}`,
    meta: `−${sym}${lostAmount.toLocaleString("en-IN")} — ${label} lost after purchase (the next recurring invoice resets MRR)`,
    csmId,
  }).catch((err) => console.error(err));
  return { newMrr, lostAmount };
}

// One entry point for every stage change (My Portfolio, Tasks → Pitch Reminders, a lab's Adoption tab), so
// the three screens can never drift apart. `target` = { labId, moduleKey, paramName, level, label,
// existingParamState, region }. Returns { newMrr, message } — newMrr is set only when the lab's MRR changed.
export async function applyPitchStageChange(target, { from, to, comment, amount, isTrial, csmId, labMrr }) {
  if (to === "Added") {
    await markFeatureAdded({ ...target, fromStatus: from }, amount, isTrial, csmId, comment);
    return { newMrr: null, message: `${target.label} marked Added${isTrial ? " (trial)" : ""}.` };
  }
  if (to === "Lost after Purchase") {
    const { newMrr, lostAmount } = await markLostAfterPurchase(target, { labMrr, region: target.region, csmId, comment, from });
    const sym = target.region === "ROW" ? "$" : "₹";
    return {
      newMrr,
      message: lostAmount
        ? `${target.label} lost — MRR reduced by ${sym}${lostAmount.toLocaleString("en-IN")} and logged as a Contraction.`
        : `${target.label} marked Lost after Purchase (no priced charge on record, so MRR is unchanged).`,
    };
  }
  const opts = { comment, from, label: target.label };
  if (target.level === "module") await setModulePitchStatus(target.labId, target.moduleKey, to, csmId, opts);
  else await setParamPitchStatus(target.labId, target.moduleKey, target.paramName, to, csmId, opts);
  return { newMrr: null, message: `${target.label}: ${from} → ${to}.` };
}
