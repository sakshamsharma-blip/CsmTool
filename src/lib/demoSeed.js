import raw from "./demoData.json";

// Used only when no Supabase project is configured (.env not set up yet) — lets the app still
// be opened and clicked through, exactly like the original prototype, with the same reviewed
// catalog/plans/roster data (extracted from the prototype, not retyped).
export const DEMO_MODULES = raw.MODULES;
export const DEMO_PLANS = raw.PLANS;
export const DEMO_CSM_DIRECTORY = raw.CSM_DIRECTORY;

export const DEMO_LABS = [
  { id: "829", name: "iGenetic Diagnostics", type: "Parent", parent: null, csm: "Rahul Barge", plan: "advance", region: "Domestic", state: "Maharashtra", country: "India", mrr: 70000, status: "Active" },
  { id: "829-1", name: "iGenetic Diagnostics - Andheri", type: "Child", parent: "829", csm: "Rahul Barge", plan: "advance", region: "Domestic", state: "Maharashtra", country: "India", mrr: 30000, status: "Active" },
  { id: "829-2", name: "iGenetic Diagnostics - Borivali", type: "Child", parent: "829", csm: "Rahul Barge", plan: "advance", region: "Domestic", state: "Maharashtra", country: "India", mrr: 25000, status: "Active" },
  { id: "830", name: "Medcis Group", type: "Parent", parent: null, csm: "Suraj Todkar", plan: "growth", region: "Domestic", state: "Maharashtra", country: "India", mrr: 40000, status: "Active" },
  { id: "831", name: "Span Diagnostics", type: "Parent", parent: null, csm: "Aseem Khan", plan: "premium", region: "Domestic", state: "Gujarat", country: "India", mrr: 40000, status: "Active" },
  { id: "832", name: "Truemedix Lab", type: "Parent", parent: null, csm: "Aseem Khan", plan: "starter", region: "Domestic", state: "Gujarat", country: "India", mrr: 35000, status: "At Risk" },
  { id: "833", name: "Cadabams Group", type: "Parent", parent: null, csm: "Mazhar Shaikh", plan: "enterprise", region: "Domestic", state: "Tamil Nadu", country: "India", mrr: 120000, status: "Active" },
  { id: "834", name: "Nairobi Precision Labs", type: "Parent", parent: null, csm: "Mazhar Shaikh", plan: "premium", region: "ROW", state: "—", country: "Kenya", mrr: 1400, status: "Active" },
];
