import { useState } from "react";
import SearchSelect from "./SearchSelect";
import DesignationSelect from "./DesignationSelect";

const field = { border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", background: "var(--surface)", color: "var(--text)", width: "100%" };

// "Given by": pick one of the lab's Points of Contact, or add a new POC on the spot (saved to the lab).
export default function PocPicker({ labId, name, designation, pocsFor, onAddPoc, onPick, showToast }) {
  const [adding, setAdding] = useState(null); // { name, designation, minProactive }
  const [busy, setBusy] = useState(false);
  const pocs = labId ? pocsFor(labId) : [];
  const match = pocs.find((c) => c.name === name && (c.designation || "") === (designation || ""));
  const options = pocs.map((c) => ({ value: c.id, label: c.name, hint: c.designation || "" }));
  async function save() {
    if (!adding.name.trim()) { showToast("Enter the person's name."); return; }
    if (!adding.designation.trim()) { showToast("Pick the person's designation."); return; }
    setBusy(true);
    try { const c = await onAddPoc(labId, adding); onPick(c); setAdding(null); showToast(`${c.name} added to the lab's points of contact.`); }
    catch (err) { showToast(`⚠ ${err.message}`); } finally { setBusy(false); }
  }
  if (!labId) return <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Pick the lab first.</div>;
  return (
    <div>
      {!adding && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <SearchSelect value={match?.id || ""} onChange={(id) => { const c = pocs.find((x) => x.id === id); if (c) onPick(c); }}
              options={options} placeholder={pocs.length ? "Pick a point of contact…" : "No POCs yet for this lab"} />
          </div>
          <button type="button" className="mark-purchased" onClick={() => setAdding({ name: "", designation: "", minProactive: "" })}>+ Add POC</button>
        </div>
      )}
      {!adding && name && !match && <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 4 }}>Saved as: {name}{designation ? ` — ${designation}` : ""}</div>}
      {!adding && match && <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 4 }}>Designation: <b>{match.designation || "—"}</b></div>}
      {adding && (
        <div className="table-card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <input style={field} placeholder="Name *" value={adding.name} onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value }))} autoFocus />
          <DesignationSelect style={field} value={adding.designation} onChange={(v) => setAdding((a) => ({ ...a, designation: v }))} />
          <input style={field} type="number" min="0" max="31" placeholder="Minimum proactive check-ins per month (optional)" value={adding.minProactive}
            onChange={(e) => setAdding((a) => ({ ...a, minProactive: e.target.value }))} />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-primary" style={{ fontSize: 12, padding: "6px 12px" }} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save POC"}</button>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 12px" }} disabled={busy} onClick={() => setAdding(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

