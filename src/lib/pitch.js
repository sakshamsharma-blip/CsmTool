import { supabase } from "../supabaseClient";
import { markParamIncluded, markModuleInScope, recordParamChange, normalizePitch, STATUS_ACTIVE, PURCHASED_START_STATUS } from "./adoption";
import { recordPurchase, fetchActivePurchase, markPurchaseLost } from "./purchases";
import { logActivity } from "./activity";
import { updateLabMRR } from "./labs";
import { logChurn } from "./churn";
import { todayISO } from "./dates";
import { syncItemTask, closeItemTasks } from "./tasks";

// Expansion stages for a Not-in-plan parameter (list and order: decision Oct 23 2026). "Purchased" is the one
// stage with real consequences: it asks Priced or Trial, records the purchase on the Expansion tab (feature_purchases —
// Collections is invoice-only and is not written to) and moves the feature onto the In-plan track (see
// markFeatureAdded below). The two Lost stages are kept at the end: "Lost in Expansion" =
// the pitch never converted (recorded + logged only). "Lost after Purchase" = it was bought and then lost: the
// lab's MRR drops by that feature's charge and it's logged as a Contraction (see markLostAfterPurchase).
// (Onboarding / Setup was removed from this list Oct 26 2026 — onboarding happens on the In-plan list after Purchased.)
export const PITCH_STATUSES = ["To-Do", "Pitching", "Trial", "Purchased", "Not Required", "Not Applicable", "Lost in Expansion", "Lost after Purchase"];
// Stages that mean work is under way — an item at one of these has an open task on Tasks (with STATUS_ACTIVE for In-plan items).
export const PITCH_ACTIVE_STATUSES = ["Pitching", "Trial"];
// Still open (not bought, not closed) — what My Portfolio lists as "to pitch".
export const PITCH_OPEN_STATUSES = ["To-Do", ...PITCH_ACTIVE_STATUSES];
export { STATUS_ACTIVE };

// Stage choices for one parameter. Once a feature has been bought it is on the In-plan track (its status
// dropdown); the only Expansion stage left for it is "Lost after Purchase" (which lowers MRR and logs a
// Contraction) — "Lost in Expansion" only if that's already its stage (older data).
export function pitchOptionsFor(purchased, currentStage) {
  if (!purchased) return PITCH_STATUSES.filter((s) => s !== "Lost after Purchase" || s === currentStage);
  return PITCH_STATUSES.filter((s) => s === "Purchased" || s === "Lost after Purchase" || s === currentStage);
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
    byLab[r.lab_id][key] = normalizePitch(r.status);
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
    map[r.param_name ? `param:${r.module_key}|${r.param_name}` : `mod:${r.module_key}`] = normalizePitch(r.status);
  });
  return map;
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

// Confirms an "Added" pitch: records the pitch status, graduates the feature/module onto the Adoption
// tab, and records the purchase (date, Priced / Trial, monthly charge) on the Expansion tab. It does NOT touch
// Collections — that is driven only by uploaded invoices.
export async function markFeatureAdded(target, amount, isTrial, csmId, comment) {
  const { labId, moduleKey, paramName, level, label, existingParamState, fromStatus } = target;
  await upsertPitchStatus(labId, moduleKey, level === "param" ? paramName : null, "Purchased");
  if (level === "module") {
    await markModuleInScope(labId, moduleKey);
  } else {
    await markParamIncluded(labId, moduleKey, paramName, existingParamState);
  }
  await recordPurchase({ labId, moduleKey, paramName: level === "param" ? paramName : null, label, amount: isTrial ? 0 : amount, isTrial, csmId });
  const trimmed = (comment || "").trim();
  const sym = target.region === "ROW" ? "$" : "₹";
  if (level === "param" && trimmed) {
    await recordParamChange(labId, moduleKey, paramName,
      `Stage: ${fromStatus || "—"} → Purchased (${isTrial ? "trial" : `${sym}${amount.toLocaleString("en-IN")}/mo`})`, trimmed, csmId)
      .catch((err) => console.error(err));
  }
  await logActivity(labId, {
    kind: "Expansion Converted",
    title: `Pitch stage changed: ${fromStatus || "—"} → Purchased`,
    meta: `${label}: ${fromStatus || "—"} → Purchased${isTrial ? " — trial/free" : ` — ${sym}${amount.toLocaleString("en-IN")}/mo`}${trimmed ? ` — ${trimmed}` : ""}`,
    csmId,
    source: "checkin",
    details: { pitch: { moduleKey, paramName: level === "param" ? paramName : null, label, from: fromStatus || null, to: "Purchased", comment: trimmed || null, amount: isTrial ? 0 : amount, isTrial } },
  });
}

