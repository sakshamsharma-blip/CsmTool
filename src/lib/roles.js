// A CSM Lead and an Admin both get the "see everything, optionally filter to one CSM"
// team view (ScopeToggle) instead of being stuck on just their own labs — a plain CSM
// never does. Centralized here so the 5 places that check it stay in sync.
export function hasLeadAccess(role) {
  return role === "Lead" || role === "Admin";
}

export function roleLabel(role) {
  if (role === "Admin") return "Admin";
  if (role === "Lead") return "CSM Lead";
  return "Customer Success Manager";
}
