import { useSessionState } from "./useSessionState";
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
// `page` keys the remembered My Labs / Team View choice per screen, so it survives a refresh (sessionStorage).
export function useScopedCsm(viewer, page = "default") {
  const { csmDirectory, currentCSM } = viewer;
  const isHead = hasLeadAccess(csmDirectory.find((c) => c.name === currentCSM)?.role);
  const [scope, setScope] = useSessionState(`${page}.scope`, "mine");
  const [csmFilter, setCsmFilter] = useSessionState(`${page}.csmFilter`, "");
  const csmNames = csmDirectory.map((c) => c.name);

  // Someone locked to their own labs (isHead === false) always resolves to currentCSM itself,
  // regardless of `scope` — the ScopeToggle UI that would flip it to "team" never even renders
  // for them. teamAll marks "Team View with no CSM filter" — the one state where a screen should
  // aggregate everyone at once instead of scoping to one person.
  const teamAll = isHead && scope === "team" && !csmFilter;
  const scopeCsm = isHead && scope === "team" ? (csmFilter || null) : currentCSM;

  // Team View's CSM dropdown only lists people who actually have labs (an Admin or a new CSM with none isn't offered).
  const teamNames = viewer.csmsWithLabs ? csmNames.filter((n) => viewer.csmsWithLabs.includes(n)) : csmNames;

  return { isHead, scope, setScope, csmFilter, setCsmFilter, csmNames, teamNames, scopeCsm, teamAll };
}
