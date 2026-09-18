import { useEffect, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { fmtINR, fmtMoney, toINR } from "../lib/format";
import { computeLabRollup, flattenRollup } from "../lib/labRollup";
import { fetchAllCollectionsItems, addCollectionsItem, logCollectionsReminder, labCollectionsSummary, daysSince, agingBucket, AGING_COLORS } from "../lib/collections";
import { fetchAllInvoices, invoiceBalance, isInvoiceOpen } from "../lib/invoices";
import { useScopedCsm } from "../lib/useScopedCsm";
import ScopeToggle from "../components/ScopeToggle";
import Modal from "../components/Modal";
import InfoTip from "../components/InfoTip";

export default function CollectionsView({ labs, viewer, idByName, onOpenLab, showToast }) {
  const { isHead, scope, setScope, csmFilter, setCsmFilter, csmNames, scopeCsm, teamAll } = useScopedCsm(viewer);

  const [items, setItems] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);

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
    try {
      const [collItems, inv] = await Promise.all([fetchAllCollectionsItems(), fetchAllInvoices()]);
      setItems(collItems);
      setInvoices(inv);
    }
    catch (err) { setError(err.message || "Failed to load collections."); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!SUPABASE_CONFIGURED) {
    return <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — Collections needs a database connected.</div>;
  }
  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading collections…</div>;
  if (error) return <div className="error-banner">Couldn't load collections — {error}</div>;

  const scopeLabel = teamAll ? "the whole team" : scopeCsm;

  const allRows = computeLabRollup(labs);
  const rows = scopeCsm ? allRows.filter((r) => r.csm === scopeCsm || r.children.some((c) => c.csm === scopeCsm)) : allRows;
  const flat = flattenRollup(rows);
  const flatIds = new Set(flat.map((l) => l.id));
  const labsById = {};
  labs.forEach((l) => { labsById[l.id] = l; });

  const scoped = items.filter((i) => flatIds.has(i.labId));
  const scopedInvoices = invoices.filter((iv) => flatIds.has(iv.labId));

  // Group into one row per lab, matching the prototype's portfolio-wide Collections list —
  // itemized owed/collected detail (both pitch-add-on items and uploaded invoices) lives on
  // that lab's own Collections tab.
  const byLab = {};
  scoped.forEach((i) => { (byLab[i.labId] = byLab[i.labId] || []).push(i); });
  const invByLab = {};
  scopedInvoices.forEach((iv) => { (invByLab[iv.labId] = invByLab[iv.labId] || []).push(iv); });

  const labSummaries = Object.entries(labsById)
    .filter(([labId]) => flatIds.has(labId))
    .map(([labId, lab]) => {
      const labItems = byLab[labId] || [];
      const labInvoices = invByLab[labId] || [];
      if (!labItems.length && !labInvoices.length) return null;
      const itemSummary = labCollectionsSummary(labItems);
      const openInvoices = labInvoices.filter(isInvoiceOpen);
      const invoiceOutstanding = openInvoices.reduce((s, iv) => s + invoiceBalance(iv), 0);
      const invoiceOldestDays = openInvoices.reduce((max, iv) => Math.max(max, daysSince(iv.dueDate)), 0);
      const outstanding = itemSummary.outstanding + invoiceOutstanding;
      const openCount = itemSummary.openCount + openInvoices.length;
      const daysOverdue = Math.max(itemSummary.daysOverdue, invoiceOldestDays);
      const bucket = openCount ? agingBucket(daysOverdue) : "Current";
      const lastPayment = [itemSummary.lastPayment, ...labInvoices.map((iv) => iv.collectedAt)].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
      return { lab, labId, items: labItems, outstanding, openCount, daysOverdue, bucket, lastPayment };
    })
    .filter(Boolean)
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.outstanding - a.outstanding);

  // Labs can be in different currencies — convert each to INR before adding into the totals.
  const totalOutstanding = labSummaries.reduce((s, l) => s + toINR(l.outstanding, l.lab.region), 0);
  const overdueLabs = labSummaries.filter((l) => l.bucket === "Overdue" || l.bucket === "Critical").length;
  const criticalLabs = labSummaries.filter((l) => l.bucket === "Critical").length;

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

  async function handleLogReminder(summary) {
    try {
      await logCollectionsReminder(summary.labId, idByName[summary.lab?.csm], summary.lab?.name);
      showToast(`Reminder logged for ${summary.lab.name}.`);
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  return (
    <div>
      <h1 className="page-title">
        Collections
        <InfoTip>Upload a lab's invoice on its own Collections tab — the invoice date, amount and type (Monthly vs. one-off Pro-Rata) are read automatically and you confirm before saving. A Monthly invoice updates that lab's MRR; either type tracks what's still owed here. Due date is the invoice date plus that lab's Credit Days, not the invoice's own due date field.</InfoTip>
      </h1>
      <p className="page-sub">Outstanding dues for labs assigned to <b>{scopeLabel}</b>.</p>

      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={csmNames} />

      <div className="summary-grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginBottom: 18 }}>
        <div className="stile"><div className="sval">{fmtINR(totalOutstanding)}</div><div className="slabel">Total Outstanding</div></div>
        <div className="stile"><div className="sval" style={{ color: overdueLabs > 0 ? "var(--warn)" : "var(--text)" }}>{overdueLabs}</div><div className="slabel">Overdue Labs</div></div>
        <div className="stile"><div className="sval" style={{ color: criticalLabs > 0 ? "var(--bad)" : "var(--text)" }}>{criticalLabs}</div><div className="slabel">Critical</div></div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={() => setAddOpen(true)}>+ Add Item</button>
      </div>

      {!labSummaries.length ? (
        <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No collections items for {scopeLabel} yet.</div>
      ) : (
        <div className="table-card"><div className="table-scroll"><table className="child-mini">
          <thead><tr><th>Lab</th><th>Outstanding</th><th>Days Overdue</th><th>Status</th><th>Last Payment</th><th></th></tr></thead>
          <tbody>{labSummaries.map((s) => (
            <tr key={s.labId}>
              <td className="lab-name clickable" onClick={() => onOpenLab(s.labId)}>{s.lab.name}</td>
              <td className="mrr-cell">{fmtMoney(s.outstanding, s.lab.region)}</td>
              <td>{s.openCount ? `${s.daysOverdue}d` : "—"}</td>
              <td><span className="status-chip" style={{ background: "transparent", border: `1px solid ${AGING_COLORS[s.bucket]}`, color: AGING_COLORS[s.bucket], cursor: "default" }}>{s.bucket}</span></td>
              <td style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                {s.lastPayment ? new Date(s.lastPayment).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}
              </td>
              <td><span className="mark-purchased" onClick={() => handleLogReminder(s)}>Log Reminder</span></td>
            </tr>
          ))}</tbody>
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
            <label>Amount Owed ({addLabId && labsById[addLabId]?.region === "ROW" ? "$" : "₹"})</label>
            <input type="number" min="0" value={addAmount} onChange={(e) => setAddAmount(e.target.value)}
              style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }} />
          </div>
        )}
        {addError && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>Pick a lab, a description, and an amount (or mark it trial/free).</div>}
      </Modal>
    </div>
  );
}
