import { useState } from "react";
import { RESOURCE_KINDS, addModuleResource, updateModuleResource, deleteModuleResource } from "../lib/moduleResources";

const ICON = { Documentation: "📄", "Training Video": "🎬", Other: "🔗" };
const input = { border: "1px solid var(--border)", borderRadius: 7, padding: "6px 9px", fontSize: 12.5, fontFamily: "inherit", background: "var(--surface)", color: "var(--text)" };

function isHttpUrl(v) {
  try { const u = new URL((v || "").trim()); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
}

// Documentation / training-video links for ONE module, shared across every lab (module_resources, migration 0036).
// Shown in the Adoption Template and inside each module on a lab's Adoption tab. Anyone signed in can add a link;
// whoever added it — or a CSM Lead / Admin — can edit or remove it.
export default function ModuleResources({ moduleKey, moduleName, resources, myProfileId, isHead, onChanged, showToast }) {
  const [form, setForm] = useState(null); // null | { id?, kind, title, url }
  const [saving, setSaving] = useState(false);
  const list = resources.filter((r) => r.moduleKey === moduleKey);
  const canManage = (r) => isHead || (myProfileId && r.addedBy === myProfileId);

  async function save() {
    if (!form.title.trim()) { showToast?.("Give the link a title."); return; }
    if (!isHttpUrl(form.url)) { showToast?.("Enter a full link starting with http:// or https://"); return; }
    setSaving(true);
    try {
      if (form.id) await updateModuleResource(form.id, form);
      else await addModuleResource({ moduleKey, ...form }, myProfileId);
      setForm(null);
      await onChanged?.();
      showToast?.(`Link saved — everyone sees it under ${moduleName}.`);
    } catch (err) {
      showToast?.(`⚠ ${/module_resources/.test(err.message || "") ? "Module links aren't set up in the database yet (migration 0036)." : err.message}`);
    } finally { setSaving(false); }
  }
  async function remove(r) {
    if (!window.confirm(`Remove "${r.title}" from ${moduleName} for everyone?`)) return;
    try { await deleteModuleResource(r.id); await onChanged?.(); showToast?.("Link removed."); }
    catch (err) { showToast?.(`⚠ ${err.message}`); }
  }

  return (
    <div className="module-resources">
      <div className="mr-head">
        <span>📚 Docs &amp; training videos{list.length ? ` (${list.length})` : ""}</span>
        {!form && myProfileId && (
          <button type="button" className="mark-purchased" onClick={() => setForm({ kind: "Documentation", title: "", url: "" })}>+ Add link</button>
        )}
      </div>
      {!list.length && !form && <div className="mr-empty">No links yet for {moduleName}.</div>}
      {list.map((r) => (
        <div key={r.id} className="mr-row">
          <span title={r.kind}>{ICON[r.kind] || "🔗"}</span>
          <a href={r.url} target="_blank" rel="noreferrer noopener">{r.title} ↗</a>
          <span className="mr-kind">{r.kind}</span>
          {canManage(r) && (
            <span className="mr-actions">
              <span className="icon-btn" title="Edit" style={{ cursor: "pointer" }} onClick={() => setForm({ id: r.id, kind: r.kind, title: r.title, url: r.url })}>✎</span>
              <span className="icon-btn" title="Remove" style={{ cursor: "pointer" }} onClick={() => remove(r)}>🗑</span>
            </span>
          )}
        </div>
      ))}
      {form && (
        <div className="mr-form">
          <select style={input} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
            {RESOURCE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input style={{ ...input, flex: "1 1 160px" }} placeholder="Title, e.g. Billing setup guide" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          <input style={{ ...input, flex: "2 1 220px" }} type="url" placeholder="https://…" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} />
          <button type="button" className="btn btn-primary" style={{ fontSize: 11.5, padding: "5px 12px" }} disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 11.5, padding: "5px 12px" }} disabled={saving} onClick={() => setForm(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
