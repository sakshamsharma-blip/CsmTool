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
import { updateLabStatus, updateLabStageTags, updateLabTestimonial, updateLabDetails, updateLabBillingMode, fetchMrrHistory } from "../lib/labs";
import { HEALTH_STATUSES, isHealthyStatus, logLabPulse } from "../lib/pulse";
import { fetchAllVisits, fetchVisitById, updateVisit } from "../lib/visits";
import { syncFollowupTaskForVisit } from "../lib/tasks";
import { computeSentimentHealth, HEALTH_BUCKET_COLORS } from "../lib/labHealth";
import { CHURN_TYPES, logChurn } from "../lib/churn";
import Modal from "../components/Modal";
import InfoTip from "../components/InfoTip";
import Sparkline from "../components/Sparkline";

const SEG_NAME = { A: "Enterprise", B: "Premium", C: "Advance", D: "Standard", E: "Essential" };
const EMPTY_ADOPTION = { scope: {}, paramScope: {}, paramState: {} };
const LAB_STATUSES = ["Active", "Inactive", "At Risk"]; // Churned/Contraction go through the Churn modal instead
const STAGE_TAGS = ["Adoption", "Expansion", "Support", "Pending Dues", "Open Points", "Pilot", "Future Churn", "Churn", "Rapo"];

// Same field vocab Log Check-in / Log Visit use — kept here too since the Visit Detail view
// (Lab History tab) edits the very same visit/check-in records.
const VISIT_TYPES = ["Visit", "Call", "Email", "WhatsApp", "Note"];
const VISIT_DISCUSSION_TOPICS = [
  "Adoption/Usage", "Billing & Payments", "Support Issue", "Renewal/Expansion",
  "Training Need", "Relationship/Escalation", "Other",
];
const VISIT_SENTIMENTS = [
  { key: "Positive", color: "var(--ok)" },
  { key: "Neutral", color: "var(--text-dim)" },
  { key: "At Risk", color: "var(--bad)" },
];

function statusPillClass(s) { return "status-" + (s || "").replace(" ", ""); }
function healthPillClass(s) { return isHealthyStatus(s) ? "status-Active" : s === "Churn" ? "status-Inactive" : "status-AtRisk"; }
function initials(name) { return (name || "").split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase(); }

