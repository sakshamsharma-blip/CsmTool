import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Consent page for the CSM GROWTH Claude connector (MCP, supabase/functions/csm-mcp). Supabase Auth's OAuth 2.1 server
// sends the person here (Site URL + Authorization Path "/oauth/consent", set in the Supabase dashboard) with an
// `authorization_id`, after they have signed in. They see who is asking and approve or deny; Supabase then redirects back
// to Claude. The connector is read-only and runs with the person's own access (RLS), so it sees only what they see here.
export default function OAuthConsentScreen() {
  const authorizationId = new URLSearchParams(window.location.search).get("authorization_id");
  const [details, setDetails] = useState(null);
  const [error, setError] = useState(authorizationId ? "" : "This link is missing its authorization id — start the connection again from Claude.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authorizationId) return;
    let cancelled = false;
    supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) { setError(err.message || "Couldn't load this request."); return; }
      if (data && !("authorization_id" in data) && data.redirect_url) { window.location.href = data.redirect_url; return; } // already approved
      setDetails(data);
    });
    return () => { cancelled = true; };
  }, [authorizationId]);

  async function decide(approve) {
    setBusy(true);
    const call = approve ? supabase.auth.oauth.approveAuthorization : supabase.auth.oauth.denyAuthorization;
    const { data, error: err } = await call.call(supabase.auth.oauth, authorizationId, { skipBrowserRedirect: true });
    if (err) { setError(err.message || "Something went wrong."); setBusy(false); return; }
    window.location.href = data.redirect_url;
  }

  const card = { background: "var(--surface)", borderRadius: 14, padding: "30px 30px 26px", width: 400, maxWidth: "calc(100vw - 32px)", boxShadow: "0 8px 32px rgba(16,24,40,.10)", border: "1px solid var(--border)", color: "var(--text)" };
  return (
    <div style={{ display: "flex", position: "fixed", inset: 0, background: "var(--bg)", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" }}>
      <div style={card}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 18 }}>
          <img src="/brand/crelio-wordmark.png" alt="CrelioHealth" style={{ height: 28, width: "auto" }} />
          <div style={{ fontWeight: 700, fontSize: 15 }}>Connect {details?.client?.name || "an app"} to CSM GROWTH</div>
        </div>
        {error ? <div className="error-banner">{error}</div> : !details ? (
          <div style={{ fontSize: 13, color: "var(--text-dim)", textAlign: "center" }}>Loading…</div>
        ) : (
          <>
            <p style={{ fontSize: 13, lineHeight: 1.5, margin: "0 0 10px" }}>
              <b>{details.client?.name || "This app"}</b> wants to <b>read</b> your CSM GROWTH data as <b>{details.user?.email}</b>.
            </p>
            <ul style={{ fontSize: 12.5, lineHeight: 1.6, margin: "0 0 14px", paddingLeft: 18, color: "var(--text-dim)" }}>
              <li>Read-only: it can't change anything.</li>
              <li>It sees exactly what you see in the app — your own labs, or the team if you're a Lead / Admin.</li>
              <li>Labs, adoption scores, tasks, check-ins, invoices, expansion and feedback.</li>
            </ul>
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 16, wordBreak: "break-all" }}>Returns to: {details.redirect_uri}</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" disabled={busy} onClick={() => decide(false)}>Deny</button>
              <button className="btn btn-primary" disabled={busy} onClick={() => decide(true)}>{busy ? "…" : "Allow"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
