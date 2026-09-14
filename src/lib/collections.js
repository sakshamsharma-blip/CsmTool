import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";

// Collections tracker with a simulated Zoho Books reconciliation. A real Zoho sync doesn't
// exist yet — per the prototype's own note ("Requirement going in: this syncs with Zoho
// Books"), so collected_zoho is simulated the same way the prototype showed it: as the full
// invoice amount, standing in for "what Zoho's books say was collected." When a CSM logs
// what they manually collected, we compare it to that figure — a match auto-resolves as
// Matched, a mismatch is flagged Conflict and blocked until a CSM adds a mandatory
// resolution comment via resolveConflict(). collected_zoho/resolution_comment and the
// Matched/Conflict statuses already existed in the schema from 0001_init.sql, unused, for
// exactly this.
export async function fetchAllCollectionsItems() {
  const { data, error } = await supabase
    .from("collections_items")
    .select("id,lab_id,module_key,param_name,label,amount,is_trial,added_date,collected_manual,collected_zoho,collected_at,status,resolution_comment,csm_id,created_at")
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
    collectedZoho: r.collected_zoho != null ? Number(r.collected_zoho) : null,
    collectedAt: r.collected_at,
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

// owedAmount is the item's `amount` (what's actually invoiced) — passed in rather than
// re-fetched so the caller's already-loaded row is the source of truth.
export async function markItemCollected(itemId, manualAmount, owedAmount, labId, csmId) {
  const zohoAmount = owedAmount;
  const matches = Math.round(manualAmount * 100) === Math.round(zohoAmount * 100);
  const status = matches ? "Matched" : "Conflict";
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("collections_items")
    .update({ collected_manual: manualAmount, collected_zoho: zohoAmount, status, collected_at: nowIso })
    .eq("id", itemId);
  if (error) throw error;
  logActivity(labId, {
    kind: "Collections Update",
    title: matches ? "Collection marked collected — matched Zoho" : "Collection marked collected — Zoho conflict",
    meta: matches
      ? `₹${manualAmount.toLocaleString("en-IN")} collected`
      : `₹${manualAmount.toLocaleString("en-IN")} logged manually vs ₹${zohoAmount.toLocaleString("en-IN")} in Zoho`,
    csmId,
  }).catch((err) => console.error(err));
  return status;
}

export async function resolveConflict(itemId, comment, labId, csmId) {
  const { error } = await supabase
    .from("collections_items")
    .update({ status: "Resolved", resolution_comment: comment })
    .eq("id", itemId);
  if (error) throw error;
  logActivity(labId, {
    kind: "Collections Update",
    title: "Collection conflict resolved",
    meta: comment,
    csmId,
  }).catch((err) => console.error(err));
}

export async function logCollectionsReminder(labId, csmId, labName) {
  await logActivity(labId, {
    kind: "Collections Reminder",
    title: "Reminder sent",
    meta: `Payment reminder logged${labName ? ` for ${labName}` : ""}`,
    csmId,
  });
}

// ---- Aging (Collections Aging: Current / Due Soon / Overdue / Critical) ----
export function daysSince(dateStr) {
  const then = new Date(dateStr + "T00:00:00");
  const now = new Date();
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}
export function agingBucket(days) {
  if (days >= 45) return "Critical";
  if (days >= 30) return "Overdue";
  if (days >= 15) return "Due Soon";
  return "Current";
}
export const AGING_COLORS = { Current: "var(--ok)", "Due Soon": "var(--accent)", Overdue: "var(--warn)", Critical: "var(--bad)" };

// Per-lab rollup used by both the portfolio-wide Collections list and the Dashboard's
// Collections Aging chart: which items are still "open" (Pending or unresolved Conflict),
// how old the oldest one is, and when this lab last had a payment logged.
export function labCollectionsSummary(items) {
  const open = items.filter((i) => i.status === "Pending" || i.status === "Conflict");
  const outstanding = open.reduce((s, i) => s + (i.amount || 0), 0);
  const oldestDays = open.reduce((max, i) => Math.max(max, daysSince(i.addedDate)), 0);
  const openConflicts = items.filter((i) => i.status === "Conflict").length;
  const paid = items.filter((i) => i.collectedAt).sort((a, b) => new Date(b.collectedAt) - new Date(a.collectedAt));
  return {
    outstanding,
    daysOverdue: open.length ? oldestDays : 0,
    bucket: open.length ? agingBucket(oldestDays) : "Current",
    openConflicts,
    lastPayment: paid[0]?.collectedAt || null,
    openCount: open.length,
  };
}
