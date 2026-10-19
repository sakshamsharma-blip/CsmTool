import { useState } from "react";
import Modal from "./Modal";

const fieldStyle = { width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" };

// Confirm step for every Expansion pitch-stage change (My Portfolio and Tasks → Pitch Reminders). The
// comment is always optional; picking "Added" additionally asks for the monthly cost (or trial/free)
// because that stage creates a Collections entry. Render it only while a change is pending
// (`{pending && <PitchStageModal … />}`) so its fields start fresh for each change.
export default function PitchStageModal({ target, fromStatus, toStatus, onClose, onConfirm }) {
  const [comment, setComment] = useState("");
  const [trial, setTrial] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  const isAdded = toStatus === "Added";

  async function handleConfirm() {
    let parsed = 0;
    if (isAdded && !trial) {
      parsed = parseFloat(amount);
      if (!parsed || parsed <= 0) { setError(true); return; }
    }
    setSaving(true);
    try {
      await onConfirm({ comment: comment.trim(), amount: parsed, isTrial: isAdded && trial });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={`Change stage — ${target.label}`}
      onClose={saving ? () => {} : onClose}
      actions={[
        { label: "Cancel", className: "btn-ghost", onClick: onClose, disabled: saving },
        { label: saving ? "Saving…" : isAdded ? "Confirm Added" : "Confirm", className: "btn-primary", onClick: handleConfirm, disabled: saving },
      ]}
    >
      <div style={{ fontSize: 13, marginBottom: 14 }}>
        <b>{fromStatus || "—"}</b> <span style={{ color: "var(--text-faint)" }}>→</span> <b style={{ color: "var(--accent)" }}>{toStatus}</b>
      </div>

      {isAdded && (
        <>
          <div className="tmpl-field" style={{ marginBottom: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, cursor: "pointer" }}>
              <input type="checkbox" checked={trial} onChange={(e) => setTrial(e.target.checked)} /> This is a trial / free addition (no charge yet)
            </label>
          </div>
          {!trial && (
            <div className="tmpl-field" style={{ marginBottom: 12 }}>
              <label>Added Monthly Cost (₹)</label>
              <input type="number" min="0" placeholder="e.g. 5000" value={amount} onChange={(e) => { setAmount(e.target.value); setError(false); }} style={fieldStyle} />
            </div>
          )}
        </>
      )}

      <div className="tmpl-field">
        <label>Comment (optional)</label>
        <textarea rows="3" style={{ ...fieldStyle, resize: "vertical" }} value={comment} onChange={(e) => setComment(e.target.value)}
          placeholder="Why is this changing? Anything the next person should know." />
      </div>
      {error && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>Enter an amount, or mark this as trial/free.</div>}
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10 }}>
        This change is recorded in the lab's Lab History{comment.trim() ? ", including your comment" : ""}.
      </div>
    </Modal>
  );
}
