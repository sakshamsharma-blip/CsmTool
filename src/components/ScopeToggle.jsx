import { LAB_TYPES } from "../lib/labs";

// Lead-only "see everything, optionally filter to one CSM" pattern, reused on My Portfolio, Dashboard,
// Collections and Visits & Meetings so a CSM Lead isn't stuck viewing one CSM's world at a time. A
// plain CSM never sees the My Labs / Team View part — they only ever see their own labs.
// The Lab Type filter (Pathology / Radiology / Pathology + Radiology) is shown to everyone when the screen passes
// labType / setLabType.
export default function ScopeToggle({ isHead, scope, setScope, csmFilter, setCsmFilter, csmNames, labType, setLabType }) {
  if (!isHead && !setLabType) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0 18px", flexWrap: "wrap" }}>
      {isHead && (
        <div className="tabbar" style={{ marginBottom: 0, borderBottom: "none" }}>
          <button className={`tabbtn${scope === "mine" ? " active" : ""}`} onClick={() => setScope("mine")}>My Labs</button>
          <button className={`tabbtn${scope === "team" ? " active" : ""}`} onClick={() => setScope("team")}>Team View</button>
        </div>
      )}
      {isHead && scope === "team" && (
        <select className="dash-select" value={csmFilter} onChange={(e) => setCsmFilter(e.target.value)}>
          <option value="">All CSMs</option>
          {csmNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      )}
      {setLabType && (
        <select className="dash-select" value={labType || ""} onChange={(e) => setLabType(e.target.value)} title="Lab Type">
          <option value="">All Lab Types</option>
          {LAB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      )}
    </div>
  );
}
