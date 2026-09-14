import { useEffect, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { fmtINR } from "../lib/format";
import { computeLabRollup, flattenRollup } from "../lib/labRollup";
import { fetchAllCollectionsItems, addCollectionsItem, markItemCollected } from "../lib/collections";
import ScopeToggle from "../components/ScopeToggle";
import Modal from "../components/Modal";

export default function CollectionsView({ labs, csmDirectory, currentCSM, idByName, onOpenLab, showToast }) {
  const isHead = csmDirectory.find((c) => c.name === currentCSM)?.role === "Lead";
  const [scope, setScope] = useState("mine");
  const [csmFilter, setCsmFilter] = useState("");
  const csmNames = csmDirectory.map((c) => c.name);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);
  const [manualInputs, setManualInputs] = useState({}); // itemId -> typed amount string

  const [addOpen, setAddOpen] = useState(false);
  const [addLabId, setAddLabId] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addTrial, setAddTrial] = useState(false);
  const [addError, setAddError] = useState(false);

  async function loadAll() {
    if (!SUPABASE_CONFIGURED) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try { setItems(await fetchAllCollectionsItems()); }
    catch (err) { setError(err.message || "Failed to load collections."); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!SUPABASE_CONFIGURED) {
    return <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — Collections needs a database connected.</div>;
  }
  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading collections…</div>;
  if (error) return <div className="warn-banner" style={{ background: "var(--bad-bg)", color: "var(--bad)", borderColor: "#f3b8b8" }}>Couldn't load collections — {error}</div>;

  const teamAll = isHead && scope === "team" && !csmFilter;
  const scopeCsm = isHead && scope === "team" ? (csmFilter || null) : currentCSM;
  const scopeLabel = teamAll ? "the whole team" : scopeCsm;

  const allRows = computeLabRollup(labs);
  const rows = scopeCsm ? allRows.filter((r) => r.csm === scopeCsm || r.children.some((c) => c.csm === scopeCsm)) : allRows;
  const flat = flattenRollup(rows);
  const flatIds = new Set(flat.map((l) => l.id));
  const labsById = {};
  labs.forEach((l) => { labsById[l.id] = l; });

  const scoped = items.filter((i) => flatIds.has(i.labId));
  const pending = scoped.filter((i) => i.status === "Pending");
  const totalOwed = pending.reduce((s, i) => s + (i.amount || 0), 0);
  const totalCollected = scoped.reduce((s, i) => s + (i.collectedManual || 0), 0);

  async function handleMarkCollected(item) {
    const val = parseFloat(manualInputs[item.id]);
    if (!val || val < 0) { showToast("Enter a valid amount."); return; }
    try {
      await markItemCollected(item.id, val, item.labId, idByName[labsById[item.labId]?.csm]);
      await loadAll();
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  const labOptions = [];
  allRows.forEach((r) => { labOptions.push(r); r.children.forEach((c) => labOptions.push(c)); });

  async function handleAddItem() {
    if (!addLabId || !addLabel.trim()) { setAddError(true); return; }
    if (!addTrial && (!addAmount || parseFloat(addAmount) <= 0)) { setAddError(true); return; }
    try {
      await addCollectionsItem({
        labId: addLabId, moduleKey: null, paramName: null, label: addLabel.trim(),
        amount: addTrial ? 0 : parseFloat(addAmount), isTrial: addTrial,
        csmId: idByName[labsById[addLabId]?.csm],
      });
      setAddOpen(false); setAddLabId(""); setAddLabel(""); setAddAmount(""); setAddTrial(false); setAddError(false);
      await loadAll();
      showToast("Collections item added.");
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  return (
    <div>
      <h1 className="page-title">Collections</h1>
      <p className="page-sub">Outstanding dues for labs assigned to <b>{scopeLabel}</b>.</p>

      <div className="banner" style={{ background: "#eef4ff", border: "1px solid #cfe0fb" }}>
        <span className="badge" style={{ background: "#1948a8" }}>BASIC MANUAL TRACKER</span>
        <span>Itemized owed/collected, logged manually — no Zoho Books sync yet. Items are created automatically when a pitch on My Portfolio is marked Added, or add one directly below.</span>
      </div>

      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={csmNames} />

      <div className="summary-grid" style={{ gridTemplateColumns: "repeat(4,1fr)", marginBottom: 18 }}>
        <div className="stile"><div className="sval">{fmtINR(totalOwed)}</div><div className="slabel">Outstanding (Pending)</div></div>
        <div className="stile"><div className="sval" style={{ color: "var(--ok)" }}>{fmtINR(totalCollected)}</div><div className="slabel">Collected To Date</div></div>
        <div className="stile"><div className="sval">{pending.length}</div><div className="slabel">Pending Items</div></div>
        <div className="stile"><div className="sval">{scoped.length}</div><div className="slabel">Total Items</div></div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={() => setAddOpen(true)}>+ Add Item</button>
      </div>

      {!scoped.length ? (
        <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No collections items for {scopeLabel} yet.</div>
      ) : (
        <div className="table-card"><div className="table-scroll"><table className="child-mini">
          <thead><tr><th>Lab</th><th>Feature</th><th>Added</th><th>Owed</th><th>Collected</th><th>Status</th><th></th></tr></thead>
          <tbody>{scoped.map((item) => {
            const lab = labsById[item.labId];
            return (
              <tr key={item.id}>
                <td className="lab-name clickable" onClick={() => onOpenLab(item.labId)}>{lab ? lab.name : item.labId}</td>
                <td>{item.label}{item.isTrial && <span className="cat-tag" style={{ background: "#eef2ff", color: "#4338ca" }}> Trial/Free</span>}</td>
                <td style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{new Date(item.addedDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</td>
                <td className="mrr-cell">{item.isTrial ? "—" : fmtINR(item.amount)}</td>
                <td>
                  {item.isTrial ? "—" : item.collectedManual === null ? (
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="number" placeholder="₹ collected" value={manualInputs[item.id] || ""} onChange={(e) => setManualInputs((m) => ({ ...m, [item.id]: e.target.value }))}
                        style={{ width: 92, border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px", fontSize: 11.5 }} />
                      <button className="mark-purchased" onClick={() => handleMarkCollected(item)}>Save</button>
                    </span>
                  ) : fmtINR(item.collectedManual)}
                </td>
                <td><span className={`status-chip ${item.status === "Pending" ? "st-InProgress" : "st-Adopted"}`} style={{ cursor: "default" }}>{item.status}</span></td>
                <td></td>
              </tr>
            );
          })}</tbody>
        </table></div></div>
      )}

      <Modal
        open={addOpen}
        title="Add Collections Item"
        onClose={() => setAddOpen(false)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setAddOpen(false) },
          { label: "Add Item", className: "btn-primary", onClick: handleAddItem },
        ]}
      >
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Lab</label>
          <select value={addLabId} onChange={(e) => setAddLabId(e.target.value)} style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }}>
            <option value="">Select a lab…</option>
            {labOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Feature / Description</label>
          <input value={addLabel} onChange={(e) => setAddLabel(e.target.value)} placeholder="e.g. Home Collection add-on"
            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }} />
        </div>
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, cursor: "pointer" }}>
            <input type="checkbox" checked={addTrial} onChange={(e) => setAddTrial(e.target.checked)} /> Trial / free (nothing owed yet)
          </label>
        </div>
        {!addTrial && (
          <div className="tmpl-field">
            <label>Amount Owed (₹)</label>
            <input type="number" min="0" value={addAmount} onChange={(e) => setAddAmount(e.target.value)}
              style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }} />
          </div>
        )}
        {addError && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>Pick a lab, a description, and an amount (or mark it trial/free).</div>}
      </Modal>
    </div>
  );
}
