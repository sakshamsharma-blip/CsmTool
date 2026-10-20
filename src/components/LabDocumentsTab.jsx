import { useEffect, useState } from "react";
import Modal from "./Modal";
import { fetchLabDocuments, addLabDocument, updateLabDocument, deleteLabDocument, DOC_TYPES } from "../lib/labDocuments";

const field = { width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" };

function isHttpUrl(v) {
  try { const u = new URL((v || "").trim()); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
}

// Lab → Documents: links to this lab's documents kept elsewhere (Drive, etc.). Type + name + link, opened in a
// new tab. Nothing is uploaded here.
export default function LabDocumentsTab({ lab, csmId, showToast }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // null | { doc?: existing, f: { docType, customType, name, url } }
  const [saving, setSaving] = useState(false);

  async function load() {
    try { setDocs(await fetchLabDocuments(lab.id)); setError(""); }
    catch (err) { setError(err.message || "Couldn't load documents."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let cancelled = false;
    fetchLabDocuments(lab.id)
      .then((rows) => { if (!cancelled) { setDocs(rows); setError(""); } })
      .catch((err) => { if (!cancelled) setError(err.message || "Couldn't load documents."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lab.id]);

  function openAdd() { setEditing({ f: { docType: DOC_TYPES[0], customType: "", name: "", url: "" } }); }
  function openEdit(d) {
    const known = DOC_TYPES.includes(d.docType);
    setEditing({ doc: d, f: { docType: known ? d.docType : "Other", customType: known ? "" : d.docType, name: d.name, url: d.url } });
  }
  async function handleSave() {
    const f = editing.f;
    const docType = f.docType === "Other" && f.customType.trim() ? f.customType.trim() : f.docType;
    if (!f.name.trim()) { showToast?.("Give the document a name."); return; }
    if (!isHttpUrl(f.url)) { showToast?.("Enter a full link starting with http:// or https://"); return; }
    setSaving(true);
    try {
      if (editing.doc) await updateLabDocument(editing.doc, { docType, name: f.name, url: f.url }, csmId);
      else await addLabDocument(lab.id, { docType, name: f.name, url: f.url }, csmId);
      setEditing(null);
      await load();
      showToast?.("Document link saved.");
    } catch (err) { showToast?.(`⚠ ${err.message}`); }
    finally { setSaving(false); }
  }
  async function handleDelete(d) {
    if (!window.confirm(`Remove the link "${d.name}"? (The document itself isn't touched.)`)) return;
    try { await deleteLabDocument(d, csmId); await load(); showToast?.("Document link removed."); }
    catch (err) { showToast?.(`⚠ ${err.message}`); }
  }

  return (
    <div className="table-card" style={{ padding: "6px 20px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0 6px" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Documents</div>
          <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}>Links to {lab.name}'s documents (agreements, proposals, POs…) kept in Drive or elsewhere.</div>
        </div>
        <button className="btn btn-primary" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={openAdd}>+ Add Document</button>
      </div>
      {loading ? <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "10px 0" }}>Loading…</div>
        : error ? <div style={{ fontSize: 12, color: "var(--bad)", padding: "10px 0" }}>{/lab_documents/.test(error) ? "Documents aren't set up in the database yet (migration 0033)." : error}</div>
        : !docs.length ? <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "10px 0" }}>No documents linked yet.</div>
        : (
          <div className="table-scroll"><table className="child-mini">
            <thead><tr><th>Type</th><th>Name</th><th>Added</th><th></th></tr></thead>
            <tbody>{docs.map((d) => (
              <tr key={d.id}>
                <td><span className="cat-tag cat-Indigo">{d.docType}</span></td>
                <td><a href={d.url} target="_blank" rel="noreferrer noopener" style={{ fontWeight: 600 }}>{d.name} ↗</a></td>
                <td style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{new Date(d.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <span className="icon-btn" title="Edit" style={{ cursor: "pointer" }} onClick={() => openEdit(d)}>✎</span>
                  <span className="icon-btn" title="Remove" style={{ cursor: "pointer", marginLeft: 6 }} onClick={() => handleDelete(d)}>🗑</span>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}

      <Modal
        open={!!editing}
        title={editing?.doc ? "Edit Document Link" : "Add Document Link"}
        onClose={() => setEditing(null)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setEditing(null), disabled: saving },
          { label: saving ? "Saving…" : "Save", className: "btn-primary", onClick: handleSave, disabled: saving },
        ]}
      >
        {editing && (() => {
          const setF = (k, v) => setEditing((x) => ({ ...x, f: { ...x.f, [k]: v } }));
          return (
            <>
              <div className="tmpl-field" style={{ marginBottom: 10 }}>
                <label>Document Type</label>
                <select style={field} value={editing.f.docType} onChange={(e) => setF("docType", e.target.value)}>
                  {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {editing.f.docType === "Other" && (
                <div className="tmpl-field" style={{ marginBottom: 10 }}>
                  <label>Type name (optional)</label>
                  <input style={field} value={editing.f.customType} onChange={(e) => setF("customType", e.target.value)} placeholder="e.g. NDA" />
                </div>
              )}
              <div className="tmpl-field" style={{ marginBottom: 10 }}>
                <label>Document Name</label>
                <input style={field} value={editing.f.name} onChange={(e) => setF("name", e.target.value)} placeholder="e.g. Service Agreement 2026" />
              </div>
              <div className="tmpl-field">
                <label>Link</label>
                <input type="url" style={field} value={editing.f.url} onChange={(e) => setF("url", e.target.value)} placeholder="https://drive.google.com/…" />
              </div>
            </>
          );
        })()}
      </Modal>
    </div>
  );
}
