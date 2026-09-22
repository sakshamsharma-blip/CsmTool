import { useEffect, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { fmtINR, fmtMoney, toINR } from "../lib/format";
import { computeLabRollup, flattenRollup } from "../lib/labRollup";
import { fetchAllExpansionOpportunities, addExpansionOpportunity, updateExpansionOpportunity, EXPANSION_STATUSES } from "../lib/expansion";
import { useScopedCsm } from "../lib/useScopedCsm";
import ScopeToggle from "../components/ScopeToggle";
import Modal from "../components/Modal";
import InfoTip from "../components/InfoTip";

const STATUS_COLORS = { Onboarding: "var(--accent)", Pipeline: "var(--text-dim)", Live: "var(--ok)", Lost: "var(--bad)" };

const inputStyle = { width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" };

function emptyForm() {
  return { labId: "", monthlyRevenue: "", annualRevenue: "", dealWonDate: "", expectedLiveDate: "", status: "Pipeline", comments: "" };
}

export default function ExpansionView({ labs, viewer, idByName, onOpenLab, showToast }) {
  // Same CSM/Manager split every other portfolio-wide screen (Collections, Dashboard, Tasks…)
  // uses — a plain CSM sees only their own deals, a Lead/Admin defaults to their own but can
  // flip to Team View for the consolidated picture across every CSM.
  const { isHead, scope, setScope, csmFilter, setCsmFilter, csmNames, scopeCsm, teamAll } = useScopedCsm(viewer);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [formError, setFormError] = useState("");

  async function loadAll() {
    if (!SUPABASE_CONFIGURED) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchAllExpansionOpportunities());
    } catch (err) { setError(err.message || "Failed to load expansion opportunities."); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!SUPABASE_CONFIGURED) {
    return <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — Expansion needs a database connected.</div>;
  }
  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading expansion opportunities…</div>;
  if (error) return <div className="error-banner">Couldn't load expansion opportunities — {error}</div>;

  const scopeLabel = teamAll ? "the whole team" : scopeCsm;

  const allRows = computeLabRollup(labs);
  const rows = scopeCsm ? allRows.filter((r) => r.csm === scopeCsm || r.children.some((c) => c.csm === scopeCsm)) : allRows;
  const flat = flattenRollup(rows);
  const flatIds = new Set(flat.map((l) => l.id));
  const labsById = {};
  labs.forEach((l) => { labsById[l.id] = l; });

  const scoped = items.filter((i) => flatIds.has(i.labId));

  // Same "convert to INR before summing across labs" rule Collections/Total Labs use — labs can
  // be in different native currencies. MRR is summed per status from monthly_revenue; Live ARR
  // sums the deal's own annual_revenue (not monthly x 12) since that's the field CSMs actually
  // enter and it can legitimately differ from a straight x12 (e.g. a non-calendar contract term).
  function mrrSumFor(status) {
    return scoped
      .filter((i) => i.status === status)
      .reduce((s, i) => s + toINR(i.monthlyRevenue, labsById[i.labId]?.region), 0);
  }
  const onboardingMRR = mrrSumFor("Onboarding");
  const pipelineMRR = mrrSumFor("Pipeline");
  const liveMRR = mrrSumFor("Live");
  const lostMRR = mrrSumFor("Lost");
  const liveARR = scoped
    .filter((i) => i.status === "Live")
    .reduce((s, i) => s + toINR(i.annualRevenue, labsById[i.labId]?.region), 0);

  const labOptions = [];
  allRows.forEach((r) => { labOptions.push(r); r.children.forEach((c) => labOptions.push(c)); });

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm());
    setFormError("");
    setModalOpen(true);
  }
  function openEdit(item) {
    setEditingId(item.id);
    setForm({
      labId: item.labId,
      monthlyRevenue: item.monthlyRevenue ? String(item.monthlyRevenue) : "",
      annualRevenue: item.annualRevenue ? String(item.annualRevenue) : "",
      dealWonDate: item.dealWonDate || "",
      expectedLiveDate: item.expectedLiveDate || "",
      status: item.status,
      comments: item.comments || "",
    });
    setFormError("");
    setModalOpen(true);
  }
  function setField(field, value) {
    setForm((f) => {
      if (field === "monthlyRevenue") {
        // Annual auto-fills as monthly x 12 until the CSM overrides it directly — same
        // "auto-calculated but editable" convention AddLabDrawer uses for MRR/ARR.
        const autoAnnual = f.annualRevenue === "" || f.annualRevenue === String((parseFloat(f.monthlyRevenue) || 0) * 12);
        return { ...f, monthlyRevenue: value, annualRevenue: autoAnnual ? String((parseFloat(value) || 0) * 12 || "") : f.annualRevenue };
      }
      return { ...f, [field]: value };
    });
  }

  async function handleSave() {
    if (!form.labId) { setFormError("Select a lab."); return; }
    if (!form.monthlyRevenue || parseFloat(form.monthlyRevenue) <= 0) { setFormError("Enter a monthly revenue amount."); return; }
    setFormError("");
    const lab = labsById[form.labId];
    const csmId = idByName?.[lab?.csm];
    const payload = {
      labId: form.labId,
      monthlyRevenue: parseFloat(form.monthlyRevenue) || 0,
      annualRevenue: parseFloat(form.annualRevenue) || 0,
      dealWonDate: form.dealWonDate,
      expectedLiveDate: form.expectedLiveDate,
      status: form.status,
      comments: form.comments.trim(),
      csmId,
    };
    try {
      if (editingId) {
        await updateExpansionOpportunity(editingId, payload, lab?.name);
        showToast("Expansion opportunity updated.");
      } else {
        await addExpansionOpportunity(payload, lab?.name);
        showToast("Expansion opportunity added.");
      }
      setModalOpen(false);
      await loadAll();
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  return (
    <div>
      <h1 className="page-title">
        Expansion
        <InfoTip>Deal-level upsell tracking (Onboarding → Pipeline → Live → Lost) — distinct from the module/param-level Pitch Pipeline on My Portfolio. A deal here is a whole opportunity (e.g. a new branch, a bundle upgrade) rather than a single module/param add-on.</InfoTip>
      </h1>
      <p className="page-sub">Expansion opportunities for <b>{scopeLabel}</b>.</p>

      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={csmNames} />

      <div className="summary-grid" style={{ gridTemplateColumns: "repeat(5,1fr)", marginBottom: 18 }}>
        <div className="stile"><div className="sval" style={{ color: STATUS_COLORS.Onboarding }}>{fmtINR(onboardingMRR)}</div><div className="slabel">Onboarding MRR</div></div>
        <div className="stile"><div className="sval">{fmtINR(pipelineMRR)}</div><div className="slabel">Pipeline MRR</div></div>
        <div className="stile"><div className="sval" style={{ color: STATUS_COLORS.Lost }}>{fmtINR(lostMRR)}</div><div className="slabel">Lost MRR</div></div>
        <div className="stile"><div className="sval" style={{ color: STATUS_COLORS.Live }}>{fmtINR(liveMRR)}</div><div className="slabel">Live MRR</div></div>
        <div className="stile"><div className="sval" style={{ color: STATUS_COLORS.Live }}>{fmtINR(liveARR)}</div><div className="slabel">Live ARR</div></div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={openAdd}>+ Add Expansion Opportunity</button>
      </div>

      {!scoped.length ? (
        <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No expansion opportunities for {scopeLabel} yet.</div>
      ) : (
        <div className="table-card"><div className="table-scroll"><table className="child-mini">
          <thead><tr><th>Lab</th><th>Monthly Revenue</th><th>Annual Revenue</th><th>Deal Won</th><th>Expected Live</th><th>Status</th><th>Comments</th><th></th></tr></thead>
          <tbody>{scoped.map((item) => {
            const lab = labsById[item.labId];
            if (!lab) return null;
            return (
              <tr key={item.id}>
                <td className="lab-name clickable" onClick={() => onOpenLab(item.labId)}>{lab.name}</td>
                <td className="mrr-cell">{fmtMoney(item.monthlyRevenue, lab.region)}</td>
                <td className="mrr-cell">{fmtMoney(item.annualRevenue, lab.region)}</td>
                <td style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                  {item.dealWonDate ? new Date(item.dealWonDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" }) : "—"}
                </td>
                <td style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                  {item.expectedLiveDate ? new Date(item.expectedLiveDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" }) : "—"}
                </td>
                <td><span className="status-chip" style={{ background: "transparent", border: `1px solid ${STATUS_COLORS[item.status]}`, color: STATUS_COLORS[item.status], cursor: "default" }}>{item.status}</span></td>
                <td style={{ fontSize: 11.5, color: "var(--text-dim)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.comments}>{item.comments || "—"}</td>
                <td><span className="mark-purchased" onClick={() => openEdit(item)}>Edit</span></td>
              </tr>
            );
          })}</tbody>
        </table></div></div>
      )}

      <Modal
        open={modalOpen}
        title={editingId ? "Edit Expansion Opportunity" : "Add Expansion Opportunity"}
        onClose={() => setModalOpen(false)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setModalOpen(false) },
          { label: editingId ? "Save Changes" : "Add Opportunity", className: "btn-primary", onClick: handleSave },
        ]}
      >
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Lab</label>
          <select value={form.labId} onChange={(e) => setField("labId", e.target.value)} style={inputStyle} disabled={!!editingId}>
            <option value="">Select a lab…</option>
            {labOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <div className="tmpl-field" style={{ flex: 1 }}>
            <label>Monthly Revenue ({form.labId && labsById[form.labId]?.region === "ROW" ? "$" : "₹"})</label>
            <input type="number" min="0" value={form.monthlyRevenue} onChange={(e) => setField("monthlyRevenue", e.target.value)} style={inputStyle} />
          </div>
          <div className="tmpl-field" style={{ flex: 1 }}>
            <label>Annual Revenue ({form.labId && labsById[form.labId]?.region === "ROW" ? "$" : "₹"})</label>
            <input type="number" min="0" value={form.annualRevenue} onChange={(e) => setField("annualRevenue", e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <div className="tmpl-field" style={{ flex: 1 }}>
            <label>Deal Won Date</label>
            <input type="date" value={form.dealWonDate} onChange={(e) => setField("dealWonDate", e.target.value)} style={inputStyle} />
          </div>
          <div className="tmpl-field" style={{ flex: 1 }}>
            <label>Expected Live Date</label>
            <input type="date" value={form.expectedLiveDate} onChange={(e) => setField("expectedLiveDate", e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Status</label>
          <select value={form.status} onChange={(e) => setField("status", e.target.value)} style={inputStyle}>
            {EXPANSION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="tmpl-field">
          <label>Comments / Notes (optional)</label>
          <textarea rows="2" value={form.comments} onChange={(e) => setField("comments", e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        {formError && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>{formError}</div>}
      </Modal>
    </div>
  );
}
