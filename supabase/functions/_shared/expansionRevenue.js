// Expansion revenue — ONE copy, shared by the web app (src/lib/expansion.js re-exports it) and the CSM 360 connector.
// Pure functions only. Decision Nov 5 2026: the revenue that came from Expansion, separate from a lab's total MRR:
//   • a purchased feature with a price, from when it became priced until it was lost (feature_purchases);
//   • a manual deal at status Live, from its deal-won date, else from when it was added (expansion_opportunities).
// Trials, Pipeline, Onboarding and Lost add nothing. Neither source moves the lab's MRR, which follows invoices.

// Both sources as one list. `localDate` turns a timestamp into YYYY-MM-DD in the viewer's own timezone.
// Status: a priced purchase is Live, a trial is Onboarding, a lost one is Lost; a manual deal keeps its own.
export function expansionRows(opps, purchases, localDate = (ts) => String(ts || "").slice(0, 10)) {
  const manual = (opps || []).map((o) => ({
    id: `deal-${o.id}`, dealId: o.id, kind: "Manual", labId: o.labId, title: o.title || "", moduleKey: o.moduleKey || null,
    monthly: o.monthlyRevenue || 0, annual: o.annualRevenue || (o.monthlyRevenue || 0) * 12, status: o.status, isTrial: false,
    startedOn: o.dealWonDate || null, expectedLive: o.expectedLiveDate || null, note: o.comments || "",
    liveFrom: o.status === "Live" ? o.dealWonDate || localDate(o.createdAt) : null, liveUntil: null,
  }));
  const features = (purchases || []).map((p) => ({
    id: `purchase-${p.id}`, kind: "Feature", labId: p.labId, title: p.label || p.paramName || "", moduleKey: p.moduleKey || null,
    monthly: p.monthlyCharge || 0, annual: (p.monthlyCharge || 0) * 12, status: p.status === "Lost" ? "Lost" : p.isTrial ? "Onboarding" : "Live", isTrial: !!p.isTrial,
    startedOn: p.purchasedOn || null, expectedLive: null, note: p.lostComment || "", chargesAddedOn: p.chargesAddedOn || null,
    liveFrom: p.isTrial ? null : p.chargesAddedOn || p.purchasedOn, liveUntil: p.lostOn || null,
  }));
  return [...features, ...manual];
}

// Was this row bringing in revenue on that day?
export function isLiveOn(row, iso) {
  return !!row.liveFrom && row.liveFrom <= iso && (!row.liveUntil || row.liveUntil > iso);
}

// Expansion MRR and ARR on a day. `convert(amount, labId)` puts every amount in one currency before adding.
export function revenueOn(rows, iso, convert = (amount) => amount) {
  const live = rows.filter((r) => isLiveOn(r, iso));
  return {
    mrr: live.reduce((s, r) => s + convert(r.monthly, r.labId), 0),
    arr: live.reduce((s, r) => s + convert(r.annual, r.labId), 0),
    count: live.length,
  };
}
