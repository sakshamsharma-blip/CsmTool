import { useState } from "react";
import { supabase } from "../supabaseClient";

export default function LoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError("");
    setResetSent(false);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message || "Sign-in failed. Check your email/password.");
      setBusy(false);
      return;
    }
    onLoggedIn();
  }

  async function handleForgotPassword() {
    if (!email) {
      setError("Enter your email above first, then click “Forgot your password?” again.");
      return;
    }
    setError("");
    setResetBusy(true);
    // Explicit redirectTo so the reset link comes back to wherever this is actually running
    // (localhost while testing, the real deployed URL once live) instead of whatever Supabase's
    // project-level Site URL happens to be set to. That target URL also has to be added under
    // Authentication → URL Configuration → Redirect URLs in the Supabase dashboard, or Supabase
    // will reject it and the link won't work.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setResetBusy(false);
    if (resetError) {
      setError(resetError.message || "Couldn't send a reset link. Contact your CS Lead.");
      return;
    }
    setResetSent(true);
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
      <form
        onSubmit={handleSubmit}
        style={{ background: "#fff", borderRadius: 14, padding: "34px 32px", width: 340, boxShadow: "0 8px 32px rgba(16,24,40,.10)", border: "1px solid var(--border)" }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <img src="/brand/crelio-wordmark.png" alt="CrelioHealth" style={{ height: 30, width: "auto" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--text)" }}>CS Console</div>
            <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>Customer Success workspace for the CS &amp; CSM team</div>
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={label}>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@creliohealth.in"
            style={field} />
        </div>
        <div style={{ marginBottom: 6 }}>
          <label style={label}>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
            style={field} />
        </div>
        <div style={{ textAlign: "right", marginBottom: 4 }}>
          <span
            onClick={resetBusy ? undefined : handleForgotPassword}
            style={{ fontSize: 11.5, color: "var(--brand-dark)", cursor: resetBusy ? "default" : "pointer", fontWeight: 600 }}
          >
            {resetBusy ? "Sending…" : "Forgot your password?"}
          </span>
        </div>
        {resetSent && <div style={{ color: "var(--ok)", fontSize: 12, margin: "8px 0 0" }}>Reset link sent — check your email.</div>}
        {error && <div style={{ color: "var(--bad)", fontSize: 12, margin: "8px 0 0" }}>{error}</div>}
        <button type="submit" disabled={busy}
          style={{ width: "100%", marginTop: 16, border: "none", borderRadius: 8, padding: 11, fontSize: 13.5, fontWeight: 700, background: "var(--brand)", color: "#fff", cursor: "pointer" }}>
          {busy ? "Signing in…" : "Sign In"}
        </button>
      </form>
      <div style={{ fontSize: 11, color: "var(--text-faint)", textAlign: "center", maxWidth: 320, lineHeight: 1.5 }}>
        Access is by invitation only. Contact your CS Lead for an account.
      </div>
    </div>
  );
}
