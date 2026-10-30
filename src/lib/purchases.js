import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";
import { todayISO } from "./dates";

// Features a lab bought through Expansion (Purchased stage) — migration 0042. One row = one purchase: when it was bought,
// Priced (monthly charge) or Trial, whether it was later lost. This is where purchase details live; Collections is
// invoice-driven only and a purchase no longer writes there. Amounts are in the lab's own currency (INR Domestic / USD ROW).
const COLUMNS = "id,lab_id,module_key,param_name,label,is_trial,monthly_charge,purchased_on,charges_added_on,status,lost_on,lost_comment,csm_id,created_at";

function mapRow(r) {
  return {
    id: r.id, labId: r.lab_id, moduleKey: r.module_key, paramName: r.param_name || null, label: r.label,
    isTrial: !!r.is_trial, monthlyCharge: Number(r.monthly_charge) || 0, purchasedOn: r.purchased_on,
    chargesAddedOn: r.charges_added_on, status: r.status, lostOn: r.lost_on, lostComment: r.lost_comment || "",
    csmId: r.csm_id, createdAt: r.created_at,
  };
}

export async function fetchAllPurchases() {
  const { data, error } = await supabase.from("feature_purchases").select(COLUMNS).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRow);
}

export async function fetchLabPurchases(labId) {
  const { data, error } = await supabase.from("feature_purchases").select(COLUMNS).eq("lab_id", labId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRow);
}

// Shape the Adoption tab's "Priced ₹X/mo / Trial · Add charges" tag reads (same fields a Collections item had).
export function purchaseAsCharge(p) {
  return { kind: "purchase", id: p.id, labId: p.labId, label: p.label, isTrial: p.isTrial, amount: p.monthlyCharge, moduleKey: p.moduleKey, paramName: p.paramName };
}

export async function recordPurchase({ labId, moduleKey, paramName, label, isTrial, amount, csmId }) {
  const { error } = await supabase.from("feature_purchases").insert({
    lab_id: labId, module_key: moduleKey, param_name: paramName || null, label,
    is_trial: !!isTrial, monthly_charge: isTrial ? 0 : amount, purchased_on: todayISO(), csm_id: csmId || null,
  });
  if (error) throw error;
}

// The newest still-active purchase of this feature (module-level pitches have paramName null).
export async function fetchActivePurchase(labId, moduleKey, paramName) {
  let q = supabase.from("feature_purchases").select(COLUMNS).eq("lab_id", labId).eq("module_key", moduleKey).eq("status", "Active");
  q = paramName ? q.eq("param_name", paramName) : q.is("param_name", null);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  return data && data.length ? mapRow(data[0]) : null;
}

// "Add charges" on a trial purchase: sets the monthly charge. MRR is NOT touched — it moves with invoices.
export async function addPurchaseCharges(id, amount, labId, csmId, label, region) {
  const { error } = await supabase.from("feature_purchases")
    .update({ is_trial: false, monthly_charge: amount, charges_added_on: todayISO() }).eq("id", id);
  if (error) throw error;
  logActivity(labId, {
    kind: "Expansion Update",
    title: "Charges added (trial → priced)",
    meta: `${label || "Feature"} now billed at ${region === "ROW" ? "$" : "₹"}${Number(amount).toLocaleString("en-IN")}/mo — MRR updates from the next invoice`,
    csmId,
  }).catch((err) => console.error(err));
}

export async function markPurchaseLost(id, comment) {
  const { error } = await supabase.from("feature_purchases")
    .update({ status: "Lost", lost_on: todayISO(), lost_comment: (comment || "").trim() || null }).eq("id", id);
  if (error) throw error;
}

// Every purchased feature's charge across labs: the active purchase records, plus older Collections entries (from before
// purchases had their own record) for features that have none — what the Priced / Trial tags read.
export function mergeCharges(purchases, legacyItems) {
  const fromPurchases = purchases.filter((p) => p.status === "Active").map(purchaseAsCharge);
  const covered = new Set(fromPurchases.map((c) => `${c.labId}|${c.moduleKey}|${c.paramName}`));
  return [...fromPurchases, ...legacyItems.filter((i) => !covered.has(`${i.labId}|${i.moduleKey}|${i.paramName}`))];
}
