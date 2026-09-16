import { supabase } from "../supabaseClient";

// idByName / nameById translate between the UI (works with CSM names) and the database
// (labs.csm_id is a real profiles.id uuid) — same bridge app.html used.
export async function fetchLabs(idByName) {
  const { data, error } = await supabase.from("labs").select("*");
  if (error) throw error;
  const nameById = {};
  Object.entries(idByName).forEach(([name, id]) => { nameById[id] = name; });
  return data.map((l) => ({
    id: l.id,
    name: l.name,
    type: l.type,
    parent: l.parent_id,
    csm: nameById[l.csm_id] || "",
    plan: l.plan_id,
    region: l.region,
    city: l.city,
    state: l.state,
    country: l.country,
    mrr: Number(l.mrr) || 0,
    status: l.status,
    creditDays: l.credit_days != null ? String(l.credit_days) : "30",
    billingType: l.billing_type || "Fixed",
    paymentCycle: l.payment_cycle || "Monthly",
    remarks: l.remarks || "",
    healthStatus: l.health_status || null,
    lastRating: l.last_rating != null ? Number(l.last_rating) : null,
    stageTags: l.stage_tags || [],
    testimonialCollected: !!l.testimonial_collected,
    testimonialVideoUrl: l.testimonial_video_url || "",
    testimonialCollectedBy: l.testimonial_collected_by || null,
    testimonialCollectedAt: l.testimonial_collected_at || null,
  }));
}

export async function insertLab(lab, idByName) {
  const { error } = await supabase.from("labs").insert({
    id: lab.id,
    name: lab.name,
    type: lab.type,
    parent_id: lab.parent || null,
    csm_id: idByName[lab.csm] || null,
    plan_id: lab.plan,
    region: lab.region,
    city: lab.city || null,
    state: lab.state,
    country: lab.country,
    mrr: lab.mrr,
    status: lab.status,
    credit_days: lab.creditDays ? parseInt(lab.creditDays, 10) : null,
    billing_type: lab.billingType || null,
    payment_cycle: lab.paymentCycle || null,
    remarks: lab.remarks || null,
  });
  if (error) throw error;
  recordMrrSnapshot(lab.id, lab.mrr, lab.region, "lab_created").catch((err) => console.error(err));
}

// One row per MRR change, going forward — see migrations/0011 for why this can't be backfilled.
// Best-effort, fire-and-forget from callers — same convention as logActivity — a snapshot
// failure should never block the real MRR write that triggered it.
export async function recordMrrSnapshot(labId, mrr, region, source = "manual") {
  const { error } = await supabase.from("mrr_snapshot").insert({ lab_id: labId, mrr, region, source });
  if (error) throw error;
}

export async function fetchMrrHistory(labId) {
  const { data, error } = await supabase
    .from("mrr_snapshot")
    .select("id,mrr,region,source,logged_at")
    .eq("lab_id", labId)
    .order("logged_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((r) => ({ id: r.id, mrr: Number(r.mrr) || 0, region: r.region, source: r.source, loggedAt: r.logged_at }));
}

export async function updateLabCsm(labId, csmName, idByName) {
  const { error } = await supabase.from("labs").update({ csm_id: idByName[csmName] || null }).eq("id", labId);
  if (error) throw error;
}

export async function updateLabPlan(labId, planId) {
  const { error } = await supabase.from("labs").update({ plan_id: planId }).eq("id", labId);
  if (error) throw error;
}

// Called when a Monthly invoice is uploaded and confirmed — see src/lib/invoices.js. Amount is
// in the lab's own native currency (INR for Domestic, USD for ROW).
export async function updateLabMRR(labId, newMrr, region) {
  const { error } = await supabase.from("labs").update({ mrr: newMrr }).eq("id", labId);
  if (error) throw error;
  if (region) recordMrrSnapshot(labId, newMrr, region, "invoice").catch((err) => console.error(err));
}

// Plain status changes (Active/Inactive/At Risk) — NOT for Churned, which goes through
// src/lib/churn.js's logChurn() instead, since that needs a churn_log detail record alongside
// the status flip.
export async function updateLabStatus(labId, status) {
  const { error } = await supabase.from("labs").update({ status }).eq("id", labId);
  if (error) throw error;
}

export async function updateLabStageTags(labId, tags) {
  const { error } = await supabase.from("labs").update({ stage_tags: tags }).eq("id", labId);
  if (error) throw error;
}

export async function updateLabTestimonial(labId, { collected, videoUrl, csmId }) {
  const { error } = await supabase.from("labs").update({
    testimonial_collected: collected,
    testimonial_video_url: videoUrl || null,
    testimonial_collected_by: collected ? csmId || null : null,
    testimonial_collected_at: collected ? new Date().toISOString() : null,
  }).eq("id", labId);
  if (error) throw error;
}
