import { Fragment, useEffect, useMemo, useState } from "react";
import { useSessionState } from "../lib/useSessionState";
import { fmtINR, fmtMoney, toINR, segmentFor, SEG_BANDS } from "../lib/format";
import { isHealthyStatus } from "../lib/pulse";
import { computeLabRollup } from "../lib/labRollup";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { fetchAllVisits } from "../lib/visits";
import { computeSentimentHealth, HEALTH_BUCKET_COLORS } from "../lib/labHealth";
import { LAB_TYPES } from "../lib/labs";
import { useScopedCsm } from "../lib/useScopedCsm";
import { todayISO } from "../lib/dates";
import ScopeToggle from "../components/ScopeToggle";
import SearchSelect from "../components/SearchSelect";

const SEG_NAME = { A: "Enterprise", B: "Premium", C: "Advance", D: "Standard", E: "Essential" };
// [header, value getter]. "Lab ID" is the editable user-facing lab_code (not the internal id), the parent is
// shown by its Lab ID too, and MRR is each lab's own figure in its own currency.
const CSV_COLUMNS = [
  ["Lab ID", (l) => l.labCode || l.id],
  ["Lab Name", (l) => l.name],
  ["Type", (l) => l.type],
  ["Lab Type", (l) => l.labType || ""],
  ["Parent Lab ID", (l, byId) => (l.parent ? (byId[l.parent]?.labCode || l.parent) : "")],
  ["CSM", (l) => l.csm],
  ["Region", (l) => l.region],
  ["City", (l) => l.city],
  ["State", (l) => l.state],
  ["Country", (l) => l.country],
  ["MRR", (l) => l.mrr],
  ["Currency", (l) => (l.region === "ROW" ? "USD" : "INR")],
  ["Status", (l) => l.status],
];

