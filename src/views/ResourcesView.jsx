import { useEffect, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { TEAM_RESOURCE_KINDS, fetchResources, addResource, updateResource, deleteResource } from "../lib/resources";
import { fetchModuleResources } from "../lib/moduleResources";

const ICON = { Document: "📄", Training: "🎬", Other: "🔗", Documentation: "📄", "Training Video": "🎬" };
const input = { border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", fontSize: 12.5, fontFamily: "inherit", background: "var(--surface)", color: "var(--text)" };

function isHttpUrl(v) {
  try { const u = new URL((v || "").trim()); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
}

// Sidebar → Resources: one place for the team's common documents and training material (table `resources`), plus
// a read-only roll-up of every module's docs & training links (added on the Adoption Template / a lab's Adoption tab).
export default function ResourcesView({ modules, myProfileId, isHead, showToast }) {
  const [items, setItems] = useState([]);
  const [moduleLinks, setModuleLinks] = useState([]);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null); // null | { id?, kind, title, url, description }
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [fKind, setFKind] = useState("");

  async function load() {
    const [r, m] = await Promise.all([fetchResources(), fetchModuleResources().catch(() => [])]);
    setItems(r); setModuleLinks(m);
  }
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return undefined;
    let cancelled = false;
    Promise.all([fetchResources(), fetchModuleResources().catch(() => [])])
      .then(([r, m]) => { if (!cancelled) { setItems(r); setModuleLinks(m); } })
      .catch((err) => { if (!cancelled) setError(/resources/.test(err.message || "") ? "Resources aren't set up in the database yet (migration 0038)." : err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (!SUPABASE_CONFIGURED) return <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — Resources needs a database connected.</div>;
  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading resources…</div>;

  const canManage = (r) => isHead || (myProfileId && r.addedBy === myProfileId);
  const ql = q.trim().toLowerCase();
  const shown = items.filter((r) => (!fKind || r.kind === fKind) && (!ql || `${r.title} ${r.description}`.toLowerCase().includes(ql)));
  const modName = Object.fromEntries((modules || []).map((m) => [m.key, m.name]));
  const shownModuleLinks = moduleLinks.filter((r) => !ql || `${r.title} ${modName[r.moduleKey] || ""}`.toLowerCase().includes(ql));

  async function save() {
    if (!form.title.trim()) { showToast("Give it a title."); return; }
    if (!isHttpUrl(form.url)) { showToast("Enter a full link starting with http:// or https://"); return; }
    setSaving(true);
    try {
      if (form.id) await updateResource(form.id, form); else await addResource(form, myProfileId);
      setForm(null); await load(); showToast("Saved — the whole team can see it.");
    } catch (err) { showToast(`⚠ ${err.message}`); } finally { setSaving(false); }
  }
  async function remove(r) {
    if (!window.confirm(`Remove "${r.title}" for everyone?`)) return;
    try { await deleteResource(r.id); await load(); showToast("Removed."); } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  return (
    <div>
      <h1 className="page-title">Resources</h1>
      <p className="page-sub">Common documents and training material for the whole team. Module-specific links are listed further down.</p>
      {error && <div className="error-banner">{error}</div>}

      <div className="filters">
        <input style={{ ...input, minWidth: 220 }} placeholder="Search resources…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={fKind} onChange={(e) => setFKind(e.target.value)}>
          <option value="">All types</option>
          {TEAM_RESOURCE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        {!form && myProfileId && <button className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => setForm({ kind: "Document", title: "", url: "", description: "" })}>+ Add resource</button>}
      </div>

      {form && (
        <div className="table-card" style={{ padding: 14, marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
          <select style={input} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
            {TEAM_RESOURCE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input style={{ ...input, flex: "1 1 180px" }} placeholder="Title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          <input style={{ ...input, flex: "2 1 240px" }} type="url" placeholder="https://…" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} />
          <input style={{ ...input, flex: "1 1 100%" }} placeholder="Short description (optional)" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
          <button className="btn btn-ghost" disabled={saving} onClick={() => setForm(null)}>Cancel</button>
        </div>
      )}

      <div className="table-card" style={{ marginBottom: 22 }}>
        {!shown.length ? <div style={{ padding: 20, color: "var(--text-faint)", fontSize: 12.5 }}>{items.length ? "Nothing matches." : "No resources yet — add the first one."}</div> : (
          <div className="table-scroll"><table className="child-mini">
            <thead><tr><th>Resource</th><th>Type</th><th>Added</th><th></th></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id}>
                <td>
                  <a href={r.url} target="_blank" rel="noreferrer noopener" style={{ fontWeight: 600 }}>{ICON[r.kind] || "🔗"} {r.title} ↗</a>
                  {r.description && <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}>{r.description}</div>}
                </td>
                <td>{r.kind}</td>
                <td style={{ whiteSpace: "nowrap" }}>{new Date(r.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</td>
                <td style={{ whiteSpace: "nowrap" }}>{canManage(r) && (<>
                  <span className="icon-btn" title="Edit" style={{ cursor: "pointer" }} onClick={() => setForm({ id: r.id, kind: r.kind, title: r.title, url: r.url, description: r.description })}>✎</span>{" "}
                  <span className="icon-btn" title="Remove" style={{ cursor: "pointer" }} onClick={() => remove(r)}>🗑</span>
                </>)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Module docs &amp; training links</h3>
      <div className="table-card">
        {!shownModuleLinks.length ? <div style={{ padding: 20, color: "var(--text-faint)", fontSize: 12.5 }}>No module links yet — add them from the Adoption Template or a lab's Adoption tab.</div> : (
          <div className="table-scroll"><table className="child-mini">
            <thead><tr><th>Module</th><th>Link</th><th>Type</th></tr></thead>
            <tbody>{shownModuleLinks.map((r) => (
              <tr key={r.id}>
                <td>{modName[r.moduleKey] || r.moduleKey}</td>
                <td><a href={r.url} target="_blank" rel="noreferrer noopener">{ICON[r.kind] || "🔗"} {r.title} ↗</a></td>
                <td>{r.kind}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
