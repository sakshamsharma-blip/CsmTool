import { useEffect, useRef, useState } from "react";
import {
  TASK_STATUSES, TASK_PRIORITIES, PRIORITY_COLORS, isRecurring, isTaskDoneToday, taskStatusLabel, taskTypeLabel, repeatLabel,
  resolutionDays, setTaskStatus, toggleTaskDone, updateTaskFields, deleteTask, fetchTaskUpdates, addTaskComment, deleteTaskUpdate,
} from "../lib/tasks";

const field = { width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 9px", fontSize: 12.5, fontFamily: "inherit", background: "var(--surface)", color: "var(--text)" };
const fmtDate = (iso) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
const fmtTime = (iso) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

// Task side panel on the Tasks page (layout from the reference design, Oct 30 2026): every detail of one task, editable by
// its owner or a CSM Lead / Admin (anyone who can see it can comment); Comments & Updates, Activity History, Related
// Items and a timeline. `stage` (Adoption / Expansion tasks only) = { current, options: [{ value, disabled, note }] }
// for changing the item's own stage right here — `onStageChange(to)` opens the usual confirm dialog.
export default function TaskDrawer({ task, lab, currentCSM, isHead, csmNames, idByName, nameById, onClose, onChanged, onOpenLab, showToast, stage, onStageChange }) {
  const [updates, setUpdates] = useState([]);
  const [tab, setTab] = useState("comments");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(task.desc);
  const [details, setDetails] = useState(task.details || "");
  const dueRef = useRef(null);
  const [openedAt] = useState(() => Date.now()); // "Days Elapsed" is counted from when the panel was opened
  const actorId = idByName[currentCSM];
  const canEdit = isHead || task.owner === currentCSM;
  const recurring = isRecurring(task);
  const statusLabel = taskStatusLabel(task);

  async function loadUpdates() {
    try { setUpdates(await fetchTaskUpdates(task.id)); } catch (err) { console.error(err); }
  }
  useEffect(() => {
    let cancelled = false;
    fetchTaskUpdates(task.id).then((u) => { if (!cancelled) setUpdates(u); }).catch((err) => console.error(err));
    return () => { cancelled = true; };
  }, [task.id]);

  async function run(fn, message) {
    setBusy(true);
    try { await fn(); await onChanged(); await loadUpdates(); if (message) showToast(message); }
    catch (err) { showToast(`⚠ ${err.message}`); }
    finally { setBusy(false); }
  }
  const change = (changes, extra) => run(() => updateTaskFields(task, changes, actorId, extra));

  const comments = updates.filter((u) => u.kind === "comment").slice().reverse();
  const events = updates.filter((u) => u.kind === "event").slice().reverse();
  const hasCreatedEvent = updates.some((u) => u.kind === "event" && u.body.startsWith("Task created"));
  const timeline = [
    ...(hasCreatedEvent ? [] : [{ id: "created", kind: "event", body: "Task created", createdAt: task.createdAt, authorId: null }]),
    ...updates,
  ];
  const elapsed = Math.max(0, Math.floor((openedAt - new Date(task.createdAt).getTime()) / 86400000));
  const tat = resolutionDays(task);
  const pillClass = { Overdue: "tk-st-overdue", "Due Today": "tk-st-today", Done: "tk-st-done", "On Hold": "tk-st-hold", "In Progress": "tk-st-progress" }[statusLabel] || "tk-st-open";

  return (
    <>
      <div className="drawer-backdrop show" onClick={onClose} />
      <div className="drawer show tk-drawer" role="dialog" aria-label={`Task: ${task.desc}`}>
        <div className="drawer-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            {editingTitle && canEdit ? (
              <div style={{ display: "flex", gap: 6 }}>
                <input style={{ ...field, fontSize: 15, fontWeight: 700 }} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
                <button className="btn btn-primary" style={{ padding: "5px 10px", fontSize: 12 }} disabled={busy || !title.trim()}
                  onClick={async () => { await change({ desc: title }); setEditingTitle(false); }}>Save</button>
              </div>
            ) : (
              <h2 style={{ fontSize: 17 }}>
                {task.desc}
                {canEdit && <button type="button" className="tk-icon-btn" title="Edit title" onClick={() => { setTitle(task.desc); setEditingTitle(true); }}>✎</button>}
              </h2>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
              {lab ? <span className="lab-name clickable" onClick={() => onOpenLab(lab.id)}>{lab.name}</span> : <span style={{ color: "var(--text-faint)", fontSize: 12.5 }}>Not tied to a lab</span>}
              <span className={`tk-status ${pillClass}`}>{statusLabel}</span>
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="drawer-body">
          <div className="tk-fields">
            <div><label>Task Type</label><span className="tk-chip">{taskTypeLabel(task)}</span></div>
            <div><label>Source</label><span className="tk-chip">{task.source}</span></div>
            <div><label>Priority</label>
              {canEdit ? (
                <select style={field} value={task.priority} disabled={busy} onChange={(e) => change({ priority: e.target.value })}>
                  {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              ) : <span className="tk-prio"><i style={{ background: PRIORITY_COLORS[task.priority] }} />{task.priority}</span>}
            </div>
            <div><label>Assigned To</label>
              {canEdit ? (
                <select style={field} value={task.owner} disabled={busy}
                  onChange={(e) => change({ ownerId: idByName[e.target.value] }, { ownerName: e.target.value })}>
                  {!csmNames.includes(task.owner) && <option value={task.owner}>{task.owner || "—"}</option>}
                  {csmNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              ) : <b style={{ fontSize: 13 }}>{task.owner || "—"}</b>}
            </div>
            <div><label>Status</label>
              {recurring ? <span className="tk-chip">{repeatLabel(task)} · {isTaskDoneToday(task) ? "done today" : "open today"}</span>
                : canEdit ? (
                  <select style={field} value={task.status} disabled={busy} onChange={(e) => run(() => setTaskStatus(task, e.target.value, actorId), `Status: ${e.target.value}.`)}>
                    {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : <b style={{ fontSize: 13 }}>{task.status}</b>}
            </div>
            <div><label>Due Date</label>
              {canEdit && !recurring ? (
                <div style={{ display: "flex", gap: 4 }}>
                  <input ref={dueRef} type="date" style={field} value={task.due || ""} disabled={busy} onChange={(e) => change({ due: e.target.value || null })} />
                  {task.due && <button type="button" className="tk-icon-btn" title="Remove due date" onClick={() => change({ due: null })}>✕</button>}
                </div>
              ) : <b style={{ fontSize: 13 }}>{recurring ? repeatLabel(task) : task.due ? fmtDate(task.due) : "No due date"}</b>}
            </div>
          </div>

          <div className="tmpl-field" style={{ marginTop: 14 }}>
            <label>Description</label>
            {canEdit ? (
              <>
                <textarea rows="3" style={{ ...field, resize: "vertical" }} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Add details for this task…" />
                {details !== (task.details || "") && (
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button className="btn btn-primary" style={{ padding: "5px 12px", fontSize: 12 }} disabled={busy} onClick={() => change({ details })}>Save description</button>
                    <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setDetails(task.details || "")}>Cancel</button>
                  </div>
                )}
              </>
            ) : <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{task.details || <span style={{ color: "var(--text-faint)" }}>No description.</span>}</div>}
          </div>

          <div className="tk-stats">
            <div><label>Created On</label><b>{fmtDate(task.createdAt)}</b><span>{new Date(task.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span></div>
            <div><label>Due Date</label><b>{recurring ? repeatLabel(task) : task.due ? fmtDate(task.due) : "Not set"}</b></div>
            <div><label>Days Elapsed</label><b style={{ color: statusLabel === "Overdue" ? "var(--bad)" : undefined }}>{elapsed} day{elapsed === 1 ? "" : "s"}</b></div>
            <div><label>Resolution TAT</label><b>{tat == null ? "—" : `${tat.toFixed(1)} days`}</b><span>{tat == null ? (task.status === "Done" ? "Not recorded" : "Pending") : ""}</span></div>
          </div>

          <div className="tk-tabs">
            {[["comments", `Comments & Updates (${comments.length})`], ["activity", "Activity History"], ["related", "Related Items"]].map(([k, l]) => (
              <button key={k} type="button" className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>

          {tab === "comments" && (
            <div>
              <div style={{ display: "flex", gap: 8, margin: "10px 0 12px" }}>
                <input style={field} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment or update…"
                  onKeyDown={(e) => { if (e.key === "Enter" && comment.trim()) run(async () => { await addTaskComment(task.id, comment, actorId); setComment(""); }); }} />
                <button className="btn btn-primary" disabled={busy || !comment.trim()}
                  onClick={() => run(async () => { await addTaskComment(task.id, comment, actorId); setComment(""); })}>Post</button>
              </div>
              {!comments.length ? <div className="tk-empty">No comments yet.</div> : comments.map((c) => (
                <div key={c.id} className="tk-comment">
                  <span className="tk-avatar">{(nameById[c.authorId] || "?").charAt(0)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tk-comment-head"><b>{nameById[c.authorId] || "—"}</b> · {fmtTime(c.createdAt)}
                      {(isHead || c.authorId === actorId) && <button type="button" className="tk-icon-btn" title="Delete comment" onClick={() => { if (window.confirm("Delete this comment?")) run(() => deleteTaskUpdate(c.id)); }}>🗑</button>}
                    </div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{c.body}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === "activity" && (
            <div style={{ marginTop: 10 }}>
              {!events.length ? <div className="tk-empty">No changes recorded yet.</div> : events.map((e) => (
                <div key={e.id} className="tk-activity"><b>{e.body}</b><span>{nameById[e.authorId] || "System"} · {fmtTime(e.createdAt)}</span></div>
              ))}
            </div>
          )}
          {tab === "related" && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {lab && (
                <div className="tk-related"><span>Lab</span><span className="lab-name clickable" onClick={() => onOpenLab(lab.id)}>{lab.name}</span></div>
              )}
              {task.paramName && (
                <div className="tk-related">
                  <span>{task.source} item</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                    <span><b>{task.paramName}</b> <span className="lab-name clickable" style={{ marginLeft: 6 }} onClick={() => onOpenLab(task.labId, "adoption")}>Open Adoption tab</span></span>
                    {stage && (
                      <label style={{ fontSize: 12, color: "var(--text-dim)" }}>Stage{" "}
                        <select className="status-select" value={stage.current} onChange={(e) => onStageChange(e.target.value)}>
                          {stage.options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.value}{o.note ? ` — ${o.note}` : ""}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                </div>
              )}
              {task.sourceVisitId && lab && (
                <div className="tk-related"><span>Created from</span><span className="lab-name clickable" onClick={() => onOpenLab(lab.id, "history")}>a check-in / visit (Lab History)</span></div>
              )}
              {!lab && !task.paramName && <div className="tk-empty">Nothing linked to this task.</div>}
            </div>
          )}

          <h4 style={{ fontSize: 13, margin: "20px 0 8px" }}>Task Timeline</h4>
          <div className="tk-timeline">
            {timeline.map((u) => (
              <div key={u.id} className="tk-tl-item">
                <b>{u.kind === "comment" ? "Comment added" : u.body}</b>
                <span>{fmtTime(u.createdAt)}{u.authorId ? ` by ${nameById[u.authorId] || "—"}` : ""}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="drawer-foot">
          {canEdit && (
            <button className="btn btn-ghost" style={{ marginRight: "auto", color: "var(--bad)" }} disabled={busy}
              onClick={() => { if (window.confirm(`Delete the task "${task.desc}"?`)) run(async () => { await deleteTask(task.id); onClose(); }, "Task deleted."); }}>Delete</button>
          )}
          {canEdit && !recurring && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => { dueRef.current?.focus(); dueRef.current?.showPicker?.(); }}>{task.due ? "Change Due Date" : "Add Due Date"}</button>
          )}
          {canEdit && (
            <button className="btn btn-primary" disabled={busy}
              onClick={() => run(() => toggleTaskDone(task, actorId), recurring ? "Updated for today." : task.status === "Done" ? "Task reopened." : "Task done.")}>
              {recurring ? (isTaskDoneToday(task) ? "Undo today" : "Done for today") : task.status === "Done" ? "Reopen" : "Mark as Done"}
            </button>
          )}
          {!canEdit && <span style={{ fontSize: 12, color: "var(--text-faint)" }}>Only {task.owner || "the owner"} or a CSM Lead / Admin can change this task — you can comment.</span>}
        </div>
      </div>
    </>
  );
}

