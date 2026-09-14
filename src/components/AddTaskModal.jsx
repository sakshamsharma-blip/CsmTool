import { useState } from "react";
import Modal from "./Modal";
import { todayISO } from "../lib/tasks";

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function AddTaskModal({ open, onClose, onSubmit, defaultAssignee, isHead, csmNames, labOptions }) {
  const [desc, setDesc] = useState("");
  const [assignee, setAssignee] = useState(defaultAssignee);
  const [labId, setLabId] = useState("");
  const [repeat, setRepeat] = useState("none");
  const [repeatDay, setRepeatDay] = useState(new Date().getDay());
  const [repeatIntervalDays, setRepeatIntervalDays] = useState(7);
  const [due, setDue] = useState(todayISO());
  const [error, setError] = useState(false);

  if (!open) return null;

  function reset() {
    setDesc(""); setAssignee(defaultAssignee); setLabId(""); setRepeat("none");
    setRepeatDay(new Date().getDay()); setRepeatIntervalDays(7); setDue(todayISO()); setError(false);
  }
  function handleClose() { reset(); onClose(); }

  function handleSubmit() {
    if (!desc.trim()) { setError(true); return; }
    const owners = assignee === "__all__" ? csmNames.slice() : [assignee];
    let payload = { labId: labId || null, desc: desc.trim(), owners, repeat, assignedByName: isHead ? defaultAssignee : null };
    if (repeat === "weekly" || repeat === "fortnightly") payload = { ...payload, repeatDay, repeatAnchor: repeat === "fortnightly" ? todayISO() : null };
    else if (repeat === "monthly") payload = { ...payload, repeatDay: parseInt(repeatDay, 10) };
    else if (repeat === "custom") payload = { ...payload, repeatIntervalDays: Math.max(1, parseInt(repeatIntervalDays, 10) || 1), due };
    else payload = { ...payload, due };
    onSubmit(payload);
    reset();
  }

  const fieldStyle = { width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, color: "var(--text)", background: "#fff", fontFamily: "inherit" };

  return (
    <Modal
      open={open}
      title="Add Task"
      onClose={handleClose}
      actions={[
        { label: "Cancel", className: "btn-ghost", onClick: handleClose },
        { label: "Add Task", className: "btn-primary", onClick: handleSubmit },
      ]}
    >
      <div className="tmpl-field" style={{ marginBottom: 12 }}>
        <label>Task</label>
        <input type="text" style={fieldStyle} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Weekly portfolio review" />
      </div>
      {isHead && (
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Assign To</label>
          <select style={fieldStyle} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value={defaultAssignee}>{defaultAssignee}</option>
            {csmNames.filter((n) => n !== defaultAssignee).map((n) => <option key={n} value={n}>{n}</option>)}
            <option value="__all__">All CSMs (one personal copy each)</option>
          </select>
        </div>
      )}
      <div className="tmpl-field-row" style={{ marginBottom: 12, display: "flex", gap: 10 }}>
        <div className="tmpl-field" style={{ flex: 1 }}>
          <label>Lab (optional)</label>
          <select style={fieldStyle} value={labId} onChange={(e) => setLabId(e.target.value)}>
            <option value="">Not tied to a lab</option>
            {labOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="tmpl-field" style={{ flex: 1 }}>
          <label>Repeat</label>
          <select style={fieldStyle} value={repeat} onChange={(e) => setRepeat(e.target.value)}>
            <option value="none">Doesn't repeat</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="fortnightly">Every 2 weeks</option>
            <option value="monthly">Every month</option>
            <option value="custom">Custom — every N days</option>
          </select>
        </div>
      </div>
      {(repeat === "weekly" || repeat === "fortnightly") && (
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Day of week</label>
          <select style={fieldStyle} value={repeatDay} onChange={(e) => setRepeatDay(parseInt(e.target.value, 10))}>
            {DOW.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </div>
      )}
      {repeat === "monthly" && (
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Day of month</label>
          <input type="number" min="1" max="28" style={fieldStyle} value={repeatDay} onChange={(e) => setRepeatDay(e.target.value)} />
        </div>
      )}
      {repeat === "custom" && (
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Repeat every N days</label>
          <input type="number" min="1" style={fieldStyle} value={repeatIntervalDays} onChange={(e) => setRepeatIntervalDays(e.target.value)} />
        </div>
      )}
      {(repeat === "none" || repeat === "custom") && (
        <div className="tmpl-field" style={{ marginTop: 0 }}>
          <label>{repeat === "custom" ? "Starting From" : "Due Date"}</label>
          <input type="date" style={fieldStyle} value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
      )}
      {error && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>Give the task a description first.</div>}
    </Modal>
  );
}
