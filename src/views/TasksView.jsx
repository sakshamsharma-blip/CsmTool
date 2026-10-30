import { useEffect, useState, useMemo } from "react";
import { useSessionState } from "../lib/useSessionState";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { computeLabRollup } from "../lib/labRollup";
import { fetchAllLabsAdoption, resolveParam, setParamStatus, statusOptions } from "../lib/adoption";
import { fetchAllPitchStatus, applyPitchStageChange, pitchOptionsFor } from "../lib/pitch";
import {
  fetchAllTasks, addTask as apiAddTask, setTaskStatus, toggleTaskDone, fetchTaskCommentCounts, isRecurring, isTaskDueToday,
  isTaskDoneToday, taskBucket, taskStatusLabel, taskTypeLabel, resolutionDays, repeatLabel,
  TASK_PRIORITIES, TASK_SOURCES, PRIORITY_COLORS,
} from "../lib/tasks";
import { taskKpis, statusDistribution, overdueAging, groupedStats, daysOverdue } from "../lib/taskStats";
import { filterLabsByLabType } from "../lib/labs";
import { useScopedCsm } from "../lib/useScopedCsm";
import ScopeToggle from "../components/ScopeToggle";
import AddTaskModal from "../components/AddTaskModal";
import TaskDrawer from "../components/TaskDrawer";
import PitchStageModal from "../components/PitchStageModal";
import InfoTip from "../components/InfoTip";
import SearchSelect from "../components/SearchSelect";
import { labSelectOptions } from "../lib/selectOptions";

// Tasks (redesigned Oct 30 2026 from the reference layout): KPI tiles, Resolution TAT by source, status distribution and
// overdue aging, then the task table grouped Overdue / Due Today / Upcoming / No due date / Done, a side panel per task
// (TaskDrawer), and — in Team View — the team's TAT and source-wise completion for the last 30 days.
// Adoption / Expansion items that are under way are tasks too (Source Adoption / Expansion — created automatically, see
// syncItemTask in lib/tasks.js); their stage can still be changed from the task panel.
const TYPE_FILTERS = [
  ["follow-up", "Follow-up"], ["action-item", "Action Item"], ["planned-visit", "Planned Visit"], ["adoption-item", "Adoption"],
  ["expansion-item", "Expansion"], ["collection", "Collection Due"], ["reminder", "Reminder"], ["recurring", "Recurring"], ["personal", "Personal"],
];
function typeKey(t) {
  if (["follow-up", "action-item", "planned-visit", "adoption-item", "expansion-item", "collection", "pitch", "reminder"].includes(t.type)) return t.type;
  return isRecurring(t) ? "recurring" : "personal";
}
const STATUS_FILTERS = ["Open", "In Progress", "On Hold", "Overdue", "Due Today", "Done"];
const GROUPS = [
  { key: "overdue", label: "Overdue", cls: "tk-g-overdue" },
  { key: "today", label: "Due Today", cls: "tk-g-today" },
  { key: "upcoming", label: "Upcoming", cls: "tk-g-upcoming" },
  { key: "none", label: "No due date", cls: "tk-g-upcoming" },
  { key: "done", label: "Done", cls: "tk-g-done" },
];
function groupOf(t) {
  if (isTaskDoneToday(t)) return "done";
  if (isRecurring(t)) return "today";
  return taskBucket(t.due);
}
const STATUS_PILL = { Overdue: "tk-st-overdue", "Due Today": "tk-st-today", Done: "tk-st-done", "On Hold": "tk-st-hold", "In Progress": "tk-st-progress", Open: "tk-st-open" };
const DIST_COLORS = { Open: "var(--accent)", "In Progress": "var(--stg-plan-2)", Overdue: "var(--bad)", Done: "var(--ok)", "On Hold": "var(--stg-closed)" };
const SOURCE_COLORS = { Manual: "var(--accent)", Adoption: "var(--stg-plan-2)", Expansion: "var(--stg-exp-2)" };
const PAGE = 25;

