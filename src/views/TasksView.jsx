import { useEffect, useState } from "react";
import { useSessionState } from "../lib/useSessionState";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { computeLabRollup } from "../lib/labRollup";
import { fetchAllLabsAdoption, fetchAllParamChanges, setParamStatus, statusOptions } from "../lib/adoption";
import {
  fetchAllPitchStatus, buildActiveItemRows, applyPitchStageChange, pitchOptionsFor,
} from "../lib/pitch";
import { todayISO } from "../lib/dates";
import Modal from "../components/Modal";
import { fetchAllTasks, toggleTaskDone as apiToggleTaskDone, addTask as apiAddTask, isTaskDoneToday } from "../lib/tasks";
import { useScopedCsm } from "../lib/useScopedCsm";
import ScopeToggle from "../components/ScopeToggle";
import TasksPanel from "../components/TasksPanel";
import PitchStageModal from "../components/PitchStageModal";
import InfoTip from "../components/InfoTip";
import SearchSelect from "../components/SearchSelect";
import Paginated from "../components/Pager";
import { labSelectOptions } from "../lib/selectOptions";

// Everything a CSM (or a Lead, across the team) needs to work through — every task regardless of
// due date (Overdue/Today/Upcoming/Someday/Done, or one list sorted by due date), plus every Adoption /
// Expansion item that is UNDER WAY (moved past To-Do — see buildActiveItemRows in lib/pitch.js). An item
// at To-Do is not a task yet. Status can be changed right from the table (the same records the lab's
// Adoption tab edits), and "Remind me" adds a dated reminder task for it.
const TASK_TYPE_FILTERS = [
  ["follow-up", "Follow-ups"], ["action-item", "Action items"], ["planned-visit", "Planned visits"],
  ["collection", "Collection due"], ["reminder", "Reminders"], ["recurring", "Recurring"], ["personal", "Personal"],
];
function taskTypeKey(t) {
  if (["follow-up", "action-item", "planned-visit", "collection", "pitch", "reminder"].includes(t.type)) return t.type;
  return t.repeat && t.repeat !== "none" ? "recurring" : "personal";
}

