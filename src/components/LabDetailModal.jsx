import { useState } from "react";
import Modal from "./Modal";
import { fmtINR, segmentFor } from "../lib/format";

export default function LabDetailModal({ lab, onClose, csmNames, plans, onReassignCsm, onChangePlan }) {
  const [newCsm, setNewCsm] = useState(lab?.csm || "");
  const [newPlan, setNewPlan] = useState(lab?.plan || "");
  if (!lab) return null;
  const seg = segmentFor(lab.mrr || 0);
  const planName = plans.find((p) => p.id === lab.plan)?.name || lab.plan;

  return (
    <Modal
      open={!!lab}
      title={lab.name}
      onClose={onClose}
      actions={[{ label: "Done", className: "btn-primary", onClick: onClose }]}
    >
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 14 }}>
        Lab ID {lab.id} · {lab.type} · {lab.city ? lab.city + ", " : ""}{lab.state}, {lab.country}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16, fontSize: 12.5 }}>
        <div><b>MRR</b><div>{fmtINR(lab.mrr || 0)}</div></div>
        <div><b>Segment</b><div><span className="seg-badge" style={{ background: seg.color }}>{seg.code}</span></div></div>
        <div><b>Status</b><div>{lab.status}</div></div>
        <div><b>Current Plan</b><div>{planName}</div></div>
      </div>

      <div className="tmpl-field" style={{ marginBottom: 12 }}>
        <label>Reassign CSM</label>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={newCsm} onChange={(e) => setNewCsm(e.target.value)} style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }}>
            {csmNames.map((n) => <option key={n}>{n}</option>)}
          </select>
          <button className="btn btn-ghost" disabled={newCsm === lab.csm} onClick={() => onReassignCsm(lab.id, newCsm)}>Save</button>
        </div>
      </div>

      <div className="tmpl-field">
        <label>Change Plan</label>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={newPlan} onChange={(e) => setNewPlan(e.target.value)} style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }}>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn btn-ghost" disabled={newPlan === lab.plan} onClick={() => onChangePlan(lab.id, newPlan)}>Save</button>
        </div>
      </div>
    </Modal>
  );
}
