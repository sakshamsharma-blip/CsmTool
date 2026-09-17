import { Fragment, useState } from "react";
import AddTaskModal from "./AddTaskModal";
import {
  TASK_SECTIONS, isTaskDoneToday, taskDisplayBucket, repeatLabel, taskTypeLabel, getTasksForPanel,
} from "../lib/tasks";

// "Tasks for Today" — shared by Dashboard and My Portfolio. scopeCsm=null means "everyone in this
// scope" (a Lead's Team View with no CSM filter); otherwise only that CSM's tasks show.
export default function TasksPanel({ tasks, scopeCsm, onToggleDone, onAddTask, onOpenLab, isHead, currentCSM, csmNames, labOptions, labsById }) {
  const [modalOpen, setModalOpen] = useState(false);
  const display = getTasksForPanel(tasks, scopeCsm);

  const addBtn = (
    <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 10px" }} onClick={() => setModalOpen(true)}>+ Add Task</button>
  );

  return (
    <>
      {!display.length ? (
        <div className="table-card" style={{ padding: "18px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, color: "var(--text-faint)", fontSize: 12.5 }}>
          <span>No tasks{scopeCsm ? ` for ${scopeCsm}` : ""} right now — everything's caught up.</span>
          {addBtn}
        </div>
      ) : (
        <div className="table-card">
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 12px 0" }}>{addBtn}</div>
          <div className="table-scroll">
            <table className="child-mini">
              <thead><tr><th></th><th>Task</th><th>Lab</th><th>Type</th><th>Owner</th><th>Due</th></tr></thead>
              <tbody>
                {TASK_SECTIONS.map(({ key, label }) => {
                  const items = display.filter((t) => taskDisplayBucket(t) === key);
                  if (!items.length) return null;
                  items.sort((a, b) => (a.due || "").localeCompare(b.due || ""));
                  return (
                    <Fragment key={key}>
                      <tr className="task-section-row"><td colSpan="6">{label} <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>({items.length})</span></td></tr>
                      {items.map((t) => {
                        const doneToday = isTaskDoneToday(t);
                        const bucket = taskDisplayBucket(t);
                        const dueLabel = t.repeat && t.repeat !== "none"
                          ? repeatLabel(t)
                          : (t.due ? new Date(t.due + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "No due date");
                        const dueColor = doneToday ? "var(--text-faint)" : bucket === "overdue" ? "var(--bad)" : bucket === "today" ? "var(--warn)" : "var(--text-dim)";
                        return (
                          <tr key={t.id} style={doneToday ? { opacity: 0.6 } : undefined}>
                            <td><input className="task-check" type="checkbox" checked={doneToday} onChange={() => onToggleDone(t)} title="Mark done" /></td>
                            <td style={doneToday ? { textDecoration: "line-through" } : undefined}>
                              {t.desc}
                              {t.auto && <span className="cat-tag cat-Warn"> System</span>}
                              {t.assignedBy && <span className="cat-tag cat-Indigo"> From {t.assignedBy}</span>}
                            </td>
                            <td>{t.labId ? <span className="lab-name clickable" onClick={() => onOpenLab(t.labId)}>{labsById?.[t.labId]?.name || t.labId}</span> : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
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
