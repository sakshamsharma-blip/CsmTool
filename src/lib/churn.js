import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";
import { updateLabStatus } from "./labs";

export const CHURN_TYPES = ["Churned", "Contraction"];

export function quarterOf(dateStr) {
  if (!dateStr) return "";
  const m = new Date(dateStr).getMonth(); // 0-indexed
  return `Q${Math.floor(m / 3) + 1}`;
}

export async function fetchChurnLog() {
  const { data, error } = await supabase
    .from("churn_log")
    .select("id,lab_id,churn_type,churn_month,mrr_lost,due_amount,reason,csm_id,logged_at")
    .order("churn_month", { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id, labId: r.lab_id, churnType: r.churn_type, churnMonth: r.churn_month,
    mrrLost: Number(r.mrr_lost) || 0, dueAmount: Number(r.due_amount) || 0,
    reason: r.reason || "", csmId: r.csm_id, loggedAt: r.logged_at,
  }));
}

// Logs the churn/contraction record and, only for a full Churn (not a Contraction — the lab is
// still a customer, just smaller), flips the lab's status. mrrLost/dueAmount are passed in by
// the caller, which already has the lab's current MRR and Collections balance loaded.
export async function logChurn(labId, { churnType, churnMonth, mrrLost, dueAmount, reason }, csmId) {
  const { error: e1 } = await supabase.from("churn_log").insert({
    lab_id: labId, churn_type: churnType, churn_month: churnMonth,
    mrr_lost: mrrLost || 0, due_amount: dueAmount || 0, reason: reason || null, csm_id: csmId || null,
  });
  if (e1) throw e1;
  if (churnType === "Churned") {
    await updateLabStatus(labId, "Churned");
  }
  await logActivity(labId, {
    kind: churnType === "Churned" ? "Lab Churned" : "Contraction Logged",
    title: `${churnType} — ${mrrLost ? `MRR impact ${mrrLost}` : "no MRR figure given"}${reason ? ` (${reason})` : ""}`,
    meta: dueAmount ? `${dueAmount} outstanding at time of logging` : null,
    csmId,
    source: "system",
  });
}
