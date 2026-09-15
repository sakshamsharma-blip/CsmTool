import { useState } from "react";
import { supabase } from "../supabaseClient";

// Shown the moment someone lands back in the app from a "reset password" / "forgot password"
// email link — Supabase's redirect establishes a real session for them (that's how the link
// works) and fires a PASSWORD_RECOVERY auth event, which App.jsx listens for and turns into this
// full-screen gate. They can't get past it into the rest of the app until they've actually set a
// new password — landing them straight into the workspace on a stale/temp password without ever
// being asked to change it would defeat the point of the link.
export default function PasswordRecoveryScreen({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(updateError.message || "Couldn't set the new password — try again.");
      return;
    }
    setDone(true);
  }

  const field = { width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 13.5, fontFamily: "inherit" };
  const label = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-dim)", marginBottom: 5 };

  return (
    <div
      style={{
        display: "flex", position: "fixed", inset: 0, background: "var(--bg)", zIndex: 9999,
        alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 22,
        fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
      }}
    >
      <div style={{ background: "#fff", borderRadius: 14, padding: "34px 32px", width: 340, boxShadow: "0 8px 32px rgba(16,24,40,.10)", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <img src="/brand/crelio-wordmark.png" alt="CrelioHealth" style={{ height: 30, width: "auto" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--text)" }}>Set a New Password</div>
            <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>
              {done ? "All set — you can sign in with it from now on." : "Choose a new password for your account."}
            </div>
          </div>
        </div>

        {done ? (
          <button
            type="button"
            onClick={onDone}
            style={{ width: "100%", border: "none", borderRadius: 8, padding: 11, fontSize: 13.5, fontWeight: 700, background: "var(--brand)", color: "#fff", cursor: "pointer" }}
          >
            Continue to CS Console
          </button>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label style={label}>New Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={field} />
            </div>
            <div style={{ marginBottom: 6 }}>
              <label style={label}>Confirm New Password</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" style={field} />
            </div>
            {error && <div style={{ color: "var(--bad)", fontSize: 12, margin: "8px 0 0" }}>{error}</div>}
            <button type="submit" disabled={busy}
              style={{ width: "100%", marginTop: 16, border: "none", borderRadius: 8, padding: 11, fontSize: 13.5, fontWeight: 700, background: "var(--brand)", color: "#fff", cursor: "pointer" }}>
              {busy ? "Saving…" : "Set New Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
