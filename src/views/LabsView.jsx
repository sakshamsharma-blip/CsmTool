import { Fragment, useMemo, useState } from "react";
import { fmtINR, segmentFor } from "../lib/format";

function computeRows(labs) {
  const parents = labs.filter((l) => l.type === "Parent");
  return parents.map((par) => {
    const children = labs.filter((l) => l.type === "Child" && l.parent === par.id);
    const mrr = children.length ? children.reduce((s, c) => s + c.mrr, 0) : par.mrr || 0;
    return { ...par, mrr, children };
  });
}

export default function LabsView({ labs, csmNames, onOpenAddDrawer, onOpenLab }) {
  const [expanded, setExpanded] = useState({});
  const [filters, setFilters] = useState({ csm: "", region: "", status: "", segment: "" });

  const rows = useMemo(() => {
    let r = computeRows(labs);
    if (filters.csm) r = r.filter((row) => row.csm === filters.csm || row.children.some((c) => c.csm === filters.csm));
    if (filters.region) r = r.filter((row) => row.region === filters.region);
    if (filters.status) r = r.filter((row) => row.status === filters.status || row.children.some((c) => c.status === filters.status));
    if (filters.segment) r = r.filter((row) => segmentFor(row.mrr).code === filters.segment);
    return r;
  }, [labs, filters]);

  const allRowsForTiles = useMemo(() => computeRows(labs), [labs]);
  const totalLabs = allRowsForTiles.length + allRowsForTiles.reduce((s, r) => s + r.children.length, 0);
  const activeCount = allRowsForTiles.filter((r) => r.status === "Active").length +
    allRowsForTiles.reduce((s, r) => s + r.children.filter((c) => c.status === "Active").length, 0);
  const totalMRR = allRowsForTiles.reduce((s, r) => s + r.mrr, 0);
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

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1 className="page-title">Total Labs</h1>
          <p className="page-sub">The lab master record — Customer Master.</p>
        </div>
        <button className="btn btn-primary" onClick={onOpenAddDrawer}>+ Add New Lab</button>
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
          <option value="">All Status</option><option>Active</option><option>Inactive</option><option>At Risk</option>
        </select>
        <span className="clear" onClick={() => setFilters({ csm: "", region: "", status: "", segment: "" })}>Clear all</span>
      </div>

      <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th></th><th>Lab ID</th><th>Lab Name</th><th>Type</th><th>CSM</th><th>Segment</th>
            <th>Region</th><th>State</th><th>Country</th><th>MRR</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan="11" style={{ textAlign: "center", color: "var(--text-faint)", padding: 24 }}>No labs match these filters.</td></tr>
          )}
          {rows.map((r) => {
            const seg = segmentFor(r.mrr);
            return (
              <Fragment key={r.id}>
                <tr>
                  <td>{r.children.length > 0 && (
                    <span className="toggle" onClick={() => setExpanded((e) => ({ ...e, [r.id]: !e[r.id] }))}>
                      {expanded[r.id] ? "▾" : "▸"}
                    </span>
                  )}</td>
                  <td>{r.id}</td>
                  <td className="lab-name clickable" onClick={() => onOpenLab(r)}>{r.name}</td>
                  <td><span className="pill pill-parent">Parent</span></td>
                  <td>{r.csm}</td>
                  <td><span className="seg-badge" style={{ background: seg.color }}>{seg.code}</span></td>
                  <td>{r.region}</td><td>{r.state}</td><td>{r.country}</td>
                  <td className="mrr-cell">{fmtINR(r.mrr)}</td>
                  <td><span className={`status-pill ${statusPillClass(r.status)}`}>{r.status}</span></td>
                </tr>
                {r.children.length > 0 && expanded[r.id] && r.children.map((c) => {
                  const cseg = segmentFor(c.mrr);
                  return (
                    <tr className="child-row" key={c.id}>
                      <td></td><td>{c.id}</td>
                      <td className="lab-name clickable" onClick={() => onOpenLab(c)}>{c.name}</td>
                      <td><span className="pill pill-child">Child</span></td>
                      <td>{c.csm}</td>
                      <td><span className="seg-badge" style={{ background: cseg.color }}>{cseg.code}</span></td>
                      <td>{c.region}</td><td>{c.state}</td><td>{c.country}</td>
                      <td className="mrr-cell">{fmtINR(c.mrr)}</td>
                      <td><span className={`status-pill ${statusPillClass(c.status)}`}>{c.status}</span></td>
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
  );
}
