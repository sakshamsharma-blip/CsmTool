import { useState } from "react";
import Modal from "./Modal";

export default function CsmFormModal({ open, editing, onClose, onSave }) {
  const [name, setName] = useState(editing?.name || "");
  const [role, setRole] = useState(editing?.role || "CSM");
  const [error, setError] = useState("");

  if (!open) return null;

  async function handleSave() {
    if (!name.trim()) { setError("Name is required."); return; }
    try {
      await onSave({ id: editing?.id, name: name.trim(), role });
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
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="CSM">CSM</option>
          <option value="Lead">CSM Lead</option>
          <option value="Admin">Admin</option>
        </select>
      </div>
      {error && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}