function csvCell(v) {
  let s = String(v ?? "");
  // Spreadsheet apps execute cells starting with = + - @ as formulas — prefix them so they stay text.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  s = s.replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

function exportLabsCsv(labs, allLabs) {
  const byId = {};
  allLabs.forEach((l) => { byId[l.id] = l; });
  const header = CSV_COLUMNS.map(([h]) => h).join(",");
  const lines = labs.map((l) => CSV_COLUMNS.map(([, get]) => csvCell(get(l, byId))).join(","));
  const csv = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `total-labs-${todayISO()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function LabsView({ labs, viewer, onOpenAddDrawer, onOpenLab, initialQuery }) {
  // Same "My Labs vs. Team View" scoping every other screen (Dashboard, My Portfolio,
  // Collections, Tasks, Visits, Reports) already has — Total Labs was the one screen that
  // skipped it and showed the full company list to everyone, CSM included. A plain CSM is
  // locked to their own labs (ScopeToggle renders nothing for them); a Lead/Admin defaults to
  // their own too but can flip to Team View. currentCSM already reflects whoever an Admin is
  // currently previewing as (Sidebar's "Preview as"), so this also closes the gap where Total
  // Labs used to leak everyone's labs even while an Admin was previewing a plain CSM.
  const { isHead, scope, setScope, csmFilter, setCsmFilter, teamNames, scopeCsm } = useScopedCsm(viewer, "labs");

  const [expanded, setExpanded] = useState({});
  const EMPTY_FILTERS = { csm: "", region: "", status: "", segment: "", country: "", state: "", city: "", labType: "", health: "" };
  const [filters, setFilters] = useSessionState("labs.filters", EMPTY_FILTERS);
  // Populated from whatever States actually exist on labs today — not the full geography
  // dataset — so this only ever offers choices that will actually match something.
  const stateOptions = useMemo(() => [...new Set(labs.map((l) => l.state).filter((v) => v && v !== "—"))].sort(), [labs]);
  const countryOptions = useMemo(() => [...new Set(labs.map((l) => l.country).filter((v) => v && v !== "—"))].sort(), [labs]);
  const cityOptions = useMemo(() => [...new Set(labs.map((l) => (l.city || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [labs]);
  const [query, setQuery] = useSessionState("labs.query", initialQuery || "");
  const [sortBy, setSortBy] = useSessionState("labs.sortBy", "mrr-desc"); // default: highest MRR first (compared in INR)
  const [visits, setVisits] = useState([]);

  // Lab Health (Sentiment) badge — fetched independently of `labs` (same pattern Dashboard/
  // Visits use), non-blocking: the table itself renders instantly off the `labs` prop, and these
  // badges just fill in once visit history loads.
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    fetchAllVisits().then(setVisits).catch((err) => console.error(err));
  }, []);
  const visitsByLab = useMemo(() => {
    const m = {};
    visits.forEach((v) => { (m[v.labId] = m[v.labId] || []).push(v); });
    return m;
  }, [visits]);
  function sentimentHealthOf(l) { return computeSentimentHealth(visitsByLab[l.id]); }

  // The top bar's search box seeds this same query — keep them in sync when it changes there,
  // without fighting the user if they then edit this page's own search box directly.
  const [seenInitialQuery, setSeenInitialQuery] = useState(initialQuery);
  if (initialQuery !== seenInitialQuery) {
    setSeenInitialQuery(initialQuery);
    if (initialQuery !== undefined) setQuery(initialQuery);
  }

  // Ownership scoping (My Labs / Team View / previewed CSM) always applies first — same rule
  // for the table and the summary tiles above it — and the manual "All CSMs" dropdown filter
  // below narrows further from there for a Lead/Admin already in Team View.
  const rows = useMemo(() => {
    let r = computeLabRollup(labs);
    if (scopeCsm) r = r.filter((row) => row.csm === scopeCsm || row.children.some((c) => c.csm === scopeCsm));
    const q = query.trim().toLowerCase();
    // Matches the top bar's promise — Lab ID, Lab Name, CSM, City — not just the name. Lab ID
    // here means labCode (the editable, user-facing one — see migration 0017), not the internal
    // id, though they still match for any lab whose Lab ID has never been renamed.
    const matchesLab = (l) => [l.labCode || l.id, l.name, l.csm, l.city].some((v) => String(v || "").toLowerCase().includes(q));
    if (q) r = r.filter((row) => matchesLab(row) || row.children.some(matchesLab));
    if (filters.csm) r = r.filter((row) => row.csm === filters.csm || row.children.some((c) => c.csm === filters.csm));
    if (filters.region) r = r.filter((row) => row.region === filters.region);
    if (filters.country) r = r.filter((row) => row.country === filters.country || row.children.some((c) => c.country === filters.country));
    if (filters.state) r = r.filter((row) => row.state === filters.state || row.children.some((c) => c.state === filters.state));
    if (filters.city) {
      const sameCity = (l) => (l.city || "").trim().toLowerCase() === filters.city.toLowerCase();
      r = r.filter((row) => sameCity(row) || row.children.some(sameCity));
    }
    if (filters.status) r = r.filter((row) => row.status === filters.status || row.children.some((c) => c.status === filters.status));
    if (filters.segment) r = r.filter((row) => segmentFor(toINR(row.mrr, row.region)).code === filters.segment);
    // Same rule as filterLabsByLabType: a child lab with no type of its own counts as its parent's.
    if (filters.labType) r = r.filter((row) => row.labType === filters.labType || row.children.some((c) => (c.labType || row.labType) === filters.labType));
    if (filters.health) {
      const hasHealth = (l) => computeSentimentHealth(visitsByLab[l.id]).bucket === filters.health;
      r = r.filter((row) => hasHealth(row) || row.children.some(hasHealth));
    }
    const mrrInr = (l) => toINR(l.mrr, l.region) || 0;
    const cmp = sortBy === "mrr-asc" ? (a, b) => mrrInr(a) - mrrInr(b)
      : sortBy === "name" ? (a, b) => a.name.localeCompare(b.name)
        : (a, b) => mrrInr(b) - mrrInr(a);
    return [...r].sort(cmp).map((row) => ({ ...row, children: [...row.children].sort(cmp) }));
  }, [labs, filters, query, scopeCsm, sortBy, visitsByLab]);

  const allRowsForTiles = useMemo(() => {
    let r = computeLabRollup(labs);
    if (scopeCsm) r = r.filter((row) => row.csm === scopeCsm || row.children.some((c) => c.csm === scopeCsm));
    return r;
  }, [labs, scopeCsm]);
  const totalLabs = allRowsForTiles.length + allRowsForTiles.reduce((s, r) => s + r.children.length, 0);
  const activeCount = allRowsForTiles.filter((r) => r.status === "Active").length +
    allRowsForTiles.reduce((s, r) => s + r.children.filter((c) => c.status === "Active").length, 0);
  // Total MRR/ARR mix Domestic and ROW labs together, so every lab's own-currency amount is
  // converted to INR before summing — a raw sum would silently add dollars to rupees.
  const totalMRR = allRowsForTiles.reduce((s, r) => s + toINR(r.mrr, r.region), 0);
  // Lab Health (Sentiment) counts — every lab (parents and child labs), same way Active / Inactive are counted.
  const everyLabInScope = allRowsForTiles.flatMap((r) => [r, ...r.children]);
  const healthCount = (bucket) => everyLabInScope.filter((l) => sentimentHealthOf(l).bucket === bucket).length;
  const tiles = [
    ["Total Labs", totalLabs, ""],
    ["Parent Labs (Clients)", allRowsForTiles.length, ""],
    ["Child Labs", allRowsForTiles.reduce((s, r) => s + r.children.length, 0), ""],
    ["Active Labs", activeCount, "ok"],
    ["Inactive Labs", totalLabs - activeCount, totalLabs - activeCount > 0 ? "bad" : ""],
    ["Needs Attention (Lab Health)", healthCount("Needs Attention"), healthCount("Needs Attention") > 0 ? "warn" : ""],
    ["At Risk (Lab Health)", healthCount("At Risk"), healthCount("At Risk") > 0 ? "bad" : ""],
    ["Total MRR", fmtINR(totalMRR), "accent"],
    ["Total ARR", fmtINR(totalMRR * 12), "accent"],
  ];

  function statusPillClass(s) { return "status-" + s.replace(" ", ""); }
  function healthPillClass(s) { return isHealthyStatus(s) ? "status-Active" : s === "Churn" ? "status-Inactive" : "status-AtRisk"; }

  // One table row (a parent, or a child under an expanded parent). The first five cells stay frozen when the
  // table scrolls sideways.
  function labRow(l, isChild) {
    const seg = segmentFor(toINR(l.mrr, l.region));
    return (
      <tr key={l.id} className={isChild ? "child-row" : undefined}>
        <td className="fz fz0">{!isChild && l.children.length > 0 && (
          <span className="toggle" onClick={() => setExpanded((e) => ({ ...e, [l.id]: !e[l.id] }))}>{expanded[l.id] ? "▾" : "▸"}</span>
        )}</td>
        <td className="fz fz1">{l.labCode || l.id}</td>
        <td className="fz fz2 lab-name clickable" onClick={() => onOpenLab(l.id)}>{l.name}</td>
        <td className="fz fz3"><span className={`pill ${isChild ? "pill-child" : "pill-parent"}`}>{isChild ? "Child" : "Parent"}</span></td>
        <td className="fz fz4">{l.csm}</td>
        <td className="mrr-cell">{fmtMoney(l.mrr, l.region)}</td>
        <td><span className="seg-badge" style={{ background: seg.color }}>{seg.code}</span></td>
        <td>{l.region}</td>
        <td>{l.labType || <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
        <td><span className={`status-pill ${statusPillClass(l.status)}`}>{l.status}</span></td>
        <td>{l.healthStatus ? <span className={`status-pill ${healthPillClass(l.healthStatus)}`}>{l.healthStatus}</span> : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
        <td><span style={{ fontSize: 11, fontWeight: 700, color: HEALTH_BUCKET_COLORS[sentimentHealthOf(l).bucket] }}>{sentimentHealthOf(l).bucket}</span></td>
        <td>{l.city || "—"}</td><td>{l.state}</td><td>{l.country}</td>
      </tr>
    );
  }

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1 className="page-title">Total Labs</h1>
          <p className="page-sub">The lab master record — Customer Master.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" title="Exports the labs currently listed below (your scope + filters), parents and their child labs" onClick={() => exportLabsCsv(rows.flatMap((r) => [labs.find((l) => l.id === r.id) || r, ...r.children]), labs)}>Export</button>
          <button className="btn btn-ghost" disabled title="Coming next — bulk CSV import" style={{ opacity: 0.55, cursor: "not-allowed" }}>Import Labs</button>
          <button className="btn btn-primary" onClick={onOpenAddDrawer}>+ Add New Lab</button>
        </div>
      </div>

      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={teamNames} />

      <div className="tiles" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))" }}>
        {tiles.map(([label, val, cls]) => (
          <div key={label} className={`tile ${cls}`}>
            <div className="tval">{val}</div>
            <div className="tlabel">{label}</div>
          </div>
        ))}
      </div>

      <div className="filters">
        {/* Not an email field — see the note on the top bar's search box for why every autofill hint is off. */}
        <input
          type="text"
          name="csm-lab-filter"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          data-form-type="other"
          placeholder="🔍  Search lab name…"
          value={query}
          onChange={(e) => {
            const v = e.target.value;
            if (e.nativeEvent && e.nativeEvent.inputType === undefined && v.includes("@")) return;
            setQuery(v);
          }}
          style={{ minWidth: 200 }}
        />
        {/* Extra manual "jump to one CSM" narrowing on top of the scope above — only meaningful
            once Team View is already showing more than one person's labs, so a plain CSM (always
            scoped to just their own) never sees it. */}
        {isHead && (
          <select value={filters.csm} onChange={(e) => setFilters((f) => ({ ...f, csm: e.target.value }))}>
            <option value="">All CSMs</option>
            {teamNames.map((n) => <option key={n}>{n}</option>)}
          </select>
        )}
        <select value={filters.segment} onChange={(e) => setFilters((f) => ({ ...f, segment: e.target.value }))}>
          <option value="">All Segments</option><option>A</option><option>B</option><option>C</option><option>D</option><option>E</option>
        </select>
        <select value={filters.labType || ""} onChange={(e) => setFilters((f) => ({ ...f, labType: e.target.value }))} title="Lab Type">
          <option value="">All Lab Types</option>
          {LAB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filters.health || ""} onChange={(e) => setFilters((f) => ({ ...f, health: e.target.value }))} title="Lab Health (Sentiment) — from logged visit/check-in sentiment">
          <option value="">All Lab Health</option>
          {["Healthy", "Needs Attention", "At Risk", "Not Assessed"].map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={filters.region} onChange={(e) => setFilters((f) => ({ ...f, region: e.target.value }))}>
          <option value="">All Regions</option><option>Domestic</option><option>ROW</option>
        </select>
        <SearchSelect
          value={filters.country}
          onChange={(v) => setFilters((f) => ({ ...f, country: v }))}
          options={countryOptions.map((c) => ({ value: c, label: c }))}
          emptyLabel="All Countries"
          placeholder="All Countries"
        />
        <SearchSelect
          value={filters.state}
          onChange={(v) => setFilters((f) => ({ ...f, state: v }))}
          options={stateOptions.map((s) => ({ value: s, label: s }))}
          emptyLabel="All States"
          placeholder="All States"
        />
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="">All Status</option><option>Active</option><option>Inactive</option><option>At Risk</option><option>Churned</option>
        </select>
        <SearchSelect
          value={filters.city}
          onChange={(v) => setFilters((f) => ({ ...f, city: v }))}
          options={cityOptions.map((c) => ({ value: c, label: c }))}
          emptyLabel="All Cities"
          placeholder="All Cities"
        />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} title="Sort">
          <option value="mrr-desc">MRR: high → low</option>
          <option value="mrr-asc">MRR: low → high</option>
          <option value="name">Lab name A → Z</option>
        </select>
        <span className="clear" onClick={() => { setFilters(EMPTY_FILTERS); setQuery(""); setSortBy("mrr-desc"); }}>Clear all</span>
      </div>

      <div className="table-card">
      <div className="table-scroll">
      <table className="freeze-cols">
        <thead>
          <tr>
            <th className="fz fz0"></th><th className="fz fz1">Lab ID</th><th className="fz fz2">Lab Name</th><th className="fz fz3">Type</th><th className="fz fz4">CSM Name</th>
            <th>MRR</th><th>Segment</th><th>Region</th><th>Lab Type</th><th>Status</th><th>Health</th>
            <th title="Auto, from logged visit/check-in sentiment — separate from Health">Lab Health (Sentiment)</th>
            <th>City</th><th>State</th><th>Country</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan="15" style={{ textAlign: "center", color: "var(--text-faint)", padding: 24 }}>No labs match these filters.</td></tr>
          )}
          {rows.map((r) => (
            <Fragment key={r.id}>
              {labRow(r, false)}
              {r.children.length > 0 && expanded[r.id] && r.children.map((c) => labRow(c, true))}
            </Fragment>
          ))}
        </tbody>
      </table>
      </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 18 }}>
        <div className="side-card">
          <h4>Segment Guide</h4>
          {SEG_BANDS.map((b, i) => (
            <div key={b.code} className="seg-row">
              <span><span className="seg-badge" style={{ background: b.color }}>{b.code}</span> {SEG_NAME[b.code]}</span>
              <span style={{ color: "var(--text-dim)" }}>{b.min === 0 ? `${fmtINR(0)}–${fmtINR(SEG_BANDS[i - 1].min - 1)}` : `${fmtINR(b.min)}+`} MRR</span>
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
