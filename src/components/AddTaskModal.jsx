import { useState } from "react";
import Modal from "./Modal";
import { todayISO, TASK_PRIORITIES } from "../lib/tasks";
import SearchSelect from "./SearchSelect";
import { labSelectOptions } from "../lib/selectOptions";

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Add Task (Tasks page, and Tasks for Today on Dashboard / My Portfolio). Laid out in three groups: what the task is,
// who and where, and when (date + optional time, Nov 23 2026).
export default function AddTaskModal({ open, onClose, onSubmit, defaultAssignee, isHead, csmNames, labOptions }) {
  const [desc, setDesc] = useState("");
  const [assignee, setAssignee] = useState(defaultAssignee);
  const [labId, setLabId] = useState("");
  const [repeat, setRepeat] = useState("none");
  const [repeatDay, setRepeatDay] = useState(new Date().getDay());
  const [repeatIntervalDays, setRepeatIntervalDays] = useState(7);
  const [due, setDue] = useState(todayISO());
  const [dueTime, setDueTime] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [details, setDetails] = useState("");
  const [error, setError] = useState(false);

  if (!open) return null;

  function reset() {
    setDesc(""); setAssignee(defaultAssignee); setLabId(""); setRepeat("none");
    setRepeatDay(new Date().getDay()); setRepeatIntervalDays(7); setDue(todayISO()); setDueTime(""); setPriority("Medium"); setDetails(""); setError(false);
  }
  function handleClose() { reset(); onClose(); }

  function handleSubmit() {
    if (!desc.trim()) { setError(true); return; }
    const owners = assignee === "__all__" ? csmNames.slice() : [assignee];
    let payload = { labId: labId || null, desc: desc.trim(), owners, repeat, assignedByName: isHead ? defaultAssignee : null, priority, details };
    if (repeat === "weekly" || repeat === "fortnightly") payload = { ...payload, repeatDay, repeatAnchor: repeat === "fortnightly" ? todayISO() : null };
    else if (repeat === "monthly") payload = { ...payload, repeatDay: parseInt(repeatDay, 10) };
    else if (repeat === "custom") payload = { ...payload, repeatIntervalDays: Math.max(1, parseInt(repeatIntervalDays, 10) || 1), due };
    else payload = { ...payload, due: due || null, dueTime: due && dueTime ? dueTime : null }; // a one-off task may have no due date yet
    onSubmit(payload);
    reset();
  }

  const oneOff = repeat === "none";
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
      <div className="atm">
        <section className="atm-sec">
          <div className="field">
            <label>Task <span className="req">*</span></label>
            <input type="text" value={desc} onChange={(e) => { setDesc(e.target.value); setError(false); }} placeholder="e.g. Weekly portfolio review" autoFocus />
          </div>
          <div className="field">
            <label>Description <span className="atm-opt">optional</span></label>
            <textarea rows="2" value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Any detail the owner needs" style={{ resize: "vertical" }} />
          </div>
        </section>

        <section className="atm-sec">
          <div className="atm-head">Who and where</div>
          <div className="atm-grid">
            <div className="field">
              <label>Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            {isHead ? (
              <div className="field">
                <label>Assign To</label>
                <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                  <option value={defaultAssignee}>{defaultAssignee}</option>
                  {csmNames.filter((n) => n !== defaultAssignee).map((n) => <option key={n} value={n}>{n}</option>)}
                  <option value="__all__">All CSMs (one personal copy each)</option>
                </select>
              </div>
            ) : <div />}
            <div className="field atm-span">
              <label>Lab <span className="atm-opt">optional</span></label>
              <SearchSelect value={labId} onChange={setLabId} options={labSelectOptions(labOptions)} emptyLabel="Not tied to a lab" placeholder="Search a lab…"
                inputStyle={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, color: "var(--text)", background: "var(--surface)", fontFamily: "inherit" }} />
            </div>
          </div>
        </section>

        <section className="atm-sec">
          <div className="atm-head">When</div>
          <div className="atm-grid">
            <div className="field">
              <label>Repeat</label>
              <select value={repeat} onChange={(e) => setRepeat(e.target.value)}>
                <option value="none">Doesn't repeat</option>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="fortnightly">Every 2 weeks</option>
                <option value="monthly">Every month</option>
                <option value="custom">Custom — every N days</option>
              </select>
            </div>
            {(repeat === "weekly" || repeat === "fortnightly") && (
              <div className="field">
                <label>Day of week</label>
                <select value={repeatDay} onChange={(e) => setRepeatDay(parseInt(e.target.value, 10))}>
                  {DOW.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </div>
            )}
            {repeat === "monthly" && (
              <div className="field">
                <label>Day of month</label>
                <input type="number" min="1" max="28" value={repeatDay} onChange={(e) => setRepeatDay(e.target.value)} />
              </div>
            )}
            {repeat === "custom" && (
              <div className="field">
                <label>Repeat every N days</label>
                <input type="number" min="1" value={repeatIntervalDays} onChange={(e) => setRepeatIntervalDays(e.target.value)} />
              </div>
            )}
            {repeat === "daily" && <div />}
            {(oneOff || repeat === "custom") && (
              <div className="field">
                <label>{repeat === "custom" ? "Starting from" : <>Due date <span className="atm-opt">optional</span></>}</label>
                <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </div>
            )}
            {oneOff && (
              <div className="field">
                <label>Due time <span className="atm-opt">optional</span></label>
                <input type="time" value={dueTime} disabled={!due} onChange={(e) => setDueTime(e.target.value)} />
              </div>
            )}
          </div>
          {oneOff && <div className="atm-hint">Clear the date to add one later. Without a time, it's due any time that day.</div>}
        </section>
        {error && <div style={{ color: "var(--bad)", fontSize: 12 }}>Give the task a name first.</div>}
      </div>
    </Modal>
  );
}
