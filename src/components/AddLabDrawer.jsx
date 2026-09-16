import { useEffect, useMemo, useState } from "react";
import { fmtMoney, toINR, segmentFor, nativeCurrency } from "../lib/format";

const SEG_LABELS = { A: "Enterprise", B: "Premium", C: "Advance", D: "Standard", E: "Essential" };

export default function AddLabDrawer({ open, onClose, onSave, labs, csmNames, plans, presetParent }) {
  const [hierarchy, setHierarchy] = useState("parent");
  const [form, setForm] = useState(initialForm(csmNames, plans));
  const [saveError, setSaveError] = useState("");

  // Re-seed defaults whenever the roster/plans change (e.g. right after adding a CSM) so the
  // dropdowns aren't stuck on a stale default.
  useMemo(() => {
    setForm((f) => ({ ...f, csm: f.csm || csmNames[0] || "", plan: f.plan || plans[0]?.id || "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csmNames.length, plans.length]);

  // Every time the drawer opens, start from a clean slate — either blank ("+ Add New Lab" from
  // the Sidebar/Total Labs) or, when opened via "+ Add Child Lab" on a parent's own Child Labs
  // tab, pre-set to Child Lab with that parent selected and its CSM/region/plan/billing details
  // carried over as sensible defaults (all still editable before saving).
  useEffect(() => {
    if (!open) return;
    setSaveError("");
    if (presetParent) {
      setHierarchy("child");
      setForm({
        ...initialForm(csmNames, plans),
        parentId: presetParent.id,
        csm: presetParent.csm || csmNames[0] || "",
        plan: presetParent.plan || plans[0]?.id || "",
        region: presetParent.region || "Domestic",
        city: presetParent.city || "",
        state: presetParent.state || "",
        country: presetParent.country || "",
        creditDays: presetParent.creditDays || "30",
        billingType: presetParent.billingType || "Fixed",
        paymentCycle: presetParent.paymentCycle || "Monthly",
      });
    } else {
      setHierarchy("parent");
      setForm(initialForm(csmNames, plans));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetParent]);

  if (!open) return null;

  const mrr = parseFloat(form.mrr) || 0;
  const arr = mrr * 12;
  const currency = nativeCurrency(form.region);
  const currencySymbol = currency === "USD" ? "$" : "₹";
  const seg = segmentFor(toINR(mrr, form.region));
  // Existing labs may be in either currency — normalize to INR before adding this one in.
  const totalManaged = labs.reduce((s, r) => s + toINR(r.mrr || 0, r.region), 0) + toINR(mrr, form.region);
  const weight = totalManaged ? (toINR(mrr, form.region) / totalManaged) * 100 : 0;
  const parents = labs.filter((l) => l.type === "Parent");

  function set(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  // "Save & Add Another" after a preset-parent add (adding several child labs in a row under
  // the same parent) should stay on that parent rather than snapping back to a blank Parent Lab
  // form — only a plain "+ Add New Lab" open resets all the way to blank.
  function reset() {
    if (presetParent) {
      setHierarchy("child");
      setForm({
        ...initialForm(csmNames, plans),
        parentId: presetParent.id,
        csm: presetParent.csm || csmNames[0] || "",
        plan: presetParent.plan || plans[0]?.id || "",
        region: presetParent.region || "Domestic",
        city: presetParent.city || "",
        state: presetParent.state || "",
        country: presetParent.country || "",
        creditDays: presetParent.creditDays || "30",
        billingType: presetParent.billingType || "Fixed",
        paymentCycle: presetParent.paymentCycle || "Monthly",
      });
    } else {
      setForm(initialForm(csmNames, plans));
      setHierarchy("parent");
    }
  }

  function handleSave(addAnother) {
    if (!form.id.trim() || !form.name.trim()) {
      setSaveError("Lab ID and Lab Name are required.");
      return;
    }
    const trimmedId = form.id.trim();
    if (labs.some((l) => l.id.trim().toLowerCase() === trimmedId.toLowerCase())) {
      setSaveError(`Lab ID "${trimmedId}" is already in use — every lab (parent or child) needs a unique Lab ID.`);
      return;
    }
    if (hierarchy === "child" && !form.parentId) {
      setSaveError(parents.length ? "Select which parent lab this lab goes under." : "No parent labs exist yet — create the parent lab first, then add this as a Child Lab under it.");
      return;
    }
    if (form.creditDays.trim() === "") {
      setSaveError("Credit Days is required — enter 0 if this lab has no credit period.");
      return;
    }
    setSaveError("");
    const lab = {
      id: form.id.trim(), name: form.name.trim(), type: hierarchy === "child" ? "Child" : "Parent",
      parent: hierarchy === "child" ? form.parentId : null,
      csm: form.csm, plan: form.plan,
      region: form.region, city: form.city.trim(), state: form.state.trim() || "—", country: form.country.trim() || "—",
      mrr, status: "Active",
      creditDays: form.creditDays, billingType: form.billingType, paymentCycle: form.paymentCycle,
      remarks: form.remarks.trim(),
    };
    onSave(lab);
    reset();
    if (!addAnother) onClose();
  }

  return (
    <>
      <div className="drawer-backdrop show" onClick={onClose} />
      <div className="drawer show">
        <div className="drawer-head">
          <div>
            <h2>{presetParent ? `Add Child Lab under ${presetParent.name}` : "Add New Lab"}</h2>
            <p>{presetParent ? `Customer Master > Total Labs > ${presetParent.name} > Add Child Lab` : "Customer Master > Total Labs > Add New Lab"}</p>
          </div>
          <button className="drawer-close" onClick={onClose}>&times;</button>
        </div>
        <div className="drawer-body">
          {saveError && <div className="warn-banner" style={{ background: "var(--bad-bg)", color: "var(--bad)", borderColor: "#f3b8b8", marginBottom: 14 }}>{saveError}</div>}
          <div className="form-card">
            <div className="fsection">
              <h4>1. Lab Hierarchy</h4>
              <div className="hierarchy-choice">
                <div className={`hchoice${hierarchy === "parent" ? " selected" : ""}`} onClick={() => setHierarchy("parent")}>
                  <div className="dot"></div><b>Parent Lab</b><span>Main lab or group</span>
                </div>
                <div className={`hchoice${hierarchy === "child" ? " selected" : ""}`} onClick={() => setHierarchy("child")}>
                  <div className="dot"></div><b>Child Lab</b><span>Branch or center under a parent lab</span>
                </div>
              </div>
              {hierarchy === "child" && (
                <div className="field">
                  <label>Parent Lab (if Child Lab)</label>
                  <select value={form.parentId} onChange={(e) => set("parentId", e.target.value)}>
                    <option value="">{parents.length ? "Select a parent lab…" : "No parent labs yet — create one first"}</option>
                    {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <div className="hint">Select the parent lab this lab will be created under.</div>
                </div>
              )}
            </div>

            <div className="fsection">
              <h4>2. Basic Information</h4>
              <div className="frow">
                <div className="field"><label>Lab ID <span className="req">*</span></label>
                  <input value={form.id} onChange={(e) => set("id", e.target.value)} placeholder="Enter unique Lab ID" /></div>
                <div className="field"><label>Lab Name <span className="req">*</span></label>
                  <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Enter Lab Name" /></div>
              </div>
              <div className="frow">
                <div className="field"><label>CSM Name <span className="req">*</span></label>
                  <select value={form.csm} onChange={(e) => set("csm", e.target.value)}>
                    {csmNames.map((n) => <option key={n}>{n}</option>)}
                  </select>
                </div>
                <div className="field"><label>Region Category <span className="req">*</span></label>
                  <select value={form.region} onChange={(e) => set("region", e.target.value)}>
                    <option>Domestic</option><option>ROW</option>
                  </select>
                </div>
              </div>
              <div className="frow">
                <div className="field"><label>Plan <span className="req">*</span></label>
                  <select value={form.plan} onChange={(e) => set("plan", e.target.value)}>
                    {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="frow">
                <div className="field"><label>City <span className="req">*</span></label>
                  <input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Enter City" /></div>
                <div className="field"><label>State <span className="req">*</span></label>
                  <input value={form.state} onChange={(e) => set("state", e.target.value)} placeholder="Enter State" /></div>
              </div>
              <div className="frow two">
                <div className="field"><label>Country <span className="req">*</span></label>
                  <input value={form.country} onChange={(e) => set("country", e.target.value)} placeholder="Enter Country" /></div>
                <div className="field"><label>Client Segment</label><input readOnly value={mrr ? `${seg.code} — ${SEG_LABELS[seg.code]}` : "Auto calculated"} /></div>
              </div>
            </div>

            <div className="fsection">
              <h4>3. Billing &amp; Payment Information</h4>
              <div className="frow">
                <div className="field"><label>Credit Days <span className="req">*</span></label>
                  <input
                    type="number" min="0" step="1" inputMode="numeric"
                    value={form.creditDays}
                    onChange={(e) => set("creditDays", e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="e.g. 30"
                  />
                </div>
                <div className="field"><label>Billing Type <span className="req">*</span></label>
                  <select value={form.billingType} onChange={(e) => set("billingType", e.target.value)}>
                    <option>Fixed</option><option>Variable</option>
                  </select>
                </div>
              </div>
              <div className="frow two">
                <div className="field"><label>Payment Cycle <span className="req">*</span></label>
                  <select value={form.paymentCycle} onChange={(e) => set("paymentCycle", e.target.value)}>
                    <option>Monthly</option><option>Quarterly</option><option>Half Yearly</option><option>Annual</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="fsection">
              <h4>4. Revenue Information</h4>
              <div className="frow two">
                <div className="field"><label>Current MRR ({currencySymbol}) <span className="req">*</span></label>
                  <input type="number" value={form.mrr} onChange={(e) => set("mrr", e.target.value)} placeholder={`Enter Monthly Recurring Revenue in ${currency}`} />
                  <div className="hint">
                    Enter amount without commas, in {currency} ({form.region} labs bill in {currency}). Example: 90000
                    {mrr > 0 && <> — {fmtMoney(mrr, form.region)}</>}
                  </div></div>
                <div className="field"><label>Current ARR ({currencySymbol})</label><input readOnly value={mrr ? fmtMoney(arr, form.region) : "Auto calculated (MRR × 12)"} /></div>
              </div>
              <div className="side-card" style={{ marginTop: 4 }}>
                <h4>Segment Guide (based on MRR)</h4>
                <div className="seg-row"><span><span className="seg-badge" style={{ background: "var(--segA)" }}>A</span> ≥ ₹90,000</span><span>Enterprise</span></div>
                <div className="seg-row"><span><span className="seg-badge" style={{ background: "var(--segB)" }}>B</span> ₹50K–89,999</span><span>Premium</span></div>
                <div className="seg-row"><span><span className="seg-badge" style={{ background: "var(--segC)" }}>C</span> ₹25K–49,999</span><span>Advance</span></div>
                <div className="seg-row"><span><span className="seg-badge" style={{ background: "var(--segD)" }}>D</span> ₹15K–24,999</span><span>Standard</span></div>
                <div className="seg-row"><span><span className="seg-badge" style={{ background: "var(--segE)" }}>E</span> &lt; ₹15,000</span><span>Essential</span></div>
              </div>
            </div>

            <div className="fsection">
              <h4>5. Additional Information</h4>
              <div className="field"><label>Remarks</label>
                <textarea rows="2" maxLength="500" value={form.remarks} onChange={(e) => set("remarks", e.target.value)} placeholder="Enter any additional notes about the lab (optional)" /></div>
            </div>

            <div className="side-card">
              <h4>Automation Preview</h4>
              <ul className="autoprev" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                <li>Segment will be auto-calculated based on MRR</li>
                <li>ARR will be calculated as MRR × 12</li>
                <li>Account weightage calculated from total managed MRR</li>
                <li>All values can be edited after saving</li>
              </ul>
              <div className="calc-summary">
                <div className="row"><span>ARR</span><b>{fmtMoney(arr, form.region)}</b></div>
                <div className="row"><span>Segment</span><b>{mrr ? seg.code : "—"}</b></div>
                <div className="row"><span>Account Weightage</span><b>{weight.toFixed(1)}%</b></div>
              </div>
            </div>
          </div>
        </div>
        <div className="drawer-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-ghost" onClick={() => handleSave(true)}>Save &amp; Add Another</button>
          <button className="btn btn-primary" onClick={() => handleSave(false)}>Save Lab</button>
        </div>
      </div>
    </>
  );
}

function initialForm(csmNames, plans) {
  return {
    id: "", name: "", parentId: "", csm: csmNames[0] || "", region: "Domestic", plan: plans[0]?.id || "",
    city: "", state: "", country: "", creditDays: "30", billingType: "Fixed", paymentCycle: "Monthly",
    mrr: "", remarks: "",
  };
}
