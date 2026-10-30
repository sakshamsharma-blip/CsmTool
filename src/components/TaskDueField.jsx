import { todayISO } from "../lib/dates";

// Optional due date for the task an Adoption / Expansion item gets while it's under way (decision Oct 30 2026): it can be
// set here when the stage changes, or left empty and added later on Tasks.
export default function TaskDueField({ value, onChange, style }) {
  return (
    <div className="tmpl-field" style={{ marginTop: 12 }}>
      <label>Task due date <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>(optional)</span></label>
      <input type="date" min={todayISO()} style={style} value={value} onChange={(e) => onChange(e.target.value)} />
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 3 }}>This item is a task on Tasks while it's under way. Leave empty to add a due date later.</div>
    </div>
  );
}