// Older purchases (before Oct 30 2026) created a Collections entry instead of a purchase record — still read as the
// fallback when a feature has no purchase record. Module-level pitches have param_name null.
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
// then takes the feature's monthly charge — from its purchase record (older purchases: the newest priced Collections
// entry) — off the lab's own
// MRR (never below 0) and logs it as a Contraction so it shows in Reports → Churn Report / Total MRR
// Impact. A trial/free feature has no charge, so only the stage is recorded. Returns the new MRR (or null
// when MRR didn't change) so the caller can update the screen.
export async function markLostAfterPurchase(target, { labMrr, region, csmId, comment, from }) {
  const { labId, moduleKey, paramName, level, label } = target;
  const opts = { comment, from, label };
  if (level === "module") await setModulePitchStatus(labId, moduleKey, "Lost after Purchase", csmId, opts);
  else await setParamPitchStatus(labId, moduleKey, paramName, "Lost after Purchase", csmId, opts);

  const purchase = await fetchActivePurchase(labId, moduleKey, level === "param" ? paramName : null);
  if (purchase) await markPurchaseLost(purchase.id, comment);
  let lostAmount = 0, dueAmount = 0;
  if (purchase && !purchase.isTrial && purchase.monthlyCharge > 0) {
    lostAmount = purchase.monthlyCharge;
  } else if (!purchase) {
    const items = await fetchFeatureCollectionsItems(labId, moduleKey, level === "param" ? paramName : null);
    const priced = items.find((i) => !i.is_trial && Number(i.amount) > 0);
    if (priced) { lostAmount = Number(priced.amount); dueAmount = Math.max(0, lostAmount - (Number(priced.collected_manual) || 0)); }
  }
  if (!lostAmount) return { newMrr: null, lostAmount: 0 };

  const newMrr = Math.max(0, (Number(labMrr) || 0) - lostAmount);
  await updateLabMRR(labId, newMrr, region, "lost");
  const sym = region === "ROW" ? "$" : "₹";
  const trimmed = (comment || "").trim();
  await logChurn(labId, {
    churnType: "Contraction",
    churnMonth: todayISO(),
    mrrLost: lostAmount,
    dueAmount,
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
// `due` (optional) = due date for the item's task when it is (still) under way.
export async function applyPitchStageChange(target, { from, to, comment, amount, isTrial, csmId, labMrr, due }) {
  const isParam = target.level !== "module";
  const item = { labId: target.labId, moduleKey: target.moduleKey, paramName: target.paramName, actorId: csmId };
  if (to === "Purchased") {
    await markFeatureAdded({ ...target, fromStatus: from }, amount, isTrial, csmId, comment);
    if (isParam) {
      // The Expansion cycle is complete; the feature starts on the In-plan list at Onboarding / Setup.
      await syncItemTask({ ...item, source: "Expansion", stage: "Purchased", active: false }).catch((err) => console.error(err));
      await syncItemTask({ ...item, source: "Adoption", stage: PURCHASED_START_STATUS, active: true, due }).catch((err) => console.error(err));
    }
    return { newMrr: null, message: `${target.label} marked Purchased${isTrial ? " (trial)" : ""} — now on the In-plan list at ${PURCHASED_START_STATUS}.` };
  }
  if (to === "Lost after Purchase") {
    if (isParam) await closeItemTasks(target.labId, target.moduleKey, target.paramName, csmId).catch((err) => console.error(err));
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
  else {
    await setParamPitchStatus(target.labId, target.moduleKey, target.paramName, to, csmId, opts);
    await syncItemTask({ ...item, source: "Expansion", stage: to, active: PITCH_ACTIVE_STATUSES.includes(to), due }).catch((err) => console.error(err));
  }
  return { newMrr: null, message: `${target.label}: ${from} → ${to}.` };
}
