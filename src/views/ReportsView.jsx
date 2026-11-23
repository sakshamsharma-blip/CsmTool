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
import MultiSelectFilter from "../components/MultiSelectFilter";

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
  // MRR Breakdown opens first (Nov 23 2026). A new key, so a tab remembered from before doesn't reopen Churn.
  const [tab, setTab] = useSessionState("reports.view", "mrr");

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

  // MRR by Country / State / City — per client (parent lab), group MRR in INR; labs = the client plus its child labs.
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
  const countryBreakdown = geoBreakdown((r) => (r.country && r.country !== "—" ? r.country : "Not set"));
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

  // CSM share of the whole book (Nov 2026): clients handled (parent labs, by the parent's CSM) and revenue handled (each
  // client's group MRR, by the parent's CSM — same numbers as the segment matrix), as % of the company total. The
  // percentages are always against the WHOLE company, even when the view is narrowed to one CSM.
  const csmShare = useMemo(() => {
    const allRollup = computeLabRollup(labs);
    const totalClients = allRollup.length; // clients = parent labs (a child counts under its parent)
    const totalMrr = allRollup.reduce((s, r) => s + toINR(r.mrr, r.region), 0);
    const names = [...new Set(labs.map((l) => l.csm).filter(Boolean))].sort();
    const rows = names.map((name) => {
      const clients = allRollup.filter((r) => r.csm === name);
      const mrr = clients.reduce((s, r) => s + toINR(r.mrr, r.region), 0);
      return { name, clients: clients.length, mrr, clientPct: totalClients ? clients.length / totalClients : 0, mrrPct: totalMrr ? mrr / totalMrr : 0 };
    }).filter((r) => !scopeCsm || r.name === scopeCsm);
    return { rows, totalClients, totalMrr };
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


  return (
    <div>
      <h1 className="page-title">Financial Reports</h1>
      <p className="page-sub">MRR breakdowns and churn / contraction history for <b>{scopeLabel}</b> — the granular reporting leadership tracked in spreadsheets, now live.</p>

      <div className="tabbar">
        <button className={`tabbtn${tab === "mrr" ? " active" : ""}`} onClick={() => setTab("mrr")}>MRR Breakdown</button>
        <button className={`tabbtn${tab === "churn" ? " active" : ""}`} onClick={() => setTab("churn")}>Churn Report</button>
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
            <div style={{ padding: "14px 18px 4px", fontSize: 12.5, fontWeight: 700 }}>CSM share of the book <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>— % of all {csmShare.totalClients} clients and of total MRR {fmtINR(csmShare.totalMrr)}</span></div>
            <div className="table-scroll">
              <table className="child-mini">
                <thead><tr><th>CSM</th><th>Clients (parent labs)</th><th>% of total clients</th><th>MRR handled</th><th>% of total revenue</th><th>ARR handled</th></tr></thead>
                <tbody>
                  {csmShare.rows.map((r) => (
                    <tr key={r.name}>
                      <td>{r.name}</td>
                      <td>{r.clients}</td>
                      <td><b>{(r.clientPct * 100).toFixed(1)}%</b></td>
                      <td className="mrr-cell">{fmtINR(r.mrr)}</td>
                      <td><b>{(r.mrrPct * 100).toFixed(1)}%</b></td>
                      <td className="mrr-cell">{fmtINR(r.mrr * 12)}</td>
                    </tr>
                  ))}
                  {(() => {
                    const t = csmShare.rows.reduce((a, r) => ({ clients: a.clients + r.clients, clientPct: a.clientPct + r.clientPct, mrr: a.mrr + r.mrr, mrrPct: a.mrrPct + r.mrrPct }), { clients: 0, clientPct: 0, mrr: 0, mrrPct: 0 });
                    return (
                      <tr style={{ fontWeight: 700 }}>
                        <td>Grand Total</td>
                        <td>{t.clients}</td>
                        <td>{(t.clientPct * 100).toFixed(1)}%</td>
                        <td className="mrr-cell">{fmtINR(t.mrr)}</td>
                        <td>{(t.mrrPct * 100).toFixed(1)}%</td>
                        <td className="mrr-cell">{fmtINR(t.mrr * 12)}</td>
                      </tr>
                    );
                  })()}
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

          </div>

          <LocationTable dim="Country" rows={countryBreakdown} />
          <LocationTable dim="State" rows={stateBreakdown} />
          <LocationTable dim="City" rows={cityBreakdown} />
        </>
      )}
    </div>
  );
}

// MRR by Country / State / City (Nov 23 2026): three separate full-width tables, no paging. Each scrolls down inside its
// card with the header and totals pinned, and has its own checkbox filter with search, remembered across a refresh.
function LocationTable({ dim, rows }) {
  const [picked, setPicked] = useSessionState(`reports.loc.${dim}`, []);
  const shown = picked.length ? rows.filter((g) => picked.includes(g.key)) : rows;
  const total = shown.reduce((t, g) => ({ clients: t.clients + g.clients, labs: t.labs + g.labs, mrr: t.mrr + g.mrr, pct: t.pct + g.pct }), { clients: 0, labs: 0, mrr: 0, pct: 0 });
  return (
    <div className="table-card rep-loc" style={{ marginTop: 18 }}>
      <div className="rep-loc-head">
        <b>MRR by {dim}</b>
        <MultiSelectFilter label={dim} selected={picked.filter((v) => rows.some((g) => g.key === v))} onChange={setPicked}
          options={rows.map((g) => ({ value: g.key, label: g.key, hint: fmtINR(g.mrr) }))} />
        <span className="rep-loc-note">{shown.length} of {rows.length} · highest MRR first</span>
      </div>
      {!rows.length ? <div style={{ padding: "10px 18px 16px", color: "var(--text-faint)", fontSize: 12.5 }}>No labs in this view.</div> : (
        <div className="rep-scroll">
          <table className="child-mini">
            <thead><tr><th>{dim}</th><th className="num">Clients</th><th className="num">Labs</th><th className="num">MRR</th><th>% of MRR</th><th className="num">ARR</th></tr></thead>
            <tbody>{shown.map((g) => (
              <tr key={g.key}>
                <td>{g.key}</td>
                <td className="num">{g.clients}</td>
                <td className="num">{g.labs}</td>
                <td className="num mrr-cell">{fmtINR(g.mrr)}</td>
                <td><span className="pct-bar"><span style={{ width: `${Math.max(g.pct * 100, g.mrr > 0 ? 2 : 0)}%` }} /></span><b>{(g.pct * 100).toFixed(1)}%</b></td>
                <td className="num mrr-cell">{fmtINR(g.mrr * 12)}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr>
              <td>{picked.length ? "Total (filtered)" : "Total"}</td>
              <td className="num">{total.clients}</td><td className="num">{total.labs}</td><td className="num">{fmtINR(total.mrr)}</td>
              <td><b>{(total.pct * 100).toFixed(1)}%</b></td><td className="num">{fmtINR(total.mrr * 12)}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
