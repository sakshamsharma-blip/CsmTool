import { useEffect, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { computeLabRollup } from "../lib/labRollup";
import { fetchAllLabsAdoption } from "../lib/adoption";
import { fetchAllPitchStatus, buildActivePitchRows } from "../lib/pitch";
import { fetchAllTasks, toggleTaskDone as apiToggleTaskDone, addTask as apiAddTask } from "../lib/tasks";
import { hasLeadAccess } from "../lib/roles";
import ScopeToggle from "../components/ScopeToggle";
import TasksPanel from "../components/TasksPanel";

// Everything a CSM (or a Lead, across the team) needs to work through — every task regardless of
// due date (Overdue/Today/Upcoming/Someday/Done, same data "Tasks for Today" already uses under
// the hood, just not tucked away on Dashboard/Portfolio), plus a read-only view of every open
// Expansion pitch item (To Do/Pitching/In Progress) so nothing sitting in the pitch worklist gets
// forgotten just because it isn't a "task" yet. Pitch status itself is still only ever changed on
// My Portfolio — clicking a row here just opens that lab.
export default function TasksView({ labs, modules, plans, csmDirectory, currentCSM, idByName, onOpenLab, showToast }) {
  const isHead = hasLeadAccess(csmDirectory.find((c) => c.name === currentCSM)?.role);
  const [scope, setScope] = useState("mine");
  const [csmFilter, setCsmFilter] = useState("");
  const csmNames = csmDirectory.map((c) => c.name);

  const [adoptionByLab, setAdoptionByLab] = useState({});
  const [pitchByLab, setPitchByLab] = useState({});
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);

  function invert(m) { const out = {}; Object.entries(m).forEach(([name, id]) => { out[id] = name; }); return out; }

  async function loadAll() {
    if (!SUPABASE_CONFIGURED) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [adoption, pitch, tk] = await Promise.all([
        fetchAllLabsAdoption(), fetchAllPitchStatus(), fetchAllTasks(invert(idByName)),
      ]);
      setAdoptionByLab(adoption);
      setPitchByLab(pitch);
      setTasks(tk);
    } catch (err) {
      setError(err.message || "Failed to load tasks.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!SUPABASE_CONFIGURED) {
    return <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — Tasks needs a database connected.</div>;
  }
  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading tasks…</div>;
  if (error) return <div className="warn-banner" style={{ background: "var(--bad-bg)", color: "var(--bad)", borderColor: "#f3b8b8" }}>Couldn't load tasks — {error}</div>;

  const teamAll = isHead && scope === "team" && !csmFilter;
  const scopeCsm = isHead && scope === "team" ? (csmFilter || null) : currentCSM;
  const scopeLabel = teamAll ? "the whole team" : scopeCsm;

  const labsById = {};
  labs.forEach((l) => { labsById[l.id] = l; });
  const labOptions = [];
  computeLabRollup(labs).forEach((r) => { labOptions.push(r); r.children.forEach((c) => labOptions.push(c)); });

  const pitchRows = buildActivePitchRows({ labs, modules, plans, adoptionByLab, pitchByLab })
    .filter((r) => !scopeCsm || r.csm === scopeCsm)
    .sort((a, b) => a.labName.localeCompare(b.labName));

  async function handleToggleDone(task) {
    try { await apiToggleTaskDone(task); await loadAll(); } catch (err) { showToast(`⚠ ${err.message}`); }
  }
  async function handleAddTask(payload) {
    try { await apiAddTask({ ...payload, idByName }); await loadAll(); showToast(payload.owners.length > 1 ? `Task added for all ${payload.owners.length} CSMs.` : "Task added."); }
    catch (err) { showToast(`⚠ ${err.message}`); }
  }

  return (
    <div>
      <h1 className="page-title">Tasks</h1>
      <p className="page-sub">Everything on <b>{scopeLabel}</b>'s plate — personal to-dos, follow-ups, and open Expansion pitches — not just what's due today.</p>

      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={csmNames} />

      <TasksPanel
        tasks={tasks} scopeCsm={scopeCsm} onToggleDone={handleToggleDone} onAddTask={handleAddTask}
        onOpenLab={onOpenLab} isHead={isHead} currentCSM={currentCSM} csmNames={csmNames} labOptions={labOptions} labsById={labsById}
      />

      <div style={{ marginTop: 26 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>Pitch Reminders (Expansion) <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>({pitchRows.length})</span></div>
        <div className="banner" style={{ marginBottom: 12 }}>
          <span className="badge">READ-ONLY</span>
          <span>Every Expansion feature still sitting at To Do / Pitching / In Progress across {teamAll ? "the team" : `${scopeCsm}'s`} labs. Change a status from that lab's row on My Portfolio — this list just makes sure nothing here gets forgotten.</span>
        </div>
        {!pitchRows.length ? (
          <div className="table-card" style={{ padding: "18px 20px", color: "var(--text-faint)", fontSize: 12.5 }}>No open pitch items for {scopeLabel} right now.</div>
        ) : (
          <div className="table-card"><div className="table-scroll"><table className="child-mini">
            <thead><tr><th>Lab</th><th>Pitch Item</th><th>CSM</th><th>Status</th></tr></thead>
            <tbody>{pitchRows.map((r, i) => (
              <tr key={`${r.labId}-${r.moduleKey}-${r.paramName || ""}-${i}`}>
                <td className="lab-name clickable" onClick={() => onOpenLab(r.labId)}>{r.labName}</td>
                <td>{r.label}</td>
                <td>{r.csm}</td>
                <td><span className="status-chip" style={{ background: "transparent", border: "1px solid var(--accent)", color: "var(--accent)", cursor: "default" }}>{r.status}</span></td>
              </tr>
            ))}</tbody>
          </table></div></div>
        )}
      </div>
    </div>
  );
}
