import { useState } from "react";
import Modal from "./Modal";

export default function CsmFormModal({ open, editing, onClose, onSave }) {
  const [name, setName] = useState(editing?.name || "");
  // Admin isn't a selectable role here — there's exactly one Admin account, created directly
  // in the database, and this form can't create or hand out another one.
  const isEditingAdmin = editing?.role === "Admin";
  const [role, setRole] = useState(isEditingAdmin ? "Admin" : editing?.role || "CSM");
  const [active, setActive] = useState(editing?.active !== false);
  const [error, setError] = useState("");

  if (!open) return null;

  async function handleSave() {
    if (!name.trim()) { setError("Name is required."); return; }
    try {
      await onSave({ id: editing?.id, name: name.trim(), role, active });
    } catch (err) {
      setError(err.message || "Couldn't save — check console.");
    }
  }

  return (
    <Modal
      open={open}
      title={editing ? "Edit Team Member" : "Add Team Member"}
      onClose={onClose}
      actions={[
        { label: "Cancel", className: "btn-ghost", onClick: onClose },
        { label: editing ? "Save Changes" : "Add", className: "btn-primary", onClick: handleSave },
      ]}
    >
      <div className="tmpl-field" style={{ marginBottom: 12 }}>
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya Nair" />
      </div>
      <div className="tmpl-field">
        <label>Role</label>
        {isEditingAdmin ? (
          <>
            <input value="Admin" disabled style={{ color: "var(--text-dim)", background: "var(--bg)" }} />
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 5 }}>
              The Admin role isn't changeable here.
            </div>
          </>
        ) : (
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="CSM">CSM</option>
            <option value="Lead">CSM Lead</option>
          </select>
        )}
      </div>
      {editing && !isEditingAdmin && (
        <div className="tmpl-field" style={{ marginTop: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, cursor: "pointer" }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
          </label>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 5 }}>
            Turn off if this person has left the team — they'll stop showing up as an option when assigning or reassigning a lab, but their history and past assignments stay intact.
          </div>
        </div>
      )}
      {error && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}
