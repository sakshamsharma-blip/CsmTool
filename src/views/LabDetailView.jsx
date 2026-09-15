import { useEffect, useMemo, useState } from "react";
import { supabase, SUPABASE_CONFIGURED } from "../supabaseClient";
import { fmtMoney, toINR, nativeCurrency, segmentFor } from "../lib/format";
import { planIncludesModule, planIncludesParam } from "../lib/plans";
import {
  STATUS_ORDER, EXP_STAGES, defaultParamState,
  fetchLabAdoption, saveLabAdoption, computeLabScores,
} from "../lib/adoption";
import { fetchLabActivity, logActivity, ACTIVITY_ICONS } from "../lib/activity";
import {
  fetchAllCollectionsItems, addCollectionsItem, updateItemCollected,
  logCollectionsReminder, labCollectionsSummary, isItemOpen, itemBalance, itemStatusLabel, AGING_COLORS,
} from "../lib/collections";
import {
  fetchInvoicesForLab, saveInvoice, updateInvoiceCollected,
  invoiceBalance, isInvoiceOpen, invoiceStatusLabel,
} from "../lib/invoices";
import { extractInvoiceFromFile } from "../lib/invoiceParse";
import Modal from "../components/Modal";

const SEG_NAME = { A: "Enterprise", B: "Premium", C: "Advance", D: "Standard", E: "Essential" };
const EMPTY_ADOPTION = { scope: {}, paramScope: {}, paramState: {} };

function statusPillClass(s) { return "status-" + s.replace(" ", ""); }
function initials(name) { return (name || "").split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase(); }

