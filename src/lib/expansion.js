import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";

// Expansion Opportunities — deal-level upsell tracking (Onboarding/Pipeline/Live/Lost), separate
// from the module/param-level Pitch Pipeline on My Portfolio. Amounts are stored in the lab's own
// native currency, same convention as collections_items/invoices — see src/lib/format.js's
// toINR/toUSD/fmtMoney(amount, lab.region) for conversion at display time.
export const EXPANSION_STATUSES = ["Onboarding", "Pipeline", "Live", "Lost"];

const COLUMNS = "id,lab_id,monthly_revenue,annual_revenue,deal_won_date,expected_live_date,status,comments,csm_id,created_at,updated_at";

function mapRow(r) {
  return {
    id: r.id,
    labId: r.lab_id,
    monthlyRevenue: Number(r.monthly_revenue) || 0,
    annualRevenue: Number(r.annual_revenue) || 0,
    dealWonDate: r.deal_won_date,
    expectedLiveDate: r.expected_live_date,
    status: r.status,
    comments: r.comments || "",
    csmId: r.csm_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function fetchAllExpansionOpportunities() {
  const { data, error } = await supabase
    .from("expansion_opportunities")
    .select(COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRow);
}

export async function addExpansionOpportunity({ labId, monthlyRevenue, annualRevenue, dealWonDate, expectedLiveDate, status, comments, csmId }, labName) {
  const { error } = await supabase.from("expansion_opportunities").insert({
    lab_id: labId,
    monthly_revenue: monthlyRevenue || 0,
    annual_revenue: annualRevenue || 0,
    deal_won_date: dealWonDate || null,
    expected_live_date: expectedLiveDate || null,
    status: status || "Pipeline",
    comments: comments || null,
    csm_id: csmId || null,
  });
  if (error) throw error;
  logActivity(labId, {
    kind: "Expansion Opportunity Added",
    title: `Expansion opportunity added (${status || "Pipeline"})`,
    meta: labName ? `for ${labName}` : null,
    csmId,
  }).catch((err) => console.error(err));
}

export async function updateExpansionOpportunity(id, { labId, monthlyRevenue, annualRevenue, dealWonDate, expectedLiveDate, status, comments, csmId }, labName) {
  const { error } = await supabase
    .from("expansion_opportunities")
    .update({
      monthly_revenue: monthlyRevenue || 0,
      annual_revenue: annualRevenue || 0,
      deal_won_date: dealWonDate || null,
      expected_live_date: expectedLiveDate || null,
      status,
      comments: comments || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
  logActivity(labId, {
    kind: "Expansion Opportunity Updated",
    title: `Expansion opportunity set to ${status}`,
    meta: labName ? `for ${labName}` : null,
    csmId,
  }).catch((err) => console.error(err));
}

// Portfolio-wide rollup used by the Expansion tab's summary tiles — counts + pipeline value per
// status. Pipeline value deliberately excludes Lost (never counted) and Live (already realized,
// showing up in the lab's real MRR instead) — it's "what's still in motion".
export function expansionSummary(items) {
  const byStatus = { Onboarding: 0, Pipeline: 0, Live: 0, Lost: 0 };
  items.forEach((i) => { byStatus[i.status] = (byStatus[i.status] || 0) + 1; });
  const inMotion = items.filter((i) => i.status === "Onboarding" || i.status === "Pipeline");
  return { byStatus, inMotionCount: inMotion.length };
}
