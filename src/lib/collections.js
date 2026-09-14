import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";

// Basic manual Collections tracker — itemized owed/collected per "Added" upsell, using the real
// collections_items table. No Zoho Books sync exists yet, so unlike the prototype's simulated
// reconciliation (collected_manual vs a fake collected_zoho, with a "Conflict" state when they
// differ), this only tracks what a CSM manually logs as collected. Status is simply
// Pending -> Collected, or Resolved for a trial/free item (nothing owed). collected_zoho and the
// Matched/Conflict states stay in the schema, unused, for whenever a real Zoho sync lands.
export async function fetchAllCollectionsItems() {
  const { data, error } = await supabase
    .from("collections_items")
    .select("id,lab_id,module_key,param_name,label,amount,is_trial,added_date,collected_manual,status,resolution_comment,csm_id,created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    labId: r.lab_id,
    moduleKey: r.module_key,
    paramName: r.param_name,
    label: r.label,
    amount: Number(r.amount) || 0,
    isTrial: r.is_trial,
    addedDate: r.added_date,
    collectedManual: r.collected_manual != null ? Number(r.collected_manual) : null,
    status: r.status,
    resolutionComment: r.resolution_comment || "",
    csmId: r.csm_id,
  }));
}

export async function addCollectionsItem({ labId, moduleKey, paramName, label, amount, isTrial, csmId }) {
  const { error } = await supabase.from("collections_items").insert({
    lab_id: labId,
    module_key: moduleKey,
    param_name: paramName || null,
    label,
    amount: isTrial ? 0 : amount,
    is_trial: isTrial,
    status: isTrial ? "Resolved" : "Pending",
    resolution_comment: isTrial ? "Trial/free — nothing to collect yet." : null,
    csm_id: csmId || null,
  });
  if (error) throw error;
}

export async function markItemCollected(itemId, manualAmount, labId, csmId) {
  const { error } = await supabase
    .from("collections_items")
    .update({ collected_manual: manualAmount, status: "Resolved" })
    .eq("id", itemId);
  if (error) throw error;
  logActivity(labId, {
    kind: "Collections Update",
    title: "Collection marked collected",
    meta: `₹${manualAmount.toLocaleString("en-IN")} collected`,
    csmId,
  }).catch((err) => console.error(err));
}
