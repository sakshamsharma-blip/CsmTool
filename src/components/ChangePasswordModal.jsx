import { useState } from "react";
import { supabase } from "../supabaseClient";
import Modal from "./Modal";

// TopBar's "Change Password" — since the person is already signed in, this sets the new
// password directly (supabase.auth.updateUser), no email round-trip needed. That's the flow for
// someone who was handed an ID + temp password directly (rather than an invite link) and wants
// to set their own password right after logging in for the first time.
export default function ChangePasswordModal({ open, onClose, showToast }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function handleClose() {
    setPassword(""); setConfirm(""); setError(""); setBusy(false);
    onClose();
  }

  async function handleSave() {
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    setError("");
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) { setError(updateError.message || "Couldn't update password — try again."); return; }
    showToast && showToast("Password updated.");
    handleClose();
  }

  const field = { width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" };

  return (
    <Modal
      open={open}
      title="Change Password"
      onClose={handleClose}
      actions={[
        { label: "Cancel", className: "btn-ghost", onClick: handleClose },
        { label: busy ? "Saving…" : "Save", className: "btn-primary", onClick: handleSave, disabled: busy },
      ]}
    >
      <div className="tmpl-field" style={{ marginBottom: 12 }}>
        <label>New Password</label>
        <input type="password" style={field} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
      </div>
      <div className="tmpl-field">
        <label>Confirm New Password</label>
        <input type="password" style={field} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
      </div>
      {error && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}
