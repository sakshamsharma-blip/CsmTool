import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";

export const HEALTH_STATUSES = ["No Risk", "Happy", "Unhappy", "Risky Churn", "Churn", "Assign CS"];

// "No Risk" and "Happy" read as healthy; everything else is worth a CSM's attention — used to
// color the status pill/chip consistently wherever health shows up (Total Labs, Lab Detail).
export function isHealthyStatus(status) {
  return status === "No Risk" || status === "Happy";
}

export async function fetchLabPulseHistory(labId) {
  const { data, error } = await supabase
    .from("lab_pulse_log")
    .select("id,health_status,rating,note,csm_id,logged_at")
    .eq("lab_id", labId)
    .order("logged_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id, healthStatus: r.health_status, rating: r.rating != null ? Number(r.rating) : null,
    note: r.note || "", csmId: r.csm_id, loggedAt: r.logged_at,
  }));
}

// One pulse check captures health status + an optional satisfaction rating together (matches
// how the source tracking sheet records both in the same monthly pass) — denormalizes onto
// labs.health_status / labs.last_rating for fast list display, and logs to Lab History same as
// every other lab-level change.
export async function logLabPulse(labId, { healthStatus, rating, note }, csmId) {
  const { error: e1 } = await supabase.from("lab_pulse_log").insert({
    lab_id: labId, health_status: healthStatus, rating: rating ?? null, note: note || null, csm_id: csmId || null,
  });
  if (e1) throw e1;
  const { error: e2 } = await supabase.from("labs").update({
    health_status: healthStatus, last_rating: rating ?? null,
  }).eq("id", labId);
  if (e2) throw e2;
  await logActivity(labId, {
    kind: "Health Check",
    title: `Health set to ${healthStatus}${rating != null ? ` · rating ${rating}/10` : ""}`,
    meta: note || null,
    csmId,
    source: "system",
  });
}
