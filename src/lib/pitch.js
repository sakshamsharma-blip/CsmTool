import { supabase } from "../supabaseClient";
import { markParamIncluded, markModuleInScope, resolveParam, recordParamChange, normalizePitch, STATUS_ACTIVE } from "./adoption";
import { addCollectionsItem } from "./collections";
import { logActivity } from "./activity";
import { updateLabMRR } from "./labs";
import { logChurn } from "./churn";
import { todayISO } from "./dates";

// Expansion stages for a Not-in-plan parameter (list and order: decision Oct 23 2026). "Purchased" is the one
// stage with real consequences: it asks Priced or Trial, creates a Collections item and moves the feature onto
// the In-plan track (see markFeatureAdded below). The two Lost stages are kept at the end: "Lost in Expansion" =
// the pitch never converted (recorded + logged only). "Lost after Purchase" = it was bought and then lost: the
// lab's MRR drops by that feature's charge and it's logged as a Contraction (see markLostAfterPurchase).
// (Onboarding / Setup was removed from this list Oct 26 2026 — onboarding happens on the In-plan list after Purchased.)
export const PITCH_STATUSES = ["To-Do", "Pitching", "Trial", "Purchased", "Not Required", "Not Applicable", "Lost in Expansion", "Lost after Purchase"];
// Stages that mean work is under way — these show up in Tasks (with STATUS_ACTIVE for In-plan items).
export const PITCH_ACTIVE_STATUSES = ["Pitching", "Trial"];
// Still open (not bought, not closed) — what My Portfolio lists as "to pitch".
export const PITCH_OPEN_STATUSES = ["To-Do", ...PITCH_ACTIVE_STATUSES];
export const PITCH_LOST_STATUSES = ["Lost in Expansion", "Lost after Purchase"];
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

export function getModulePitchStatus(pitchForLab, moduleKey) {
  return (pitchForLab && pitchForLab[`mod:${moduleKey}`]) || "To-Do";
}
export function getParamPitchStatus(pitchForLab, moduleKey, paramName, paramIncluded) {
  const key = `param:${moduleKey}|${paramName}`;
  if (pitchForLab && pitchForLab[key]) return pitchForLab[key];
  return paramIncluded ? "Purchased" : "To-Do";
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

// Every item that is UNDER WAY across a set of labs — what Tasks lists (decision Oct 23 2026: an item becomes a task
// only once it moves past To-Do). In plan / purchased: In Discussion / Demo, Trial, Onboarding / Setup, Live 1–4.
// Not in plan: Pitching, Trial. `changesByParam` ("<lab>|<module>|<param>" → ascending param_changes rows)
// gives the date it got under way: the start of its latest unbroken run of active stages (null if unrecorded).
export function buildActiveItemRows({ labs, modules, plans, adoptionByLab, pitchByLab, changesByParam = {} }) {
  const rows = [];
  labs.forEach((lab) => {
    const plan = plans.find((p) => p.id === lab.plan) || plans[0];
    if (!plan) return;
    const pf = pitchByLab[lab.id];
    modules.forEach((mod) => {
      mod.params.forEach((p) => {
        const r = resolveParam(plan, mod, p, adoptionByLab[lab.id], pf);
        if (r.lost) return;
        const planTrack = r.inPlan || r.purchased;
        const status = planTrack ? r.status : r.pitch;
        const active = planTrack ? STATUS_ACTIVE : PITCH_ACTIVE_STATUSES;
        if (!active.includes(status)) return;
        rows.push({
          labId: lab.id, labName: lab.name, csm: lab.csm, moduleKey: mod.key, moduleName: mod.name, paramName: p.name,
          category: planTrack ? "In-Plan" : "Not-in-Plan", status, resolved: r,
          startedAt: activeSince(changesByParam[`${lab.id}|${mod.key}|${p.name}`], active),
        });
      });
    });
  });
  return rows;
}

// Start of the latest unbroken run of changes INTO an active stage ("Status: A → B" / "Stage: A → B").
function activeSince(changes, active) {
  if (!changes || !changes.length) return null;
  let since = null;
  changes.forEach((c) => {
    const m = /→ ([^(]+?)(?: \(|$)/.exec(c.change || "");
    if (!m) return;
    const to = normalizePitch(m[1].trim()); // older trail rows use the pre-0038 names
    if (active.includes(to)) { if (!since) since = c.created_at; } else since = null;
  });
  return since;
}

// Confirms an "Added" pitch: records the pitch status, graduates the feature/module onto the Adoption
// tab, and creates a real Collections item so there's something to collect against.
export async function markFeatureAdded(target, amount, isTrial, csmId, comment) {
  const { labId, moduleKey, paramName, level, label, existingParamState, fromStatus } = target;
  await upsertPitchStatus(labId, moduleKey, level === "param" ? paramName : null, "Purchased");
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
  if (to === "Purchased") {
    await markFeatureAdded({ ...target, fromStatus: from }, amount, isTrial, csmId, comment);
    return { newMrr: null, message: `${target.label} marked Purchased${isTrial ? " (trial)" : ""} — now tracked on the In-plan list.` };
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
