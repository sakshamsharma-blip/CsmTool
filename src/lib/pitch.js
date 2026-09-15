import { supabase } from "../supabaseClient";
import { markParamIncluded, markModuleInScope } from "./adoption";
import { addCollectionsItem } from "./collections";
import { logActivity } from "./activity";
import { planIncludesModule, planIncludesParam } from "./plans";

// The upsell/pitch worklist (My Portfolio) — for every Expansion-category feature (or whole module,
// if the module itself isn't in scope yet), a 5-state pitch status. "Added" is the one status with
// real consequences: the upsell succeeded, so the feature graduates onto the Adoption tab and a
// Collections item is created for it (see markFeatureAdded below).
export const PITCH_STATUSES = ["To Do", "Pitching", "In Progress", "Added", "Not Required"];
export const PITCH_ACTIVE_STATUSES = ["To Do", "Pitching", "In Progress"];

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

export async function setModulePitchStatus(labId, moduleKey, status, csmId) {
  await upsertPitchStatus(labId, moduleKey, null, status);
  logActivity(labId, { kind: "Pitch Updated", title: "Pitch status changed", meta: `${moduleKey} → ${status}`, csmId }).catch((err) => console.error(err));
}

export async function setParamPitchStatus(labId, moduleKey, paramName, status, csmId) {
  await upsertPitchStatus(labId, moduleKey, paramName, status);
  logActivity(labId, { kind: "Pitch Updated", title: "Pitch status changed", meta: `${paramName} → ${status}`, csmId }).catch((err) => console.error(err));
}

// Every Expansion-category pitch item across a set of labs that's still active (To Do / Pitching /
// In Progress) — a read-only summary for the all-tasks page's "Pitch Reminders" section. My Portfolio
// stays the one place pitch status actually gets changed; this just surfaces what's still open there
// so it isn't easy to lose track of alongside regular tasks. Mirrors the exact in-scope logic each
// lab's own Adoption tab and My Portfolio use (saved per-lab overrides first, falling back to the
// assigned Plan's defaults).
export function buildActivePitchRows({ labs, modules, plans, adoptionByLab, pitchByLab }) {
  function isModuleInScope(lab, moduleKey, plan) {
    const a = adoptionByLab[lab.id];
    if (a && Object.prototype.hasOwnProperty.call(a.scope, moduleKey)) return a.scope[moduleKey];
    return planIncludesModule(plan, moduleKey);
  }
  function isParamInScope(lab, moduleKey, paramName, plan) {
    const a = adoptionByLab[lab.id];
    const key = `${moduleKey}|${paramName}`;
    if (a && Object.prototype.hasOwnProperty.call(a.paramScope, key)) return a.paramScope[key];
    return planIncludesParam(plan, moduleKey, paramName);
  }
  function paramIncluded(lab, moduleKey, paramName) {
    const a = adoptionByLab[lab.id];
    const key = `${moduleKey}|${paramName}`;
    return !!(a && a.paramState[key] && a.paramState[key].included);
  }

  const rows = [];
  labs.forEach((lab) => {
    const plan = plans.find((p) => p.id === lab.plan) || plans[0];
    if (!plan) return;
    const pf = pitchByLab[lab.id];
    modules.forEach((mod) => {
      if (!isModuleInScope(lab, mod.key, plan)) {
        const status = getModulePitchStatus(pf, mod.key);
        if (PITCH_ACTIVE_STATUSES.includes(status)) {
          rows.push({
            labId: lab.id, labName: lab.name, csm: lab.csm,
            level: "module", moduleKey: mod.key, paramName: null,
            label: `Pitch ${mod.name} (new module)`, status,
          });
        }
        return;
      }
      mod.params.forEach((p) => {
        if (p.category !== "Expansion" || !isParamInScope(lab, mod.key, p.name, plan)) return;
        const status = getParamPitchStatus(pf, mod.key, p.name, paramIncluded(lab, mod.key, p.name));
        if (PITCH_ACTIVE_STATUSES.includes(status)) {
          rows.push({
            labId: lab.id, labName: lab.name, csm: lab.csm,
            level: "param", moduleKey: mod.key, paramName: p.name,
            label: `Pitch ${p.name} (${mod.name})`, status,
          });
        }
      });
    });
  });
  return rows;
}

// Confirms an "Added" pitch: records the pitch status, graduates the feature/module onto the Adoption
// tab, and creates a real Collections item so there's something to collect against.
export async function markFeatureAdded(target, amount, isTrial, csmId) {
  const { labId, moduleKey, paramName, level, label, existingParamState } = target;
  await upsertPitchStatus(labId, moduleKey, level === "param" ? paramName : null, "Added");
  if (level === "module") {
    await markModuleInScope(labId, moduleKey);
  } else {
    await markParamIncluded(labId, moduleKey, paramName, existingParamState);
  }
  await addCollectionsItem({ labId, moduleKey, paramName: level === "param" ? paramName : null, label, amount: isTrial ? 0 : amount, isTrial, csmId });
  await logActivity(labId, {
    kind: "Expansion Converted",
    title: "Marked Added",
    meta: `${label}${isTrial ? " — trial/free" : ` — ₹${amount.toLocaleString("en-IN")}/mo`}`,
    csmId,
  });
}
