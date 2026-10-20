import { useEffect, useState } from "react";
import Modal from "./Modal";
import { fetchMyNotificationPrefs, saveNotificationPrefs } from "../lib/notifications";

const field = { width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" };

// Top bar → account menu → "Reminder Settings": choose a daily digest of overdue / due-today tasks and overdue
// payments by Email, Slack, or both. Always the signed-in person's own settings (not whoever an Admin previews).
export default function ReminderSettingsModal({ open, onClose, profileId, showToast }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [email, setEmail] = useState("");
  const [slackMemberId, setSlackMemberId] = useState("");

  useEffect(() => {
    if (!open || !profileId) return;
    let cancelled = false;
    fetchMyNotificationPrefs(profileId)
      .then((p) => {
        if (cancelled) return;
        setEmailEnabled(!!p.email_enabled); setSlackEnabled(!!p.slack_enabled);
        setEmail(p.email || ""); setSlackMemberId(p.slack_member_id || ""); setError("");
      })
      .catch((err) => { if (!cancelled) setError(/notification_prefs/.test(err.message || "") ? "Reminder settings aren't set up in the database yet (migration 0025)." : err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, profileId]);

  async function handleSave() {
    setSaving(true);
    try {
      await saveNotificationPrefs({ profileId, emailEnabled, slackEnabled, email, slackMemberId });
      showToast?.("Reminder settings saved.");
      onClose();
    } catch (err) {
      setError(err.message || "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Reminder Settings"
      onClose={onClose}
      actions={[
        { label: "Cancel", className: "btn-ghost", onClick: onClose },
        { label: saving ? "Saving…" : "Save", className: "btn-primary", onClick: handleSave, disabled: saving || loading || !!error },
      ]}
    >
      <p style={{ fontSize: 12.5, color: "var(--text-dim)", margin: "0 0 12px" }}>
        A daily reminder (9:00 AM) listing your overdue and due-today tasks, and overdue payments on your labs.
      </p>
      {loading ? <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>Loading…</div> : (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, cursor: "pointer", marginBottom: 8 }}>
            <input type="checkbox" checked={emailEnabled} onChange={(e) => setEmailEnabled(e.target.checked)} /> Email me
          </label>
          {emailEnabled && (
            <div className="tmpl-field" style={{ marginBottom: 12 }}>
              <label>Send to (leave blank to use your login email)</label>
              <input type="email" style={field} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@creliohealth.com" />
            </div>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, cursor: "pointer", marginBottom: 8 }}>
            <input type="checkbox" checked={slackEnabled} onChange={(e) => setSlackEnabled(e.target.checked)} /> Slack me
          </label>
          {slackEnabled && (
            <div className="tmpl-field" style={{ marginBottom: 12 }}>
              <label>Your Slack member ID (optional, to @mention you)</label>
              <input style={field} value={slackMemberId} onChange={(e) => setSlackMemberId(e.target.value)} placeholder="e.g. U0123ABCD — Slack → your profile → ⋮ → Copy member ID" />
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
            Messages start once the Admin connects the email / Slack service. Until then your choice is saved and waiting.
          </div>
        </>
      )}
      {error && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}
