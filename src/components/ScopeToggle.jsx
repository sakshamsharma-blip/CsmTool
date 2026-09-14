// Lead-only "see everything, optionally filter to one CSM" pattern, reused on My Portfolio, Dashboard,
// Collections and Visits & Meetings so a CSM Lead isn't stuck viewing one CSM's world at a time. A
// plain CSM never sees this — they only ever see their own labs.
export default function ScopeToggle({ isHead, scope, setScope, csmFilter, setCsmFilter, csmNames }) {
  if (!isHead) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0 18px" }}>
      <div className="tabbar" style={{ marginBottom: 0, borderBottom: "none" }}>
        <button className={`tabbtn${scope === "mine" ? " active" : ""}`} onClick={() => setScope("mine")}>My Labs</button>
        <button className={`tabbtn${scope === "team" ? " active" : ""}`} onClick={() => setScope("team")}>Team View</button>
      </div>
      {scope === "team" && (
        <select className="dash-select" value={csmFilter} onChange={(e) => setCsmFilter(e.target.value)}>
          <option value="">All CSMs</option>
          {csmNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      )}
    </div>
  );
}
