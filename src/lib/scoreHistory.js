import { supabase } from "../supabaseClient";
import { computeLabScores, normalizePitch, normalizeStatus } from "./adoption";

// Past adoption scores. Nothing stores a score over time: every parameter change is already in param_changes
// (migration 0034), so a past date's score = today's states with every later change undone, scored by the normal rules.
// It always uses TODAY's template and Plans, so changing a weight re-reads the past through the new weights.
// Nothing exists before tracking began (a lab counts only from the day it was added).

export async function fetchAllParamChanges() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("param_changes").select("lab_id,module_key,param_name,change,created_at")
      .order("created_at", { ascending: false }).range(from, from + 999);
    if (error) throw error;
    (data || []).forEach((r) => out.push({ labId: r.lab_id, moduleKey: r.module_key, paramName: r.param_name, change: r.change, at: new Date(r.created_at).getTime() }));
    if (!data || data.length < 1000) break;
  }
  const byLab = {};
  out.forEach((c) => { (byLab[c.labId] = byLab[c.labId] || []).push(c); });
  return byLab; // labId -> changes, newest first
}

const ARROW = /^(Status|Stage):\s*(.+?)\s*→\s*(.+)$/;

// One lab's state as it was at `asOf`. `changes` = that lab's, newest first. Change texts are written by setParamStatus,
// setParamInPlan and pitch.js; anything else (e.g. adding charges) doesn't affect a score and is skipped.
export function rollBackLab(adoption, pitch, changes, asOf) {
  const later = (changes || []).filter((c) => c.at > asOf);
  if (!later.length) return { adoption, pitch };
  const paramState = { ...(adoption?.paramState || {}) };
  const pitchOut = { ...(pitch || {}) };
  later.forEach((c) => {
    const key = `${c.moduleKey}|${c.paramName}`;
    const st = { ...(paramState[key] || { inPlan: null, included: false, status: "To-Do" }) };
    const m = c.change.match(ARROW);
    if (m && m[1] === "Status") {
      st.status = normalizeStatus(m[2]);
    } else if (m) {
      const from = normalizePitch(m[2]);
      if (from === "—") delete pitchOut[`param:${key}`]; else pitchOut[`param:${key}`] = from;
      if (m[3].startsWith("Purchased")) { st.included = false; st.status = "To-Do"; } // buying set its rollout to Onboarding / Setup
      if (from === "Purchased") st.included = true;
    } else if (c.change === "In plan → Not in plan") {
      st.inPlan = true; st.included = true;
    } else if (c.change === "Not in plan → In plan") {
      st.inPlan = false; st.included = normalizePitch(pitchOut[`param:${key}`]) === "Purchased";
    } else {
      return;
    }
    paramState[key] = st;
  });
  return { adoption: { paramState }, pitch: pitchOut };
}

// Every given lab's computeLabScores at `asOf` (ms). A lab added after that moment isn't in the result.
export function labScoresAt(labs, { modules, plans, adoptionByLab, pitchByLab, changesByLab }, asOf) {
  const out = {};
  labs.forEach((lab) => {
    if (lab.createdAt && new Date(lab.createdAt).getTime() > asOf) return;
    const plan = plans.find((p) => p.id === lab.plan) || plans[0];
    const state = rollBackLab(adoptionByLab[lab.id], pitchByLab[lab.id], changesByLab[lab.id], asOf);
    out[lab.id] = computeLabScores(modules, plan, state.adoption, state.pitch);
  });
  return out;
}
