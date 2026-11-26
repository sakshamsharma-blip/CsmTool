import { Fragment, useEffect, useState } from "react";
import { useSessionState } from "../lib/useSessionState";
import AddTaskModal from "./AddTaskModal";
import TaskDrawer from "./TaskDrawer";
import SearchSelect from "./SearchSelect";
import { labSelectOptions } from "../lib/selectOptions";
import ClearFilters from "./ClearFilters";
import {
  TASK_SECTIONS, isTaskDoneToday, taskDisplayBucket, repeatLabel, taskTypeLabel, getTasksForPanel, fmtTime,
} from "../lib/tasks";

// "Tasks for Today" — shared by Dashboard and My Portfolio. scopeCsm=null means "everyone in this
// scope" (a Lead's Team View with no CSM filter); otherwise only that CSM's tasks show.
// `persistKey` names where this panel sits (dashboard / portfolio / tasks) so its lab filter is remembered across a
// refresh per screen. `sortByDue` ("asc" | "desc") swaps the Overdue/Today/… sections for one flat list ordered by due date (tasks with
// no due date last). Like the Tasks page (Nov 23 2026), long titles and lab names are cut with … and clicking a row opens
// the task panel with everything about it; `onTasksChanged` reloads the list after a change there.
export default function TasksPanel({ tasks, scopeCsm, onToggleDone, onAddTask, onOpenLab, isHead, currentCSM, csmNames, labOptions, labsById, sortByDue, persistKey, idByName, showToast, onTasksChanged }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  // Re-check every minute, so a task turns Overdue at its due time without a reload.
  const [, setMinute] = useState(0);
  useEffect(() => { const id = setInterval(() => setMinute((m) => m + 1), 60000); return () => clearInterval(id); }, []);
  const openTask = openId ? tasks.find((t) => t.id === openId) : null;
  const nameById = Object.fromEntries(Object.entries(idByName || {}).map(([n, id]) => [id, n]));
  const [fLab, setFLab] = useSessionState(`tasksPanel.${persistKey || "default"}.fLab`, ""); // lab-wise filter
  const display = getTasksForPanel(tasks, scopeCsm).filter((t) => !fLab || t.labId === fLab);

  const addBtn = (
    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ minWidth: 200 }}>
        <SearchSelect value={fLab} onChange={setFLab} options={labSelectOptions(labOptions || [])} emptyLabel="All labs" placeholder="All labs"
          inputStyle={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 9px", fontSize: 11.5, fontFamily: "inherit", background: "var(--surface)", color: "var(--text)" }} />
      </span>
      {fLab && <ClearFilters active onClear={() => setFLab("")} label="Clear" />}
      <button className="btn btn-primary" style={{ fontSize: 11, padding: "5px 10px" }} onClick={() => setModalOpen(true)}>+ Add Task</button>
    </span>
  );

  return (
    <>
      {!display.length ? (
        <div className="table-card" style={{ padding: "18px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, color: "var(--text-faint)", fontSize: 12.5 }}>
          <span>{fLab ? "No tasks for this lab right now." : `No tasks${scopeCsm ? ` for ${scopeCsm}` : ""} right now — everything's caught up.`}</span>
          {addBtn}
        </div>
      ) : (
        <div className="table-card">
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 12px 0" }}>{addBtn}</div>
          <div className="table-scroll">
            <table className="child-mini">
              <thead><tr><th></th><th>Task</th><th>Lab</th><th>Type</th><th>Owner</th><th>Due</th></tr></thead>
              <tbody>
                {(sortByDue ? [{ key: "__flat", label: sortByDue === "asc" ? "By due date — earliest first" : "By due date — latest first" }] : TASK_SECTIONS).map(({ key, label }) => {
                  const items = sortByDue ? [...display] : display.filter((t) => taskDisplayBucket(t) === key);
                  if (!items.length) return null;
                  const dir = sortByDue === "desc" ? -1 : 1;
                  items.sort((a, b) => (a.due && b.due ? dir * a.due.localeCompare(b.due) : a.due ? -1 : b.due ? 1 : 0));
                  return (
                    <Fragment key={key}>
                      <tr className="task-section-row"><td colSpan="6">{label} <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>({items.length})</span></td></tr>
                      {items.map((t) => {
                        const doneToday = isTaskDoneToday(t);
                        const bucket = taskDisplayBucket(t);
                        const dueLabel = t.repeat && t.repeat !== "none"
                          ? repeatLabel(t)
                          : (t.due ? `${new Date(t.due + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}${t.dueTime ? `, ${fmtTime(t.dueTime)}` : ""}` : "No due date");
                        const dueColor = doneToday ? "var(--text-faint)" : bucket === "overdue" ? "var(--bad)" : bucket === "today" ? "var(--warn)" : "var(--text-dim)";
                        return (
                          <tr key={t.id} className={`tk-row${openId === t.id ? " active" : ""}`} style={doneToday ? { opacity: 0.6 } : undefined} onClick={() => setOpenId(t.id)} title="Open the task">
                            <td onClick={(e) => e.stopPropagation()}><input className="task-check" type="checkbox" checked={doneToday} onChange={() => onToggleDone(t)} title="Mark done" /></td>
                            <td className="tp-title" title={t.desc} style={doneToday ? { textDecoration: "line-through" } : undefined}>
                              <span className="tk-clip">{t.desc}</span>
                              {t.auto && <span className="cat-tag cat-Warn"> System</span>}
                              {t.assignedBy && <span className="cat-tag cat-Indigo"> From {t.assignedBy}</span>}
                            </td>
                            <td className="tk-lab" title={labsById?.[t.labId]?.name}>{t.labId ? <span className="lab-name clickable" onClick={(e) => { e.stopPropagation(); onOpenLab(t.labId); }}>{labsById?.[t.labId]?.name || t.labId}</span> : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                            <td>{taskTypeLabel(t)}</td>
                            <td>{t.owner}</td>
                            <td style={{ color: dueColor, fontWeight: 700, whiteSpace: "nowrap" }}>{bucket === "overdue" && !doneToday ? "Overdue · " : ""}{dueLabel}</td>
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
      )}
      {openTask && idByName && (
        <TaskDrawer key={openTask.id} task={openTask} lab={labsById?.[openTask.labId] || null}
          currentCSM={currentCSM} isHead={isHead} csmNames={csmNames} idByName={idByName} nameById={nameById}
          onClose={() => setOpenId(null)} onChanged={() => onTasksChanged?.()} onOpenLab={onOpenLab} showToast={showToast} />
      )}
      <AddTaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={(payload) => { onAddTask(payload); setModalOpen(false); }}
        defaultAssignee={scopeCsm || currentCSM}
        isHead={isHead}
        csmNames={csmNames}
        labOptions={labOptions}
      />
    </>
  );
}
