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
export async function updateLabMRR(labId, newMrr) {
  const { error } = await supabase.from("labs").update({ mrr: newMrr }).eq("id", labId);
  if (error) throw error;
}
