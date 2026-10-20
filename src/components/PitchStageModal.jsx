import { useState } from "react";
import Modal from "./Modal";

const fieldStyle = { width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" };

// Confirm step for every Expansion pitch-stage change (My Portfolio, Tasks → Pitch Reminders, a lab's Adoption
// tab — including its "Mark purchased" button). A comment is REQUIRED for every change (decision, Oct 2026). "Added" asks the person to
// choose Priced or Trial (and the monthly charge if priced) because that stage creates a Collections entry;
// "Lost after Purchase" explains the MRR drop before confirming. Render it only while a change is pending
// (`{pending && <PitchStageModal … />}`) so its fields start fresh for each change.
export default function PitchStageModal({ target, fromStatus, toStatus, onClose, onConfirm }) {
  const [comment, setComment] = useState("");
  const [pricing, setPricing] = useState(""); // "" until chosen | "priced" | "trial"
  const [amount, setAmount] = useState("");
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  const isAdded = toStatus === "Added";
  const isLostAfterPurchase = toStatus === "Lost after Purchase";
  const trial = pricing === "trial";
  // Amounts are stored in the lab's own currency — ROW labs bill in USD, Domestic in INR.
  const sym = target.region === "ROW" ? "$" : "₹";

  async function handleConfirm() {
    let parsed = 0;
    if (!comment.trim()) { setError(true); return; }
    if (isAdded && !pricing) { setError(true); return; }
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
            <label>Priced or trial?</label>
            <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, cursor: "pointer" }}>
                <input type="radio" name="pricing" checked={pricing === "priced"} onChange={() => { setPricing("priced"); setError(false); }} /> Priced
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, cursor: "pointer" }}>
                <input type="radio" name="pricing" checked={pricing === "trial"} onChange={() => { setPricing("trial"); setError(false); }} /> Trial / free (charges can be added later)
              </label>
            </div>
          </div>
          {pricing === "priced" && (
            <div className="tmpl-field" style={{ marginBottom: 12 }}>
              <label>Added Monthly Cost ({sym})</label>
              <input type="number" min="0" placeholder="e.g. 5000" value={amount} onChange={(e) => { setAmount(e.target.value); setError(false); }} style={fieldStyle} />
            </div>
          )}
        </>
      )}

      <div className="tmpl-field">
        <label>Comment <span style={{ color: "var(--bad)" }}>*</span></label>
        <textarea rows="3" style={{ ...fieldStyle, resize: "vertical" }} value={comment} onChange={(e) => { setComment(e.target.value); setError(false); }}
          placeholder="Why is this changing? Anything the next person should know." />
      </div>
      {isLostAfterPurchase && (
        <div className="warn-banner" style={{ marginTop: 12 }}>
          The lab's MRR drops by this feature's monthly charge (from its Collections entry) and the loss is logged as a
          Contraction in Reports. The next Monthly invoice sets MRR to the billed figure again. A trial feature has no
          charge, so only the stage is recorded.
        </div>
      )}
      {error && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>{!comment.trim() ? "A comment is required — say why the stage is changing." : isAdded && !pricing ? "Choose Priced or Trial." : "Enter the monthly charge."}</div>}
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10 }}>
        This change and your comment are recorded in the lab's Lab History.
      </div>
    </Modal>
  );
}