export default function TasksView({ labs, modules, plans, viewer, idByName, onOpenLab, onPatchLab, showToast }) {
  const { currentCSM } = viewer;
  const { isHead, scope, setScope, csmFilter, setCsmFilter, csmNames, teamNames, scopeCsm, teamAll } = useScopedCsm(viewer, "tasks");

  const [adoptionByLab, setAdoptionByLab] = useState({});
  const [pitchByLab, setPitchByLab] = useState({});
  const [changesByParam, setChangesByParam] = useState({});
  const [tasks, setTasks] = useState([]);
  const [sortByDue, setSortByDue] = useSessionState("tasks.sortByDue", "");
  const [fCategory, setFCategory] = useSessionState("tasks.fCategory", "");
  const [itemSort, setItemSort] = useSessionState("tasks.itemSort", "lab");
  const [remindFor, setRemindFor] = useState(null); // active item getting a reminder task
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);

  // A status change waiting for its confirm step (comment required; Purchased also asks Priced / Trial).
  const [pending, setPending] = useState(null);
  // Filters (apply to both the task list and Pitch Reminders where it makes sense)
  const [fLab, setFLab] = useSessionState("tasks.fLab", "");
  const [fType, setFType] = useSessionState("tasks.fType", "");
  const [fStatus, setFStatus] = useSessionState("tasks.fStatus", "");

  function invert(m) { const out = {}; Object.entries(m).forEach(([name, id]) => { out[id] = name; }); return out; }

  async function loadAll() {
    if (!SUPABASE_CONFIGURED) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [adoption, pitch, tk, ch] = await Promise.all([
        fetchAllLabsAdoption(), fetchAllPitchStatus(), fetchAllTasks(invert(idByName)), fetchAllParamChanges().catch(() => []),
      ]);
      const byParam = {};
      ch.forEach((c) => { (byParam[`${c.lab_id}|${c.module_key}|${c.param_name}`] = byParam[`${c.lab_id}|${c.module_key}|${c.param_name}`] || []).push(c); });
      setAdoptionByLab(adoption);
      setPitchByLab(pitch);
      setChangesByParam(byParam);
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

  const daysSince = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : null);
  const itemRows = buildActiveItemRows({ labs, modules, plans, adoptionByLab, pitchByLab, changesByParam })
    .filter((r) => !scopeCsm || r.csm === scopeCsm)
    .filter((r) => !fLab || r.labId === fLab)
    .filter((r) => !fCategory || r.category === fCategory)
    .map((r) => ({ ...r, days: daysSince(r.startedAt) }))
    .sort((a, b) => itemSort === "days"
      ? (b.days ?? -1) - (a.days ?? -1)
      : a.labName.localeCompare(b.labName) || a.paramName.localeCompare(b.paramName));

  const filteredTasks = tasks.filter((t) => {
    if (fLab && t.labId !== fLab) return false;
    if (fType && taskTypeKey(t) !== fType) return false;
    if (fStatus === "open" && isTaskDoneToday(t)) return false;
    if (fStatus === "done" && !isTaskDoneToday(t)) return false;
    return true;
  });

  async function handleToggleDone(task) {
    try { await apiToggleTaskDone(task); await loadAll(); } catch (err) { showToast(`⚠ ${err.message}`); }
  }
  async function handleAddTask(payload) {
    try { await apiAddTask({ ...payload, idByName }); await loadAll(); showToast(payload.owners.length > 1 ? `Task added for all ${payload.owners.length} CSMs.` : "Task added."); }
    catch (err) { showToast(`⚠ ${err.message}`); }
  }

  function handleItemStatusChange(r, status) {
    if (status === r.status) return;
    setPending({
      row: r,
      // region rides along so Purchased asks for the cost in the lab's own currency (₹ or $).
      target: { labId: r.labId, moduleKey: r.moduleKey, paramName: r.paramName, level: "param", label: r.paramName, existingParamState: r.resolved.state, region: labsById[r.labId]?.region },
      from: r.status, to: status,
    });
  }
  async function confirmStageChange({ comment, amount, isTrial }) {
    const { row, target: t, from, to } = pending;
    try {
      const lab = labsById[t.labId];
      const csmId = idByName[lab?.csm];
      let message;
      if (row.category === "In-Plan" && to !== "Lost after Purchase") {
        await setParamStatus(t.labId, row.resolved, to, comment, csmId, { canStepBack: isHead });
        message = `${t.label}: ${from} → ${to}.`;
      } else {
        const res = await applyPitchStageChange(t, { from, to, comment, amount, isTrial, csmId, labMrr: lab?.mrr });
        if (res.newMrr != null) onPatchLab?.(t.labId, { mrr: res.newMrr });
        message = res.message;
      }
      setPending(null);
      showToast(message);
      await loadAll();
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }
  async function saveReminder({ due, note }) {
    const r = remindFor;
    const owner = r.csm || currentCSM;
    try {
      await apiAddTask({
        labId: r.labId, desc: `Reminder: ${r.paramName} (${r.moduleName}, ${r.category})${note ? ` — ${note}` : ""}`,
        owners: [owner], type: "reminder", repeat: "none", due, idByName, assignedByName: currentCSM,
      });
      setRemindFor(null);
      showToast(`Reminder set for ${new Date(due + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}.`);
      await loadAll();
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  return (
    <div>
      <h1 className="page-title">Tasks</h1>
      <p className="page-sub">Everything on <b>{scopeLabel}</b>'s plate — personal to-dos, follow-ups, reminders, and Adoption / Expansion items in progress — not just what's due today.</p>

      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={teamNames} />

      <div className="filters">
        <SearchSelect value={fLab} onChange={setFLab} options={labSelectOptions(labOptions)} emptyLabel="All labs" placeholder="All labs" />
        <select value={fType} onChange={(e) => setFType(e.target.value)}>
          <option value="">All types</option>
          {TASK_TYPE_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Open &amp; done</option>
          <option value="open">Open only</option>
          <option value="done">Done only</option>
        </select>
        <select value={sortByDue} onChange={(e) => setSortByDue(e.target.value)} title="How the task list is ordered">
          <option value="">Group by Overdue / Today / …</option>
          <option value="asc">Sort by due date (earliest first)</option>
          <option value="desc">Sort by due date (latest first)</option>
        </select>
        {(fLab || fType || fStatus || sortByDue) && <span className="clear" onClick={() => { setFLab(""); setFType(""); setFStatus(""); setSortByDue(""); }}>Clear filters</span>}
      </div>

      <TasksPanel persistKey="tasks"
        tasks={filteredTasks} scopeCsm={scopeCsm} onToggleDone={handleToggleDone} onAddTask={handleAddTask}
        onOpenLab={onOpenLab} isHead={isHead} currentCSM={currentCSM} csmNames={csmNames} labOptions={labOptions} labsById={labsById}
        sortByDue={sortByDue}
      />

      <div style={{ marginTop: 26 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span>Adoption &amp; Expansion items in progress <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>({itemRows.length}{fLab ? ", filtered to one lab" : ""})</span></span>
          <InfoTip>An item shows up here once it moves past <b>To-Do</b> — In plan: In Discussion / Demo, Trial, Onboarding / Setup, Live 1–4; Not in plan: Pitching, Trial. In-plan items move one step at a time (Live steps a week apart, Adopted a month after Live 1). It leaves the list when it reaches a final status (Adopted, Purchased → In-plan To-Do, Not Required, …). Change the status right here (a comment is required, as on the lab's Adoption tab); "Remind me" adds a dated reminder to the task list above. "Days" = days since it got under way.</InfoTip>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, fontWeight: 400 }}>
            <select value={fCategory} onChange={(e) => setFCategory(e.target.value)} className="status-select">
              <option value="">In-Plan &amp; Not-in-Plan</option>
              <option value="In-Plan">In-Plan only</option>
              <option value="Not-in-Plan">Not-in-Plan only</option>
            </select>
            <select value={itemSort} onChange={(e) => setItemSort(e.target.value)} className="status-select">
              <option value="lab">Sort by lab</option>
              <option value="days">Sort by days open (oldest first)</option>
            </select>
          </span>
        </div>
        {!itemRows.length ? (
          <div className="table-card" style={{ padding: "18px 20px", color: "var(--text-faint)", fontSize: 12.5 }}>Nothing in progress for {scopeLabel} right now.</div>
        ) : (
          <div className="table-card"><Paginated items={itemRows}>{(pageRows) => (<div className="table-scroll"><table className="child-mini">
            <thead><tr><th>Lab</th><th>Category</th><th>Item</th><th>Days</th><th>Status</th><th>CSM</th><th></th></tr></thead>
            <tbody>{pageRows.map((r) => (
              <tr key={`${r.labId}|${r.moduleKey}|${r.paramName}`}>
                <td className="lab-name clickable" onClick={() => onOpenLab(r.labId)}>{r.labName}</td>
                <td><span className={`cat-tag cat-${r.category === "In-Plan" ? "Adoption" : "Expansion"}`}>{r.category}</span></td>
                <td>{r.paramName}<div style={{ fontSize: 11, color: "var(--text-faint)" }}>{r.moduleName}</div></td>
                <td style={{ fontWeight: 700, color: r.days == null ? "var(--text-faint)" : r.days > 30 ? "var(--bad)" : r.days > 14 ? "var(--warn)" : "var(--text)" }} title={r.startedAt ? `Under way since ${new Date(r.startedAt).toLocaleDateString()}` : "Start date not recorded"}>
                  {r.days == null ? "—" : `${r.days}d`}
                </td>
                <td>
                  <select className="status-select" value={r.status} onChange={(e) => handleItemStatusChange(r, e.target.value)}>
                    {r.category === "In-Plan"
                      ? statusOptions(r.resolved, { canStepBack: isHead }).map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.value}{o.note ? ` — ${o.note}` : ""}</option>)
                      : pitchOptionsFor(false, r.status).map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                </td>
                <td>{r.csm}</td>
                <td><button type="button" className="mark-purchased" onClick={() => setRemindFor(r)}>⏰ Remind me</button></td>
              </tr>
            ))}</tbody>
          </table></div>)}</Paginated></div>
        )}
      </div>

      {remindFor && <ReminderModal item={remindFor} onClose={() => setRemindFor(null)} onSave={saveReminder} />}
      {pending && (
        <PitchStageModal target={pending.target} fromStatus={pending.from} toStatus={pending.to} onClose={() => setPending(null)} onConfirm={confirmStageChange} />
      )}
    </div>
  );
}

function ReminderModal({ item, onClose, onSave }) {
  const [due, setDue] = useState(todayISO());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const field = { width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" };
  async function save() {
    if (!due) return;
    setSaving(true);
    try { await onSave({ due, note: note.trim() }); } finally { setSaving(false); }
  }
  return (
    <Modal open title={`Reminder — ${item.paramName}`} onClose={saving ? () => {} : onClose} actions={[
      { label: "Cancel", className: "btn-ghost", onClick: onClose, disabled: saving },
      { label: saving ? "Saving…" : "Add reminder", className: "btn-primary", onClick: save, disabled: saving },
    ]}>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>{item.labName} · {item.category} · {item.status}</div>
      <div className="tmpl-field" style={{ marginBottom: 10 }}>
        <label>Remind on</label>
        <input type="date" style={field} value={due} min={todayISO()} onChange={(e) => setDue(e.target.value)} />
      </div>
      <div className="tmpl-field">
        <label>Note (optional)</label>
        <input style={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Check trial feedback with the lab head" />
      </div>
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8 }}>Added to {item.csm || "the lab's CSM"}'s task list as a Reminder, due on that date.</div>
    </Modal>
  );
}
