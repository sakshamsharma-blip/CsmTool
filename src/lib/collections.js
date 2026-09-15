import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";

// Collections tracker — manual, no Zoho Books dependency. Each item has one number that
// matters: how much has actually been collected so far (`collected_manual`), which a CSM can
// bump up any time more money comes in (handles partial/installment payments naturally). There
// is deliberately no second "what the accounting system says" figure to reconcile against
// anymore, so there's no Matched/Conflict step either — status is just derived from the two
// numbers you already have (amount owed vs. collected so far).
//
// The underlying `collections_items` table still has its old `status` CHECK constraint
// (Pending/Matched/Conflict/Resolved) from when this simulated a Zoho sync — rather than run a
// migration to loosen it under time pressure, we just stop writing 'Matched'/'Conflict' and
// reuse 'Pending' (still outstanding) and 'Resolved' (fully collected) going forward. The UI
// never shows those raw words — it always computes and displays Pending / Partially Collected /
// Collected from the actual amounts, so the repurposed enum value is invisible to anyone using
// the app. `collected_zoho` and `resolution_comment` are left alone (unused for new rows).
export async function fetchAllCollectionsItems() {
  const { data, error } = await supabase
    .from("collections_items")
    .select("id,lab_id,module_key,param_name,label,amount,is_trial,added_date,collected_manual,collected_at,csm_id,created_at")
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
    collectedManual: r.collected_manual != null ? Number(r.collected_manual) : 0,
    collectedAt: r.collected_at,
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
    collected_manual: isTrial ? 0 : 0,
    collected_at: isTrial ? new Date().toISOString() : null,
    resolution_comment: isTrial ? "Trial/free — nothing to collect." : null,
    csm_id: csmId || null,
  });
  if (error) throw error;
}

// Item-level helpers — the single source of truth for "is this settled" everywhere in the app
// (Collections list, Dashboard aging, per-lab tab), replacing the old string-status checks.
export function itemBalance(item) {
  if (item.isTrial) return 0;
  return Math.max(0, (item.amount || 0) - (item.collectedManual || 0));
}
export function isItemOpen(item) {
  return itemBalance(item) > 0;
}
export function itemStatusLabel(item) {
  if (item.isTrial) return "Trial/Free";
  if (!item.collectedManual) return "Pending";
  return itemBalance(item) > 0 ? "Partially Collected" : "Collected";
}

// Updates how much has been collected so far for one item — callable repeatedly as more money
// comes in (not a one-time action). `manualAmount` is the new running total, not a delta.
export async function updateItemCollected(itemId, manualAmount, owedAmount, labId, csmId, label) {
  const nowIso = new Date().toISOString();
  const fullyCollected = manualAmount >= owedAmount;
  const { error } = await supabase
    .from("collections_items")
    .update({ collected_manual: manualAmount, collected_at: nowIso, status: fullyCollected ? "Resolved" : "Pending" })
    .eq("id", itemId);
  if (error) throw error;
  logActivity(labId, {
    kind: "Collections Update",
    title: fullyCollected ? "Marked fully collected" : "Payment logged",
    meta: `₹${Number(manualAmount).toLocaleString("en-IN")} collected so far${label ? ` for ${label}` : ""}`,
    csmId,
  }).catch((err) => console.error(err));
  return fullyCollected ? "Collected" : "Partially Collected";
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
// Collections Aging chart: which items are still open (a balance remains), how old the oldest
// one is, and when this lab last had a payment logged. Amounts here stay in the lab's own
// native currency — callers convert to INR themselves when summing across labs.
export function labCollectionsSummary(items) {
  const open = items.filter(isItemOpen);
  const outstanding = open.reduce((s, i) => s + itemBalance(i), 0);
  const oldestDays = open.reduce((max, i) => Math.max(max, daysSince(i.addedDate)), 0);
  const paid = items.filter((i) => i.collectedAt).sort((a, b) => new Date(b.collectedAt) - new Date(a.collectedAt));
  return {
    outstanding,
    daysOverdue: open.length ? oldestDays : 0,
    bucket: open.length ? agingBucket(oldestDays) : "Current",
    lastPayment: paid[0]?.collectedAt || null,
    openCount: open.length,
  };
}