export default function LabDetailView({ lab, labs, modules, plans, csmNames, currentCSM, idByName, onBack, onOpenLab, onReassignCsm, onChangePlan, onInvoiceMrrUpdate, onPatchLab, onLogCheckin, onAddChildLab, initialTab, showToast }) {
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

  const [statusOpen, setStatusOpen] = useState(false);
  const [newStatus, setNewStatus] = useState(lab.status);
  const [churnOpen, setChurnOpen] = useState(false);
  const [churnType, setChurnType] = useState("Churned");
  const [churnMonth, setChurnMonth] = useState(new Date().toISOString().slice(0, 10));
  const [churnMrrLost, setChurnMrrLost] = useState("");
  const [churnReason, setChurnReason] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);

  const [pulseOpen, setPulseOpen] = useState(false);
  const [pulseHealth, setPulseHealth] = useState(lab.healthStatus || "No Risk");
  const [pulseRating, setPulseRating] = useState(lab.lastRating != null ? String(lab.lastRating) : "");
  const [pulseNote, setPulseNote] = useState("");
  const [savingPulse, setSavingPulse] = useState(false);

  const [stageTags, setStageTags] = useState(lab.stageTags || []);
  const [savingStageTags, setSavingStageTags] = useState(false);

  const [detailsEditMode, setDetailsEditMode] = useState(false);
  const [editCity, setEditCity] = useState(lab.city || "");
  const [editState, setEditState] = useState(lab.state || "");
  const [editCountry, setEditCountry] = useState(lab.country || "");
  const [editRegion, setEditRegion] = useState(lab.region || "Domestic");
  const [editBillingType, setEditBillingType] = useState(lab.billingType || "Fixed");
  const [editPaymentCycle, setEditPaymentCycle] = useState(lab.paymentCycle || "Monthly");
  const [editCreditDays, setEditCreditDays] = useState(lab.creditDays || "30");
  const [editRemarks, setEditRemarks] = useState(lab.remarks || "");
  const [savingDetails, setSavingDetails] = useState(false);
  const [savingBillingMode, setSavingBillingMode] = useState(false);

  const [testimonialOpen, setTestimonialOpen] = useState(false);
  const [testimonialCollected, setTestimonialCollected] = useState(lab.testimonialCollected || false);
  const [testimonialUrl, setTestimonialUrl] = useState(lab.testimonialVideoUrl || "");
  const [savingTestimonial, setSavingTestimonial] = useState(false);

  const [mrrHistory, setMrrHistory] = useState([]);

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
    setNewStatus(lab.status);
    setStatusOpen(false);
    setChurnOpen(false);
    setChurnReason("");
    setPulseOpen(false);
    setPulseHealth(lab.healthStatus || "No Risk");
    setPulseRating(lab.lastRating != null ? String(lab.lastRating) : "");
    setPulseNote("");
    setStageTags(lab.stageTags || []);
    setTestimonialOpen(false);
    setTestimonialCollected(lab.testimonialCollected || false);
    setTestimonialUrl(lab.testimonialVideoUrl || "");
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

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) { setMrrHistory([]); return; }
    let cancelled = false;
    fetchMrrHistory(lab.id).then((rows) => { if (!cancelled) setMrrHistory(rows); }).catch((err) => console.error(err));
    return () => { cancelled = true; };
  }, [lab.id]);

  // Lab Health (Sentiment) — computed from this lab's own visit/check-in history, same source
  // Dashboard and Total Labs read (lib/labHealth.js), kept separate from the manual Health
  // Status pill next to it.
  const [labVisits, setLabVisits] = useState([]);
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) { setLabVisits([]); return; }
    let cancelled = false;
    fetchAllVisits()
      .then((all) => { if (!cancelled) setLabVisits(all.filter((v) => v.labId === lab.id)); })
      .catch((err) => console.error(err));
    return () => { cancelled = true; };
  }, [lab.id]);
  const sentHealth = computeSentimentHealth(labVisits);

  // Visit Detail (Lab History tab) — opened by clicking a Visit/Check-in row in the Activity
  // Timeline (only those rows carry a details.visitId). Fetched on demand rather than reused from
  // `labVisits` above since that list only has the fields fetchAllVisits selects for the Lab
  // Health computation, and edits here need the full record either way.
  const [openVisitId, setOpenVisitId] = useState(null);
  const [visitDetail, setVisitDetail] = useState(null);
  const [loadingVisitDetail, setLoadingVisitDetail] = useState(false);
  const [visitDetailError, setVisitDetailError] = useState(null);
  const [visitEditMode, setVisitEditMode] = useState(false);
  const [savingVisitDetail, setSavingVisitDetail] = useState(false);
  const [vType, setVType] = useState("Visit");
  const [vDate, setVDate] = useState("");
  const [vDuration, setVDuration] = useState("");
  const [vLocation, setVLocation] = useState("");
  const [vPersonName, setVPersonName] = useState("");
  const [vPersonDesignation, setVPersonDesignation] = useState("");
  const [vTopics, setVTopics] = useState([]);
  const [vNotes, setVNotes] = useState("");
  const [vSentiment, setVSentiment] = useState("");
  const [vFlagged, setVFlagged] = useState([]);
  const [vActionItems, setVActionItems] = useState([]);
  const [vFollowup, setVFollowup] = useState("");
  const [vFollowupReason, setVFollowupReason] = useState("");

  useEffect(() => {
    if (!openVisitId) { setVisitDetail(null); setVisitEditMode(false); return; }
    let cancelled = false;
    setLoadingVisitDetail(true);
    setVisitDetailError(null);
    fetchVisitById(openVisitId)
      .then((v) => { if (!cancelled) setVisitDetail(v); })
      .catch((err) => { if (!cancelled) setVisitDetailError(err.message || "Failed to load visit."); })
      .finally(() => { if (!cancelled) setLoadingVisitDetail(false); });
    return () => { cancelled = true; };
  }, [openVisitId]);

  function openVisitDetail(id) {
    setOpenVisitId(id);
    setVisitEditMode(false);
  }
  function closeVisitDetail() {
    setOpenVisitId(null);
    setVisitDetail(null);
    setVisitEditMode(false);
  }
  function startEditVisit() {
    const v = visitDetail;
    if (!v) return;
    setVType(v.type || "Visit");
    setVDate(v.visitDate || "");
    setVDuration(v.durationMinutes != null ? String(v.durationMinutes) : "");
    setVLocation(v.location || "");
    setVPersonName(v.personName || "");
    setVPersonDesignation(v.personDesignation || "");
    setVTopics(v.discussionTopics || []);
    setVNotes(v.notes || "");
    setVSentiment(v.sentiment || "");
    setVFlagged(v.flaggedModules || []);
    setVActionItems(v.actionItems || []);
    setVFollowup(v.nextFollowupDate || "");
    setVFollowupReason(v.nextFollowupReason || "");
    setVisitEditMode(true);
  }
  function cancelEditVisit() {
    setVisitEditMode(false);
  }
  function toggleVTopic(t) {
    setVTopics((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));
  }
  function toggleVFlag(moduleKey) {
    setVFlagged((fs) => (fs.includes(moduleKey) ? fs.filter((k) => k !== moduleKey) : [...fs, moduleKey]));
  }
  function addVActionItem() {
    setVActionItems((items) => [...items, { text: "", dueDate: "" }]);
  }
  function updateVActionItem(i, patch) {
    setVActionItems((items) => items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function removeVActionItem(i) {
    setVActionItems((items) => items.filter((_, idx) => idx !== i));
  }

  // Saves the edited visit/check-in, then keeps its linked follow-up task in sync (create/update/
  // remove based on the follow-up date now on the record — see lib/tasks.js), then refreshes the
  // Activity Timeline and Lab Health so the edit shows up immediately without a full page reload.
  async function handleSaveVisitDetail() {
    setSavingVisitDetail(true);
    try {
      await updateVisit(openVisitId, {
        type: vType, visitDate: vDate, notes: vNotes,
        nextFollowupDate: vFollowup || null, nextFollowupReason: vFollowupReason,
        sentiment: vSentiment || null,
        durationMinutes: vDuration ? Number(vDuration) : null,
        location: vLocation,
        personName: vPersonName,
        personDesignation: vPersonDesignation,
        discussionTopics: vTopics,
        flaggedModules: vFlagged,
        actionItems: vActionItems.filter((it) => it.text.trim()).map((it) => ({ text: it.text.trim(), dueDate: it.dueDate || null })),
      });
      await syncFollowupTaskForVisit({
        visitId: openVisitId, labId: lab.id, labName: lab.name, ownerName: lab.csm, idByName,
        nextFollowupDate: vFollowup || null, nextFollowupReason: vFollowupReason,
      });
      const refreshed = await fetchVisitById(openVisitId);
      setVisitDetail(refreshed);
      setVisitEditMode(false);
      fetchLabActivity(lab.id).then(setActivity).catch((err) => console.error(err));
      fetchAllVisits().then((all) => setLabVisits(all.filter((v) => v.labId === lab.id))).catch((err) => console.error(err));
      showToast("Visit updated.");
    } catch (err) {
      showToast(`⚠ ${err.message}`);
    } finally {
      setSavingVisitDetail(false);
    }
  }

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

  // Mirrors computeLabRollup in lib/labRollup.js — same Billing Mode rule, just scoped to one
  // lab instead of the whole list (this view already has `labs` in scope for the children
  // lookup, and rebuilding the rollup of every lab just to read one row isn't worth it here).
  function effectiveMRR(l) {
    if (l.type === "Parent") {
      const children = labs.filter((c) => c.type === "Child" && c.parent === l.id);
      if (children.length) return l.billingMode === "Consolidated" ? (l.mrr || 0) : children.reduce((s, c) => s + (c.mrr || 0), 0);
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

  // Status change — Active/Inactive/At Risk apply immediately; Churned/Contraction hand off to
  // the Churn modal instead, since those need a churn_log detail record alongside the flip.
  async function handleChangeStatusClick() {
    if (newStatus === "Churned" || newStatus === "Contraction") {
      setStatusOpen(false);
      setChurnType(newStatus === "Churned" ? "Churned" : "Contraction");
      setChurnMonth(new Date().toISOString().slice(0, 10));
      setChurnMrrLost(String(effectiveMRR(lab) || ""));
      setChurnReason("");
      setChurnOpen(true);
      return;
    }
    setSavingStatus(true);
    try {
      await updateLabStatus(lab.id, newStatus);
      onPatchLab && onPatchLab(lab.id, { status: newStatus });
      const csmId = idByName?.[lab.csm];
      const meta = `${lab.status} → ${newStatus}`;
      logActivity(lab.id, { kind: "Status Changed", title: "Status changed", meta, csmId }).catch((err) => console.error(err));
      setStatusOpen(false);
      showToast(`Status set to ${newStatus}.`);
    } catch (err) {
      showToast(`⚠ ${err.message}`);
    } finally {
      setSavingStatus(false);
    }
  }

  async function handleChurnConfirm() {
    const outstandingNow = (() => {
      const itemSummary = labCollectionsSummary(collItems);
      const openInvoices = invoices.filter(isInvoiceOpen);
      const invOutstanding = openInvoices.reduce((s, iv) => s + invoiceBalance(iv), 0);
      return itemSummary.outstanding + invOutstanding;
    })();
    setSavingStatus(true);
    try {
      const csmId = idByName?.[lab.csm];
      await logChurn(lab.id, {
        churnType, churnMonth, mrrLost: parseFloat(churnMrrLost) || 0, dueAmount: outstandingNow, reason: churnReason,
      }, csmId);
      if (churnType === "Churned") onPatchLab && onPatchLab(lab.id, { status: "Churned" });
      setChurnOpen(false);
      showToast(churnType === "Churned" ? "Lab marked Churned." : "Contraction logged.");
    } catch (err) {
      showToast(`⚠ ${err.message}`);
    } finally {
      setSavingStatus(false);
    }
  }

  async function handlePulseConfirm() {
    setSavingPulse(true);
    try {
      const csmId = idByName?.[lab.csm];
      const rating = pulseRating.trim() ? parseFloat(pulseRating) : null;
      await logLabPulse(lab.id, { healthStatus: pulseHealth, rating, note: pulseNote }, csmId);
      onPatchLab && onPatchLab(lab.id, { healthStatus: pulseHealth, lastRating: rating });
      setPulseOpen(false);
      showToast(`Health set to ${pulseHealth}.`);
    } catch (err) {
      showToast(`⚠ ${err.message}`);
    } finally {
      setSavingPulse(false);
    }
  }

  async function handleToggleStageTag(tag) {
    const next = stageTags.includes(tag) ? stageTags.filter((t) => t !== tag) : [...stageTags, tag];
    setStageTags(next);
    setSavingStageTags(true);
    try {
      await updateLabStageTags(lab.id, next);
      onPatchLab && onPatchLab(lab.id, { stageTags: next });
    } catch (err) {
      setStageTags(stageTags); // revert on failure
      showToast(`⚠ ${err.message}`);
    } finally {
      setSavingStageTags(false);
    }
  }

  async function handleTestimonialSave() {
    setSavingTestimonial(true);
    try {
      const csmId = idByName?.[lab.csm];
      await updateLabTestimonial(lab.id, { collected: testimonialCollected, videoUrl: testimonialUrl, csmId });
      onPatchLab && onPatchLab(lab.id, {
        testimonialCollected, testimonialVideoUrl: testimonialUrl,
        testimonialCollectedBy: testimonialCollected ? csmId : null,
        testimonialCollectedAt: testimonialCollected ? new Date().toISOString() : null,
      });
      setTestimonialOpen(false);
      showToast(testimonialCollected ? "Testimonial logged." : "Testimonial cleared.");
    } catch (err) {
      showToast(`⚠ ${err.message}`);
    } finally {
      setSavingTestimonial(false);
    }
  }

  // Lab Details edit is in-page, not a modal — clicking Edit turns the read-only rows below
  // into inputs in place; Save Changes/Cancel replace the Edit button while in that mode. Scoped
  // to just the plain fields here — CSM/Plan/Status/Testimonial/Health Check stay on their own
  // dedicated actions since those cascade to child labs or branch into the Churn workflow, which
  // a flat "edit everything and save" wouldn't preserve.
  function startEditDetails() {
    setEditCity(lab.city || "");
    setEditState(lab.state || "");
    setEditCountry(lab.country || "");
    setEditRegion(lab.region || "Domestic");
    setEditBillingType(lab.billingType || "Fixed");
    setEditPaymentCycle(lab.paymentCycle || "Monthly");
    setEditCreditDays(lab.creditDays || "30");
    setEditRemarks(lab.remarks || "");
    setDetailsEditMode(true);
  }

  function cancelEditDetails() {
    setDetailsEditMode(false);
  }

  async function handleSaveDetails() {
    setSavingDetails(true);
    try {
      const patch = {
        city: editCity, state: editState, country: editCountry, region: editRegion,
        billingType: editBillingType, paymentCycle: editPaymentCycle, creditDays: editCreditDays, remarks: editRemarks,
      };
      await updateLabDetails(lab.id, patch);
      onPatchLab && onPatchLab(lab.id, patch);
      const csmId = idByName?.[lab.csm];
      logActivity(lab.id, { kind: "Details Updated", title: "Lab details updated", csmId }).catch((err) => console.error(err));
      setDetailsEditMode(false);
      showToast("Lab details updated.");
    } catch (err) {
      showToast(`⚠ ${err.message}`);
    } finally {
      setSavingDetails(false);
    }
  }

  // Changing Billing Mode can visibly jump the group's reported MRR (it flips which number is
  // authoritative — the parent's own, or the sum of children) — worth a confirm rather than a
  // silent flip on a stray click, since it's exactly the kind of change that "mixes up finances"
  // if done by accident.
  async function handleChangeBillingMode(mode) {
    const next = mode || null;
    if (next === lab.billingMode) return;
    const children = labs.filter((c) => c.type === "Child" && c.parent === lab.id);
    if (children.length) {
      const preview = next === "Consolidated" ? fmtMoney(lab.mrr || 0, lab.region) : fmtMoney(children.reduce((s, c) => s + (c.mrr || 0), 0), lab.region);
      const ok = window.confirm(`Switch ${lab.name} to ${next || "Per-Branch (default)"}? Its group MRR will become ${preview}.`);
      if (!ok) return;
    }
    setSavingBillingMode(true);
    try {
      await updateLabBillingMode(lab.id, next);
      onPatchLab && onPatchLab(lab.id, { billingMode: next });
      const csmId = idByName?.[lab.csm];
      logActivity(lab.id, { kind: "Billing Mode Changed", title: "Billing mode changed", meta: `→ ${next || "Per-Branch (default)"}`, csmId }).catch((err) => console.error(err));
      showToast(`Billing mode set to ${next || "Per-Branch"}.`);
    } catch (err) {
      showToast(`⚠ ${err.message}`);
    } finally {
      setSavingBillingMode(false);
    }
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
            {lab.healthStatus && (
              <span className={`status-pill ${healthPillClass(lab.healthStatus)}`} title="Health status">{lab.healthStatus}</span>
            )}
            {lab.lastRating != null && (
              <span className="status-pill" style={{ background: "var(--accent-dim)", color: "var(--info-text)" }} title="Last rating">★ {lab.lastRating}/10</span>
            )}
            <span
              className="status-pill"
              style={{ background: "#f4f6f9", color: HEALTH_BUCKET_COLORS[sentHealth.bucket] }}
              title="Lab Health (Sentiment) — auto, from logged visit/check-in sentiment. Separate from the manual Health Status above."
            >
              Lab Health: {sentHealth.bucket}
            </span>
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
        <div className="table-card" style={{ padding: "6px 20px 20px", overflow: "visible" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>Lab Details</div>
            {!detailsEditMode ? (
              <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "5px 12px" }} onClick={startEditDetails}>✎ Edit</button>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "5px 12px" }} onClick={cancelEditDetails} disabled={savingDetails}>Cancel</button>
                <button className="btn btn-primary" style={{ fontSize: 11.5, padding: "5px 12px" }} onClick={handleSaveDetails} disabled={savingDetails}>{savingDetails ? "Saving…" : "Save Changes"}</button>
              </div>
            )}
          </div>

          {(() => {
            const inputStyle = { border: "1px solid var(--border)", borderRadius: 7, padding: "6px 10px", fontSize: 13, fontFamily: "inherit", width: "100%", maxWidth: 320 };
            const row = (label, readNode, editNode) => (
              <div key={label} className="param-row" style={{ padding: "11px 0" }}>
                <span className="pname" style={{ color: "var(--text-dim)", flex: "0 0 180px" }}>{label}</span>
                {detailsEditMode && editNode ? editNode : <span style={{ fontWeight: 600 }}>{readNode}</span>}
              </div>
            );
            return (
              <>
                {row("Lab Name", lab.name)}
                {row("Lab ID", lab.id)}
                {row("Lab Type", lab.type + " Lab")}
                {row("Parent Lab", lab.parent ? (labs.find((l) => l.id === lab.parent) || {}).name || lab.parent : "—")}
                {row("CSM Name", lab.csm)}
                {row("Region Category", lab.region,
                  <div>
                    <select value={editRegion} onChange={(e) => setEditRegion(e.target.value)} style={inputStyle}>
                      <option>Domestic</option><option>ROW</option>
                    </select>
                    {editRegion !== lab.region && (
                      <div style={{ fontSize: 11, color: "var(--warn)", marginTop: 4, fontWeight: 400 }}>
                        Domestic bills in ₹, ROW in $ — changing this doesn't convert the existing MRR figure, so double-check it afterward.
                      </div>
                    )}
                  </div>
                )}
                {row("City", lab.city || "—", <input value={editCity} onChange={(e) => setEditCity(e.target.value)} style={inputStyle} />)}
                {row("State", lab.state, <input value={editState} onChange={(e) => setEditState(e.target.value)} style={inputStyle} />)}
                {row("Country", lab.country, <input value={editCountry} onChange={(e) => setEditCountry(e.target.value)} style={inputStyle} />)}
                {row("Client Segment", `${seg.code} — ${SEG_NAME[seg.code]}`)}
                {row("Credit Days", lab.creditDays || "30",
                  <input
                    type="number" min="0" step="1" inputMode="numeric" value={editCreditDays}
                    onChange={(e) => setEditCreditDays(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="e.g. 30" style={inputStyle}
                  />
                )}
                {row("Billing Type", lab.billingType || "Variable",
                  <select value={editBillingType} onChange={(e) => setEditBillingType(e.target.value)} style={inputStyle}>
                    <option>Fixed</option><option>Variable</option>
                  </select>
                )}
                {row("Payment Cycle", lab.paymentCycle || "Monthly",
                  <select value={editPaymentCycle} onChange={(e) => setEditPaymentCycle(e.target.value)} style={inputStyle}>
                    <option>Monthly</option><option>Quarterly</option><option>Half Yearly</option><option>Annual</option>
                  </select>
                )}
                {row("Current MRR", fmtMoney(effectiveMRR(lab), lab.region))}
                {row("Current ARR", fmtMoney(effectiveMRR(lab) * 12, lab.region))}
                {row("Status", lab.status)}
                {row("Remarks", lab.remarks || "—",
                  <textarea rows="2" value={editRemarks} onChange={(e) => setEditRemarks(e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />
                )}
              </>
            );
          })()}

          <div style={{ padding: "14px 0", borderTop: "1px solid var(--border)", marginTop: 4 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-dim)", marginBottom: 8, display: "flex", alignItems: "center" }}>
              MRR Trend
              <InfoTip>Tracking starts from when this was added — there's no historical MRR to backfill from before this feature existed, so a lab added today shows one point until more snapshots build up.</InfoTip>
            </div>
            <Sparkline
              points={mrrHistory.map((h) => ({ value: h.mrr, label: new Date(h.loggedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) }))}
              valueFmt={(v) => fmtMoney(v, lab.region)}
            />
          </div>

          <div className="param-row" style={{ padding: "11px 0", alignItems: "flex-start" }}>
            <span className="pname" style={{ color: "var(--text-dim)", flex: "0 0 180px", paddingTop: 4 }}>Stage</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, opacity: savingStageTags ? 0.6 : 1 }}>
              {STAGE_TAGS.map((tag) => (
                <span
                  key={tag}
                  onClick={() => handleToggleStageTag(tag)}
                  className="status-select"
                  style={{
                    cursor: "pointer", userSelect: "none", fontSize: 11.5, padding: "4px 10px", borderRadius: 20,
                    border: `1px solid ${stageTags.includes(tag) ? "var(--accent)" : "var(--border)"}`,
                    background: stageTags.includes(tag) ? "var(--accent-dim)" : "transparent",
                    color: stageTags.includes(tag) ? "var(--info-text)" : "var(--text-dim)",
                    fontWeight: stageTags.includes(tag) ? 700 : 500,
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="param-row" style={{ padding: "11px 0" }}>
            <span className="pname" style={{ color: "var(--text-dim)", flex: "0 0 180px" }}>Testimonial Video</span>
            <span style={{ fontWeight: 600 }}>
              {lab.testimonialCollected
                ? (lab.testimonialVideoUrl ? <a href={lab.testimonialVideoUrl} target="_blank" rel="noreferrer">Collected — view link</a> : "Collected")
                : "Not yet collected"}
            </span>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={() => { setNewCsm(lab.csm); setReassignOpen(true); }}>Reassign CSM</button>
            <button className="btn btn-ghost" onClick={() => { setNewPlan(lab.plan); setPlanReason(""); setChangePlanOpen(true); }}>Change Plan</button>
            <button className="btn btn-ghost" onClick={() => { setNewStatus(lab.status); setStatusOpen(true); }}>Change Status</button>
            <button className="btn btn-ghost" onClick={() => { setPulseHealth(lab.healthStatus || "No Risk"); setPulseRating(lab.lastRating != null ? String(lab.lastRating) : ""); setPulseNote(""); setPulseOpen(true); }}>Log Health Check</button>
            <button className="btn btn-ghost" onClick={() => { setTestimonialCollected(lab.testimonialCollected || false); setTestimonialUrl(lab.testimonialVideoUrl || ""); setTestimonialOpen(true); }}>Edit Testimonial</button>
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

      <Modal
        open={statusOpen}
        title="Change Status"
        onClose={() => setStatusOpen(false)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setStatusOpen(false) },
          { label: newStatus === "Churned" || newStatus === "Contraction" ? "Continue" : "Save", className: "btn-primary", onClick: handleChangeStatusClick, disabled: savingStatus || newStatus === lab.status },
        ]}
      >
        <div className="tmpl-field">
          <label>New Status</label>
          <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }}>
            {LAB_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            <option value="Churned">Churned (full loss)</option>
            <option value="Contraction">Contraction (partial downgrade)</option>
          </select>
          {(newStatus === "Churned" || newStatus === "Contraction") && (
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>
              This opens the Churn log next — it needs a month, MRR impact, and reason.
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={churnOpen}
        title={churnType === "Churned" ? "Log Churn" : "Log Contraction"}
        onClose={() => setChurnOpen(false)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setChurnOpen(false) },
          { label: churnType === "Churned" ? "Mark Churned" : "Log Contraction", className: "btn-primary", onClick: handleChurnConfirm, disabled: savingStatus },
        ]}
      >
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Type</label>
          <select value={churnType} onChange={(e) => setChurnType(e.target.value)} style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }}>
            {CHURN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Month</label>
          <input type="date" value={churnMonth} onChange={(e) => setChurnMonth(e.target.value)}
            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }} />
        </div>
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>MRR Impact ({lab.region === "ROW" ? "$" : "₹"})</label>
          <input type="number" min="0" value={churnMrrLost} onChange={(e) => setChurnMrrLost(e.target.value)}
            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }} />
        </div>
        <div className="tmpl-field">
          <label>Reason</label>
          <textarea value={churnReason} onChange={(e) => setChurnReason(e.target.value)} rows={2}
            placeholder="e.g. Switched to a competing LIMS"
            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10 }}>
          The lab's current Collections balance is captured automatically as the outstanding-dues figure on this record.
        </div>
      </Modal>

      <Modal
        open={pulseOpen}
        title="Log Health Check"
        onClose={() => setPulseOpen(false)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setPulseOpen(false) },
          { label: "Save", className: "btn-primary", onClick: handlePulseConfirm, disabled: savingPulse },
        ]}
      >
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Health Status</label>
          <select value={pulseHealth} onChange={(e) => setPulseHealth(e.target.value)} style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }}>
            {HEALTH_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Satisfaction Rating (optional, 0–10)</label>
          <input type="number" min="0" max="10" value={pulseRating} onChange={(e) => setPulseRating(e.target.value)}
            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }} />
        </div>
        <div className="tmpl-field">
          <label>Note (optional)</label>
          <textarea value={pulseNote} onChange={(e) => setPulseNote(e.target.value)} rows={2}
            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />
        </div>
      </Modal>

      <Modal
        open={testimonialOpen}
        title="Edit Testimonial"
        onClose={() => setTestimonialOpen(false)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setTestimonialOpen(false) },
          { label: "Save", className: "btn-primary", onClick: handleTestimonialSave, disabled: savingTestimonial },
        ]}
      >
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, cursor: "pointer" }}>
            <input type="checkbox" checked={testimonialCollected} onChange={(e) => setTestimonialCollected(e.target.checked)} /> Testimonial video collected
          </label>
        </div>
        {testimonialCollected && (
          <div className="tmpl-field">
            <label>Video Link</label>
            <input value={testimonialUrl} onChange={(e) => setTestimonialUrl(e.target.value)} placeholder="https://…"
              style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }} />
          </div>
        )}
      </Modal>

      {tab === "childlabs" && (
        <>
          <div className="table-card" style={{ padding: "14px 18px", marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", overflow: "visible" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center" }}>
              Billing Mode
              <InfoTip>Consolidated — one invoice covers the whole group, and {lab.name}'s own MRR is the group's real MRR. Per-Branch — each center is billed separately, and {lab.name}'s MRR is ignored in favor of summing every child's MRR.</InfoTip>
            </div>
            <select
              value={lab.billingMode || ""}
              onChange={(e) => handleChangeBillingMode(e.target.value)}
              disabled={savingBillingMode}
              style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "6px 10px", fontSize: 12.5, fontFamily: "inherit" }}
            >
              <option value="">Not set{children.length ? " (defaults to Per-Branch)" : ""}</option>
              <option value="Consolidated">Consolidated</option>
              <option value="Per-Branch">Per-Branch</option>
            </select>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
              Group MRR right now: <b style={{ color: "var(--text)" }}>{fmtMoney(effectiveMRR(lab), lab.region)}</b>
            </div>
          </div>

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
          <div className="error-banner">
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
              <div className="info-banner" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
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
              <div className="warn-banner" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
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
                    <span className="mtag">{scores.weightTotal ? Math.round((mod.weight / scores.weightTotal) * 100) : 0}% of score</span>
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
              — untick "In scope" on a module this lab doesn't need, or tick one that isn't in their plan as a custom add-on.
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
          <div className="error-banner">Couldn't load collections — {collError || invoicesError}</div>
        ) : !SUPABASE_CONFIGURED ? (
          <div className="table-card" style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — Collections isn't tracked without a database connected.</div>
        ) : (
          <div className="table-card" style={{ padding: "6px 20px 20px", overflow: "visible" }}>
            <div style={{ display: "flex", alignItems: "center", fontSize: 11.5, color: "var(--text-faint)", padding: "10px 0 4px" }}>
              How invoices work
              <InfoTip>Upload an invoice below — its date, amount and type are read automatically and you confirm before saving. A Monthly invoice updates this lab's MRR; a Pro-Rata invoice is a one-off top-up that doesn't. Due date is the invoice date + this lab's Credit Days ({lab.creditDays || "30"}), not the invoice's own due date field.</InfoTip>
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
                      <td>{inv.invoiceNumber}{!inv.extractedOk && <span className="cat-tag cat-Warn" title="Auto-extraction couldn't read every field — check this row's numbers"> ⚠ check</span>}</td>
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
                  {uploadForm.invoiceType === "Monthly" && (() => {
                    // A Monthly invoice updates THIS lab's own mrr field — but whether that field
                    // is actually what shows up in the group's reported MRR depends on Billing
                    // Mode. Catching a mismatch here is the "doesn't mix the logics" check: it's
                    // easy to upload an invoice against the wrong lab in a Parent/Child group and
                    // have the number silently go nowhere.
                    if (lab.type === "Child") {
                      const parentLab = labs.find((l) => l.id === lab.parent);
                      if (parentLab?.billingMode === "Consolidated") {
                        return (
                          <div className="warn-banner" style={{ marginBottom: 12 }}>
                            {parentLab.name} is billed <b>Consolidated</b> — only its own MRR counts toward the group's total. Saving this invoice will update {lab.name}'s MRR, but it won't affect the group's reported number. If this invoice covers the whole group, log it against {parentLab.name} instead.
                          </div>
                        );
                      }
                    } else if (lab.type === "Parent" && children.length && lab.billingMode !== "Consolidated") {
                      return (
                        <div className="warn-banner" style={{ marginBottom: 12 }}>
                          {lab.name} is billed <b>Per-Branch</b> — its own MRR is ignored in favor of summing its child labs' MRR. Saving this invoice will update {lab.name}'s own MRR, but it won't affect the group's reported number. If this invoice is for one specific center, log it against that child lab instead — or switch Billing Mode to Consolidated on the Child Labs tab if it now covers the whole group.
                        </div>
                      );
                    }
                    return null;
                  })()}
                  {!uploadForm.extractedOk && (
                    <div className="warn-banner" style={{ marginBottom: 12 }}>
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
          <div className="error-banner">
            Couldn't load activity — {activityError}
          </div>
        ) : !SUPABASE_CONFIGURED ? (
          <div className="table-card" style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>
            Demo mode — activity isn't tracked without a database connected.
          </div>
        ) : (
          openVisitId ? (
            <div className="table-card" style={{ padding: "6px 20px 20px" }}>
              <a onClick={closeVisitDetail} style={{ display: "inline-block", fontSize: 12, color: "var(--accent)", cursor: "pointer", padding: "14px 0 6px" }}>&larr; Back to Activity Timeline</a>

              {loadingVisitDetail ? (
                <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading visit…</div>
              ) : visitDetailError ? (
                <div className="error-banner">Couldn't load this visit — {visitDetailError}</div>
              ) : visitDetail && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0 11px", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700 }}>{ACTIVITY_ICONS[visitDetail.type] || "📝"} {visitDetail.type} — {new Date(visitDetail.visitDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</div>
                    {!visitEditMode ? (
                      <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "5px 12px" }} onClick={startEditVisit}>✎ Edit</button>
                    ) : (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "5px 12px" }} onClick={cancelEditVisit} disabled={savingVisitDetail}>Cancel</button>
                        <button className="btn btn-primary" style={{ fontSize: 11.5, padding: "5px 12px" }} onClick={handleSaveVisitDetail} disabled={savingVisitDetail}>{savingVisitDetail ? "Saving…" : "Save Changes"}</button>
                      </div>
                    )}
                  </div>

                  {(() => {
                    const inputStyle = { border: "1px solid var(--border)", borderRadius: 7, padding: "6px 10px", fontSize: 13, fontFamily: "inherit", width: "100%", maxWidth: 320 };
                    const row = (label, readNode, editNode) => (
                      <div key={label} className="param-row" style={{ padding: "11px 0", alignItems: editNode ? "flex-start" : "center" }}>
                        <span className="pname" style={{ color: "var(--text-dim)", flex: "0 0 180px", paddingTop: visitEditMode && editNode ? 4 : 0 }}>{label}</span>
                        {visitEditMode && editNode ? editNode : <span style={{ fontWeight: 600 }}>{readNode}</span>}
                      </div>
                    );
                    return (
                      <>
                        {row("Type", visitDetail.type,
                          <select value={vType} onChange={(e) => setVType(e.target.value)} style={inputStyle}>
                            {VISIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        )}
                        {row("Date", new Date(visitDetail.visitDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
                          <input type="date" value={vDate} onChange={(e) => setVDate(e.target.value)} style={inputStyle} />
                        )}
                        {row("Duration (min)", visitDetail.durationMinutes ?? "—",
                          <input type="number" min="0" value={vDuration} onChange={(e) => setVDuration(e.target.value)} style={inputStyle} />
                        )}
                        {row("Location", visitDetail.location || "—", <input value={vLocation} onChange={(e) => setVLocation(e.target.value)} style={inputStyle} />)}
                        {row("Person Name", visitDetail.personName || "—", <input value={vPersonName} onChange={(e) => setVPersonName(e.target.value)} style={inputStyle} />)}
                        {row("Person Designation", visitDetail.personDesignation || "—", <input value={vPersonDesignation} onChange={(e) => setVPersonDesignation(e.target.value)} style={inputStyle} />)}
                        {row("Discussion Topics", visitDetail.discussionTopics?.length ? visitDetail.discussionTopics.join(", ") : "—",
                          <div className="rule-chip-row">
                            {VISIT_DISCUSSION_TOPICS.map((t) => (
                              <label key={t} className="rule-chip" style={vTopics.includes(t) ? { borderColor: "var(--accent)", background: "var(--accent-dim)", color: "var(--accent)" } : undefined}>
                                <input type="checkbox" checked={vTopics.includes(t)} onChange={() => toggleVTopic(t)} /> {t}
                              </label>
                            ))}
                          </div>
                        )}
                        {row("Notes", visitDetail.notes || "—",
                          <textarea rows="3" value={vNotes} onChange={(e) => setVNotes(e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />
                        )}
                        {row("Sentiment", visitDetail.sentiment || "Not set",
                          <div style={{ display: "flex", gap: 8 }}>
                            {VISIT_SENTIMENTS.map((s) => (
                              <button
                                key={s.key} type="button" onClick={() => setVSentiment(vSentiment === s.key ? "" : s.key)} className="btn"
                                style={{
                                  border: `1.5px solid ${vSentiment === s.key ? s.color : "var(--border)"}`,
                                  background: vSentiment === s.key ? s.color : "#fff", color: vSentiment === s.key ? "#fff" : "var(--text)",
                                  borderRadius: 9, padding: "7px 12px", fontSize: 12, fontWeight: 600,
                                }}
                              >
                                {s.key}
                              </button>
                            ))}
                          </div>
                        )}
                        {row("Flagged Modules", visitDetail.flaggedModules?.length ? visitDetail.flaggedModules.map((k) => modules.find((m) => m.key === k)?.name || k).join(", ") : "—",
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                            {modules.map((m) => (
                              <label key={m.key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, cursor: "pointer" }}>
                                <input type="checkbox" checked={vFlagged.includes(m.key)} onChange={() => toggleVFlag(m.key)} /> {m.icon} {m.name}
                              </label>
                            ))}
                          </div>
                        )}
                        {row("Action Items", visitDetail.actionItems?.length ? `${visitDetail.actionItems.length} item${visitDetail.actionItems.length > 1 ? "s" : ""}` : "—",
                          <div>
                            {vActionItems.map((it, i) => (
                              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                                <input style={{ ...inputStyle, flex: 1, maxWidth: 220 }} value={it.text} onChange={(e) => updateVActionItem(i, { text: e.target.value })} placeholder="Action item" />
                                <input type="date" style={{ ...inputStyle, maxWidth: 150 }} value={it.dueDate || ""} onChange={(e) => updateVActionItem(i, { dueDate: e.target.value })} />
                                <span className="icon-btn" title="Remove" onClick={() => removeVActionItem(i)} style={{ cursor: "pointer" }}>✕</span>
                              </div>
                            ))}
                            <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={addVActionItem}>+ Add Action Item</button>
                          </div>
                        )}
                        {!visitDetail.actionItems?.length ? null : !visitEditMode && (
                          <div style={{ padding: "0 0 11px 180px", fontSize: 12.5 }}>
                            {visitDetail.actionItems.map((it, i) => (
                              <div key={i} style={{ color: "var(--text-dim)" }}>• {it.text}{it.dueDate ? ` — due ${new Date(it.dueDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}</div>
                            ))}
                          </div>
                        )}
                        {row("Next Follow-up Date", visitDetail.nextFollowupDate ? new Date(visitDetail.nextFollowupDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—",
                          <input type="date" value={vFollowup} onChange={(e) => setVFollowup(e.target.value)} style={inputStyle} />
                        )}
                        {row("Follow-up Reason", visitDetail.nextFollowupReason || "—",
                          <input value={vFollowupReason} onChange={(e) => setVFollowupReason(e.target.value)} placeholder="e.g. QBR" style={inputStyle} />
                        )}
                      </>
                    );
                  })()}
                  {visitEditMode && (
                    <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                      Changing the follow-up date here keeps this visit's linked task in sync — it updates the task's due date, creates one if there wasn't one, or removes it if the date is cleared.
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
          <div className="table-card" style={{ padding: "6px 20px 18px" }}>
            <div style={{ fontWeight: 700, fontSize: 14, paddingTop: 14 }}>Activity Timeline</div>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}>Every logged system event for {lab.name}, newest first. Visit/check-in entries can be opened for details.</div>

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
                  const visitId = e.details?.visitId;
                  return (
                    <tr key={e.id} className={visitId ? "clickable" : undefined} style={visitId ? { cursor: "pointer" } : undefined} onClick={visitId ? () => openVisitDetail(visitId) : undefined} title={visitId ? "Open this visit's details" : undefined}>
                      <td className="adate">{d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}<br />{d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</td>
                      <td><span className="aicon">{ACTIVITY_ICONS[e.kind] || "📝"}</span>{e.title}{visitId && <span style={{ marginLeft: 6, fontSize: 10.5, color: "var(--accent)", fontWeight: 700 }}>View →</span>}</td>
                      <td style={{ color: "var(--text-dim)" }}>{e.meta || "—"}</td>
                      <td>{nameById[e.csm_id] || "System"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )
        )
      )}
    </div>
  );
}
