import { useEffect, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { fmtINR, fmtMoney, toINR, segmentFor } from "../lib/format";
import { computeLabRollup } from "../lib/labRollup";
import { fetchAllLabsAdoption, computeSavedLabScores } from "../lib/adoption";
import { fetchAllCollectionsItems, labCollectionsSummary, isItemOpen, itemBalance, AGING_COLORS } from "../lib/collections";
import { fetchAllTasks, toggleTaskDone as apiToggleTaskDone, addTask as apiAddTask, getOpenTasksFor } from "../lib/tasks";
import { hasLeadAccess } from "../lib/roles";
import ScopeToggle from "../components/ScopeToggle";
import BarChart from "../components/BarChart";
import TasksPanel from "../components/TasksPanel";

export default function DashboardView({ labs, modules, plans, csmDirectory, currentCSM, idByName, onOpenLab, showToast }) {
  const isHead = hasLeadAccess(csmDirectory.find((c) => c.name === currentCSM)?.role);
  const [scope, setScope] = useState("mine");
  const [csmFilter, setCsmFilter] = useState("");
  const csmNames = csmDirectory.map((c) => c.name);

  const [adoptionByLab, setAdoptionByLab] = useState({});
  const [collectionsItems, setCollectionsItems] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);

  function invert(m) { const out = {}; Object.entries(m).forEach(([name, id]) => { out[id] = name; }); return out; }

  async function loadAll() {
    if (!SUPABASE_CONFIGURED) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [adoption, items, tk] = await Promise.all([
        fetchAllLabsAdoption(), fetchAllCollectionsItems(), fetchAllTasks(invert(idByName)),
      ]);
      setAdoptionByLab(adoption);
      setCollectionsItems(items);
      setTasks(tk);
    } catch (err) {
      setError(err.message || "Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!SUPABASE_CONFIGURED) {
    return <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — Dashboard needs a database connected.</div>;
  }
  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading dashboard…</div>;
  if (error) return <div className="warn-banner" style={{ background: "var(--bad-bg)", color: "var(--bad)", borderColor: "#f3b8b8" }}>Couldn't load dashboard — {error}</div>;

  const teamAll = isHead && scope === "team" && !csmFilter;
  const scopeCsm = isHead && scope === "team" ? (csmFilter || null) : currentCSM;
  const scopeLabel = teamAll ? "All CSMs" : scopeCsm;

  const allRows = computeLabRollup(labs);
  const rows = scopeCsm ? allRows.filter((r) => r.csm === scopeCsm || r.children.some((c) => c.csm === scopeCsm)) : allRows;

  function planOf(lab) { return plans.find((p) => p.id === lab.plan) || plans[0]; }
  function scoreOf(lab) { return computeSavedLabScores(modules, planOf(lab), adoptionByLab[lab.id]); }

  const totalLabs = rows.length + rows.reduce((s, r) => s + r.children.length, 0);
  const totalMRR = rows.reduce((s, r) => s + toINR(r.mrr, r.region), 0);
  const activeCount = rows.filter((r) => r.status === "Active").length + rows.reduce((s, r) => s + r.children.filter((c) => c.status === "Active").length, 0);
  const atRiskCount = rows.filter((r) => r.status === "At Risk").length + rows.reduce((s, r) => s + r.children.filter((c) => c.status === "At Risk").length, 0);
  const avgAdoption = rows.length ? Math.round(rows.reduce((s, r) => s + scoreOf(r).overallPct, 0) / rows.length) : 0;
  const openTaskCount = getOpenTasksFor(tasks, teamAll ? null : scopeCsm).length;

  const healthy = rows.filter((r) => scoreOf(r).overallPct >= 75).length;
  const needsPush = rows.filter((r) => { const p = scoreOf(r).overallPct; return p >= 40 && p < 75; }).length;
  const atRiskAdopt = rows.filter((r) => scoreOf(r).overallPct < 40).length;

  const labsById = {};
  labs.forEach((l) => { labsById[l.id] = l; });

  const rowIds = new Set();
  rows.forEach((r) => { rowIds.add(r.id); r.children.forEach((c) => rowIds.add(c.id)); });
  const scopedItems = collectionsItems.filter((i) => rowIds.has(i.labId));
  // Items can belong to labs in different currencies — convert each to INR before summing.
  const outstandingTotal = scopedItems.filter(isItemOpen).reduce((s, i) => s + toINR(itemBalance(i), labsById[i.labId]?.region), 0);
  const collectedTotal = scopedItems.reduce((s, i) => s + toINR(i.collectedManual || 0, labsById[i.labId]?.region), 0);

  // Collections Aging — one bucket per lab (its oldest open item), matching the prototype's
  // 4-bucket chart rather than a raw item count.
  const itemsByLab = {};
  scopedItems.forEach((i) => { (itemsByLab[i.labId] = itemsByLab[i.labId] || []).push(i); });
  const agingCounts = { Current: 0, "Due Soon": 0, Overdue: 0, Critical: 0 };
  Object.values(itemsByLab).forEach((labItems) => {
    const s = labCollectionsSummary(labItems);
    if (s.openCount) agingCounts[s.bucket] += 1;
  });

  async function handleToggleDone(task) {
    try { await apiToggleTaskDone(task); await loadAll(); } catch (err) { showToast(`⚠ ${err.message}`); }
  }
  async function handleAddTask(payload) {
    try { await apiAddTask({ ...payload, idByName }); await loadAll(); showToast(payload.owners.length > 1 ? `Task added for all ${payload.owners.length} CSMs.` : "Task added."); }
    catch (err) { showToast(`⚠ ${err.message}`); }
  }

  const labOptions = [];
  allRows.forEach((r) => { labOptions.push(r); r.children.forEach((c) => labOptions.push(c)); });

  const byCsm = (isHead && scope === "team" && !csmFilter) ? csmNames.map((name) => {
    const csmRows = allRows.filter((r) => r.csm === name || r.children.some((c) => c.csm === name));
    const labCount = csmRows.length + csmRows.reduce((s, r) => s + r.children.length, 0);
    const mrr = csmRows.reduce((s, r) => s + toINR(r.mrr, r.region), 0);
    const avgAdopt = csmRows.length ? Math.round(csmRows.reduce((s, r) => s + scoreOf(r).overallPct, 0) / csmRows.length) : 0;
    const openTasks = getOpenTasksFor(tasks, name).length;
    return { name, labCount, mrr, avgAdopt, openTasks };
  }).filter((c) => c.labCount > 0) : null;

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-sub">Viewing: <b>{scopeLabel}</b></p>

      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={csmNames} />

      <div className="summary-grid" style={{ gridTemplateColumns: "repeat(6,1fr)", marginBottom: 8 }}>
        <div className="stile"><div className="sval">{totalLabs}</div><div className="slabel">Labs</div></div>
        <div className="stile"><div className="sval" style={{ color: "var(--accent)" }}>{fmtINR(totalMRR)}</div><div className="slabel">Total MRR</div></div>
        <div className="stile"><div className="sval" style={{ color: "var(--ok)" }}>{activeCount}</div><div className="slabel">Active</div></div>
        <div className="stile"><div className="sval" style={{ color: atRiskCount > 0 ? "var(--bad)" : "var(--text)" }}>{atRiskCount}</div><div className="slabel">At Risk</div></div>
        <div className="stile"><div className="sval">{avgAdoption}%</div><div className="slabel">Avg Adoption</div></div>
        <div className="stile"><div className="sval">{openTaskCount}</div><div className="slabel">Open Tasks</div></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, margin: "18px 0" }}>
        <div className="table-card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 12 }}>Adoption Health</div>
          <BarChart labelWidth={145} data={[
            { label: "Healthy (≥75%)", value: healthy, color: "var(--ok)" },
            { label: "Needs Push (40–74%)", value: needsPush, color: "var(--warn)" },
            { label: "At Risk (<40%)", value: atRiskAdopt, color: "var(--bad)" },
          ]} />
        </div>
        <div className="table-card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 12 }}>Collections Aging</div>
          <BarChart labelWidth={100} valueFmt={(v) => String(v)} data={[
            { label: "Current", value: agingCounts.Current, color: AGING_COLORS.Current },
            { label: "Due Soon", value: agingCounts["Due Soon"], color: AGING_COLORS["Due Soon"] },
            { label: "Overdue", value: agingCounts.Overdue, color: AGING_COLORS.Overdue },
            { label: "Critical", value: agingCounts.Critical, color: AGING_COLORS.Critical },
          ]} />
          <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 10 }}>{fmtINR(outstandingTotal)} outstanding · {fmtINR(collectedTotal)} collected to date</div>
        </div>
      </div>

      <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>Tasks for Today</h3>
      <div style={{ marginBottom: 8 }}>
        <TasksPanel tasks={tasks} scopeCsm={teamAll ? null : scopeCsm} onToggleDone={handleToggleDone} onAddTask={handleAddTask}
          onOpenLab={onOpenLab} isHead={isHead} currentCSM={currentCSM} csmNames={csmNames} labOptions={labOptions} labsById={labsById} />
      </div>

      {byCsm && (
        <div style={{ marginTop: 18 }}>
          <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>By CSM</h3>
          <div className="table-card"><table className="child-mini">
            <thead><tr><th>CSM</th><th>Labs</th><th>Total MRR</th><th>Avg Adoption</th><th>Open Tasks</th></tr></thead>
            <tbody>{byCsm.map((c) => (
              <tr key={c.name}>
                <td className="lab-name clickable" onClick={() => setCsmFilter(c.name)}>{c.name}</td>
                <td>{c.labCount}</td>
                <td className="mrr-cell">{fmtINR(c.mrr)}</td>
                <td>{c.avgAdopt}%</td>
                <td>{c.openTasks}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>Labs</h3>
      {!rows.length ? (
        <div className="table-card" style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>No labs in this view.</div>
      ) : rows.map((lab) => {
        const seg = segmentFor(toINR(lab.mrr, lab.region));
        const scores = scoreOf(lab);
        const ringColor = scores.overallPct >= 75 ? "var(--ok)" : scores.overallPct >= 40 ? "var(--warn)" : "var(--bad)";
        return (
          <div key={lab.id} className="table-card" style={{ marginBottom: 8, padding: "12px 18px", display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }} onClick={() => onOpenLab(lab.id)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="lab-name" style={{ fontWeight: 700, fontSize: 13 }}>{lab.name}</div>
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{lab.id} · {lab.csm} · <span className="seg-badge" style={{ background: seg.color }}>{seg.code}</span></div>
            </div>
            <div style={{ textAlign: "right", fontSize: 12 }}><div style={{ fontWeight: 700 }}>{fmtMoney(lab.mrr, lab.region)}</div><div style={{ color: "var(--text-dim)", fontSize: 10.5 }}>MRR</div></div>
            <span className={`status-pill status-${lab.status.replace(" ", "")}`}>{lab.status}</span>
            <div style={{ textAlign: "right", fontSize: 12, width: 48 }}><div style={{ fontWeight: 700, color: ringColor }}>{Math.round(scores.overallPct)}%</div><div style={{ color: "var(--text-dim)", fontSize: 10.5 }}>Adoption</div></div>
          </div>
        );
      })}
    </div>
  );
}
