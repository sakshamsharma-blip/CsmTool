import { useState } from "react";
import { EXPANSION_STATUSES } from "../lib/expansion";
import { pitchOptionsFor } from "../lib/pitch";
import { labSelectOptions } from "../lib/selectOptions";
import SearchSelect from "./SearchSelect";

const pickStyle = { width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", background: "var(--surface)", color: "var(--text)" };

// Side panel to add or edit one expansion. `row` = a row of buildExpansionItems, or null to add a Manual one.
// Manual: everything is edited here. Feature: its name and module come from the template and its status is its Expansion stage,
// so `onSaveFeature` sends a stage change through the usual comment dialog; here it adds the expected live date, description and charge.
export default function ExpansionDrawer({ row, deal, labOptions, labsById, modules, saving, onClose, onSaveManual, onSaveFeature }) {
  const isFeature = row?.kind === "Feature";
  const adding = !row;
  const r = row?.item?.r;
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    labId: deal?.labId || row?.labId || "",
    title: deal?.title || "",
    moduleKey: deal?.moduleKey || "",
    description: isFeature ? row.description || "" : deal?.comments || "",
    monthly: isFeature ? (row.isTrial || !row.monthly ? "" : String(row.monthly)) : deal?.monthlyRevenue ? String(deal.monthlyRevenue) : "",
    annual: deal?.annualRevenue ? String(deal.annualRevenue) : "",
    wonDate: deal?.dealWonDate || "",
    expectedLive: isFeature ? row.expectedLive || "" : deal?.expectedLiveDate || "",
    status: isFeature ? row.stage || "" : deal?.status || "Pipeline",
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  // Annual follows monthly × 12 until someone types their own.
  const setMonthly = (v) => setForm((f) => {
    const auto = f.annual === "" || f.annual === String((parseFloat(f.monthly) || 0) * 12);
    return { ...f, monthly: v, annual: auto ? String((parseFloat(v) || 0) * 12 || "") : f.annual };
  });

  const lab = labsById[form.labId];
  const sym = lab?.region === "ROW" ? "$" : "₹";
  const moduleName = modules.find((m) => m.key === row?.moduleKey)?.name || "—";
  // A charge exists only once a feature is bought: a priced one can be changed, a trial can be given one.
  const chargeEditable = isFeature && !!r?.purchased && !r?.lost && !!row.purchaseId;
  const stages = r ? pitchOptionsFor(r.purchased, r.pitch) : [];

  function save() {
    if (isFeature) {
      const amount = form.monthly === "" ? null : parseFloat(form.monthly);
      if (amount != null && (!Number.isFinite(amount) || amount < 0)) { setError("Enter a valid monthly charge."); return; }
      onSaveFeature({ expectedLive: form.expectedLive, description: form.description.trim(), amount, stage: form.status });
      return;
    }
    if (!form.labId) { setError("Select a lab."); return; }
    if (!form.title.trim()) { setError("Give the expansion a title."); return; }
    if (!(parseFloat(form.monthly) > 0)) { setError("Enter a monthly amount."); return; }
    onSaveManual({
      labId: form.labId, title: form.title.trim(), moduleKey: form.moduleKey, comments: form.description.trim(),
      monthlyRevenue: parseFloat(form.monthly) || 0, annualRevenue: parseFloat(form.annual) || 0,
      dealWonDate: form.wonDate, expectedLiveDate: form.expectedLive, status: form.status,
    });
  }

  return (
    <>
      <div className="drawer-backdrop show" onClick={onClose} />
      <div className="drawer show" role="dialog" aria-label={adding ? "Add Expansion" : "Edit Expansion"}>
        <div className="drawer-head">
          <div>
            <h2>{adding ? "Add Expansion" : "Edit Expansion"}</h2>
            <p>{isFeature ? "Comes from the lab's Adoption tab" : "Added on this page"}</p>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="drawer-body">
          <div className="form-card">
            <div className="fsection">
              <h4>Expansion Type</h4>
              <div className="hierarchy-choice" style={{ marginBottom: 0 }}>
                <div className={`hchoice${isFeature ? " selected" : ""}`} style={{ cursor: "default", opacity: isFeature ? 1 : 0.55 }}><b>Feature</b><span>From a lab's Adoption tab</span><span className="dot" /></div>
                <div className={`hchoice${!isFeature ? " selected" : ""}`} style={{ cursor: "default", opacity: !isFeature ? 1 : 0.55 }}><b>Manual</b><span>Added with Add Expansion</span><span className="dot" /></div>
              </div>
            </div>

            <div className="fsection">
              <h4>Expansion Details</h4>
              <div className="field" style={{ marginBottom: 12 }}>
                <label>Lab <span className="req">*</span></label>
                {adding
                  ? <SearchSelect value={form.labId} onChange={(v) => set("labId", v)} options={labSelectOptions(labOptions)} placeholder="Search a lab…" inputStyle={pickStyle} />
                  : <input readOnly value={lab?.name || ""} />}
              </div>
              <div className="field" style={{ marginBottom: 12 }}>
                <label>Expansion Title <span className="req">*</span></label>
                {isFeature
                  ? <input readOnly value={row.title} />
                  : <input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="What is being expanded, e.g. Extra logins" />}
              </div>
              <div className="field" style={{ marginBottom: 12 }}>
                <label>Category / Module</label>
                {isFeature
                  ? <input readOnly value={moduleName} />
                  : (
                    <select value={form.moduleKey} onChange={(e) => set("moduleKey", e.target.value)}>
                      <option value="">Not tied to a module</option>
                      {modules.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                    </select>
                  )}
              </div>
              <div className="field">
                <label>Description / Scope</label>
                <textarea rows="2" value={form.description} onChange={(e) => set("description", e.target.value)} style={{ resize: "vertical" }} />
              </div>
            </div>

            <div className="fsection">
              <h4>Commercial Details</h4>
              <div className="frow two">
                <div className="field">
                  <label>Monthly MRR ({sym}){!isFeature && <span className="req"> *</span>}</label>
                  {isFeature && !chargeEditable
                    ? <input readOnly value={row.monthly ? row.monthly : ""} placeholder={r?.lost ? "Lost" : "Set when purchased"} />
                    : <input type="number" min="0" value={form.monthly} placeholder={row?.isTrial ? "Trial — add a charge" : undefined} onChange={(e) => (isFeature ? set("monthly", e.target.value) : setMonthly(e.target.value))} />}
                </div>
                <div className="field">
                  <label>Annual Value ({sym})</label>
                  {isFeature
                    ? <input readOnly value={(parseFloat(form.monthly) || row.monthly || 0) * 12 || ""} />
                    : <input type="number" min="0" value={form.annual} onChange={(e) => set("annual", e.target.value)} />}
                </div>
              </div>
              <div className="hint" style={{ fontSize: 11, color: "var(--text-faint)" }}>Counts in Expansion MRR only. A lab's own MRR follows its invoices.</div>
            </div>

            <div className="fsection">
              <h4>Timeline &amp; Status</h4>
              <div className="frow two">
                <div className="field">
                  <label>Status <span className="req">*</span></label>
                  {isFeature ? (
                    r ? (
                      <select value={form.status} onChange={(e) => set("status", e.target.value)}>
                        {stages.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : <input readOnly value={row.status} />
                  ) : (
                    <select value={form.status} onChange={(e) => set("status", e.target.value)}>
                      {EXPANSION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                  {isFeature && r && <div className="hint">Saving a new stage asks for a comment, like on the Adoption tab.</div>}
                </div>
                <div className="field">
                  <label>Expected Live Date</label>
                  <input type="date" value={form.expectedLive} onChange={(e) => set("expectedLive", e.target.value)} />
                </div>
              </div>
              <div className="frow two">
                <div className="field">
                  <label>{isFeature ? "Purchased On" : "Deal Won Date"}</label>
                  {isFeature ? <input readOnly value={row.startedOn || "—"} /> : <input type="date" value={form.wonDate} onChange={(e) => set("wonDate", e.target.value)} />}
                </div>
                <div className="field">
                  <label>Owner (CSM)</label>
                  <input readOnly value={lab?.csm || "—"} />
                  <div className="hint">The lab's CSM. Change it with Reassign CSM.</div>
                </div>
              </div>
            </div>
            {error && <div style={{ color: "var(--bad)", fontSize: 12 }}>{error}</div>}
          </div>
        </div>
        <div className="drawer-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : adding ? "Add Expansion" : "Update Expansion"}</button>
        </div>
      </div>
    </>
  );
}
