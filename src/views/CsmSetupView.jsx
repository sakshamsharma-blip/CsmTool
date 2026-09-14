import { useState } from "react";
import CsmFormModal from "../components/CsmFormModal";

export default function CsmSetupView({ csmDirectory, idByName, onSaveCsm }) {
  const [modalState, setModalState] = useState(null); // null | {} (add) | {id,name,role} (edit)

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1 className="page-title">CSM Setup</h1>
          <p className="page-sub">Your team roster — who's a CSM Lead vs. a CSM.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModalState({})}>+ Add Team Member</button>
      </div>

      <table className="activity-table">
        <thead><tr><th>Name</th><th>Role</th><th></th></tr></thead>
        <tbody>
          {csmDirectory.length === 0 && (
            <tr><td colSpan="3" style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No team members yet.</td></tr>
          )}
          {csmDirectory.map((c) => (
            <tr key={c.name}>
              <td>{c.name}</td>
              <td><span className={`pill ${c.role === "Lead" ? "pill-parent" : "pill-child"}`}>{c.role === "Lead" ? "CSM Lead" : "CSM"}</span></td>
              <td style={{ textAlign: "right" }}>
                <span style={{ color: "var(--accent)", fontSize: "12.5px", cursor: "pointer" }} onClick={() => setModalState({ ...c, id: idByName[c.name] })}>Edit</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {modalState !== null && (
        <CsmFormModal
          open
          editing={modalState.name ? modalState : null}
          onClose={() => setModalState(null)}
          onSave={async (payload) => { await onSaveCsm(payload); setModalState(null); }}
        />
      )}
    </div>
  );
}
