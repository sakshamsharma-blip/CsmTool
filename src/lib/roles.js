// A CSM Lead and an Admin both get the "see everything, optionally filter to one CSM"
// team view (ScopeToggle) instead of being stuck on just their own labs — a plain CSM
// never does. Centralized here (and, for the scoping state itself, in useScopedCsm.js)
// so every place that checks it stays in sync.
//
// IMPORTANT — this is a UI convenience, not the security boundary. hasLeadAccess/isHead
// only decide what buttons, toggles and rows this app *renders*; they run entirely in the
// browser and can't stop a direct query. The actual enforced boundary — what a plain CSM's
// queries can even return — is the Postgres Row-Level Security policies in
// migrations/0012_lab_visibility_rls.sql (current_profile_id()/is_lead_or_admin(), applied to
// `labs` and every lab-owned table). If a future change to this function or to a component's
// isHead check ever seems to loosen who can see what, check migration 0012's policies too —
// they're the ones actually keeping the data scoped, independent of anything in src/.
export function hasLeadAccess(role) {
  return role === "Lead" || role === "Admin";
}

export function roleLabel(role) {
  if (role === "Admin") return "Admin";
  if (role === "Lead") return "CSM Lead";
  return "Customer Success Manager";
}