const fmtDays = (v) => (v == null ? "—" : `${v.toFixed(1)} days`);
const fmtDue = (iso) => new Date(iso + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

// "↑ 12%" — `goodWhenUp` decides the colour (lower TAT is good). `unit` "pts" for percentage-point changes.
function Delta({ value, goodWhenUp = true, unit = "%" }) {
  if (value == null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  const good = up === goodWhenUp;
  return <span className={`tk-delta ${good ? "good" : "bad"}`} title="Last 30 days vs the 30 days before">{up ? "↑" : "↓"} {Math.abs(Math.round(value))}{unit === "pts" ? " pts" : "%"}</span>;
}

export default function TasksView({ labs: allLabs, modules, plans, viewer, idByName, onOpenLab, onPatchLab, showToast }) {
  const { currentCSM } = viewer;
  const { isHead, scope, setScope, csmFilter, setCsmFilter, csmNames, teamNames, scopeCsm, teamAll, labType, setLabType } = useScopedCsm(viewer, "tasks");
  const labs = useMemo(() => filterLabsByLabType(allLabs, labType), [allLabs, labType]);

  const [tasks, setTasks] = useState([]);
  const [commentCounts, setCommentCounts] = useState({});
  const [adoptionByLab, setAdoptionByLab] = useState({});
  const [pitchByLab, setPitchByLab] = useState({});
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);       // task shown in the side panel
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState([]);      // ticked rows (bulk Mark as Done)
  const [pending, setPending] = useState(null);      // an item stage change waiting for its confirm dialog
  const [shown, setShown] = useState({});            // rows shown per group ("Show more")
  const [doneOpen, setDoneOpen] = useSessionState("tasks.doneOpen", false);

  // Filters (remembered across a refresh)
  const [fLab, setFLab] = useSessionState("tasks.fLab", "");
  const [fType, setFType] = useSessionState("tasks.fType", "");
  const [fStatus, setFStatus] = useSessionState("tasks.fStatus", "");
  const [fPriority, setFPriority] = useSessionState("tasks.fPriority", "");
  const [fSource, setFSource] = useSessionState("tasks.fSource", "");
  const [fFrom, setFFrom] = useSessionState("tasks.fFrom", "");
  const [fTo, setFTo] = useSessionState("tasks.fTo", "");
  const [q, setQ] = useSessionState("tasks.q", "");
  const [sortDir, setSortDir] = useSessionState("tasks.sortDir", "asc");

  const nameById = useMemo(() => { const m = {}; Object.entries(idByName).forEach(([n, id]) => { m[id] = n; }); return m; }, [idByName]);

  async function loadAll(quiet = false) {
    if (!SUPABASE_CONFIGURED) { setLoading(false); return; }
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [tk, counts, adoption, pitch] = await Promise.all([
        fetchAllTasks(nameById), fetchTaskCommentCounts().catch(() => ({})), // task_updates may not exist before migration 0043
        fetchAllLabsAdoption(), fetchAllPitchStatus(),
      ]);
      setTasks(tk); setCommentCounts(counts); setAdoptionByLab(adoption); setPitchByLab(pitch);
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
  const actorId = idByName[currentCSM];

  // Tasks in view: owner scope (My Labs / one CSM / whole team) + Lab Type. A recurring task only shows on the days it's due.
  const inScope = tasks.filter((t) => (!scopeCsm || t.owner === scopeCsm)
    && (!labType || labsById[t.labId])
    && (!isRecurring(t) || isTaskDueToday(t)));

  // ---- analytics (scope only, not the table filters) ----
  const kpi = taskKpis(inScope);
  const dist = statusDistribution(inScope);
  const aging = overdueAging(inScope);
  const bySource = groupedStats(inScope, (t) => t.source, TASK_SOURCES);
  const ownersInView = [...new Set(inScope.map((t) => t.owner).filter(Boolean))].sort();
  const team = (isHead && scope === "team") ? groupedStats(inScope, (t) => t.owner, ownersInView) : null;

  // ---- table ----
  const needle = q.trim().toLowerCase();
  const filtered = inScope.filter((t) => {
    if (fLab && t.labId !== fLab) return false;
    if (fType && typeKey(t) !== fType) return false;
    if (fPriority && t.priority !== fPriority) return false;
    if (fSource && t.source !== fSource) return false;
    if (fStatus) {
      const label = taskStatusLabel(t);
      if (fStatus === "Overdue" || fStatus === "Due Today") { if (label !== fStatus) return false; }
      else if (fStatus === "Done") { if (!isTaskDoneToday(t)) return false; }
      else if (t.status !== fStatus || isTaskDoneToday(t)) return false;
    }
    if (fFrom && (!t.due || t.due < fFrom)) return false;
    if (fTo && (!t.due || t.due > fTo)) return false;
    if (needle && ![t.desc, t.details, labsById[t.labId]?.name, t.owner, t.paramName].some((v) => String(v || "").toLowerCase().includes(needle))) return false;
    return true;
  });
  const dir = sortDir === "desc" ? -1 : 1;
  const byDue = (a, b) => (a.due && b.due ? dir * a.due.localeCompare(b.due) : a.due ? -1 : b.due ? 1 : 0);
  const grouped = GROUPS.map((g) => ({ ...g, items: filtered.filter((t) => groupOf(t) === g.key).sort(byDue) }));
  const anyFilter = fLab || fType || fStatus || fPriority || fSource || fFrom || fTo || q;
  const canEdit = (t) => isHead || t.owner === currentCSM;
  const openTask = openId ? tasks.find((t) => t.id === openId) : null;

  function clearFilters() { setFLab(""); setFType(""); setFStatus(""); setFPriority(""); setFSource(""); setFFrom(""); setFTo(""); setQ(""); }
  async function handleAdd(payload) {
    try { await apiAddTask({ ...payload, idByName }); await loadAll(true); showToast(payload.owners.length > 1 ? `Task added for all ${payload.owners.length} CSMs.` : "Task added."); }
    catch (err) { showToast(`⚠ ${err.message}`); }
  }
  async function bulkDone() {
    const list = tasks.filter((t) => selected.includes(t.id) && canEdit(t) && !isTaskDoneToday(t));
    try {
      await Promise.all(list.map((t) => (isRecurring(t) ? toggleTaskDone(t, actorId) : setTaskStatus(t, "Done", actorId))));
      setSelected([]);
      await loadAll(true);
      showToast(`${list.length} task${list.length === 1 ? "" : "s"} marked done.`);
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  // The item behind an Adoption / Expansion task, resolved from the lab's saved adoption data (for the stage dropdown).
  function itemFor(t) {
    if (!t?.paramName || !t.labId) return null;
    const lab = allLabs.find((l) => l.id === t.labId);
    const mod = modules.find((m) => m.key === t.moduleKey);
    const def = mod?.params.find((p) => p.name === t.paramName);
    if (!lab || !mod || !def) return null;
    const plan = plans.find((p) => p.id === lab.plan) || plans[0];
    const r = resolveParam(plan, mod, def, adoptionByLab[lab.id], pitchByLab[lab.id]);
    const planTrack = (r.inPlan || r.purchased) && !r.lost;
    return {
      lab, mod, r, planTrack,
      stage: planTrack
        ? { current: r.status, options: statusOptions(r, { canStepBack: isHead }) }
        : { current: r.pitch, options: pitchOptionsFor(r.purchased, r.pitch).map((v) => ({ value: v, disabled: false, note: "" })) },
    };
  }
  const openItem = itemFor(openTask);
  function askStage(to) {
    if (!openItem || to === openItem.stage.current) return;
    const { lab, mod, r } = openItem;
    setPending({
      item: openItem,
      target: { labId: lab.id, moduleKey: mod.key, paramName: r.def.name, level: "param", label: r.def.name, existingParamState: r.state, region: lab.region },
      from: openItem.stage.current, to,
    });
  }
  async function confirmStage({ comment, amount, isTrial, due }) {
    const { item, target, from, to } = pending;
    try {
      const csmId = idByName[item.lab.csm] || actorId;
      let message;
      if (item.planTrack && to !== "Lost after Purchase") {
        await setParamStatus(target.labId, item.r, to, comment, csmId, { canStepBack: isHead, due });
        message = `${target.label}: ${from} → ${to}.`;
      } else {
        const res = await applyPitchStageChange(target, { from, to, comment, amount, isTrial, csmId, labMrr: item.lab.mrr, due });
        if (res.newMrr != null) onPatchLab?.(target.labId, { mrr: res.newMrr });
        message = res.message;
      }
      setPending(null);
      showToast(message);
      await loadAll(true);
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  const distTotal = Object.values(dist).reduce((s, v) => s + v, 0);
  const agingMax = Math.max(1, ...aging.map((a) => a.count));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">Tasks</h1>
          <p className="page-sub">Everything on <b>{scopeLabel}</b>'s plate — personal to-dos, follow-ups, reminders, and Adoption / Expansion items in progress.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAddOpen(true)}>+ Add Task</button>
      </div>

      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={teamNames} labType={labType} setLabType={setLabType} />

      <div className="tk-kpis">
        <div className="tk-kpi"><span className="tk-kpi-ico" style={{ color: "var(--accent)" }}>☰</span><div><label>Total Tasks</label><b>{kpi.total}</b><Delta value={kpi.totalChange} goodWhenUp={false} /><span>All active tasks</span></div></div>
        <div className="tk-kpi"><span className="tk-kpi-ico" style={{ color: "var(--bad)" }}>⚠</span><div><label>Overdue</label><b style={{ color: kpi.overdue ? "var(--bad)" : undefined }}>{kpi.overdue}</b><span>Past due date</span></div></div>
        <div className="tk-kpi"><span className="tk-kpi-ico" style={{ color: "var(--warn)" }}>◷</span><div><label>Due Today</label><b>{kpi.dueToday}</b><span>Requires action today</span></div></div>
        <div className="tk-kpi"><span className="tk-kpi-ico" style={{ color: "var(--ok)" }}>✓</span><div><label>Completed (30 days)</label><b>{kpi.completed}</b><Delta value={kpi.completedChange} /><span>Tasks resolved</span></div></div>
        <div className="tk-kpi"><span className="tk-kpi-ico" style={{ color: "var(--accent)" }}>⏱</span><div><label>Avg. Resolution TAT</label><b>{fmtDays(kpi.avgTat)}</b><Delta value={kpi.avgTatChange} goodWhenUp={false} /><span>Created → done</span></div></div>
        <div className="tk-kpi"><span className="tk-kpi-ico" style={{ color: "var(--stg-plan-2)" }}>▮</span><div><label>On-time Completion</label><b>{kpi.onTime == null ? "—" : `${Math.round(kpi.onTime)}%`}</b><Delta value={kpi.onTimeChange} unit="pts" /><span>Completed within due date</span></div></div>
      </div>

      <div className="tk-panels">
        <div className="table-card tk-panel">
          <div className="tk-panel-title">Resolution TAT by Task Source <InfoTip>Average days from creation to Done for tasks completed in the last 30 days, by where they came from. Arrows compare with the 30 days before (down is better).</InfoTip></div>
          <div className="tk-src-cards">
            {bySource.map((s) => (
              <div key={s.key} className="tk-src-card" style={{ borderTopColor: SOURCE_COLORS[s.key] }}>
                <label>{s.key} Tasks</label>
                <b>{fmtDays(s.avgTat)}</b>
                <span>{s.completed} completed <Delta value={s.avgTatChange} goodWhenUp={false} /></span>
              </div>
            ))}
          </div>
        </div>
        <div className="table-card tk-panel">
          <div className="tk-panel-title">Task Status Distribution <InfoTip>Open tasks by status (Overdue = open and past its due date), plus tasks completed in the last 30 days.</InfoTip></div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Donut data={Object.entries(dist).map(([k, v]) => ({ label: k, value: v, color: DIST_COLORS[k] }))} total={distTotal} />
            <div className="tk-legend">
              {Object.entries(dist).map(([k, v]) => (
                <div key={k}><i style={{ background: DIST_COLORS[k] }} />{k}<b>{v}</b><span>{distTotal ? `${Math.round((v / distTotal) * 100)}%` : ""}</span></div>
              ))}
            </div>
          </div>
        </div>
        <div className="table-card tk-panel">
          <div className="tk-panel-title">Overdue Aging</div>
          {aging.map((a) => (
            <div key={a.key} className="tk-aging-row">
              <span>{a.label}</span>
              <div className="tk-aging-track"><div style={{ width: `${(a.count / agingMax) * 100}%`, background: a.min > 7 ? "var(--bad)" : "var(--warn)" }} /></div>
              <b>{a.count}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="filters tk-filters">
        <span style={{ minWidth: 170 }}><SearchSelect value={fLab} onChange={setFLab} options={labSelectOptions(labOptions)} emptyLabel="All labs" placeholder="All labs" /></span>
        <select value={fType} onChange={(e) => setFType(e.target.value)}><option value="">All types</option>{TYPE_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option value="">All status</option>{STATUS_FILTERS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select value={fPriority} onChange={(e) => setFPriority(e.target.value)}><option value="">All priority</option>{TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select>
        <select value={fSource} onChange={(e) => setFSource(e.target.value)}><option value="">All sources</option>{TASK_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <span className="tk-range" title="Due date range">Due
          <input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} aria-label="Due from" /> –
          <input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} aria-label="Due to" />
        </span>
        <input type="text" placeholder="🔍 Search tasks…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 180 }} />
        {anyFilter && <span className="clear" onClick={clearFilters}>Clear</span>}
      </div>

      {selected.length > 0 && (
        <div className="tk-bulk">
          <b>{selected.length} selected</b>
          <button className="btn btn-primary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={bulkDone}>Mark as Done</button>
          <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setSelected([])}>Clear selection</button>
        </div>
      )}

      <div className="table-card">
        <div className="table-scroll">
          <table className="child-mini tk-table">
            <thead><tr>
              <th style={{ width: 28 }}></th><th>Task</th><th>Lab</th><th>Type</th><th>Source</th><th>Priority</th>
              <th className="clickable" onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")} title="Sort by due date">Due date {sortDir === "asc" ? "↑" : "↓"}</th>
              <th title="Overdue: days late · Upcoming: days left">Days</th><th>Status</th><th>Owner</th><th>Resolution TAT</th><th title="Comments">💬</th>
            </tr></thead>
            <tbody>
              {!filtered.length && <tr><td colSpan="12" style={{ textAlign: "center", color: "var(--text-faint)", padding: 24 }}>{anyFilter ? "No tasks match these filters." : `No tasks for ${scopeLabel} yet.`}</td></tr>}
              {grouped.map((g) => {
                if (!g.items.length) return null;
                const collapsed = g.key === "done" && !doneOpen;
                const limit = shown[g.key] || PAGE;
                return [
                  <tr key={`h-${g.key}`} className={`tk-group ${g.cls}`}>
                    <td colSpan="12">
                      <span className="clickable" onClick={() => g.key === "done" && setDoneOpen(!doneOpen)}>
                        {g.key === "done" ? (doneOpen ? "▾ " : "▸ ") : "▾ "}{g.label} ({g.items.length})
                      </span>
                    </td>
                  </tr>,
                  ...(collapsed ? [] : g.items.slice(0, limit).map((t) => {
                    const lab = labsById[t.labId] || allLabs.find((l) => l.id === t.labId);
                    const label = taskStatusLabel(t);
                    const done = isTaskDoneToday(t);
                    const late = label === "Overdue" ? daysOverdue(t) : null;
                    const left = !done && !late && t.due && !isRecurring(t) ? Math.max(0, -daysOverdue(t)) : null;
                    const tat = resolutionDays(t);
                    return (
                      <tr key={t.id} className={`tk-row${done ? " done" : ""}${openId === t.id ? " active" : ""}`} onClick={() => setOpenId(t.id)}>
                        <td onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" className="task-check" checked={done || selected.includes(t.id)} disabled={done || !canEdit(t)}
                            title={done ? "Done" : canEdit(t) ? "Select" : "Only the owner or a Lead can change this task"}
                            onChange={(e) => setSelected((s) => (e.target.checked ? [...s, t.id] : s.filter((id) => id !== t.id)))} />
                        </td>
                        <td className="tk-title">{t.desc}{t.assignedBy && <span className="cat-tag cat-Indigo"> From {t.assignedBy}</span>}</td>
                        <td>{lab ? <span className="lab-name clickable" onClick={(e) => { e.stopPropagation(); onOpenLab(lab.id); }}>{lab.name}</span> : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                        <td>{taskTypeLabel(t)}</td>
                        <td>{t.source}</td>
                        <td><span className="tk-prio"><i style={{ background: PRIORITY_COLORS[t.priority] }} />{t.priority}</span></td>
                        <td style={{ whiteSpace: "nowrap" }}>{isRecurring(t) ? repeatLabel(t) : t.due ? fmtDue(t.due) : <span style={{ color: "var(--text-faint)" }}>Not set</span>}</td>
                        <td style={{ fontWeight: 700, color: late ? "var(--bad)" : "var(--text-dim)" }}>{late != null ? `${late}d` : left != null ? `${left}d` : "—"}</td>
                        <td><span className={`tk-status ${STATUS_PILL[label] || "tk-st-open"}`}>{label}</span></td>
                        <td>{t.owner}</td>
                        <td>{tat == null ? "—" : `${tat.toFixed(1)} days`}</td>
                        <td style={{ color: "var(--text-dim)" }}>💬 {commentCounts[t.id] || 0}</td>
                      </tr>
                    );
                  })),
                  ...(!collapsed && g.items.length > limit ? [
                    <tr key={`m-${g.key}`}><td colSpan="12" style={{ textAlign: "center" }}>
                      <span className="clear" onClick={() => setShown((s) => ({ ...s, [g.key]: limit + PAGE }))}>Show {Math.min(PAGE, g.items.length - limit)} more</span>
                    </td></tr>,
                  ] : []),
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tk-panels" style={{ gridTemplateColumns: team ? "1.4fr 1fr" : "1fr", marginTop: 18 }}>
        {team && (
          <div className="table-card tk-panel">
            <div className="tk-panel-title">Team TAT Summary <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>(last 30 days)</span></div>
            <div className="table-scroll"><table className="child-mini">
              <thead><tr><th>CSM</th><th>Created</th><th>Completed</th><th>Avg. TAT</th><th>Manual TAT</th><th>Adoption TAT</th><th>Expansion TAT</th><th>On-time %</th></tr></thead>
              <tbody>{team.map((r) => (
                <tr key={r.key}>
                  <td>{r.key}</td><td>{r.created}</td><td>{r.completed}</td><td>{fmtDays(r.avgTat)}</td>
                  {["Manual", "Adoption", "Expansion"].map((src) => <td key={src}>{fmtDays(r.tatBySource[src])}</td>)}
                  <td><OnTime pct={r.onTimePct} /></td>
                </tr>
              ))}</tbody>
            </table></div>
          </div>
        )}
        <div className="table-card tk-panel">
          <div className="tk-panel-title">Task Source Wise Completion <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>(last 30 days)</span></div>
          <div className="table-scroll"><table className="child-mini">
            <thead><tr><th>Source</th><th>Created</th><th>Completed</th><th>Avg. TAT</th><th>On-time %</th></tr></thead>
            <tbody>{bySource.map((s) => (
              <tr key={s.key}>
                <td><span className="tk-prio"><i style={{ background: SOURCE_COLORS[s.key] }} />{s.key}</span></td>
                <td>{s.created}</td><td>{s.completed}</td><td>{fmtDays(s.avgTat)}</td><td><OnTime pct={s.onTimePct} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      </div>

      <AddTaskModal open={addOpen} onClose={() => setAddOpen(false)} onSubmit={(p) => { handleAdd(p); setAddOpen(false); }}
        defaultAssignee={scopeCsm || currentCSM} isHead={isHead} csmNames={csmNames} labOptions={labOptions} />

      {openTask && (
        <TaskDrawer key={openTask.id} task={openTask} lab={allLabs.find((l) => l.id === openTask.labId) || null}
          currentCSM={currentCSM} isHead={isHead} csmNames={csmNames} idByName={idByName} nameById={nameById}
          onClose={() => setOpenId(null)} onChanged={() => loadAll(true)} onOpenLab={onOpenLab} showToast={showToast}
          stage={openItem?.stage} onStageChange={askStage} />
      )}
      {pending && (
        <PitchStageModal target={pending.target} fromStatus={pending.from} toStatus={pending.to} onClose={() => setPending(null)} onConfirm={confirmStage} />
      )}
    </div>
  );
}

function OnTime({ pct }) {
  if (pct == null) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  const color = pct >= 85 ? "var(--ok)" : pct >= 70 ? "var(--warn)" : "var(--bad)";
  return (
    <span className="tk-ontime"><span className="tk-ontime-track"><i style={{ width: `${pct}%`, background: color }} /></span><b style={{ color }}>{Math.round(pct)}%</b></span>
  );
}

// Ring chart for the status distribution (2px surface gaps between segments; total in the middle).
function Donut({ data, total }) {
  const R = 46, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label={`${total} tasks: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`} style={{ flex: "none" }}>
      <circle cx="60" cy="60" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="16" />
      {total > 0 && data.filter((d) => d.value).map((d) => {
        const len = (d.value / total) * C;
        const seg = <circle key={d.label} cx="60" cy="60" r={R} fill="none" stroke={d.color} strokeWidth="16"
          strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 60 60)"><title>{`${d.label}: ${d.value}`}</title></circle>;
        acc += len;
        return seg;
      })}
      <text x="60" y="56" textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--text)">{total}</text>
      <text x="60" y="74" textAnchor="middle" fontSize="10" fill="var(--text-dim)">Tasks</text>
    </svg>
  );
}

