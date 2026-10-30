import { useEffect, useMemo, useState } from "react";
import { useSessionState } from "../lib/useSessionState";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { fmtINR, fmtMoney, toINR, segmentFor, SEG_BANDS } from "../lib/format";
import { fetchChurnLog, quarterOf } from "../lib/churn";
import { filterLabsByLabType } from "../lib/labs";
import { useScopedCsm } from "../lib/useScopedCsm";
import { computeLabRollup } from "../lib/labRollup";
import ScopeToggle from "../components/ScopeToggle";
import SearchSelect from "../components/SearchSelect";
import Paginated from "../components/Pager";

const SEG_NAME = { A: "Enterprise", B: "Premium", C: "Advance", D: "Standard", E: "Essential" };
const SEGMENTS = SEG_BANDS.map((b) => b.code);

// Two tabs leadership actually reviews from the source tracking sheet, neither of which had a
// home in the app before: Churn Report (churn/contraction log with outstanding dues at the
// time), and MRR Breakdown (Segment × CSM matrix, Region/Country splits) — the more granular
// reporting the old "CS Dashboard 2026" pivot tabs carried that Dashboard's simple bucket
// counts didn't replace.
export default function ReportsView({ labs: allLabs, viewer, idByName, onOpenLab }) {
  const { isHead, scope, setScope, csmFilter, setCsmFilter, csmNames, teamNames, scopeCsm, teamAll, labType, setLabType } = useScopedCsm(viewer, "reports");
  const labs = useMemo(() => filterLabsByLabType(allLabs, labType), [allLabs, labType]);
  const [tab, setTab] = useSessionState("reports.tab", "churn");

  const [churnRows, setChurnRows] = useState([]);
  const [loadingChurn, setLoadingChurn] = useState(SUPABASE_CONFIGURED);
  const [churnError, setChurnError] = useState(null);
  const [typeFilter, setTypeFilter] = useSessionState("reports.typeFilter", "");

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

  const scopeLabel = teamAll ? "the whole team" : scopeCsm;

  // ---- Churn Report ----
  const churnFiltered = useMemo(() => churnRows
    .filter((r) => {
      const csmName = nameById[r.csmId] || labsById[r.labId]?.csm;
      if (labType && !labsById[r.labId]) return false;
      return !scopeCsm || csmName === scopeCsm;
    })
    .filter((r) => !typeFilter || r.churnType === typeFilter)
    .sort((a, b) => new Date(b.churnMonth) - new Date(a.churnMonth)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [churnRows, scopeCsm, typeFilter, labType]);

  const churnedCount = churnFiltered.filter((r) => r.churnType === "Churned").length;
  const contractionCount = churnFiltered.filter((r) => r.churnType === "Contraction").length;
  const totalMrrLost = churnFiltered.reduce((s, r) => s + toINR(r.mrrLost, labsById[r.labId]?.region), 0);
  const totalDueAtChurn = churnFiltered.reduce((s, r) => s + toINR(r.dueAmount, labsById[r.labId]?.region), 0);

  // ---- MRR Breakdown ----
  // One row per client (parent lab) with its billed MRR from computeLabRollup — the same numbers Total
  // Labs and Dashboard show. Summing every lab's raw mrr double-counted groups: a Per-Branch parent's own
  // mrr is ignored in its group total, and so are the children of a Consolidated parent.
  // Region / Country / State / City filters (remembered across a refresh) narrow every breakdown below except "CSM share of the book".
  const [fRegion, setFRegion] = useSessionState("reports.fRegion", "");
  const [fCountry, setFCountry] = useSessionState("reports.fCountry", "");
  const [fState, setFState] = useSessionState("reports.fState", "");
  const [fCity, setFCity] = useSessionState("reports.fCity", "");
  const scopedClients = useMemo(() => {
    const rows = computeLabRollup(labs);
    return scopeCsm ? rows.filter((r) => r.csm === scopeCsm || r.children.some((c) => c.csm === scopeCsm)) : rows;
  }, [labs, scopeCsm]);
  const breakdownLabs = useMemo(() => scopedClients
    .filter((r) => !fRegion || r.region === fRegion)
    .filter((r) => !fCountry || r.country === fCountry)
    .filter((r) => !fState || r.state === fState)
    .filter((r) => !fCity || (r.city || "").trim().toLowerCase() === fCity.toLowerCase()), [scopedClients, fRegion, fCountry, fState, fCity]);
  // Each dropdown only offers what exists within the choices made before it (Region → Country → State → City).
  const inRegion = scopedClients.filter((r) => !fRegion || r.region === fRegion);
  const countryOptions = [...new Set(inRegion.map((r) => r.country).filter((v) => v && v !== "—"))].sort();
  const inCountry = inRegion.filter((r) => !fCountry || r.country === fCountry);
  const stateOptions = [...new Set(inCountry.map((r) => r.state).filter((v) => v && v !== "—"))].sort();
  const cityOptions = [...new Set(inCountry.filter((r) => !fState || r.state === fState).map((r) => (r.city || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  // MRR by State / by City — per client (parent lab), group MRR in INR; labs = the client plus its child labs.
  function geoBreakdown(keyOf) {
    const groups = {};
    breakdownLabs.forEach((r) => {
      const k = keyOf(r);
      const g = (groups[k] = groups[k] || { key: k, clients: 0, labs: 0, mrr: 0 });
      g.clients += 1; g.labs += 1 + r.children.length; g.mrr += toINR(r.mrr, r.region);
    });
    const total = Object.values(groups).reduce((sum, g) => sum + g.mrr, 0);
    return Object.values(groups).map((g) => ({ ...g, pct: total ? g.mrr / total : 0 })).sort((a, b) => b.mrr - a.mrr);
  }
  const stateBreakdown = geoBreakdown((r) => (r.state && r.state !== "—" ? r.state : "Not set"));
  const cityBreakdown = geoBreakdown((r) => `${(r.city || "").trim() || "Not set"}${r.state && r.state !== "—" ? `, ${r.state}` : ""}`);

  const segByCsm = useMemo(() => {
    const csmsInScope = teamAll || !isHead ? csmNames.filter((n) => teamAll || n === scopeCsm) : [scopeCsm].filter(Boolean);
    // Someone with no labs assigned (e.g. an Admin, or a new CSM) isn't shown as an empty column.
    const withLabs = new Set(breakdownLabs.map((l) => l.csm));
    const cols = (teamAll ? csmNames : csmsInScope).filter((c) => withLabs.has(c));
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

  // CSM share of the whole book: labs handled (parents + children, by each lab's own CSM) and revenue handled (each
  // client's group MRR, by the parent's CSM — same numbers as the segment matrix), as % of the company total. The
  // percentages are always against the WHOLE company, even when the view is narrowed to one CSM.
  const csmShare = useMemo(() => {
    const allRollup = computeLabRollup(labs);
    const totalLabs = labs.length;
    const totalMrr = allRollup.reduce((s, r) => s + toINR(r.mrr, r.region), 0);
    const names = [...new Set(labs.map((l) => l.csm).filter(Boolean))].sort();
    const rows = names.map((name) => {
      const labCount = labs.filter((l) => l.csm === name).length;
      const clients = allRollup.filter((r) => r.csm === name);
      const mrr = clients.reduce((s, r) => s + toINR(r.mrr, r.region), 0);
      return { name, labCount, clients: clients.length, mrr, labPct: totalLabs ? labCount / totalLabs : 0, mrrPct: totalMrr ? mrr / totalMrr : 0 };
    }).filter((r) => !scopeCsm || r.name === scopeCsm);
    return { rows, totalLabs, totalMrr };
  }, [labs, scopeCsm]);

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
      <h1 className="page-title">Financial Reports</h1>
      <p className="page-sub">Churn/contraction history and MRR breakdowns for <b>{scopeLabel}</b> — the granular reporting leadership tracked in spreadsheets, now live.</p>

      <div className="tabbar">
        <button className={`tabbtn${tab === "churn" ? " active" : ""}`} onClick={() => setTab("churn")}>Churn Report</button>
        <button className={`tabbtn${tab === "mrr" ? " active" : ""}`} onClick={() => setTab("mrr")}>MRR Breakdown</button>
      </div>

      <div style={{ marginTop: 16 }}>
        <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={teamNames} labType={labType} setLabType={setLabType} />
      </div>

      {tab === "churn" && (
        loadingChurn ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading churn log…</div>
        ) : churnError ? (
          <div className="error-banner">Couldn't load churn log — {churnError}</div>
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
          <div className="filters">
            <select value={fRegion} onChange={(e) => { setFRegion(e.target.value); setFCountry(""); setFState(""); setFCity(""); }}>
              <option value="">All regions</option><option value="Domestic">Domestic</option><option value="ROW">ROW</option>
            </select>
            <span style={{ minWidth: 200 }}><SearchSelect value={fCountry} onChange={(v) => { setFCountry(v); setFState(""); setFCity(""); }} options={countryOptions.map((n) => ({ value: n, label: n }))} emptyLabel="All countries" placeholder="All countries" /></span>
            <span style={{ minWidth: 200 }}><SearchSelect value={fState} onChange={(v) => { setFState(v); setFCity(""); }} options={stateOptions.map((n) => ({ value: n, label: n }))} emptyLabel="All states" placeholder="All states" /></span>
            <span style={{ minWidth: 200 }}><SearchSelect value={fCity} onChange={setFCity} options={cityOptions.map((n) => ({ value: n, label: n }))} emptyLabel="All cities" placeholder="All cities" /></span>
            {(fRegion || fCountry || fState || fCity) && <span className="clear" onClick={() => { setFRegion(""); setFCountry(""); setFState(""); setFCity(""); }}>Clear filters</span>}
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Region / Country / State / City narrow every table below except "CSM share of the book".</span>
          </div>
          <div className="table-card" style={{ marginBottom: 18 }}>
            <div style={{ padding: "14px 18px 4px", fontSize: 12.5, fontWeight: 700 }}>CSM share of the book <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>— % of all {csmShare.totalLabs} labs and of total MRR {fmtINR(csmShare.totalMrr)}</span></div>
            <div className="table-scroll">
              <table className="child-mini">
                <thead><tr><th>CSM</th><th>Labs handled</th><th>% of total labs</th><th>Clients (parent labs)</th><th>MRR handled</th><th>% of total revenue</th><th>ARR handled</th></tr></thead>
                <tbody>
                  {csmShare.rows.map((r) => (
                    <tr key={r.name}>
                      <td>{r.name}</td>
                      <td>{r.labCount}</td>
                      <td><b>{(r.labPct * 100).toFixed(1)}%</b></td>
                      <td>{r.clients}</td>
                      <td className="mrr-cell">{fmtINR(r.mrr)}</td>
                      <td><b>{(r.mrrPct * 100).toFixed(1)}%</b></td>
                      <td className="mrr-cell">{fmtINR(r.mrr * 12)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="table-card" style={{ marginBottom: 18 }}>
            <div style={{ padding: "14px 18px 4px", fontSize: 12.5, fontWeight: 700 }}>MRR by Segment{segByCsm.cols.length > 1 ? " × CSM" : ""} <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>— per client (parent lab), group MRR</span></div>
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
            <div style={{ padding: "14px 18px 4px", fontSize: 12.5, fontWeight: 700 }}>Client Count by Segment{segByCsm.cols.length > 1 ? " × CSM" : ""} <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>— parent labs</span></div>
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

          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 18 }}>
            {[["MRR by State", "State", stateBreakdown], ["MRR by City", "City", cityBreakdown]].map(([title, col, rows]) => (
              <div key={title} className="table-card" style={{ flex: "1 1 420px" }}>
                <div style={{ padding: "14px 18px 4px", fontSize: 12.5, fontWeight: 700 }}>{title} <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>— highest MRR first</span></div>
                {!rows.length ? <div style={{ padding: "10px 18px 16px", color: "var(--text-faint)", fontSize: 12.5 }}>No labs in this view.</div> : (
                  <Paginated items={rows}>{(page) => (
                    <div className="table-scroll"><table className="child-mini">
                      <thead><tr><th>{col}</th><th>Clients</th><th>Labs</th><th>MRR</th><th>% of MRR</th><th>Avg MRR / client</th><th>ARR</th></tr></thead>
                      <tbody>{page.map((g) => (
                        <tr key={g.key}>
                          <td>{g.key}</td>
                          <td>{g.clients}</td>
                          <td>{g.labs}</td>
                          <td className="mrr-cell">{fmtINR(g.mrr)}</td>
                          <td style={{ minWidth: 120 }}>
                            <span className="pct-bar"><span style={{ width: `${Math.max(g.pct * 100, g.mrr > 0 ? 2 : 0)}%` }} /></span>
                            <b>{(g.pct * 100).toFixed(1)}%</b>
                          </td>
                          <td className="mrr-cell">{fmtINR(g.clients ? g.mrr / g.clients : 0)}</td>
                          <td className="mrr-cell">{fmtINR(g.mrr * 12)}</td>
                        </tr>
                      ))}</tbody>
                    </table></div>
                  )}</Paginated>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
