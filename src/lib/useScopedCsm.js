import { useState } from "react";
import { hasLeadAccess } from "./roles";

// The "My Labs / Team View" scoping pattern shared by Dashboard, My Portfolio, Collections,
// Tasks, Visits & Meetings, Reports, and Total Labs — this used to be copy-pasted into all seven
// views individually. A plain CSM is always locked to their own labs (ScopeToggle renders
// nothing for them — see components/ScopeToggle.jsx); a CSM Lead or Admin defaults to their own
// too but can switch to Team View, optionally narrowed further to one CSM via csmFilter.
//
// Takes the same `viewer` object App.jsx computes (currentCSM/csmDirectory/myName/isHead — see
// its own comment there) so every view reads currentCSM's role the same way. Note this — like
// every hasLeadAccess/isHead check in the app — only controls what the UI shows; it is not the
// security boundary. See the comment on hasLeadAccess in roles.js for why.
export function useScopedCsm(viewer) {
  const { csmDirectory, currentCSM } = viewer;
  const isHead = hasLeadAccess(csmDirectory.find((c) => c.name === currentCSM)?.role);
  const [scope, setScope] = useState("mine");
  const [csmFilter, setCsmFilter] = useState("");
  const csmNames = csmDirectory.map((c) => c.name);

  // Someone locked to their own labs (isHead === false) always resolves to currentCSM itself,
  // regardless of `scope` — the ScopeToggle UI that would flip it to "team" never even renders
  // for them. teamAll marks "Team View with no CSM filter" — the one state where a screen should
  // aggregate everyone at once instead of scoping to one person.
  const teamAll = isHead && scope === "team" && !csmFilter;
  const scopeCsm = isHead && scope === "team" ? (csmFilter || null) : currentCSM;

  return { isHead, scope, setScope, csmFilter, setCsmFilter, csmNames, scopeCsm, teamAll };
}
