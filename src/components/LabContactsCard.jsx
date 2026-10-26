import { useEffect, useState } from "react";
import Modal from "./Modal";
import DesignationSelect from "./DesignationSelect";
import { fetchLabContacts, addLabContact, updateLabContact, deleteLabContact } from "../lib/labContacts";

const field = { width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" };
const EMPTY = { name: "", designation: "", phone: "", email: "" };

// Lab page → "Points of Contact" tab: the people at this lab a CSM deals with. These are what Log Check-in offers
// under "Person Contacted".
export default function LabContactsCard({ lab, csmId, showToast }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // null | { contact?: existing, f: form }
  const [saving, setSaving] = useState(false);

  async function load() {
    try { setContacts(await fetchLabContacts(lab.id)); setError(""); }
    catch (err) { setError(err.message || "Couldn't load contacts."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let cancelled = false;
    fetchLabContacts(lab.id)
      .then((rows) => { if (!cancelled) { setContacts(rows); setError(""); } })
      .catch((err) => { if (!cancelled) setError(err.message || "Couldn't load contacts."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lab.id]);

  async function handleSave() {
    const f = editing.f;
    if (!f.name.trim()) { showToast?.("Enter the contact's name."); return; }
    setSaving(true);
    try {
      if (editing.contact) await updateLabContact(editing.contact, f, csmId);
      else await addLabContact(lab.id, f, csmId);
      setEditing(null);
      await load();
      showToast?.("Contact saved.");
    } catch (err) { showToast?.(`⚠ ${err.message}`); }
    finally { setSaving(false); }
  }
  async function handleDelete(c) {
    if (!window.confirm(`Remove ${c.name} from ${lab.name}'s points of contact?`)) return;
    try { await deleteLabContact(c, csmId); await load(); showToast?.("Contact removed."); }
    catch (err) { showToast?.(`⚠ ${err.message}`); }
  }

  return (
    <div className="table-card" style={{ padding: "6px 20px 16px", marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: "1px solid var(--border)", marginBottom: 6 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>Points of Contact</div>
        <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "5px 12px" }} onClick={() => setEditing({ f: { ...EMPTY } })}>+ Add POC</button>
      </div>
      {loading ? <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "8px 0" }}>Loading…</div>
        : error ? <div style={{ fontSize: 12, color: "var(--bad)", padding: "8px 0" }}>{/lab_contacts/.test(error) ? "Contacts aren't set up in the database yet (migration 0032)." : error}</div>
        : !contacts.length ? <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "8px 0" }}>No contacts yet — add the people you speak to at {lab.name}.</div>
        : (
          <div className="table-scroll"><table className="child-mini">
            <thead><tr><th>Name</th><th>Designation</th><th>Phone</th><th>Email</th><th></th></tr></thead>
            <tbody>{contacts.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td>{c.designation || "—"}</td>
                <td>{c.phone || "—"}</td>
                <td>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <span className="icon-btn" title="Edit" style={{ cursor: "pointer" }} onClick={() => setEditing({ contact: c, f: { name: c.name, designation: c.designation, phone: c.phone, email: c.email } })}>✎</span>
                  <span className="icon-btn" title="Remove" style={{ cursor: "pointer", marginLeft: 6 }} onClick={() => handleDelete(c)}>🗑</span>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}

      <Modal
        open={!!editing}
        title={editing?.contact ? "Edit Point of Contact" : "Add Point of Contact"}
        onClose={() => setEditing(null)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setEditing(null), disabled: saving },
          { label: saving ? "Saving…" : "Save", className: "btn-primary", onClick: handleSave, disabled: saving },
        ]}
      >
        {editing && (
          <>
            {[["name", "Name *", "e.g. Dr. Mehta"], ["designation", "Designation", ""], ["phone", "Phone", ""], ["email", "Email", ""]].map(([k, label, ph]) => (
              <div key={k} className="tmpl-field" style={{ marginBottom: 10 }}>
                <label>{label}</label>
                {k === "designation"
                  ? <DesignationSelect style={field} value={editing.f.designation} onChange={(v) => setEditing((x) => ({ ...x, f: { ...x.f, designation: v } }))} />
                  : <input style={field} value={editing.f[k]} placeholder={ph} onChange={(e) => setEditing((x) => ({ ...x, f: { ...x.f, [k]: e.target.value } }))} />}
              </div>
            ))}
          </>
        )}
      </Modal>
    </div>
  );
}
