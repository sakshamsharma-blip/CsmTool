import { useEffect, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { computeLabRollup } from "../lib/labRollup";
import { fetchAllLabsAdoption } from "../lib/adoption";
import {
  fetchAllPitchStatus, buildActivePitchRows, markFeatureAdded,
  setModulePitchStatus, setParamPitchStatus, PITCH_STATUSES,
} from "../lib/pitch";
import { fetchAllTasks, toggleTaskDone as apiToggleTaskDone, addTask as apiAddTask } from "../lib/tasks";
import { useScopedCsm } from "../lib/useScopedCsm";
import ScopeToggle from "../components/ScopeToggle";
import TasksPanel from "../components/TasksPanel";
import PitchStageModal from "../components/PitchStageModal";
import InfoTip from "../components/InfoTip";

// Everything a CSM (or a Lead, across the team) needs to work through — every task regardless of
// due date (Overdue/Today/Upcoming/Someday/Done, same data "Tasks for Today" already uses under
// the hood, just not tucked away on Dashboard/Portfolio), plus every open Expansion pitch item
// (To Do/Pitching/In Progress) so nothing sitting in the pitch worklist gets forgotten just
// because it isn't a "task" yet. Status can be changed right from this table (same underlying
// pitch_status row My Portfolio's dropdown edits) — no need to go find the lab there first.
export default function TasksView({ labs, modules, plans, viewer, idByName, onOpenLab, showToast }) {
  const { currentCSM } = viewer;
  const { isHead, scope, setScope, csmFilter, setCsmFilter, csmNames, scopeCsm, teamAll } = useScopedCsm(viewer);

  const [adoptionByLab, setAdoptionByLab] = useState({});
  const [pitchByLab, setPitchByLab] = useState({});
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);

  // A pitch-stage change waiting for its confirm step (optional comment; Added also asks for the cost).
  const [pending, setPending] = useState(null);

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
  if (error) return <div className="error-banner">Couldn't load tasks — {error}</div>;

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

  function handlePitchStatusChange(status, target) {
    if (status === target.fromStatus) return;
    setPending({ target, from: target.fromStatus, to: status });
  }
  async function confirmStageChange({ comment, amount, isTrial }) {
    const { target: t, from, to } = pending;
    try {
      const csmId = idByName[labsById[t.labId]?.csm];
      if (to === "Added") {
        await markFeatureAdded({ ...t, fromStatus: from }, amount, isTrial, csmId, comment);
        showToast(`${t.label} marked Added.`);
      } else {
        const opts = { comment, from, label: t.label };
        if (t.level === "module") await setModulePitchStatus(t.labId, t.moduleKey, to, csmId, opts);
        else await setParamPitchStatus(t.labId, t.moduleKey, t.paramName, to, csmId, opts);
        showToast(`${t.label}: ${from} → ${to}.`);
      }
      setPending(null);
      await loadAll();
    } catch (err) { showToast(`⚠ ${err.message}`); }
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
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center" }}>
          Pitch Reminders (Expansion) <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>({pitchRows.length})</span>
          <InfoTip>Every Expansion feature still sitting at To Do / Pitching / In Progress across {teamAll ? "the team" : `${scopeCsm}'s`} labs. Change a status right here — it's the same pitch record My Portfolio's lab view edits, so either place stays in sync. Every stage change asks for an optional comment and is logged to Lab History. Picking <b>Added</b> also asks for the added cost (or trial/free), then moves the feature onto that lab's Adoption tab and creates a Collections entry automatically.</InfoTip>
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
                <td>
                  <select
                    className="status-select"
                    value={r.status}
                    onChange={(e) => handlePitchStatusChange(e.target.value, {
                      labId: r.labId, moduleKey: r.moduleKey, paramName: r.paramName,
                      level: r.level, label: r.label, existingParamState: r.existingParamState, fromStatus: r.status,
                    })}
                  >
                    {PITCH_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
              </tr>
            ))}</tbody>
          </table></div></div>
        )}
      </div>

      {pending && (
        <PitchStageModal target={pending.target} fromStatus={pending.from} toStatus={pending.to} onClose={() => setPending(null)} onConfirm={confirmStageChange} />
      )}
    </div>
  );
}
