import { useEffect, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { computeLabRollup, flattenRollup } from "../lib/labRollup";
import { fetchAllVisits, addVisit, updateVisit } from "../lib/visits";
import { fetchAllTasks, taskBucket, addTask, toggleTaskDone, deleteTask, todayISO, syncFollowupTaskForVisit } from "../lib/tasks";
import { useScopedCsm } from "../lib/useScopedCsm";
import ScopeToggle from "../components/ScopeToggle";
import Modal from "../components/Modal";
import InfoTip from "../components/InfoTip";
import SearchSelect from "../components/SearchSelect";
import { labSelectOptions } from "../lib/selectOptions";

// Visits & Meetings is about OFFLINE, in-person visits only. Calls, emails, WhatsApp chats and notes are
// still logged — from a lab's Log Check-in — but they live in Lab History, not here. Two things happen on
// this page: a past visit gets logged (saved to the lab's Lab History), and a future one gets planned
// (saved as a task, so it shows under Tasks on the day it's due).
const VISIT_TYPE = "Visit";
const PLANNED_VISIT_TASK_TYPE = "planned-visit";

function invert(m) { const out = {}; Object.entries(m || {}).forEach(([name, id]) => { out[id] = name; }); return out; }

export default function VisitsView({ labs, viewer, idByName, onOpenLab, showToast }) {
  const { currentCSM } = viewer;
  const { isHead, scope, setScope, csmFilter, setCsmFilter, csmNames, scopeCsm, teamAll } = useScopedCsm(viewer);

  const [visits, setVisits] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);

  // Log a past visit
  const [logOpen, setLogOpen] = useState(false);
  const [logLabId, setLogLabId] = useState("");
  const [logDate, setLogDate] = useState(() => todayISO());
  const [logNotes, setLogNotes] = useState("");
  const [logFollowup, setLogFollowup] = useState("");
  const [logFollowupReason, setLogFollowupReason] = useState("");
  const [logSentiment, setLogSentiment] = useState("");
  const [logFromTask, setLogFromTask] = useState(null); // a planned-visit task being completed by this log
  const [logError, setLogError] = useState(false);

  // Plan a future visit
  const [planOpen, setPlanOpen] = useState(false);
  const [planLabId, setPlanLabId] = useState("");
  const [planDate, setPlanDate] = useState("");
  const [planPurpose, setPlanPurpose] = useState("");
  const [planError, setPlanError] = useState("");

  // Edit a logged visit
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editLabId, setEditLabId] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editFollowup, setEditFollowup] = useState("");
  const [editFollowupReason, setEditFollowupReason] = useState("");
  const [editSentiment, setEditSentiment] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  async function loadAll() {
    if (!SUPABASE_CONFIGURED) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [vs, tk] = await Promise.all([fetchAllVisits(), fetchAllTasks(invert(idByName))]);
      setVisits(vs);
      setTasks(tk);
    }
    catch (err) { setError(err.message || "Failed to load visits."); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!SUPABASE_CONFIGURED) {
    return <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — Visits &amp; Meetings needs a database connected.</div>;
  }
  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading visits…</div>;
  if (error) return <div className="error-banner">Couldn't load visits — {error}</div>;

  const scopeLabel = teamAll ? "the whole team" : scopeCsm;

  const allRows = computeLabRollup(labs);
  const rows = scopeCsm ? allRows.filter((r) => r.csm === scopeCsm || r.children.some((c) => c.csm === scopeCsm)) : allRows;
  const flat = flattenRollup(rows);
  const flatIds = new Set(flat.map((l) => l.id));
  const labsById = {};
  labs.forEach((l) => { labsById[l.id] = l; });

  // Offline visits only — everything else (calls, emails…) belongs to Log Check-in / Lab History.
  const scoped = visits.filter((v) => flatIds.has(v.labId) && v.type === VISIT_TYPE);
  const recent = scoped.slice().sort((a, b) => new Date(b.visitDate) - new Date(a.visitDate));
  const upcoming = tasks
    .filter((t) => t.type === PLANNED_VISIT_TASK_TYPE && !t.done && t.labId && flatIds.has(t.labId))
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));

  // Every lab — parents AND children — searchable by name, Lab ID or city.
  const labOptions = labSelectOptions(flattenRollup(allRows));

  function resetLogForm() {
    setLogLabId(""); setLogDate(todayISO()); setLogNotes(""); setLogFollowup(""); setLogFollowupReason("");
    setLogSentiment(""); setLogFromTask(null); setLogError(false);
  }
  function openLog() { resetLogForm(); setLogOpen(true); }
  // "Log this visit" on a planned visit: opens the log form with the lab and date filled in; saving it
  // also ticks the planned-visit task off so it doesn't linger as upcoming.
  function openLogForPlanned(task) {
    resetLogForm();
    setLogLabId(task.labId);
    setLogDate(task.due && task.due <= todayISO() ? task.due : todayISO());
    setLogFromTask(task);
    setLogOpen(true);
  }

  async function handleLogVisit() {
    if (!logLabId) { setLogError(true); return; }
    try {
      const lab = labsById[logLabId];
      const newVisitId = await addVisit({
        labId: logLabId, csmId: idByName[lab?.csm], type: VISIT_TYPE, visitDate: logDate,
        notes: logNotes, nextFollowupDate: logFollowup || null, nextFollowupReason: logFollowupReason,
        sentiment: logSentiment || null,
      });

      // A next-follow-up date always creates a real task too, so it shows up under Tasks on the day it's
      // due. sourceVisitId links it back to this visit so a later edit can keep it in sync.
      if (logFollowup) {
        await addTask({
          labId: logLabId,
          desc: `Follow-up — ${lab ? lab.name : logLabId}${logFollowupReason ? `: ${logFollowupReason}` : ""}`,
          owners: [currentCSM],
          type: "follow-up",
          repeat: "none",
          due: logFollowup,
          idByName,
          assignedByName: currentCSM,
          sourceVisitId: newVisitId,
        });
      }
      if (logFromTask) await toggleTaskDone(logFromTask);

      setLogOpen(false);
      resetLogForm();
      await loadAll();
      showToast("Visit logged — it's now in the lab's Lab History.");
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  function openPlan() {
    setPlanLabId(""); setPlanDate(""); setPlanPurpose(""); setPlanError("");
    setPlanOpen(true);
  }
  async function handlePlanVisit() {
    if (!planLabId) { setPlanError("Pick a lab."); return; }
    if (!planDate) { setPlanError("Pick the date you plan to visit."); return; }
    if (planDate < todayISO()) { setPlanError("A planned visit has to be today or later — use Log Visit for one that already happened."); return; }
    try {
      const lab = labsById[planLabId];
      // Owned by the lab's CSM, so it lands on their Tasks even when a Lead plans it for them.
      const owner = lab?.csm || currentCSM;
      await addTask({
        labId: planLabId,
        desc: `Planned visit — ${lab ? lab.name : planLabId}${planPurpose.trim() ? `: ${planPurpose.trim()}` : ""}`,
        owners: [owner],
        type: PLANNED_VISIT_TASK_TYPE,
        repeat: "none",
        due: planDate,
        idByName,
        assignedByName: currentCSM,
      });
      setPlanOpen(false);
      await loadAll();
      showToast("Visit planned — it's in Tasks for that day.");
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }
  async function handleCancelPlanned(task) {
    if (!window.confirm("Cancel this planned visit? It will be removed from Tasks.")) return;
    try { await deleteTask(task.id); await loadAll(); showToast("Planned visit cancelled."); }
    catch (err) { showToast(`⚠ ${err.message}`); }
  }

  function openEdit(v) {
    setEditId(v.id);
    setEditLabId(v.labId);
    setEditDate(v.visitDate);
    setEditNotes(v.notes || "");
    setEditFollowup(v.nextFollowupDate || "");
    setEditFollowupReason(v.nextFollowupReason || "");
    setEditSentiment(v.sentiment || "");
    setEditOpen(true);
  }

  async function handleSaveEdit() {
    setEditSaving(true);
    try {
      await updateVisit(editId, {
        type: VISIT_TYPE, visitDate: editDate, notes: editNotes,
        nextFollowupDate: editFollowup || null, nextFollowupReason: editFollowupReason,
        sentiment: editSentiment || null,
      });
      // Keep this visit's linked follow-up task in step with the follow-up date as edited.
      const editLab = labsById[editLabId];
      await syncFollowupTaskForVisit({
        visitId: editId, labId: editLabId, labName: editLab ? editLab.name : editLabId, ownerName: editLab?.csm || currentCSM, idByName,
        nextFollowupDate: editFollowup || null, nextFollowupReason: editFollowupReason,
      });
      setEditOpen(false);
      await loadAll();
      showToast("Visit updated.");
    } catch (err) { showToast(`⚠ ${err.message}`); }
    finally { setEditSaving(false); }
  }

  const fieldStyle = { width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" };

  return (
    <div>
      <h1 className="page-title">
        Visits &amp; Meetings
        <InfoTip>Only offline, in-person visits live here. Log one that already happened (it's saved to the lab's Lab History), or plan a future one (it becomes a task, due on the visit date). Calls, emails, WhatsApp chats and notes are logged from a lab's Log Check-in instead.</InfoTip>
      </h1>
      <p className="page-sub">Planned and logged offline visits for <b>{scopeLabel}</b>.</p>

      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={csmNames} />

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 10 }}>
        <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={openPlan}>+ Plan a Visit</button>
        <button className="btn btn-primary" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={openLog}>+ Log Visit</button>
      </div>

      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Upcoming Planned Visits</h3>
      {!upcoming.length ? (
        <div className="table-card" style={{ padding: "18px 20px", textAlign: "center", color: "var(--text-faint)", fontSize: 12.5, marginBottom: 22 }}>No visits planned — use “Plan a Visit” to schedule one.</div>
      ) : (
        <div className="table-card" style={{ marginBottom: 22 }}><div className="table-scroll"><table className="child-mini">
          <thead><tr><th>Lab</th><th>Visit</th><th>Planned For</th><th>CSM</th><th></th></tr></thead>
          <tbody>{upcoming.map((t) => {
            const bucket = taskBucket(t.due);
            const dueColor = bucket === "overdue" ? "var(--bad)" : bucket === "today" ? "var(--warn)" : "var(--text-dim)";
            const lab = labsById[t.labId];
            return (
              <tr key={t.id}>
                <td className="lab-name clickable" onClick={() => onOpenLab(t.labId)}>{lab ? lab.name : t.labId}</td>
                <td style={{ fontSize: 12 }}>{t.desc}</td>
                <td style={{ fontWeight: 700, color: dueColor, whiteSpace: "nowrap" }}>
                  {bucket === "overdue" ? "Overdue · " : ""}{t.due ? new Date(t.due + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}
                </td>
                <td>{t.owner}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <span className="mark-purchased" onClick={() => openLogForPlanned(t)}>Log this visit</span>
                  <span className="icon-btn" title="Cancel this planned visit" onClick={() => handleCancelPlanned(t)} style={{ cursor: "pointer", marginLeft: 8 }}>✕</span>
                </td>
              </tr>
            );
          })}</tbody>
        </table></div></div>
      )}

      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Visits Logged</h3>
      {!recent.length ? (
        <div className="table-card" style={{ padding: "18px 20px", textAlign: "center", color: "var(--text-faint)", fontSize: 12.5 }}>No offline visits logged yet.</div>
      ) : (
        <div className="table-card"><div className="table-scroll"><table className="child-mini">
          <thead><tr><th>Lab</th><th>Date</th><th>Notes</th><th>Sentiment</th><th></th></tr></thead>
          <tbody>{recent.map((v) => {
            const lab = labsById[v.labId];
            const sentColor = v.sentiment === "Positive" ? "var(--ok)" : v.sentiment === "At Risk" ? "var(--bad)" : "var(--text-dim)";
            return (
              <tr key={v.id}>
                <td className="lab-name clickable" onClick={() => onOpenLab(v.labId)}>{lab ? lab.name : v.labId}</td>
                <td style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{new Date(v.visitDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</td>
                <td style={{ fontSize: 12 }}>{v.notes || "—"}</td>
                <td>{v.sentiment ? <span style={{ fontSize: 11, fontWeight: 700, color: sentColor }}>{v.sentiment}</span> : "—"}</td>
                <td><span className="icon-btn" title="Edit" onClick={() => openEdit(v)} style={{ cursor: "pointer" }}>✎</span></td>
              </tr>
            );
          })}</tbody>
        </table></div></div>
      )}

      <Modal
        open={logOpen}
        title={logFromTask ? "Log Planned Visit" : "Log a Visit"}
        onClose={() => setLogOpen(false)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setLogOpen(false) },
          { label: "Log Visit", className: "btn-primary", onClick: handleLogVisit },
        ]}
      >
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Lab</label>
          <SearchSelect value={logLabId} onChange={setLogLabId} options={labOptions} placeholder="Search a lab…" inputStyle={fieldStyle} disabled={!!logFromTask} />
        </div>
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Visit Date</label>
          <input type="date" style={fieldStyle} value={logDate} max={todayISO()} onChange={(e) => setLogDate(e.target.value)} />
        </div>
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Notes</label>
          <textarea rows="3" style={fieldStyle} value={logNotes} onChange={(e) => setLogNotes(e.target.value)} placeholder="What happened on the visit" />
        </div>
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Sentiment (optional)</label>
          <select style={fieldStyle} value={logSentiment} onChange={(e) => setLogSentiment(e.target.value)}>
            <option value="">Not set</option>
            <option value="Positive">Positive</option>
            <option value="Neutral">Neutral</option>
            <option value="At Risk">At Risk</option>
          </select>
        </div>
        <div className="tmpl-field-row" style={{ marginBottom: 4, display: "flex", gap: 10 }}>
          <div className="tmpl-field" style={{ flex: 1 }}>
            <label>Next Follow-up (optional)</label>
            <input type="date" style={fieldStyle} value={logFollowup} onChange={(e) => setLogFollowup(e.target.value)} />
          </div>
          <div className="tmpl-field" style={{ flex: 1 }}>
            <label>Follow-up Reason</label>
            <input style={fieldStyle} value={logFollowupReason} onChange={(e) => setLogFollowupReason(e.target.value)} placeholder="e.g. QBR" />
          </div>
        </div>
        {logError && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>Pick a lab first.</div>}
        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10 }}>Saved to this lab's Lab History{logFromTask ? ", and the planned visit is marked done" : ""}.</div>
      </Modal>

      <Modal
        open={planOpen}
        title="Plan a Visit"
        onClose={() => setPlanOpen(false)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setPlanOpen(false) },
          { label: "Plan Visit", className: "btn-primary", onClick: handlePlanVisit },
        ]}
      >
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Lab</label>
          <SearchSelect value={planLabId} onChange={setPlanLabId} options={labOptions} placeholder="Search a lab…" inputStyle={fieldStyle} />
        </div>
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Planned Date</label>
          <input type="date" style={fieldStyle} value={planDate} min={todayISO()} onChange={(e) => setPlanDate(e.target.value)} />
        </div>
        <div className="tmpl-field">
          <label>Purpose (optional)</label>
          <input style={fieldStyle} value={planPurpose} onChange={(e) => setPlanPurpose(e.target.value)} placeholder="e.g. Quarterly review, training on Billing" />
        </div>
        {planError && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>{planError}</div>}
        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10 }}>Becomes a task for the lab's CSM, due on the planned date. After the visit, use “Log this visit” to record it.</div>
      </Modal>

      <Modal
        open={editOpen}
        title="Edit Visit"
        onClose={() => setEditOpen(false)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setEditOpen(false) },
          { label: editSaving ? "Saving…" : "Save Changes", className: "btn-primary", onClick: handleSaveEdit, disabled: editSaving },
        ]}
      >
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Visit Date</label>
          <input type="date" style={fieldStyle} value={editDate} onChange={(e) => setEditDate(e.target.value)} />
        </div>
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Notes</label>
          <textarea rows="3" style={fieldStyle} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="What happened on the visit" />
        </div>
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Sentiment (optional)</label>
          <select style={fieldStyle} value={editSentiment} onChange={(e) => setEditSentiment(e.target.value)}>
            <option value="">Not set</option>
            <option value="Positive">Positive</option>
            <option value="Neutral">Neutral</option>
            <option value="At Risk">At Risk</option>
          </select>
        </div>
        <div className="tmpl-field-row" style={{ marginBottom: 4, display: "flex", gap: 10 }}>
          <div className="tmpl-field" style={{ flex: 1 }}>
            <label>Next Follow-up (optional)</label>
            <input type="date" style={fieldStyle} value={editFollowup} onChange={(e) => setEditFollowup(e.target.value)} />
          </div>
          <div className="tmpl-field" style={{ flex: 1 }}>
            <label>Follow-up Reason</label>
            <input style={fieldStyle} value={editFollowupReason} onChange={(e) => setEditFollowupReason(e.target.value)} placeholder="e.g. QBR" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
