import { Fragment, useEffect, useMemo, useState } from "react";
import { fmtINR, fmtMoney, toINR, segmentFor, SEG_BANDS } from "../lib/format";
import { isHealthyStatus } from "../lib/pulse";
import { computeLabRollup } from "../lib/labRollup";

const SEG_NAME = { A: "Enterprise", B: "Premium", C: "Advance", D: "Standard", E: "Essential" };
const CSV_COLUMNS = ["id", "name", "type", "parent", "csm", "region", "city", "state", "country", "mrr", "status"];

function exportLabsCsv(labs) {
  const header = CSV_COLUMNS.join(",");
  const lines = labs.map((l) => CSV_COLUMNS.map((c) => {
    const v = l[c] ?? "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  }).join(","));
  const csv = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `total-labs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function LabsView({ labs, csmNames, onOpenAddDrawer, onOpenLab, initialQuery }) {
  const [expanded, setExpanded] = useState({});
  const [filters, setFilters] = useState({ csm: "", region: "", status: "", segment: "" });
  const [query, setQuery] = useState(initialQuery || "");

  // The top bar's search box seeds this same query — keep them in sync when it changes there,
  // without fighting the user if they then edit this page's own search box directly.
  useEffect(() => {
    if (initialQuery !== undefined) setQuery(initialQuery);
  }, [initialQuery]);

  const rows = useMemo(() => {
    let r = computeLabRollup(labs);
    const q = query.trim().toLowerCase();
    // Matches the top bar's promise — Lab ID, Lab Name, CSM, City — not just the name.
    const matchesLab = (l) => [l.id, l.name, l.csm, l.city].some((v) => String(v || "").toLowerCase().includes(q));
    if (q) r = r.filter((row) => matchesLab(row) || row.children.some(matchesLab));
    if (filters.csm) r = r.filter((row) => row.csm === filters.csm || row.children.some((c) => c.csm === filters.csm));
    if (filters.region) r = r.filter((row) => row.region === filters.region);
    if (filters.status) r = r.filter((row) => row.status === filters.status || row.children.some((c) => c.status === filters.status));
    if (filters.segment) r = r.filter((row) => segmentFor(toINR(row.mrr, row.region)).code === filters.segment);
    return r;
  }, [labs, filters, query]);

  const allRowsForTiles = useMemo(() => computeLabRollup(labs), [labs]);
  const totalLabs = allRowsForTiles.length + allRowsForTiles.reduce((s, r) => s + r.children.length, 0);
  const activeCount = allRowsForTiles.filter((r) => r.status === "Active").length +
    allRowsForTiles.reduce((s, r) => s + r.children.filter((c) => c.status === "Active").length, 0);
  // Total MRR/ARR mix Domestic and ROW labs together, so every lab's own-currency amount is
  // converted to INR before summing — a raw sum would silently add dollars to rupees.
  const totalMRR = allRowsForTiles.reduce((s, r) => s + toINR(r.mrr, r.region), 0);
  const tiles = [
    ["Total Labs", totalLabs, ""],
    ["Parent Labs", allRowsForTiles.length, ""],
    ["Child Labs", allRowsForTiles.reduce((s, r) => s + r.children.length, 0), ""],
    ["Active Labs", activeCount, "ok"],
    ["Inactive Labs", totalLabs - activeCount, totalLabs - activeCount > 0 ? "bad" : ""],
    ["Total MRR", fmtINR(totalMRR), "accent"],
    ["Total ARR", fmtINR(totalMRR * 12), "accent"],
  ];

  function statusPillClass(s) { return "status-" + s.replace(" ", ""); }
  function healthPillClass(s) { return isHealthyStatus(s) ? "status-Active" : s === "Churn" ? "status-Inactive" : "status-AtRisk"; }

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1 className="page-title">Total Labs</h1>
          <p className="page-sub">The lab master record — Customer Master.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => exportLabsCsv(labs)}>Export</button>
          <button className="btn btn-ghost" disabled title="Coming next — bulk CSV import" style={{ opacity: 0.55, cursor: "not-allowed" }}>Import Labs</button>
          <button className="btn btn-primary" onClick={onOpenAddDrawer}>+ Add New Lab</button>
        </div>
      </div>

      <div className="tiles">
        {tiles.map(([label, val, cls]) => (
          <div key={label} className={`tile ${cls}`}>
            <div className="tval">{val}</div>
            <div className="tlabel">{label}</div>
          </div>
        ))}
      </div>

      <div className="filters">
        <input
          placeholder="🔍  Search lab name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ minWidth: 200 }}
        />
        <select value={filters.csm} onChange={(e) => setFilters((f) => ({ ...f, csm: e.target.value }))}>
          <option value="">All CSMs</option>
          {csmNames.map((n) => <option key={n}>{n}</option>)}
        </select>
        <select value={filters.segment} onChange={(e) => setFilters((f) => ({ ...f, segment: e.target.value }))}>
          <option value="">All Segments</option><option>A</option><option>B</option><option>C</option><option>D</option><option>E</option>
        </select>
        <select value={filters.region} onChange={(e) => setFilters((f) => ({ ...f, region: e.target.value }))}>
          <option value="">All Regions</option><option>Domestic</option><option>ROW</option>
        </select>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="">All Status</option><option>Active</option><option>Inactive</option><option>At Risk</option><option>Churned</option>
        </select>
        <span className="clear" onClick={() => { setFilters({ csm: "", region: "", status: "", segment: "" }); setQuery(""); }}>Clear all</span>
      </div>

      <div className="table-card">
      <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th></th><th>Lab ID</th><th>Lab Name</th><th>Type</th><th>CSM</th><th>Segment</th>
            <th>Region</th><th>State</th><th>Country</th><th>MRR</th><th>Status</th><th>Health</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan="12" style={{ textAlign: "center", color: "var(--text-faint)", padding: 24 }}>No labs match these filters.</td></tr>
          )}
          {rows.map((r) => {
            const seg = segmentFor(toINR(r.mrr, r.region));
            return (
              <Fragment key={r.id}>
                <tr>
                  <td>{r.children.length > 0 && (
                    <span className="toggle" onClick={() => setExpanded((e) => ({ ...e, [r.id]: !e[r.id] }))}>
                      {expanded[r.id] ? "▾" : "▸"}
                    </span>
                  )}</td>
                  <td>{r.id}</td>
                  <td className="lab-name clickable" onClick={() => onOpenLab(r.id)}>{r.name}</td>
                  <td>
                    <span className="pill pill-parent">Parent</span>
                    {r.children.length > 0 && (
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "var(--text-dim)" }} title="Billing Mode — set from the lab's Child Labs tab">
                        {r.billingMode === "Consolidated" ? "Consolidated" : "Per-Branch"}
                      </span>
                    )}
                  </td>
                  <td>{r.csm}</td>
                  <td><span className="seg-badge" style={{ background: seg.color }}>{seg.code}</span></td>
                  <td>{r.region}</td><td>{r.state}</td><td>{r.country}</td>
                  <td className="mrr-cell">{fmtMoney(r.mrr, r.region)}</td>
                  <td><span className={`status-pill ${statusPillClass(r.status)}`}>{r.status}</span></td>
                  <td>{r.healthStatus ? <span className={`status-pill ${healthPillClass(r.healthStatus)}`}>{r.healthStatus}</span> : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                </tr>
                {r.children.length > 0 && expanded[r.id] && r.children.map((c) => {
                  const cseg = segmentFor(toINR(c.mrr, c.region));
                  return (
                    <tr className="child-row" key={c.id}>
                      <td></td><td>{c.id}</td>
                      <td className="lab-name clickable" onClick={() => onOpenLab(c.id)}>{c.name}</td>
                      <td><span className="pill pill-child">Child</span></td>
                      <td>{c.csm}</td>
                      <td><span className="seg-badge" style={{ background: cseg.color }}>{cseg.code}</span></td>
                      <td>{c.region}</td><td>{c.state}</td><td>{c.country}</td>
                      <td className="mrr-cell">{fmtMoney(c.mrr, c.region)}</td>
                      <td><span className={`status-pill ${statusPillClass(c.status)}`}>{c.status}</span></td>
                      <td>{c.healthStatus ? <span className={`status-pill ${healthPillClass(c.healthStatus)}`}>{c.healthStatus}</span> : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 18 }}>
        <div className="side-card">
          <h4>Segment Guide</h4>
          {SEG_BANDS.map((b) => (
            <div key={b.code} className="seg-row">
              <span><span className="seg-badge" style={{ background: b.color }}>{b.code}</span> {SEG_NAME[b.code]}</span>
              <span style={{ color: "var(--text-dim)" }}>{fmtINR(b.min)}+ MRR</span>
            </div>
          ))}
        </div>
        <div className="side-card">
          <h4>Region Guide</h4>
          <div className="seg-row"><span><b>Domestic</b></span><span style={{ color: "var(--text-dim)" }}>Labs billed and operated within India</span></div>
          <div className="seg-row"><span><b>ROW</b></span><span style={{ color: "var(--text-dim)" }}>Rest of World — international labs</span></div>
        </div>
      </div>
    </div>
  );
}
