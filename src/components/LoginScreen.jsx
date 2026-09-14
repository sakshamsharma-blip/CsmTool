import { useState } from "react";
import { supabase } from "../supabaseClient";

export default function LoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message || "Sign-in failed. Check your email/password.");
      setBusy(false);
      return;
    }
    onLoggedIn();
  }

  return (
    <div
      style={{
        display: "flex", position: "fixed", inset: 0, background: "#0e1a2e", zIndex: 9999,
        alignItems: "center", justifyContent: "center",
        fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{ background: "#fff", borderRadius: 12, padding: "32px 30px", width: 320, boxShadow: "0 20px 60px rgba(0,0,0,.35)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg,#2f6feb,#1948a8)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#fff", fontSize: 13 }}>CS</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#101828" }}>CS Tool — Sign in</div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475467", marginBottom: 4 }}>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com"
            style={{ width: "100%", border: "1px solid #e3e8ef", borderRadius: 7, padding: "9px 10px", fontSize: 13, fontFamily: "inherit" }} />
        </div>
        <div style={{ marginBottom: 6 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475467", marginBottom: 4 }}>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
            style={{ width: "100%", border: "1px solid #e3e8ef", borderRadius: 7, padding: "9px 10px", fontSize: 13, fontFamily: "inherit" }} />
        </div>
        {error && <div style={{ color: "#d13c3c", fontSize: 12, margin: "8px 0 0" }}>{error}</div>}
        <button type="submit" disabled={busy}
          style={{ width: "100%", marginTop: 14, border: "none", borderRadius: 7, padding: 10, fontSize: 13, fontWeight: 700, background: "#2f6feb", color: "#fff", cursor: "pointer" }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <div style={{ marginTop: 12, fontSize: 11, color: "#94a1b2", textAlign: "center" }}>Ask your lead if you don't have an account yet.</div>
      </form>
    </div>
  );
}
