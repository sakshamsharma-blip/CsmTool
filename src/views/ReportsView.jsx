import { useEffect, useMemo, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { fmtINR, fmtMoney, toINR, segmentFor, SEG_BANDS } from "../lib/format";
import { fetchChurnLog, quarterOf } from "../lib/churn";
import { hasLeadAccess } from "../lib/roles";
import ScopeToggle from "../components/ScopeToggle";

const SEG_NAME = { A: "Enterprise", B: "Premium", C: "Advance", D: "Standard", E: "Essential" };
const SEGMENTS = SEG_BANDS.map((b) => b.code);

// Two tabs leadership actually reviews from the source tracking sheet, neither of which had a
// home in the app before: Churn Report (churn/contraction log with outstanding dues at the
// time), and MRR Breakdown (Segment × CSM matrix, Region/Country splits) — the more granular
// reporting the old "CS Dashboard 2026" pivot tabs carried that Dashboard's simple bucket
// counts didn't replace.
export default function ReportsView({ labs, csmDirectory, currentCSM, idByName, onOpenLab }) {
  const isHead = hasLeadAccess(csmDirectory.find((c) => c.name === currentCSM)?.role);
  const [tab, setTab] = useState("churn");
  const [scope, setScope] = useState("mine");
  const [csmFilter, setCsmFilter] = useState("");
  const csmNames = csmDirectory.map((c) => c.name);

  const [churnRows, setChurnRows] = useState([]);
  const [loadingChurn, setLoadingChurn] = useState(SUPABASE_CONFIGURED);
  const [churnError, setChurnError] = useState(null);
  const [typeFilter, setTypeFilter] = useState("");

  async function loadChurn() {
    if (!SUPABASE_CONFIGURED) { setLoadingChurn(false); return; }
    setLoadingChurn(true);
    setChurnError(null);
    try { setChurnRows(await fetchChurnLog()); }
    catch (err) { setChurnError(err.message || "Failed to load churn log."); }
    finally { setLoadingChurn(false); }
  }
  useEffect(() => { loadChurn(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const labsById = {};
  labs.forEach((l) => { labsById[l.id] = l; });
  const nameById = {};
  Object.entries(idByName || {}).forEach(([n, id]) => { nameById[id] = n; });

  const teamAll = isHead && scope === "team" && !csmFilter;
  const scopeCsm = isHead && scope === "team" ? (csmFilter || null) : currentCSM;
  const scopeLabel = teamAll ? "the whole team" : scopeCsm;

  // ---- Churn Report ----
  const churnFiltered = useMemo(() => churnRows
    .filter((r) => {
      const csmName = nameById[r.csmId] || labsById[r.labId]?.csm;
      return !scopeCsm || csmName === scopeCsm;
    })
    .filter((r) => !typeFilter || r.churnType === typeFilter)
    .sort((a, b) => new Date(b.churnMonth) - new Date(a.churnMonth)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [churnRows, scopeCsm, typeFilter]);

  const churnedCount = churnFiltered.filter((r) => r.churnType === "Churned").length;
  const contractionCount = churnFiltered.filter((r) => r.churnType === "Contraction").length;
  const totalMrrLost = churnFiltered.reduce((s, r) => s + toINR(r.mrrLost, labsById[r.labId]?.region), 0);
  const totalDueAtChurn = churnFiltered.reduce((s, r) => s + toINR(r.dueAmount, labsById[r.labId]?.region), 0);

  // ---- MRR Breakdown ----
  const breakdownLabs = useMemo(() => labs.filter((l) => !scopeCsm || l.csm === scopeCsm), [labs, scopeCsm]);

  const segByCsm = useMemo(() => {
    const csmsInScope = teamAll || !isHead ? csmNames.filter((n) => teamAll || n === scopeCsm) : [scopeCsm].filter(Boolean);
    const cols = teamAll ? csmNames : csmsInScope;
    const grid = {};
    SEGMENTS.forEach((seg) => { grid[seg] = {}; cols.forEach((c) => { grid[seg][c] = 0; }); });
    breakdownLabs.forEach((l) => {
      const seg = segmentFor(toINR(l.mrr, l.region)).code;
      if (!grid[seg] || !(l.csm in grid[seg])) return;
      grid[seg][l.csm] += toINR(l.mrr, l.region);
    });
    const colTotals = {};
    cols.forEach((c) => { colTotals[c] = SEGMENTS.reduce((s, seg) => s + (grid[seg][c] || 0), 0); });
    const grandTotal = cols.reduce((s, c) => s + colTotals[c], 0);

    // Same matrix, counting labs instead of summing MRR — the source sheet keeps these as two
    // separate pivots (SUM of MRR vs. COUNTA of CSM) since a CSM's book can be MRR-heavy with
    // few large labs, or lab-heavy with many small ones — worth seeing both.
    const countGrid = {};
    SEGMENTS.forEach((seg) => { countGrid[seg] = {}; cols.forEach((c) => { countGrid[seg][c] = 0; }); });
    breakdownLabs.forEach((l) => {
      const seg = segmentFor(toINR(l.mrr, l.region)).code;
      if (!countGrid[seg] || !(l.csm in countGrid[seg])) return;
      countGrid[seg][l.csm] += 1;
    });
    const countColTotals = {};
    cols.forEach((c) => { countColTotals[c] = SEGMENTS.reduce((s, seg) => s + (countGrid[seg][c] || 0), 0); });
    const countGrandTotal = cols.reduce((s, c) => s + countColTotals[c], 0);

    return { cols, grid, colTotals, grandTotal, countGrid, countColTotals, countGrandTotal };
  }, [breakdownLabs, csmNames, teamAll, isHead, scopeCsm]);

  const regionBreakdown = useMemo(() => {
    const byRegion = {};
    breakdownLabs.forEach((l) => {
      const key = l.region === "ROW" ? "ROW" : "Domestic";
      byRegion[key] = (byRegion[key] || 0) + toINR(l.mrr, l.region);
    });
    const total = Object.values(byRegion).reduce((s, v) => s + v, 0);
    return { byRegion, total };
  }, [breakdownLabs]);

  const countryBreakdown = useMemo(() => {
    const byCountry = {};
    breakdownLabs.forEach((l) => {
      const key = l.country || "—";
      byCountry[key] = (byCountry[key] || 0) + toINR(l.mrr, l.region);
    });
    const total = Object.values(byCountry).reduce((s, v) => s + v, 0);
    return Object.entries(byCountry).sort((a, b) => b[1] - a[1]).map(([country, mrr]) => ({ country, mrr, pct: total ? mrr / total : 0 }));
  }, [breakdownLabs]);

  return (
    <div>
      <h1 className="page-title">Reports</h1>
      <p className="page-sub">Churn/contraction history and MRR breakdowns for <b>{scopeLabel}</b> — the granular reporting leadership tracked in spreadsheets, now live.</p>

      <div className="tabbar">
        <button className={`tabbtn${tab === "churn" ? " active" : ""}`} onClick={() => setTab("churn")}>Churn Report</button>
        <button className={`tabbtn${tab === "mrr" ? " active" : ""}`} onClick={() => setTab("mrr")}>MRR Breakdown</button>
      </div>

      <div style={{ marginTop: 16 }}>
        <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={csmNames} />
      </div>

      {tab === "churn" && (
        loadingChurn ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading churn log…</div>
        ) : churnError ? (
          <div className="warn-banner" style={{ background: "var(--bad-bg)", color: "var(--bad)", borderColor: "#f3b8b8" }}>Couldn't load churn log — {churnError}</div>
        ) : (
          <>
            <div className="summary-grid" style={{ gridTemplateColumns: "repeat(4,1fr)", marginBottom: 14 }}>
              <div className="stile"><div className="sval" style={{ color: "var(--bad)" }}>{churnedCount}</div><div className="slabel">Churned</div></div>
              <div className="stile"><div className="sval" style={{ color: "var(--warn)" }}>{contractionCount}</div><div className="slabel">Contractions</div></div>
              <div className="stile"><div className="sval">{fmtINR(totalMrrLost)}</div><div className="slabel">Total MRR Impact</div></div>
              <div className="stile"><div className="sval" style={{ color: totalDueAtChurn > 0 ? "var(--bad)" : "var(--text)" }}>{fmtINR(totalDueAtChurn)}</div><div className="slabel">Outstanding at Churn</div></div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
              <select className="dash-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">All Types</option>
                <option value="Churned">Churned</option>
                <option value="Contraction">Contraction</option>
              </select>
            </div>

            {churnFiltered.length === 0 ? (
              <div className="table-card" style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>No churn or contraction logged for {scopeLabel} yet.</div>
            ) : (
              <div className="table-card"><div className="table-scroll"><table className="child-mini">
                <thead><tr><th>Lab</th><th>Type</th><th>Month</th><th>Quarter</th><th>CSM</th><th>MRR Impact</th><th>Due at Churn</th><th>Reason</th></tr></thead>
                <tbody>{churnFiltered.map((r) => {
                  const lab = labsById[r.labId];
                  return (
                    <tr key={r.id}>
                      <td className="lab-name clickable" onClick={() => onOpenLab(r.labId)}>{lab ? lab.name : r.labId}</td>
                      <td><span className={`status-pill ${r.churnType === "Churned" ? "status-Inactive" : "status-AtRisk"}`}>{r.churnType}</span></td>
                      <td>{new Date(r.churnMonth).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</td>
                      <td>{quarterOf(r.churnMonth)}</td>
                      <td>{nameById[r.csmId] || lab?.csm || "—"}</td>
                      <td className="mrr-cell">{lab ? fmtMoney(r.mrrLost, lab.region) : r.mrrLost}</td>
                      <td className="mrr-cell" style={{ color: r.dueAmount > 0 ? "var(--bad)" : "var(--text-dim)" }}>{lab ? fmtMoney(r.dueAmount, lab.region) : r.dueAmount}</td>
                      <td style={{ maxWidth: 220, whiteSpace: "normal" }}>{r.reason || "—"}</td>
                    </tr>
                  );
                })}</tbody>
              </table></div></div>
            )}
          </>
        )
      )}

      {tab === "mrr" && (
        <>
          <div className="table-card" style={{ marginBottom: 18 }}>
            <div style={{ padding: "14px 18px 4px", fontSize: 12.5, fontWeight: 700 }}>MRR by Segment{segByCsm.cols.length > 1 ? " × CSM" : ""}</div>
            <div className="table-scroll">
              <table className="child-mini">
                <thead><tr><th>Segment</th>{segByCsm.cols.map((c) => <th key={c}>{c}</th>)}<th>Total</th><th>%</th></tr></thead>
                <tbody>
                  {SEGMENTS.map((seg) => {
                    const rowTotal = segByCsm.cols.reduce((s, c) => s + (segByCsm.grid[seg][c] || 0), 0);
                    return (
                      <tr key={seg}>
                        <td>{seg} — {SEG_NAME[seg]}</td>
                        {segByCsm.cols.map((c) => <td key={c} className="mrr-cell">{segByCsm.grid[seg][c] ? fmtINR(segByCsm.grid[seg][c]) : "—"}</td>)}
                        <td className="mrr-cell" style={{ fontWeight: 700 }}>{fmtINR(rowTotal)}</td>
                        <td>{segByCsm.grandTotal ? `${(rowTotal / segByCsm.grandTotal * 100).toFixed(1)}%` : "—"}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ fontWeight: 700 }}>
                    <td>Grand Total</td>
                    {segByCsm.cols.map((c) => <td key={c} className="mrr-cell">{fmtINR(segByCsm.colTotals[c])}</td>)}
                    <td className="mrr-cell">{fmtINR(segByCsm.grandTotal)}</td>
                    <td>—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="table-card" style={{ marginBottom: 18 }}>
            <div style={{ padding: "14px 18px 4px", fontSize: 12.5, fontWeight: 700 }}>Lab Count by Segment{segByCsm.cols.length > 1 ? " × CSM" : ""}</div>
            <div className="table-scroll">
              <table className="child-mini">
                <thead><tr><th>Segment</th>{segByCsm.cols.map((c) => <th key={c}>{c}</th>)}<th>Total</th><th>%</th></tr></thead>
                <tbody>
                  {SEGMENTS.map((seg) => {
                    const rowTotal = segByCsm.cols.reduce((s, c) => s + (segByCsm.countGrid[seg][c] || 0), 0);
                    return (
                      <tr key={seg}>
                        <td>{seg} — {SEG_NAME[seg]}</td>
                        {segByCsm.cols.map((c) => <td key={c}>{segByCsm.countGrid[seg][c] || "—"}</td>)}
                        <td style={{ fontWeight: 700 }}>{rowTotal}</td>
                        <td>{segByCsm.countGrandTotal ? `${(rowTotal / segByCsm.countGrandTotal * 100).toFixed(1)}%` : "—"}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ fontWeight: 700 }}>
                    <td>Grand Total</td>
                    {segByCsm.cols.map((c) => <td key={c}>{segByCsm.countColTotals[c]}</td>)}
                    <td>{segByCsm.countGrandTotal}</td>
                    <td>—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <div className="table-card" style={{ flex: "1 1 260px" }}>
              <div style={{ padding: "14px 18px 4px", fontSize: 12.5, fontWeight: 700 }}>MRR by Region</div>
              <div className="table-scroll"><table className="child-mini">
                <thead><tr><th>Region</th><th>MRR</th><th>%</th></tr></thead>
                <tbody>{Object.entries(regionBreakdown.byRegion).map(([region, mrr]) => (
                  <tr key={region}>
                    <td>{region}</td>
                    <td className="mrr-cell">{fmtINR(mrr)}</td>
                    <td>{regionBreakdown.total ? `${(mrr / regionBreakdown.total * 100).toFixed(1)}%` : "—"}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>

            <div className="table-card" style={{ flex: "2 1 360px" }}>
              <div style={{ padding: "14px 18px 4px", fontSize: 12.5, fontWeight: 700 }}>MRR by Country</div>
              <div className="table-scroll"><table className="child-mini">
                <thead><tr><th>Country</th><th>MRR</th><th>%</th></tr></thead>
                <tbody>{countryBreakdown.map(({ country, mrr, pct }) => (
                  <tr key={country}>
                    <td>{country}</td>
                    <td className="mrr-cell">{fmtINR(mrr)}</td>
                    <td>{(pct * 100).toFixed(1)}%</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