export default function LabDetailView({ lab, labs, modules, plans, csmNames, currentCSM, idByName, onBack, onOpenLab, onReassignCsm, onChangePlan, onInvoiceMrrUpdate, onLogCheckin, onAddChildLab, initialTab, showToast }) {
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

  const [invoices, setInvoices] = useState([]);
  const [loadingInvoices, setLoadingInvoices] = useState(SUPABASE_CONFIGURED);
  const [invoicesError, setInvoicesError] = useState(null);
  const [invManualInputs, setInvManualInputs] = useState({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadStage, setUploadStage] = useState("pick"); // "pick" | "extracting" | "confirm"
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadForm, setUploadForm] = useState(null); // { invoiceNumber, invoiceDate, invoiceType, subTotal, total, extractedOk }
  const [uploadError, setUploadError] = useState("");
  const [savingInvoice, setSavingInvoice] = useState(false);

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

  async function handleUpdateItemCollected(item) {
    const val = parseFloat(collManualInputs[item.id]);
    if (!Number.isFinite(val) || val < 0) { showToast("Enter a valid amount."); return; }
    try {
      const status = await updateItemCollected(item.id, val, item.amount, lab.id, idByName?.[lab.csm], item.label);
      await loadCollections();
      showToast(status === "Collected" ? "Marked fully collected." : "Payment logged.");
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  async function loadInvoices() {
    if (!SUPABASE_CONFIGURED) { setInvoices([]); setLoadingInvoices(false); return; }
    setLoadingInvoices(true);
    setInvoicesError(null);
    try {
      setInvoices(await fetchInvoicesForLab(lab.id));
    } catch (err) {
      setInvoicesError(err.message || "Failed to load invoices.");
    } finally {
      setLoadingInvoices(false);
    }
  }
  useEffect(() => {
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lab.id]);

  async function handleUpdateInvoiceCollected(inv) {
    const val = parseFloat(invManualInputs[inv.id]);
    if (!Number.isFinite(val) || val < 0) { showToast("Enter a valid amount."); return; }
    try {
      const status = await updateInvoiceCollected(inv.id, val, inv.total, lab.id, idByName?.[lab.csm], inv.invoiceNumber);
      await loadInvoices();
      showToast(status === "Collected" ? "Invoice marked fully collected." : "Payment logged.");
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  function openUploadInvoice() {
    setUploadOpen(true); setUploadStage("pick"); setUploadFile(null); setUploadForm(null); setUploadError("");
  }
  async function handleInvoiceFileChosen(file) {
    setUploadFile(file);
    setUploadStage("extracting");
    setUploadError("");
    try {
      const extracted = await extractInvoiceFromFile(file);
      setUploadForm(extracted);
      setUploadStage("confirm");
      if (!extracted.extractedOk) showToast("Couldn't auto-read every field — please check the numbers below before saving.");
    } catch (err) {
      console.error(err);
      // Auto-extraction failing is not fatal — drop straight into the confirm form empty so the
      // CSM can still type everything in by hand rather than being blocked.
      setUploadForm({ invoiceNumber: "", invoiceDate: "", invoiceType: "Monthly", subTotal: null, total: null, extractedOk: false });
      setUploadStage("confirm");
      showToast("Couldn't read this PDF automatically — please fill the details in by hand.");
    }
  }
  async function handleSaveInvoice() {
    const f = uploadForm;
    if (!f.invoiceNumber.trim() || !f.invoiceDate || f.subTotal == null || f.total == null || f.subTotal < 0 || f.total < 0) {
      setUploadError("Fill in the invoice number, date, sub total, and total before saving.");
      return;
    }
    setSavingInvoice(true);
    try {
      await saveInvoice({
        lab, invoiceNumber: f.invoiceNumber.trim(), invoiceType: f.invoiceType, invoiceDate: f.invoiceDate,
        subTotal: f.subTotal, total: f.total, extractedOk: f.extractedOk, sourceFilename: uploadFile?.name,
        csmId: idByName?.[lab.csm],
      });
      if (f.invoiceType === "Monthly") onInvoiceMrrUpdate && onInvoiceMrrUpdate(lab.id, f.subTotal);
      setUploadOpen(false);
      await loadInvoices();
      showToast(f.invoiceType === "Monthly" ? `Invoice saved — MRR updated to ${fmtMoney(f.subTotal, lab.region)}.` : "Pro-Rata invoice saved.");
    } catch (err) {
      showToast(`⚠ ${err.message}`);
    } finally {
      setSavingInvoice(false);
    }
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

  const seg = segmentFor(toINR(effectiveMRR(lab), lab.region));
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
          <div className="m"><div>Current MRR</div><div>{fmtMoney(effectiveMRR(lab), lab.region)}</div></div>
          <div className="m"><div>Current ARR</div><div>{fmtMoney(effectiveMRR(lab) * 12, lab.region)}</div></div>
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
            ["Payment Cycle", lab.paymentCycle || "Monthly"], ["Current MRR", fmtMoney(effectiveMRR(lab), lab.region)],
            ["Current ARR", fmtMoney(effectiveMRR(lab) * 12, lab.region)], ["Status", lab.status], ["Remarks", lab.remarks || "—"],
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
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <button className="btn btn-primary" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={() => onAddChildLab && onAddChildLab(lab)}>+ Add Child Lab</button>
          </div>
          {children.length === 0 ? (
            <div className="table-card" style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>No child labs under this parent yet.</div>
          ) : (
            <div className="table-card"><div className="table-scroll"><table className="child-mini"><thead><tr>
              <th>Lab ID</th><th>Lab Name</th><th>CSM</th><th>Segment</th><th>MRR</th><th>Status</th>
            </tr></thead><tbody>
              {children.map((c) => {
                const cseg = segmentFor(toINR(c.mrr, c.region));
                return (
                  <tr key={c.id}>
                    <td>{c.id}</td>
                    <td className="lab-name clickable" onClick={() => guardedNav(() => onOpenLab(c.id))}>{c.name}</td>
                    <td>{c.csm}</td>
                    <td><span className="seg-badge" style={{ background: cseg.color }}>{cseg.code}</span></td>
                    <td className="mrr-cell">{fmtMoney(c.mrr, c.region)}</td>
                    <td><span className={`status-pill ${statusPillClass(c.status)}`}>{c.status}</span></td>
                  </tr>
                );
              })}
            </tbody></table></div></div>
          )}
        </>
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
              <div className="tile"><div className="tval" style={{ color: "#7c3aed" }}>{fmtMoney(expansionPipeline, lab.region)}</div><div className="tlabel">Expansion pipeline</div></div>
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
        loadingColl || loadingInvoices ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading collections…</div>
        ) : collError || invoicesError ? (
          <div className="warn-banner" style={{ background: "var(--bad-bg)", color: "var(--bad)", borderColor: "#f3b8b8" }}>Couldn't load collections — {collError || invoicesError}</div>
        ) : !SUPABASE_CONFIGURED ? (
          <div className="table-card" style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — Collections isn't tracked without a database connected.</div>
        ) : (
          <div className="table-card" style={{ padding: "6px 20px 20px" }}>
            <div className="banner">
              <span className="badge">HOW THIS WORKS</span>
              <span>Upload an invoice below — its date, amount and type are read automatically and you confirm before saving. A Monthly invoice updates this lab's MRR; a Pro-Rata invoice is a one-off top-up that doesn't. Due date is the invoice date + this lab's Credit Days ({lab.creditDays || "30"}), not the invoice's own due date field.</span>
            </div>

            {(() => {
              const itemSummary = labCollectionsSummary(collItems);
              const openInvoices = invoices.filter(isInvoiceOpen);
              const invOutstanding = openInvoices.reduce((s, iv) => s + invoiceBalance(iv), 0);
              const invOldestDays = openInvoices.reduce((max, iv) => Math.max(max, Math.floor((Date.now() - new Date(iv.dueDate + "T00:00:00")) / 86400000)), 0);
              const outstanding = itemSummary.outstanding + invOutstanding;
              const openCount = itemSummary.openCount + openInvoices.length;
              const daysOverdue = Math.max(itemSummary.daysOverdue, invOldestDays > 0 ? invOldestDays : 0);
              const bucket = openCount ? (daysOverdue >= 45 ? "Critical" : daysOverdue >= 30 ? "Overdue" : daysOverdue >= 15 ? "Due Soon" : "Current") : "Current";
              const lastPayment = [itemSummary.lastPayment, ...invoices.map((iv) => iv.collectedAt)].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
              return (
                <div className="summary-grid" style={{ margin: "12px 0" }}>
                  <div className="stile"><div className="sval">{fmtMoney(outstanding, lab.region)}</div><div className="slabel">Outstanding</div></div>
                  <div className="stile"><div className="sval">{openCount ? `${daysOverdue}d` : "—"}</div><div className="slabel">Days Overdue</div></div>
                  <div className="stile"><div className="sval" style={{ color: AGING_COLORS[bucket] }}>{bucket}</div><div className="slabel">Status</div></div>
                  <div className="stile"><div className="sval" style={{ fontSize: 12.5 }}>{lastPayment ? new Date(lastPayment).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}</div><div className="slabel">Last Payment</div></div>
                </div>
              );
            })()}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "18px 0 8px" }}>
              <h4 style={{ margin: 0, fontSize: 13 }}>Invoices</h4>
              <button className="btn btn-primary" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={openUploadInvoice}>⬆ Upload Invoice</button>
            </div>
            {!invoices.length ? (
              <div style={{ color: "var(--text-faint)", fontSize: 12, padding: "10px 0" }}>No invoices uploaded yet for {lab.name}.</div>
            ) : (
              <div className="table-scroll"><table className="child-mini">
                <thead><tr><th>Invoice #</th><th>Type</th><th>Invoice Date</th><th>Due Date</th><th>Sub Total</th><th>Total</th><th>Collected</th><th>Status</th></tr></thead>
                <tbody>{invoices.map((inv) => {
                  const bal = invoiceBalance(inv);
                  return (
                    <tr key={inv.id}>
                      <td>{inv.invoiceNumber}{!inv.extractedOk && <span className="cat-tag" style={{ background: "#fff7e6", color: "#8a5a00" }} title="Auto-extraction couldn't read every field — check this row's numbers"> ⚠ check</span>}</td>
                      <td><span className={`cat-tag cat-${inv.invoiceType === "Monthly" ? "Adoption" : "Expansion"}`}>{inv.invoiceType === "Monthly" ? "Monthly" : "Pro-Rata"}</span></td>
                      <td style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{new Date(inv.invoiceDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" })}</td>
                      <td style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{new Date(inv.dueDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" })}</td>
                      <td className="mrr-cell">{fmtMoney(inv.subTotal, lab.region)}</td>
                      <td className="mrr-cell">{fmtMoney(inv.total, lab.region)}</td>
                      <td>
                        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input type="number" placeholder={bal > 0 ? String(inv.collectedManual || "") : undefined} value={invManualInputs[inv.id] ?? (inv.collectedManual || "")}
                            onChange={(e) => setInvManualInputs((m) => ({ ...m, [inv.id]: e.target.value }))}
                            style={{ width: 84, border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px", fontSize: 11.5 }} />
                          <button className="mark-purchased" onClick={() => handleUpdateInvoiceCollected(inv)}>Update</button>
                        </span>
                      </td>
                      <td>
                        <span className={`status-chip ${bal > 0 ? (inv.collectedManual > 0 ? "st-InProgress" : "st-Critical") : "st-Adopted"}`} style={{ cursor: "default" }}>
                          {invoiceStatusLabel(inv)}
                        </span>
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "22px 0 8px" }}>
              <h4 style={{ margin: 0, fontSize: 13 }}>Other Items</h4>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={handleLogReminder}>Log Reminder Sent</button>
                <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={() => setAddItemOpen(true)}>+ Add Item</button>
              </div>
            </div>
            {!collItems.length ? (
              <div style={{ color: "var(--text-faint)", fontSize: 12, padding: "10px 0" }}>No manually-added items for {lab.name} — items also appear here automatically when a pitch on My Portfolio is marked Added.</div>
            ) : (
              <div className="table-scroll"><table className="child-mini">
                <thead><tr><th>Feature</th><th>Added</th><th>Owed</th><th>Collected</th><th>Status</th></tr></thead>
                <tbody>{collItems.map((item) => {
                  const bal = itemBalance(item);
                  return (
                    <tr key={item.id}>
                      <td>{item.label}{item.isTrial && <span className="cat-tag" style={{ background: "#eef2ff", color: "#4338ca" }}> Trial/Free</span>}</td>
                      <td style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{new Date(item.addedDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</td>
                      <td className="mrr-cell">{item.isTrial ? "—" : fmtMoney(item.amount, lab.region)}</td>
                      <td>
                        {item.isTrial ? "—" : (
                          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input type="number" placeholder={String(item.collectedManual || "")} value={collManualInputs[item.id] ?? (item.collectedManual || "")}
                              onChange={(e) => setCollManualInputs((m) => ({ ...m, [item.id]: e.target.value }))}
                              style={{ width: 84, border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px", fontSize: 11.5 }} />
                            <button className="mark-purchased" onClick={() => handleUpdateItemCollected(item)}>Update</button>
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`status-chip ${item.isTrial ? "st-Adopted" : bal > 0 ? (item.collectedManual > 0 ? "st-InProgress" : "st-Critical") : "st-Adopted"}`} style={{ cursor: "default" }}>
                          {itemStatusLabel(item)}
                        </span>
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            )}

            <Modal
              open={uploadOpen}
              title="Upload Invoice"
              onClose={() => !savingInvoice && setUploadOpen(false)}
              actions={
                uploadStage === "confirm"
                  ? [
                      { label: "Cancel", className: "btn-ghost", onClick: () => setUploadOpen(false) },
                      { label: savingInvoice ? "Saving…" : "Save Invoice", className: "btn-primary", onClick: handleSaveInvoice },
                    ]
                  : [{ label: "Cancel", className: "btn-ghost", onClick: () => setUploadOpen(false) }]
              }
            >
              {uploadStage === "pick" && (
                <div className="tmpl-field">
                  <label>Invoice PDF</label>
                  <input type="file" accept="application/pdf" onChange={(e) => e.target.files[0] && handleInvoiceFileChosen(e.target.files[0])} />
                  <div className="hint">We'll read the invoice number, date, sub total and total automatically — you'll get to check and correct everything before it saves.</div>
                </div>
              )}
              {uploadStage === "extracting" && (
                <div style={{ padding: "20px 0", textAlign: "center", color: "var(--text-faint)" }}>Reading {uploadFile?.name}…</div>
              )}
              {uploadStage === "confirm" && uploadForm && (
                <>
                  {!uploadForm.extractedOk && (
                    <div className="warn-banner" style={{ background: "#fff7e6", borderColor: "#f3dfa8", color: "#8a5a00", marginBottom: 12 }}>
                      Couldn't auto-read every field from {uploadFile?.name} — please fill in / correct the details below.
                    </div>
                  )}
                  <div className="frow">
                    <div className="field"><label>Invoice Number</label>
                      <input value={uploadForm.invoiceNumber} onChange={(e) => setUploadForm((f) => ({ ...f, invoiceNumber: e.target.value }))} /></div>
                    <div className="field"><label>Invoice Type</label>
                      <select value={uploadForm.invoiceType} onChange={(e) => setUploadForm((f) => ({ ...f, invoiceType: e.target.value }))}>
                        <option value="Monthly">Monthly (updates MRR)</option>
                        <option value="ProRata">Pro-Rata add-on (one-off, MRR unchanged)</option>
                      </select>
                    </div>
                  </div>
                  <div className="frow">
                    <div className="field"><label>Invoice Date</label>
                      <input type="date" value={uploadForm.invoiceDate} onChange={(e) => setUploadForm((f) => ({ ...f, invoiceDate: e.target.value }))} /></div>
                    <div className="field"><label>Due Date (auto)</label>
                      <input readOnly value={uploadForm.invoiceDate ? new Date(new Date(uploadForm.invoiceDate + "T00:00:00").getTime() + (parseInt(lab.creditDays, 10) || 0) * 86400000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"} />
                      <div className="hint">Invoice date + this lab's Credit Days ({lab.creditDays || "30"}).</div>
                    </div>
                  </div>
                  <div className="frow">
                    <div className="field"><label>Sub Total ({nativeCurrency(lab.region) === "USD" ? "$" : "₹"}) {uploadForm.invoiceType === "Monthly" && <span className="hint" style={{ fontWeight: 400 }}>— becomes this lab's MRR</span>}</label>
                      <input type="number" min="0" value={uploadForm.subTotal ?? ""} onChange={(e) => setUploadForm((f) => ({ ...f, subTotal: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></div>
                    <div className="field"><label>Total, incl. tax ({nativeCurrency(lab.region) === "USD" ? "$" : "₹"})</label>
                      <input type="number" min="0" value={uploadForm.total ?? ""} onChange={(e) => setUploadForm((f) => ({ ...f, total: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></div>
                  </div>
                  {uploadError && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>{uploadError}</div>}
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
                  <label>Amount Owed ({nativeCurrency(lab.region) === "USD" ? "$" : "₹"})</label>
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
