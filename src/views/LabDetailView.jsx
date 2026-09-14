import { useEffect, useMemo, useState } from "react";
import { supabase, SUPABASE_CONFIGURED } from "../supabaseClient";
import { fmtINR, segmentFor } from "../lib/format";
import { planIncludesModule, planIncludesParam } from "../lib/plans";
import {
  STATUS_ORDER, EXP_STAGES, defaultParamState,
  fetchLabAdoption, saveLabAdoption, computeLabScores,
} from "../lib/adoption";
import { fetchLabActivity, logActivity, ACTIVITY_ICONS } from "../lib/activity";
import {
  fetchAllCollectionsItems, addCollectionsItem, markItemCollected, resolveConflict,
  logCollectionsReminder, labCollectionsSummary, AGING_COLORS,
} from "../lib/collections";
import Modal from "../components/Modal";

const SEG_NAME = { A: "Enterprise", B: "Premium", C: "Advance", D: "Standard", E: "Essential" };
const EMPTY_ADOPTION = { scope: {}, paramScope: {}, paramState: {} };

function statusPillClass(s) { return "status-" + s.replace(" ", ""); }
function initials(name) { return (name || "").split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase(); }

export default function LabDetailView({ lab, labs, modules, plans, csmNames, currentCSM, idByName, onBack, onOpenLab, onReassignCsm, onChangePlan, onLogCheckin, initialTab, showToast }) {
  const [tab, setTab] = useState(initialTab || "details");
  const [expandedModule, setExpandedModule] = useState(null);

  const [saved, setSaved] = useState(EMPTY_ADOPTION);
  const [loadingAdoption, setLoadingAdoption] = useState(SUPABASE_CONFIGURED);
  const [adoptionError, setAdoptionError] = useState(null);
  const [draftScope, setDraftScope] = useState({});
  const [draftParamScope, setDraftParamScope] = useState({});
  const [draftParams, setDraftParams] = useState({});
  const [saving, setSaving] = useState(false);

  const [activity, setActivity] = useState([]);
  const [loadingActivity, setLoadingActivity] = useState(SUPABASE_CONFIGURED);
  const [activityError, setActivityError] = useState(null);

  const [collItems, setCollItems] = useState([]);
  const [loadingColl, setLoadingColl] = useState(SUPABASE_CONFIGURED);
  const [collError, setCollError] = useState(null);
  const [collManualInputs, setCollManualInputs] = useState({});
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [addItemLabel, setAddItemLabel] = useState("");
  const [addItemAmount, setAddItemAmount] = useState("");
  const [addItemTrial, setAddItemTrial] = useState(false);
  const [addItemError, setAddItemError] = useState(false);
  const [resolveItem, setResolveItem] = useState(null);
  const [resolveComment, setResolveComment] = useState("");
  const [resolveError, setResolveError] = useState(false);

  const nameById = {};
  Object.entries(idByName || {}).forEach(([n, id]) => { nameById[id] = n; });

  const [newCsm, setNewCsm] = useState(lab.csm);
  const [newPlan, setNewPlan] = useState(lab.plan);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [cascadeReassign, setCascadeReassign] = useState(false);
  const [changePlanOpen, setChangePlanOpen] = useState(false);
  const [cascadePlan, setCascadePlan] = useState(false);
  const [planReason, setPlanReason] = useState("");

  useEffect(() => {
    setTab(initialTab || "details");
    setExpandedModule(null);
    setDraftScope({});
    setDraftParamScope({});
    setDraftParams({});
    setNewCsm(lab.csm);
    setNewPlan(lab.plan);
    setReassignOpen(false);
    setChangePlanOpen(false);
    setCascadeReassign(false);
    setCascadePlan(false);
    setPlanReason("");
    if (!SUPABASE_CONFIGURED) {
      setSaved(EMPTY_ADOPTION);
      setLoadingAdoption(false);
      return;
    }
    let cancelled = false;
    setLoadingAdoption(true);
    setAdoptionError(null);
    fetchLabAdoption(lab.id)
      .then((data) => { if (!cancelled) setSaved(data); })
      .catch((err) => { if (!cancelled) setAdoptionError(err.message || "Failed to load adoption data."); })
      .finally(() => { if (!cancelled) setLoadingAdoption(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lab.id]);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) {
      setActivity([]);
      setLoadingActivity(false);
      return;
    }
    let cancelled = false;
    setLoadingActivity(true);
    setActivityError(null);
    fetchLabActivity(lab.id)
      .then((rows) => { if (!cancelled) setActivity(rows); })
      .catch((err) => { if (!cancelled) setActivityError(err.message || "Failed to load activity."); })
      .finally(() => { if (!cancelled) setLoadingActivity(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lab.id]);

  async function loadCollections() {
    if (!SUPABASE_CONFIGURED) { setCollItems([]); setLoadingColl(false); return; }
    setLoadingColl(true);
    setCollError(null);
    try {
      const all = await fetchAllCollectionsItems();
      setCollItems(all.filter((i) => i.labId === lab.id));
    } catch (err) {
      setCollError(err.message || "Failed to load collections.");
    } finally {
      setLoadingColl(false);
    }
  }
  useEffect(() => {
    loadCollections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lab.id]);

  async function handleMarkItemCollected(item) {
    const val = parseFloat(collManualInputs[item.id]);
    if (!val || val < 0) { showToast("Enter a valid amount."); return; }
    try {
      const status = await markItemCollected(item.id, val, item.amount, lab.id, idByName?.[lab.csm]);
      await loadCollections();
      showToast(status === "Matched" ? "Collected — matches Zoho." : "Collected — doesn't match Zoho, flagged as a conflict.");
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  async function handleResolveConflict() {
    if (!resolveComment.trim()) { setResolveError(true); return; }
    try {
      await resolveConflict(resolveItem.id, resolveComment.trim(), lab.id, idByName?.[lab.csm]);
      setResolveItem(null); setResolveComment(""); setResolveError(false);
      await loadCollections();
      showToast("Conflict resolved.");
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  async function handleLogReminder() {
    try {
      await logCollectionsReminder(lab.id, idByName?.[lab.csm], lab.name);
      setActivity((a) => [
        { id: "tmp" + Date.now(), source: "system", kind: "Collections Reminder", title: "Reminder sent", meta: `Payment reminder logged for ${lab.name}`, csm_id: idByName?.[lab.csm], created_at: new Date().toISOString() },
        ...a,
      ]);
      showToast("Reminder logged.");
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  async function handleAddCollItem() {
    if (!addItemLabel.trim()) { setAddItemError(true); return; }
    if (!addItemTrial && (!addItemAmount || parseFloat(addItemAmount) <= 0)) { setAddItemError(true); return; }
    try {
      await addCollectionsItem({
        labId: lab.id, moduleKey: null, paramName: null, label: addItemLabel.trim(),
        amount: addItemTrial ? 0 : parseFloat(addItemAmount), isTrial: addItemTrial, csmId: idByName?.[lab.csm],
      });
      setAddItemOpen(false); setAddItemLabel(""); setAddItemAmount(""); setAddItemTrial(false); setAddItemError(false);
      await loadCollections();
      showToast("Collections item added.");
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  const plan = plans.find((p) => p.id === lab.plan) || plans[0];
  const hasDraftChanges =
    Object.keys(draftScope).length > 0 || Object.keys(draftParamScope).length > 0 || Object.keys(draftParams).length > 0;

  function paramDefOf(moduleKey, paramName) {
    const mod = modules.find((m) => m.key === moduleKey);
    return mod && mod.params.find((p) => p.name === paramName);
  }
  function effectiveScope(moduleKey) {
    if (Object.prototype.hasOwnProperty.call(draftScope, moduleKey)) return draftScope[moduleKey];
    if (Object.prototype.hasOwnProperty.call(saved.scope, moduleKey)) return saved.scope[moduleKey];
    return planIncludesModule(plan, moduleKey);
  }
  function effectiveParamScope(moduleKey, paramName) {
    const key = `${moduleKey}|${paramName}`;
    if (Object.prototype.hasOwnProperty.call(draftParamScope, key)) return draftParamScope[key];
    if (Object.prototype.hasOwnProperty.call(saved.paramScope, key)) return saved.paramScope[key];
    return planIncludesParam(plan, moduleKey, paramName);
  }
  function effectiveParamState(moduleKey, paramName) {
    const key = `${moduleKey}|${paramName}`;
    const base = saved.paramState[key] || defaultParamState(paramDefOf(moduleKey, paramName));
    const draft = draftParams[key];
    return draft ? { ...base, ...draft } : base;
  }

  const scores = useMemo(
    () => computeLabScores(modules, effectiveScope, effectiveParamScope, effectiveParamState),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modules, saved, draftScope, draftParamScope, draftParams, plan]
  );

  function effectiveMRR(l) {
    if (l.type === "Parent") {
      const children = labs.filter((c) => c.type === "Child" && c.parent === l.id);
      if (children.length) return children.reduce((s, c) => s + (c.mrr || 0), 0);
    }
    return l.mrr || 0;
  }

  function guardedNav(fn) {
    if (hasDraftChanges && !window.confirm("You have unsaved adoption changes for this lab — discard them?")) return;
    fn();
  }

  function updateDraftParam(key, patch) {
    setDraftParams((d) => ({ ...d, [key]: { ...(d[key] || {}), ...patch } }));
  }
  function handleSetStatus(moduleKey, paramName, status) {
    updateDraftParam(`${moduleKey}|${paramName}`, { status });
  }
  function handleToggleIncluded(moduleKey, paramName) {
    const current = effectiveParamState(moduleKey, paramName);
    updateDraftParam(`${moduleKey}|${paramName}`, {
      included: !current.included,
      status: !current.included ? "Not Started" : current.status,
    });
  }
  function handleSetExpValue(moduleKey, paramName, raw) {
    updateDraftParam(`${moduleKey}|${paramName}`, { expValue: raw === "" ? null : Number(raw) });
  }
  function handleSetExpStage(moduleKey, paramName, stage) {
    updateDraftParam(`${moduleKey}|${paramName}`, { expStage: stage });
  }
  function handleToggleScope(moduleKey) {
    setDraftScope((d) => ({ ...d, [moduleKey]: !effectiveScope(moduleKey) }));
  }
  function handleToggleParamScope(moduleKey, paramName) {
    const key = `${moduleKey}|${paramName}`;
    setDraftParamScope((d) => ({ ...d, [key]: !effectiveParamScope(moduleKey, paramName) }));
  }

  async function handleSaveAdoption() {
    setSaving(true);
    try {
      if (SUPABASE_CONFIGURED) {
        await saveLabAdoption(lab.id, {
          plan, modules, saved,
          draft: { scope: draftScope, paramScope: draftParamScope, params: draftParams },
        });
      }
      setSaved((s) => {
        const nextParamState = { ...s.paramState };
        Object.entries(draftParams).forEach(([key, delta]) => {
          const [moduleKey, paramName] = key.split("|");
          const base = nextParamState[key] || defaultParamState(paramDefOf(moduleKey, paramName));
          nextParamState[key] = { ...base, ...delta };
        });
        return {
          scope: { ...s.scope, ...draftScope },
          paramScope: { ...s.paramScope, ...draftParamScope },
          paramState: nextParamState,
        };
      });
      const paramChanges = Object.values(draftParams).filter((v) => v.status !== undefined).length;
      const purchasedChanges = Object.values(draftParams).filter((v) => v.included !== undefined).length;
      const scopeChanges = Object.keys(draftScope).length;
      const paramScopeChanges = Object.keys(draftParamScope).length;
      setDraftScope({});
      setDraftParamScope({});
      setDraftParams({});
      showToast("Adoption changes saved.");

      const parts = [];
      if (paramChanges) parts.push(`${paramChanges} status change${paramChanges > 1 ? "s" : ""}`);
      if (purchasedChanges) parts.push(`${purchasedChanges} param${purchasedChanges > 1 ? "s" : ""} included/purchased`);
      if (scopeChanges) parts.push(`${scopeChanges} module scope change${scopeChanges > 1 ? "s" : ""}`);
      if (paramScopeChanges) parts.push(`${paramScopeChanges} feature scope change${paramScopeChanges > 1 ? "s" : ""}`);
      if (SUPABASE_CONFIGURED && parts.length) {
        const csmId = idByName?.[currentCSM];
        logActivity(lab.id, { kind: "Adoption Updated", title: "Adoption updated", meta: parts.join(", "), csmId })
          .then(() => setActivity((a) => [
            { id: "tmp" + Date.now(), source: "system", kind: "Adoption Updated", title: "Adoption updated", meta: parts.join(", "), csm_id: csmId, created_at: new Date().toISOString() },
            ...a,
          ]))
          .catch((err) => console.error(err));
      }
    } catch (err) {
      console.error(err);
      showToast(`⚠ Not saved to the database — ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  function handleDiscardAdoption() {
    setDraftScope({});
    setDraftParamScope({});
    setDraftParams({});
    showToast("Unsaved adoption changes discarded.");
  }

  async function handleResetToPlanDefaults() {
    if (!window.confirm(`Reset all scope customizations for ${lab.name} back to the ${plan.name} plan defaults?`)) return;
    try {
      if (SUPABASE_CONFIGURED) {
        const [{ error: e1 }, { error: e2 }] = await Promise.all([
          supabase.from("scope_overrides").delete().eq("lab_id", lab.id),
          supabase.from("param_scope_overrides").delete().eq("lab_id", lab.id),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;
      }
    } catch (err) {
      console.error(err);
      showToast(`⚠ Reset not saved to the database — ${err.message}`);
      return;
    }
    setSaved((s) => ({ ...s, scope: {}, paramScope: {} }));
    setDraftScope({});
    setDraftParamScope({});
    showToast(`Reset to ${plan.name} defaults.`);
  }

  async function handleReassignClick() {
    const oldCsm = lab.csm;
    const extraIds = cascadeReassign ? children.map((c) => c.id) : [];
    await onReassignCsm(lab.id, newCsm, extraIds);
    setReassignOpen(false);
    setCascadeReassign(false);
    if (SUPABASE_CONFIGURED && oldCsm !== newCsm) {
      const csmId = idByName?.[newCsm];
      const meta = `${oldCsm} → ${newCsm}` + (extraIds.length ? ` (+ ${extraIds.length} child lab${extraIds.length > 1 ? "s" : ""})` : "");
      logActivity(lab.id, { kind: "Lab Reassigned", title: "CSM reassigned", meta, csmId })
        .then(() => setActivity((a) => [
          { id: "tmp" + Date.now(), source: "system", kind: "Lab Reassigned", title: "CSM reassigned", meta, csm_id: csmId, created_at: new Date().toISOString() },
          ...a,
        ]))
        .catch((err) => console.error(err));
    }
  }

  async function handleChangePlanClick() {
    const oldPlanName = plan.name;
    const newPlanName = plans.find((p) => p.id === newPlan)?.name || newPlan;
    const extraIds = cascadePlan ? children.map((c) => c.id) : [];
    await onChangePlan(lab.id, newPlan, extraIds);
    setChangePlanOpen(false);
    setCascadePlan(false);
    if (SUPABASE_CONFIGURED && lab.plan !== newPlan) {
      const csmId = idByName?.[lab.csm];
      let meta = `${oldPlanName} → ${newPlanName}`;
      if (extraIds.length) meta += ` (+ ${extraIds.length} child lab${extraIds.length > 1 ? "s" : ""})`;
      if (planReason.trim()) meta += ` — ${planReason.trim()}`;
      logActivity(lab.id, { kind: "Plan Changed", title: "Plan changed", meta, csmId })
        .then(() => setActivity((a) => [
          { id: "tmp" + Date.now(), source: "system", kind: "Plan Changed", title: "Plan changed", meta, csm_id: csmId, created_at: new Date().toISOString() },
          ...a,
        ]))
        .catch((err) => console.error(err));
    }
    setPlanReason("");
  }

  const seg = segmentFor(effectiveMRR(lab));
  const children = lab.type === "Parent" ? labs.filter((l) => l.type === "Child" && l.parent === lab.id) : [];
  const tabs = [
    { key: "details", label: "Lab Details" },
    ...(lab.type === "Parent" ? [{ key: "childlabs", label: `Child Labs (${children.length})` }] : []),
    { key: "adoption", label: "Adoption" },
    { key: "collections", label: `Collections${collItems.length ? ` (${collItems.length})` : ""}` },
    { key: "history", label: `Lab History${activity.length ? ` (${activity.length})` : ""}` },
  ];

  const inScopeResults = scores.moduleResults.filter((m) => m.inScope);
  const outOfScopeCount = scores.moduleResults.length - inScopeResults.length;
  const fullyAdopted = inScopeResults.filter((m) => (m.mandPct || 0) >= 91).length;
  const inProgress = inScopeResults.filter((m) => (m.mandPct || 0) > 0 && (m.mandPct || 0) < 91).length;
  const notStarted = inScopeResults.filter((m) => !(m.mandPct > 0)).length;
  const planDeviations = modules.filter((mod) => effectiveScope(mod.key) !== planIncludesModule(plan, mod.key));
  const expansionPipeline = modules.reduce((sum, mod) => {
    if (!effectiveScope(mod.key)) return sum;
    return sum + mod.params.reduce((s2, p) => {
      if (!effectiveParamScope(mod.key, p.name)) return s2;
      const st = effectiveParamState(mod.key, p.name);
      return s2 + (!st.included ? st.expValue || 0 : 0);
    }, 0);
  }, 0);
  const ringColor =
    scores.mandatoryPct >= 76 ? "var(--ok)" : scores.mandatoryPct >= 51 ? "var(--accent)" : scores.mandatoryPct >= 26 ? "var(--warn)" : "var(--bad)";

  return (
    <div>
      <div className="crumb">
        <a onClick={() => guardedNav(onBack)}>Customer Master &gt; Total Labs</a> &gt; <span>{lab.name}</span>
      </div>

      <div className="detail-head">
        <div className="detail-avatar">{initials(lab.name)}</div>
        <div>
          <div className="detail-title">
            <h1>{lab.name}</h1>
            <span className={`status-pill ${statusPillClass(lab.status)}`}>{lab.status}</span>
          </div>
        </div>
        <div className="detail-meta">
          <div className="m"><div>Lab ID</div><div>{lab.id}</div></div>
          <div className="m"><div>Type</div><div>{lab.type} Lab</div></div>
          <div className="m"><div>CSM</div><div>{lab.csm}</div></div>
          <div className="m"><div>Plan</div><div>{plan.name}</div></div>
          <div className="m"><div>Segment</div><div>{seg.code} — {SEG_NAME[seg.code]}</div></div>
          <div className="m"><div>Current MRR</div><div>{fmtINR(effectiveMRR(lab))}</div></div>
          <div className="m"><div>Current ARR</div><div>{fmtINR(effectiveMRR(lab) * 12)}</div></div>
          <div className="m"><div>City, State</div><div>{lab.city ? lab.city + ", " : ""}{lab.state}</div></div>
        </div>
        <div style={{ display: "flex", gap: 8, flex: "none" }}>
          {SUPABASE_CONFIGURED && onLogCheckin && (
            <button className="btn btn-primary" onClick={() => guardedNav(onLogCheckin)}>+ Log Check-in</button>
          )}
          <button className="btn btn-ghost" onClick={() => guardedNav(onBack)}>&larr; Back to Total Labs</button>
        </div>
      </div>

      <div className="tabbar">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`tabbtn${tab === t.key ? " active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "details" && (
        <div className="table-card" style={{ padding: "6px 20px 20px" }}>
          {[
            ["Lab Name", lab.name], ["Lab ID", lab.id], ["Lab Type", lab.type + " Lab"],
            ["Parent Lab", lab.parent ? (labs.find((l) => l.id === lab.parent) || {}).name || lab.parent : "—"],
            ["CSM Name", lab.csm], ["Region Category", lab.region], ["City", lab.city || "—"], ["State", lab.state],
            ["Country", lab.country], ["Client Segment", `${seg.code} — ${SEG_NAME[seg.code]}`],
            ["Credit Days", lab.creditDays || "30"], ["Billing Type", lab.billingType || "Variable"],
            ["Payment Cycle", lab.paymentCycle || "Monthly"], ["Current MRR", fmtINR(effectiveMRR(lab))],
            ["Current ARR", fmtINR(effectiveMRR(lab) * 12)], ["Status", lab.status], ["Remarks", lab.remarks || "—"],
          ].map(([k, v]) => (
            <div key={k} className="param-row" style={{ padding: "11px 0" }}>
              <span className="pname" style={{ color: "var(--text-dim)", flex: "0 0 180px" }}>{k}</span>
              <span style={{ fontWeight: 600 }}>{v}</span>
            </div>
          ))}

          <div style={{ display: "flex", gap: 10, marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={() => { setNewCsm(lab.csm); setReassignOpen(true); }}>Reassign CSM</button>
            <button className="btn btn-ghost" onClick={() => { setNewPlan(lab.plan); setPlanReason(""); setChangePlanOpen(true); }}>Change Plan</button>
          </div>
        </div>
      )}

      <Modal
        open={reassignOpen}
        title="Reassign CSM"
        onClose={() => setReassignOpen(false)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setReassignOpen(false) },
          { label: "Reassign", className: "btn-primary", onClick: handleReassignClick, disabled: newCsm === lab.csm },
        ]}
      >
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>New CSM</label>
          <select value={newCsm} onChange={(e) => setNewCsm(e.target.value)} style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }}>
            {csmNames.map((n) => <option key={n}>{n}</option>)}
          </select>
        </div>
        {children.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
            <input type="checkbox" checked={cascadeReassign} onChange={(e) => setCascadeReassign(e.target.checked)} />
            Also reassign {children.length} child lab{children.length > 1 ? "s" : ""}
          </label>
        )}
      </Modal>

      <Modal
        open={changePlanOpen}
        title="Change Plan"
        onClose={() => setChangePlanOpen(false)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setChangePlanOpen(false) },
          { label: "Change Plan", className: "btn-primary", onClick: handleChangePlanClick, disabled: newPlan === lab.plan },
        ]}
      >
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>New Plan</label>
          <select value={newPlan} onChange={(e) => setNewPlan(e.target.value)} style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }}>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Reason (optional)</label>
          <textarea value={planReason} onChange={(e) => setPlanReason(e.target.value)} rows={2}
            placeholder="e.g. Upsell to Growth after Q3 review"
            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />
        </div>
        {children.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
            <input type="checkbox" checked={cascadePlan} onChange={(e) => setCascadePlan(e.target.checked)} />
            Also move {children.length} child lab{children.length > 1 ? "s" : ""} to this plan
          </label>
        )}
      </Modal>

      {tab === "childlabs" && (
        children.length === 0 ? (
          <div className="table-card" style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>No child labs under this parent yet.</div>
        ) : (
          <div className="table-card"><div className="table-scroll"><table className="child-mini"><thead><tr>
            <th>Lab ID</th><th>Lab Name</th><th>CSM</th><th>Segment</th><th>MRR</th><th>Status</th>
          </tr></thead><tbody>
            {children.map((c) => {
              const cseg = segmentFor(c.mrr);
              return (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td className="lab-name clickable" onClick={() => guardedNav(() => onOpenLab(c.id))}>{c.name}</td>
                  <td>{c.csm}</td>
                  <td><span className="seg-badge" style={{ background: cseg.color }}>{cseg.code}</span></td>
                  <td className="mrr-cell">{fmtINR(c.mrr)}</td>
                  <td><span className={`status-pill ${statusPillClass(c.status)}`}>{c.status}</span></td>
                </tr>
              );
            })}
          </tbody></table></div></div>
        )
      )}

      {tab === "adoption" && (
        loadingAdoption ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading adoption data…</div>
        ) : adoptionError ? (
          <div className="warn-banner" style={{ background: "var(--bad-bg)", color: "var(--bad)", borderColor: "#f3b8b8" }}>
            Couldn't load adoption data — {adoptionError}
          </div>
        ) : (
          <div>
            <div className="adopt-summary">
              <div className="adopt-ring-card">
                <div className="ring" style={{ background: `conic-gradient(${ringColor} ${scores.mandatoryPct * 3.6}deg, #eef0f3 0deg)` }}>
                  <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>
                    {Math.round(scores.mandatoryPct)}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Mandatory Completion</div>
                  <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>
                    Overall Adoption: <b style={{ color: "var(--text)" }}>{Math.round(scores.overallPct)}%</b>
                  </div>
                </div>
              </div>
              <div className="tile"><div className="tval" style={{ color: "var(--ok)" }}>{fullyAdopted}</div><div className="tlabel">Modules ≥ 91% (mandatory)</div></div>
              <div className="tile"><div className="tval" style={{ color: "var(--warn)" }}>{inProgress}</div><div className="tlabel">Modules in progress</div></div>
              <div className="tile"><div className="tval">{notStarted}</div><div className="tlabel">Modules not started</div></div>
              <div className="tile"><div className="tval" style={{ color: "#7c3aed" }}>{fmtINR(expansionPipeline)}</div><div className="tlabel">Expansion pipeline</div></div>
            </div>

            {hasDraftChanges && (
              <div className="warn-banner" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", background: "var(--accent-dim)", color: "#1948a8", borderColor: "#c8dafc" }}>
                <span><b>Unsaved changes</b> — the numbers above are a live preview. Nothing is recorded for this lab until you save.</span>
                <div style={{ display: "flex", gap: 8, flex: "none" }}>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 10px" }} onClick={handleDiscardAdoption} disabled={saving}>Discard</button>
                  <button className="btn btn-primary" style={{ fontSize: 11, padding: "5px 10px" }} onClick={handleSaveAdoption} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button>
                </div>
              </div>
            )}

            <div className="adopt-note" style={{ margin: "0 0 12px" }}>
              {outOfScopeCount > 0 ? (
                <>This lab is on <b>{plan.name}</b>, which includes {plan.modules.length} of {modules.length} modules by default — <b>{outOfScopeCount}</b> module{outOfScopeCount > 1 ? "s are" : " is"} currently out of scope for this lab as a result.</>
              ) : (
                <>This lab is on <b>{plan.name}</b>, which includes every module — every module below is in scope by default. Untick "In scope" on any module to give this lab a custom offer.</>
              )}
            </div>

            {planDeviations.length > 0 && (
              <div className="warn-banner" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", background: "#fff7e6", borderColor: "#f3dfa8", color: "#8a5a00" }}>
                <span>Current scope differs from this lab's <b>{plan.name}</b> plan on <b>{planDeviations.length}</b> module{planDeviations.length > 1 ? "s" : ""} ({planDeviations.map((m) => m.name).join(", ")}) — a custom add-on or drop, not a plan change.</span>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 10px", flex: "none" }} onClick={handleResetToPlanDefaults}>Reset to Plan Defaults</button>
              </div>
            )}

            {scores.moduleResults.map(({ mod, mandPct, inScope }) => {
              const isOpen = expandedModule === mod.key;
              const scopeToggle = (
                <label className="scope-toggle" onClick={(e) => e.stopPropagation()} title={inScope ? "In scope for this lab — untick if this lab doesn't have / doesn't apply to this module" : "Out of scope for this lab"}>
                  <input type="checkbox" checked={inScope} onChange={() => handleToggleScope(mod.key)} /> In scope
                </label>
              );
              if (!inScope) {
                return (
                  <div key={mod.key} className="module-row out-of-scope">
                    <div className="module-head" style={{ cursor: "default" }}>
                      <span className="mtoggle"></span>
                      <span>{mod.icon}</span>
                      <span className="mname">{mod.name}</span>
                      <span className="out-of-scope-tag">Not applicable to this lab</span>
                      <div className="bar-track"></div>
                      {scopeToggle}
                    </div>
                  </div>
                );
              }
              const pct = Math.round(mandPct || 0);
              const barColor = pct >= 76 ? "var(--ok)" : pct >= 51 ? "var(--accent)" : pct >= 26 ? "var(--warn)" : "var(--bad)";
              return (
                <div key={mod.key} className="module-row">
                  <div className="module-head" onClick={() => setExpandedModule(isOpen ? null : mod.key)}>
                    <span className="mtoggle">{isOpen ? "▾" : "▸"}</span>
                    <span>{mod.icon}</span>
                    <span className="mname">{mod.name}</span>
                    <span className="mtag">{mod.weight}% of score</span>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%`, background: barColor }}></div></div>
                    <span className="mpct">{pct}%</span>
                    {scopeToggle}
                  </div>
                  <div className={`module-body${isOpen ? " open" : ""}`}>
                    {mod.params.map((p) => {
                      const pInScope = effectiveParamScope(mod.key, p.name);
                      const paramScopeToggle = (
                        <label className="scope-toggle" title={pInScope ? "In scope — untick if this lab never does this specific feature" : "Out of scope for this lab"}>
                          <input type="checkbox" checked={pInScope} onChange={() => handleToggleParamScope(mod.key, p.name)} /> In scope
                        </label>
                      );
                      const catTag = <span className={`cat-tag cat-${p.category}`} title={p.category === "Adoption" ? "Base plan — tracked on rollout status" : "Add-on — gated behind purchase"}>{p.category}</span>;
                      if (!pInScope) {
                        return (
                          <div key={p.name} className="param-row" style={{ opacity: 0.55 }}>
                            <span className="param-type">{p.type === "M" ? "Mandatory" : "Optional"}</span>
                            <span className="pname">{p.name}</span>
                            {catTag}
                            <span className="out-of-scope-tag">Not applicable to this lab</span>
                            {paramScopeToggle}
                          </div>
                        );
                      }
                      const st = effectiveParamState(mod.key, p.name);
                      if (st.included) {
                        return (
                          <div key={p.name} className="param-row">
                            <span className={`param-type ${p.type}`}>{p.type === "M" ? "Mandatory" : "Optional"}</span>
                            <span className="pname">{p.name}</span>
                            {catTag}
                            <span className="param-weight">{p.weight}%</span>
                            <select className="status-select" value={st.status} onChange={(e) => handleSetStatus(mod.key, p.name, e.target.value)}>
                              {STATUS_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                            {paramScopeToggle}
                          </div>
                        );
                      }
                      return (
                        <div key={p.name} className="param-row">
                          <span className={`param-type ${p.type}`}>{p.type === "M" ? "Mandatory" : "Optional"}</span>
                          <span className="pname">{p.name}</span>
                          {catTag}
                          <span className="param-weight">{p.weight}%</span>
                          <span className="expansion-chip" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            ₹<input
                              type="number" min="0" placeholder="value"
                              value={st.expValue ?? ""}
                              onChange={(e) => handleSetExpValue(mod.key, p.name, e.target.value)}
                              style={{ width: 62, border: "none", background: "transparent", color: "inherit", font: "inherit", fontWeight: 700 }}
                            />
                          </span>
                          <select
                            value={st.expStage || ""}
                            onChange={(e) => handleSetExpStage(mod.key, p.name, e.target.value)}
                            style={{ fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, padding: "3px 5px", fontFamily: "inherit", flex: "none" }}
                          >
                            <option value="">Stage…</option>
                            {EXP_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <button className="mark-purchased" onClick={() => handleToggleIncluded(mod.key, p.name)}>Mark purchased</button>
                          {paramScopeToggle}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="adopt-note">
              Module Progress % = Completed Mandatory Weightage ÷ Total Mandatory Weightage × 100. Scope defaults from this lab's <b>{plan.name}</b> plan
              (left nav: <b>Plans</b>) — untick "In scope" on a module this lab doesn't need, or tick one on that isn't in their plan as a custom add-on.
              Each feature has its own "In scope" tick too. A feature's <b>Adoption</b>/<b>Expansion</b> tag is set once in the <b>Adoption Template</b> —
              Adoption features are always tracked on status, Expansion features are gated behind "Mark purchased" until bought. Edits stay local to this
              screen until you hit <b>Save Changes</b>.
            </div>
          </div>
        )
      )}

      {tab === "collections" && (
        loadingColl ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading collections…</div>
        ) : collError ? (
          <div className="warn-banner" style={{ background: "var(--bad-bg)", color: "var(--bad)", borderColor: "#f3b8b8" }}>Couldn't load collections — {collError}</div>
        ) : !SUPABASE_CONFIGURED ? (
          <div className="table-card" style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — Collections isn't tracked without a database connected.</div>
        ) : (
          <div className="table-card" style={{ padding: "6px 20px 20px" }}>
            <div className="banner" style={{ background: "#eef4ff", border: "1px solid #cfe0fb" }}>
              <span className="badge" style={{ background: "#1948a8" }}>ZOHO BOOKS SYNC — CONCEPT</span>
              <span>Zoho figures are simulated — no live sync yet. Items appear automatically when a pitch on My Portfolio is marked Added, or add one directly.</span>
            </div>

            {(() => {
              const s = labCollectionsSummary(collItems);
              return (
                <div className="summary-grid" style={{ margin: "12px 0" }}>
                  <div className="stile"><div className="sval">{fmtINR(s.outstanding)}</div><div className="slabel">Outstanding</div></div>
                  <div className="stile"><div className="sval">{s.openCount ? `${s.daysOverdue}d` : "—"}</div><div className="slabel">Days Overdue</div></div>
                  <div className="stile"><div className="sval" style={{ color: AGING_COLORS[s.bucket] }}>{s.bucket}</div><div className="slabel">Status</div></div>
                  <div className="stile"><div className="sval" style={{ fontSize: 12.5 }}>{s.lastPayment ? new Date(s.lastPayment).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}</div><div className="slabel">Last Payment</div></div>
                </div>
              );
            })()}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, margin: "10px 0" }}>
              <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={handleLogReminder}>Log Reminder Sent</button>
              <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={() => setAddItemOpen(true)}>+ Add Item</button>
            </div>
            {!collItems.length ? (
              <div style={{ color: "var(--text-faint)", fontSize: 12, padding: "10px 0" }}>No items yet for {lab.name}.</div>
            ) : (
              <div className="table-scroll"><table className="child-mini">
                <thead><tr><th>Feature</th><th>Added</th><th>Owed</th><th>Collected (Manual)</th><th>Zoho</th><th>Status</th><th></th></tr></thead>
                <tbody>{collItems.map((item) => (
                  <tr key={item.id}>
                    <td>{item.label}{item.isTrial && <span className="cat-tag" style={{ background: "#eef2ff", color: "#4338ca" }}> Trial/Free</span>}</td>
                    <td style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{new Date(item.addedDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</td>
                    <td className="mrr-cell">{item.isTrial ? "—" : fmtINR(item.amount)}</td>
                    <td>
                      {item.isTrial ? "—" : item.collectedManual === null ? (
                        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input type="number" placeholder="₹ collected" value={collManualInputs[item.id] || ""} onChange={(e) => setCollManualInputs((m) => ({ ...m, [item.id]: e.target.value }))}
                            style={{ width: 92, border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px", fontSize: 11.5 }} />
                          <button className="mark-purchased" onClick={() => handleMarkItemCollected(item)}>Save</button>
                        </span>
                      ) : fmtINR(item.collectedManual)}
                    </td>
                    <td>{item.isTrial ? "—" : item.collectedZoho !== null ? fmtINR(item.collectedZoho) : "—"}</td>
                    <td>
                      <span
                        className={`status-chip ${item.status === "Pending" ? "st-InProgress" : item.status === "Conflict" ? "st-Critical" : "st-Adopted"}`}
                        style={{ cursor: "default" }}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td>{item.status === "Conflict" && (
                      <span className="mark-purchased" onClick={() => { setResolveItem(item); setResolveComment(""); setResolveError(false); }}>Resolve</span>
                    )}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            <Modal
              open={!!resolveItem}
              title="Resolve Collection Conflict"
              onClose={() => setResolveItem(null)}
              actions={[
                { label: "Cancel", className: "btn-ghost", onClick: () => setResolveItem(null) },
                { label: "Resolve", className: "btn-primary", onClick: handleResolveConflict },
              ]}
            >
              {resolveItem && (
                <>
                  <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 12 }}>
                    <b>{resolveItem.label}</b> — manually logged as <b>{fmtINR(resolveItem.collectedManual)}</b>, Zoho shows <b>{fmtINR(resolveItem.collectedZoho)}</b>. Add a note explaining the mismatch before resolving.
                  </div>
                  <div className="tmpl-field">
                    <label>Comment</label>
                    <textarea value={resolveComment} onChange={(e) => setResolveComment(e.target.value)} rows={3}
                      placeholder="e.g. Partial payment received, remainder due next cycle"
                      style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />
                  </div>
                  {resolveError && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>A comment is required to resolve a conflict.</div>}
                </>
              )}
            </Modal>
            <Modal
              open={addItemOpen}
              title="Add Collections Item"
              onClose={() => setAddItemOpen(false)}
              actions={[
                { label: "Cancel", className: "btn-ghost", onClick: () => setAddItemOpen(false) },
                { label: "Add Item", className: "btn-primary", onClick: handleAddCollItem },
              ]}
            >
              <div className="tmpl-field" style={{ marginBottom: 12 }}>
                <label>Feature / Description</label>
                <input value={addItemLabel} onChange={(e) => setAddItemLabel(e.target.value)} placeholder="e.g. Home Collection add-on"
                  style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }} />
              </div>
              <div className="tmpl-field" style={{ marginBottom: 12 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, cursor: "pointer" }}>
                  <input type="checkbox" checked={addItemTrial} onChange={(e) => setAddItemTrial(e.target.checked)} /> Trial / free (nothing owed yet)
                </label>
              </div>
              {!addItemTrial && (
                <div className="tmpl-field">
                  <label>Amount Owed (₹)</label>
                  <input type="number" min="0" value={addItemAmount} onChange={(e) => setAddItemAmount(e.target.value)}
                    style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }} />
                </div>
              )}
              {addItemError && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>Give it a description and an amount (or mark it trial/free).</div>}
            </Modal>
          </div>
        )
      )}

      {tab === "history" && (
        loadingActivity ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading activity…</div>
        ) : activityError ? (
          <div className="warn-banner" style={{ background: "var(--bad-bg)", color: "var(--bad)", borderColor: "#f3b8b8" }}>
            Couldn't load activity — {activityError}
          </div>
        ) : !SUPABASE_CONFIGURED ? (
          <div className="table-card" style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>
            Demo mode — activity isn't tracked without a database connected.
          </div>
        ) : (
          <div className="table-card" style={{ padding: "6px 20px 18px" }}>
            <div style={{ fontWeight: 700, fontSize: 14, paddingTop: 14 }}>Activity Timeline</div>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}>Every logged system event for {lab.name}, newest first.</div>

            <div className="summary-grid">
              <div className="stile"><div className="sval">{activity.length}</div><div className="slabel">Total Activities</div></div>
              <div className="stile"><div className="sval" style={{ fontSize: 12.5 }}>{activity.length ? new Date(activity[activity.length - 1].created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"}</div><div className="slabel">Created On</div></div>
              <div className="stile"><div className="sval" style={{ fontSize: 12.5 }}>{activity.length ? new Date(activity[0].created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"}</div><div className="slabel">Last Updated On</div></div>
              <div className="stile"><div className="sval" style={{ fontSize: 12.5 }}>{activity.length ? (nameById[activity[0].csm_id] || "System") : "—"}</div><div className="slabel">Last Updated By</div></div>
            </div>

            <table className="activity-table">
              <thead><tr><th>Date &amp; Time</th><th>Activity</th><th>Details</th><th>Performed By</th></tr></thead>
              <tbody>
                {activity.length === 0 ? (
                  <tr><td colSpan="4" style={{ textAlign: "center", color: "var(--text-faint)", padding: "20px 0" }}>No activity logged for this lab yet.</td></tr>
                ) : activity.map((e) => {
                  const d = new Date(e.created_at);
                  return (
                    <tr key={e.id}>
                      <td className="adate">{d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}<br />{d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</td>
                      <td><span className="aicon">{ACTIVITY_ICONS[e.kind] || "📝"}</span>{e.title}</td>
                      <td style={{ color: "var(--text-dim)" }}>{e.meta || "—"}</td>
                      <td>{nameById[e.csm_id] || "System"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
