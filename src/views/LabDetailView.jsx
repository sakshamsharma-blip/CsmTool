import { useEffect, useState } from "react";
import { useSessionState } from "../lib/useSessionState";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { fmtMoney, toINR, nativeCurrency, segmentFor, fmtDuration } from "../lib/format";
import { labEngagementStats } from "../lib/labEngagement";
import { fetchLabActivity, logActivity, ACTIVITY_ICONS } from "../lib/activity";
import {
  fetchAllCollectionsItems, addCollectionsItem, updateItemCollected, convertItemToChargeable,
  updateCollectionsItem, deleteCollectionsItem,
  logCollectionsReminder, labCollectionsSummary, itemBalance, itemStatusLabel, AGING_COLORS,
} from "../lib/collections";
import {
  fetchInvoicesForLab, saveInvoice, updateInvoiceCollected, updateInvoice, deleteInvoice,
  INVOICE_TYPES, isRecurringInvoice, invoiceTypeLabel, monthlyEquivalent, coveredUntil, invoiceTypeForCycle,
  invoiceBalance, isInvoiceOpen, invoiceStatusLabel,
} from "../lib/invoices";
import { updateLabStatus, updateLabStageTags, updateLabTestimonial, updateLabDetails, updateLabBillingMode, updateLabMRR, fetchMrrHistory } from "../lib/labs";
import { HEALTH_STATUSES, isHealthyStatus, logLabPulse } from "../lib/pulse";
import { fetchAllVisits, fetchVisitById, updateVisit } from "../lib/visits";
import { syncFollowupTaskForVisit, addTask } from "../lib/tasks";
import { todayISO, dueDateFor } from "../lib/dates";
import { computeSentimentHealth, HEALTH_BUCKET_COLORS } from "../lib/labHealth";
import { CHURN_TYPES, logChurn } from "../lib/churn";
import { getCountryNames, getStatesForCountry, cityOptionsFor } from "../lib/geography";

const COUNTRY_NAMES = getCountryNames();
import Modal from "../components/Modal";
import InfoTip from "../components/InfoTip";
import Sparkline from "../components/Sparkline";
import SearchSelect from "../components/SearchSelect";
import LabAdoptionTab from "../components/LabAdoptionTab";
import { fetchLabPitchStatus } from "../lib/pitch";
import Paginated from "../components/Pager";
import LabContactsCard from "../components/LabContactsCard";
import LabDocumentsTab from "../components/LabDocumentsTab";

const SEG_NAME = { A: "Enterprise", B: "Premium", C: "Advance", D: "Standard", E: "Essential" };
const LAB_STATUSES = ["Active", "Inactive", "At Risk"]; // Churned/Contraction go through the Churn modal instead
const STAGE_TAGS = ["Adoption", "Expansion", "Support", "Pending Dues", "Open Points", "Pilot", "Future Churn", "Churn", "Rapo"];

// Same field vocab Log Check-in / Log Visit use — kept here too since the Visit Detail view
// (Lab History tab) edits the very same visit/check-in records.
// Testimonial Video Link only needs to be a real, reachable-looking URL — not a specific
// platform (Drive/YouTube/etc all vary too much to whitelist by domain).
function isValidHttpUrl(value) {
  if (!value || !value.trim()) return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const VISIT_TYPES = ["Visit", "Call", "GMeet", "Email", "WhatsApp", "Note"];
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

export default function LabDetailView({ lab, labs, modules, plans, csmNames, viewer, idByName, onBack, onOpenLab, onReassignCsm, onChangePlan, onInvoiceMrrUpdate, onPatchLab, onLogCheckin, onAddChildLab, initialTab, onTabChange, showToast }) {
  const { currentCSM } = viewer;
  const [tab, setTab] = useState(initialTab || "details");

  const [activity, setActivity] = useState([]);
  const [loadingActivity, setLoadingActivity] = useState(SUPABASE_CONFIGURED);
  const [activityError, setActivityError] = useState(null);
  const [activityKind, setActivityKind] = useSessionState("labHistory.kind", ""); // Lab History filter by entry type

  const [collItems, setCollItems] = useState([]);
  const [loadingColl, setLoadingColl] = useState(SUPABASE_CONFIGURED);
  const [collError, setCollError] = useState(null);
  const [collManualInputs, setCollManualInputs] = useState({});
  const [convertItem, setConvertItem] = useState(null);
  // This lab's pitch stages — only used to stop offering "Add Charges" on a trial whose feature was lost.
  const [pitchMap, setPitchMap] = useState({});
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return undefined;
    let cancelled = false;
    fetchLabPitchStatus(lab.id).then((m) => { if (!cancelled) setPitchMap(m); }).catch((err) => console.error(err));
    return () => { cancelled = true; };
  }, [lab.id]);
  const isLostAfterPurchase = (item) => {
    if (!item.moduleKey) return false;
    const stage = pitchMap[item.paramName ? `param:${item.moduleKey}|${item.paramName}` : `mod:${item.moduleKey}`];
    return stage === "Lost after Purchase" || stage === "Lost in Expansion";
  };
  // Edit forms for an existing invoice / Collections item: { …the record, form fields as strings }
  const [editInv, setEditInv] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [convertAmount, setConvertAmount] = useState("");
  const [savingConvert, setSavingConvert] = useState(false);
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
  const [churnMonth, setChurnMonth] = useState(todayISO());
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
  const [editName, setEditName] = useState(lab.name || "");
  const [editLabCode, setEditLabCode] = useState(lab.labCode || lab.id || "");
  const [editCity, setEditCity] = useState(lab.city || "");
  const [editState, setEditState] = useState(lab.state || "");
  const [editCountry, setEditCountry] = useState(lab.country || "");
  const [editRegion, setEditRegion] = useState(lab.region || "Domestic");
  const [editBillingType, setEditBillingType] = useState(lab.billingType || "Fixed");
  const [editPaymentCycle, setEditPaymentCycle] = useState(lab.paymentCycle || "Monthly");
  const [editCreditDays, setEditCreditDays] = useState(lab.creditDays || "30");
  const [editYearlyVisits, setEditYearlyVisits] = useState(lab.yearlyVisitsRequired != null ? String(lab.yearlyVisitsRequired) : "");
  const [editRemarks, setEditRemarks] = useState(lab.remarks || "");
  const [editMrr, setEditMrr] = useState(String(lab.mrr ?? ""));
  const [savingDetails, setSavingDetails] = useState(false);
  const [savingBillingMode, setSavingBillingMode] = useState(false);

  const [testimonialOpen, setTestimonialOpen] = useState(false);
  const [testimonialCollected, setTestimonialCollected] = useState(lab.testimonialCollected || false);
  const [testimonialUrl, setTestimonialUrl] = useState(lab.testimonialVideoUrl || "");
  const [savingTestimonial, setSavingTestimonial] = useState(false);

  const [mrrHistory, setMrrHistory] = useState([]);

  useEffect(() => {
    setTab(initialTab || "details");
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
  const [vEngagement, setVEngagement] = useState("");
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
    setVEngagement(v.engagement || "");
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
        engagement: vEngagement || null,
        durationMinutes: vDuration ? Number(vDuration) : null,
        location: vLocation,
        personName: vPersonName,
        personDesignation: vPersonDesignation,
        discussionTopics: vTopics,
        flaggedModules: vFlagged,
        actionItems: vActionItems.filter((it) => it.text.trim()).map((it) => ({ text: it.text.trim(), dueDate: it.dueDate || null })),
      });
      await syncFollowupTaskForVisit({
        visitId: openVisitId, labId: lab.id, labName: lab.name, ownerName: lab.csm || currentCSM, idByName,
        nextFollowupDate: vFollowup || null, nextFollowupReason: vFollowupReason,
      });
      // Action items added while editing become tasks too (same as at Log Check-in). Existing ones are
      // matched by their text so re-saving an unchanged check-in never creates duplicate tasks.
      const hadTexts = new Set((visitDetail?.actionItems || []).map((it) => (it.text || "").trim()));
      const newItems = vActionItems.filter((it) => it.text.trim() && !hadTexts.has(it.text.trim()));
      if (newItems.length) {
        await Promise.all(newItems.map((it) => addTask({
          labId: lab.id, desc: `Action item — ${lab.name}: ${it.text.trim()}`, owners: [lab.csm || currentCSM], type: "action-item", repeat: "none",
          due: it.dueDate || null, idByName, assignedByName: currentCSM,
        })));
      }
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

  async function handleUpdateItemCollected(item, overrideAmount) {
    const val = overrideAmount != null ? overrideAmount : parseFloat(collManualInputs[item.id]);
    if (!Number.isFinite(val) || val < 0) { showToast("Enter a valid amount."); return; }
    try {
      const status = await updateItemCollected(item.id, val, item.amount, lab.id, idByName?.[lab.csm], item.label, lab.region);
      setCollManualInputs((m) => ({ ...m, [item.id]: String(val) }));
      await loadCollections();
      showToast(status === "Collected" ? "Marked fully collected." : "Payment logged.");
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }
  // Invoice/Collections amounts everywhere else display rounded (fmtMoney) — comparisons here
  // stay exact on purpose, so "Mark Fully Collected" fills the *exact* stored owed amount
  // (never a rounded figure) rather than asking the CSM to retype it and risk a mismatch.
  function handleMarkItemFullyCollected(item) {
    handleUpdateItemCollected(item, item.amount);
  }

  function openConvertToChargeable(item) {
    setConvertItem(item);
    setConvertAmount("");
  }
  async function handleConvertToChargeable() {
    const amount = parseFloat(convertAmount);
    if (!Number.isFinite(amount) || amount <= 0) { showToast("Enter a valid chargeable amount."); return; }
    setSavingConvert(true);
    try {
      const csmId = idByName?.[lab.csm];
      // Adding charges records what the lab now owes; MRR itself moves with invoices (a Pro-Rata invoice adds
      // to it, the next recurring invoice sets it), so it's deliberately not bumped here.
      await convertItemToChargeable(convertItem.id, amount, lab.id, csmId, convertItem.label, lab.region);
      await loadCollections();
      setConvertItem(null);
      showToast(`Charges added for ${convertItem.label} — MRR will update from the next invoice.`);
    } catch (err) {
      showToast(`⚠ ${err.message}`);
    } finally {
      setSavingConvert(false);
    }
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

  async function handleUpdateInvoiceCollected(inv, overrideAmount) {
    const val = overrideAmount != null ? overrideAmount : parseFloat(invManualInputs[inv.id]);
    if (!Number.isFinite(val) || val < 0) { showToast("Enter a valid amount."); return; }
    try {
      const status = await updateInvoiceCollected(inv.id, val, inv.total, lab.id, idByName?.[lab.csm], inv.invoiceNumber, lab.region);
      setInvManualInputs((m) => ({ ...m, [inv.id]: String(val) }));
      await loadInvoices();
      showToast(status === "Collected" ? "Invoice marked fully collected." : "Payment logged.");
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }
  function handleMarkInvoiceFullyCollected(inv) {
    handleUpdateInvoiceCollected(inv, inv.total);
  }

  function openUploadInvoice() {
    setUploadOpen(true); setUploadStage("pick"); setUploadFile(null); setUploadForm(null); setUploadError("");
  }
  async function handleInvoiceFileChosen(file) {
    setUploadFile(file);
    setUploadStage("extracting");
    setUploadError("");
    try {
      // Loaded on demand: the PDF reader is most of the app's download size and only this step needs it.
      const { extractInvoiceFromFile } = await import("../lib/invoiceParse");
      const extracted = await extractInvoiceFromFile(file);
      // If the PDF didn't clearly say the billing period, start from the lab's Payment Cycle (Monthly / Quarterly /
      // Half Yearly / Annual) — the CSM can still change it before saving.
      setUploadForm(extracted.typeDetected ? extracted : { ...extracted, invoiceType: invoiceTypeForCycle(lab.paymentCycle) });
      setUploadStage("confirm");
      if (!extracted.extractedOk) showToast("Couldn't auto-read every field — see the note in the form.");
    } catch (err) {
      console.error(err);
      // The PDF reader is downloaded on demand. If this tab was opened before the app was updated, that download
      // points at the old version's file, which no longer exists — say so (a refresh fixes it) instead of an empty form
      // with no explanation. Any other failure still drops into the form so the CSM can type the details in.
      const staleApp = /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i.test(err?.message || "");
      setUploadForm({
        invoiceNumber: "", invoiceDate: "", invoiceType: invoiceTypeForCycle(lab.paymentCycle), subTotal: null, total: null, extractedOk: false,
        staleApp,
        problem: staleApp
          ? "The CS Console was updated while this page was open, so the invoice reader couldn't load. Refresh the page and upload again — or type the details in below."
          : `This PDF couldn't be read (${err?.message || "unknown error"}) — type the details in below.`,
      });
      setUploadStage("confirm");
      showToast(staleApp ? "The app was updated — refresh the page to read invoices again." : "Couldn't read this PDF automatically — please fill the details in by hand.");
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
      const saved = await saveInvoice({
        lab, invoiceNumber: f.invoiceNumber.trim(), invoiceType: f.invoiceType, invoiceDate: f.invoiceDate,
        subTotal: f.subTotal, total: f.total, extractedOk: f.extractedOk, sourceFilename: uploadFile?.name,
        csmId: idByName?.[lab.csm],
      });
      onInvoiceMrrUpdate?.(lab.id, saved.newMrr);
      setUploadOpen(false);
      await loadInvoices();
      showToast(isRecurringInvoice(f.invoiceType)
        ? `${invoiceTypeLabel(f.invoiceType)} invoice saved — MRR set to ${fmtMoney(saved.newMrr, lab.region)}, covered until ${new Date(coveredUntil(f.invoiceType, f.invoiceDate) + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}.`
        : `Pro-Rata invoice saved — MRR now ${fmtMoney(saved.newMrr, lab.region)}.`);
    } catch (err) {
      showToast(`⚠ ${err.message}`);
    } finally {
      setSavingInvoice(false);
    }
  }

  // ---- edit / delete an invoice (MRR moves only by what the change implies — see lib/invoices.js) ----
  function openEditInvoice(inv) {
    setEditInv({ ...inv, f: { invoiceNumber: inv.invoiceNumber, invoiceType: inv.invoiceType, invoiceDate: inv.invoiceDate, subTotal: String(inv.subTotal), total: String(inv.total) } });
  }
  async function handleSaveInvoiceEdit() {
    const f = editInv.f;
    const subTotal = parseFloat(f.subTotal), total = parseFloat(f.total);
    if (!f.invoiceNumber.trim() || !f.invoiceDate || !Number.isFinite(subTotal) || !Number.isFinite(total) || subTotal < 0 || total < 0) {
      showToast("Fill in the invoice number, date, sub total and total."); return;
    }
    setSavingEdit(true);
    try {
      const { newMrr } = await updateInvoice(editInv, { invoiceNumber: f.invoiceNumber.trim(), invoiceType: f.invoiceType, invoiceDate: f.invoiceDate, subTotal, total }, lab, invoices, idByName?.[lab.csm]);
      if (newMrr !== (Number(lab.mrr) || 0)) onPatchLab?.(lab.id, { mrr: newMrr });
      setEditInv(null);
      await loadInvoices();
      showToast(newMrr !== (Number(lab.mrr) || 0) ? `Invoice updated — MRR now ${fmtMoney(newMrr, lab.region)}.` : "Invoice updated.");
    } catch (err) { showToast(`⚠ ${err.message}`); }
    finally { setSavingEdit(false); }
  }
  async function handleDeleteInvoice(inv) {
    if (!window.confirm(`Delete invoice ${inv.invoiceNumber}?${inv.collectedManual ? " The payment recorded against it is deleted too." : ""} If it affects MRR, MRR is adjusted accordingly.`)) return;
    try {
      const { newMrr } = await deleteInvoice(inv, lab, invoices, idByName?.[lab.csm]);
      if (newMrr !== (Number(lab.mrr) || 0)) onPatchLab?.(lab.id, { mrr: newMrr });
      await loadInvoices();
      showToast(newMrr !== (Number(lab.mrr) || 0) ? `Invoice deleted — MRR now ${fmtMoney(newMrr, lab.region)}.` : "Invoice deleted.");
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  // ---- edit / delete a Collections item (never touches MRR) ----
  function openEditItem(item) {
    setEditItem({ ...item, f: { label: item.label, amount: String(item.amount) } });
  }
  async function handleSaveItemEdit() {
    const f = editItem.f;
    const amount = parseFloat(f.amount);
    if (!f.label.trim()) { showToast("Give the item a description."); return; }
    if (!editItem.isTrial && (!Number.isFinite(amount) || amount <= 0)) { showToast("Enter a valid amount owed."); return; }
    setSavingEdit(true);
    try {
      await updateCollectionsItem(editItem, { label: f.label.trim(), amount }, lab.id, idByName?.[lab.csm], lab.region);
      setEditItem(null);
      await loadCollections();
      showToast("Item updated.");
    } catch (err) { showToast(`⚠ ${err.message}`); }
    finally { setSavingEdit(false); }
  }
  async function handleDeleteItem(item) {
    if (!window.confirm(`Delete "${item.label}" from Collections?${item.collectedManual ? " The payment recorded against it is deleted too." : ""}`)) return;
    try {
      await deleteCollectionsItem(item, lab.id, idByName?.[lab.csm]);
      await loadCollections();
      showToast("Item deleted.");
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

  // Every lab — parent or child — can have its own MRR edited here. What differs is whether that value is
  // the one counted in the group total (see computeLabRollup in lib/labRollup.js), so `mrrNote` explains
  // that right next to the field instead of silently ignoring the edit:
  //  - Consolidated parent: its own MRR IS the group's MRR (normally set by the group's invoice).
  //  - Per-Branch parent: the group total is the sum of the children's MRR; the parent's own is kept but not counted.
  //  - Child of a Consolidated parent: kept for reference; only the parent's MRR counts toward the group.
  const mrrNote = (() => {
    if (lab.type === "Child") {
      const parentLab = labs.find((l) => l.id === lab.parent);
      if (parentLab?.billingMode === "Consolidated") {
        return `${parentLab.name} bills Consolidated, so only its own MRR counts toward the group total — this child's MRR is kept for reference.`;
      }
      return null;
    }
    if (lab.type === "Parent") {
      const kids = labs.filter((l) => l.type === "Child" && l.parent === lab.id);
      if (kids.length && lab.billingMode === "Consolidated") {
        return "Consolidated — this is the group's MRR (normally set by the group's recurring invoice). ARR = MRR × 12.";
      }
      if (kids.length) {
        return `Per-Branch — the group's MRR is the sum of each child lab's MRR (${fmtMoney(effectiveMRR(lab), lab.region)} right now), so this parent's own MRR is kept but not counted.`;
      }
    }
    return null;
  })();
  const mrrEditable = true;

  // Adoption changes now save immediately (each with its comment), so there's nothing unsaved to guard.
  function guardedNav(fn) {
    fn();
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
      setChurnMonth(todayISO());
      setChurnMrrLost(String(effectiveMRR(lab) || ""));
      setChurnReason("");
      setChurnOpen(true);
      return;
    }
    setSavingStatus(true);
    try {
      await updateLabStatus(lab.id, newStatus);
      onPatchLab?.(lab.id, { status: newStatus });
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
      const itemSummary = labCollectionsSummary(collItems, lab.creditDays);
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
      if (churnType === "Churned") onPatchLab?.(lab.id, { status: "Churned" });
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
      if (rating != null && (!Number.isFinite(rating) || rating < 0 || rating > 10)) {
        showToast("Rating must be a number from 0 to 10.");
        return;
      }
      await logLabPulse(lab.id, { healthStatus: pulseHealth, rating, note: pulseNote }, csmId);
      onPatchLab?.(lab.id, { healthStatus: pulseHealth, lastRating: rating });
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
      onPatchLab?.(lab.id, { stageTags: next });
    } catch (err) {
      setStageTags(stageTags); // revert on failure
      showToast(`⚠ ${err.message}`);
    } finally {
      setSavingStageTags(false);
    }
  }

  async function handleTestimonialSave() {
    if (testimonialCollected && !isValidHttpUrl(testimonialUrl)) {
      showToast("⚠ Enter a valid http:// or https:// link before saving.");
      return;
    }
    setSavingTestimonial(true);
    try {
      const csmId = idByName?.[lab.csm];
      await updateLabTestimonial(lab.id, { collected: testimonialCollected, videoUrl: testimonialUrl, csmId });
      onPatchLab?.(lab.id, {
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
    setEditName(lab.name || "");
    setEditLabCode(lab.labCode || lab.id || "");
    setEditCity(lab.city || "");
    setEditState(lab.state || "");
    setEditCountry(lab.country || "");
    setEditRegion(lab.region || "Domestic");
    setEditBillingType(lab.billingType || "Fixed");
    setEditPaymentCycle(lab.paymentCycle || "Monthly");
    setEditCreditDays(lab.creditDays || "30");
    setEditYearlyVisits(lab.yearlyVisitsRequired != null ? String(lab.yearlyVisitsRequired) : "");
    setEditRemarks(lab.remarks || "");
    setEditMrr(String(lab.mrr ?? ""));
    setDetailsEditMode(true);
  }

  function cancelEditDetails() {
    setDetailsEditMode(false);
  }

  async function handleSaveDetails() {
    const trimmedName = editName.trim();
    if (!trimmedName) {
      showToast("Lab Name can't be empty.");
      return;
    }
    const trimmedLabCode = editLabCode.trim();
    if (!trimmedLabCode) {
      showToast("Lab ID can't be empty.");
      return;
    }
    if (labs.some((l) => l.id !== lab.id && (l.labCode || l.id || "").trim().toLowerCase() === trimmedLabCode.toLowerCase())) {
      showToast(`⚠ Lab ID "${trimmedLabCode}" is already in use by another lab.`);
      return;
    }
    if (mrrEditable) {
      const parsedMrr = parseFloat(editMrr);
      if (editMrr !== "" && (!Number.isFinite(parsedMrr) || parsedMrr < 0)) {
        showToast("Enter a valid MRR amount.");
        return;
      }
    }
    setSavingDetails(true);
    try {
      const patch = {
        name: trimmedName, labCode: trimmedLabCode, city: editCity, state: editState, country: editCountry, region: editRegion,
        billingType: editBillingType, paymentCycle: editPaymentCycle, creditDays: editCreditDays, remarks: editRemarks,
        yearlyVisitsRequired: editYearlyVisits === "" ? null : parseInt(editYearlyVisits, 10),
      };
      await updateLabDetails(lab.id, patch);
      onPatchLab?.(lab.id, patch);
      const csmId = idByName?.[lab.csm];
      logActivity(lab.id, { kind: "Details Updated", title: "Lab details updated", csmId }).catch((err) => console.error(err));

      const parsedMrr = parseFloat(editMrr);
      if (mrrEditable && Number.isFinite(parsedMrr) && parsedMrr !== (lab.mrr || 0)) {
        await updateLabMRR(lab.id, parsedMrr, lab.region, "manual");
        onPatchLab?.(lab.id, { mrr: parsedMrr });
        logActivity(lab.id, {
          kind: "MRR Updated", title: `MRR set to ${fmtMoney(parsedMrr, lab.region)}`, csmId,
        }).catch((err) => console.error(err));
      }

      setDetailsEditMode(false);
      showToast("Lab details updated.");
    } catch (err) {
      // Postgres unique_violation — the client-side check above already catches this for labs
      // already loaded, but this is the backstop (e.g. a lab another CSM just renamed to the
      // same code, not yet reflected in this session's local labs list).
      showToast(err.code === "23505" ? `⚠ Lab ID "${trimmedLabCode}" is already in use by another lab.` : `⚠ ${err.message}`);
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
      onPatchLab?.(lab.id, { billingMode: next });
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
    ...(SUPABASE_CONFIGURED ? [{ key: "contacts", label: "Points of Contact" }] : []),
    ...(lab.type === "Parent" ? [{ key: "childlabs", label: `Child Labs (${children.length})` }] : []),
    { key: "adoption", label: "Adoption" },
    { key: "collections", label: `Collections${collItems.length ? ` (${collItems.length})` : ""}` },
    { key: "history", label: `Lab History${activity.length ? ` (${activity.length})` : ""}` },
    ...(SUPABASE_CONFIGURED ? [{ key: "documents", label: "Documents" }] : []),
  ];

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
              style={{ background: "var(--bg)", color: HEALTH_BUCKET_COLORS[sentHealth.bucket] }}
              title="Lab Health (Sentiment) — auto, from logged visit/check-in sentiment. Separate from the manual Health Status above."
            >
              Lab Health: {sentHealth.bucket}
            </span>
          </div>
        </div>
        <div className="detail-meta">
          <div className="m"><div>Lab ID</div><div>{lab.labCode || lab.id}</div></div>
          <div className="m"><div>Type</div><div>{lab.type} Lab</div></div>
          <div className="m"><div>CSM</div><div>{lab.csm}</div></div>
          <div className="m"><div>Plan</div><div>{plan.name}</div></div>
          <div className="m"><div>Segment</div><div>{seg.code} — {SEG_NAME[seg.code]}</div></div>
          <div className="m"><div>Current MRR</div><div>{fmtMoney(effectiveMRR(lab), lab.region)}</div></div>
          <div className="m"><div>Current ARR</div><div>{fmtMoney(effectiveMRR(lab) * 12, lab.region)}</div></div>
          <div className="m"><div>City, State</div><div>{lab.city ? lab.city + ", " : ""}{lab.state}</div></div>
          <div className="m" title="Total of the Duration entered on this lab's check-ins"><div>Time Spent</div><div>{fmtDuration(labEngagementStats(labVisits).totalMinutes)}</div></div>
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
            onClick={() => { setTab(t.key); onTabChange?.(t.key); }}
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
                {row("Lab Name", lab.name,
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} style={inputStyle} placeholder="Lab name" />
                )}
                {row("Lab ID", lab.labCode || lab.id,
                  <input value={editLabCode} onChange={(e) => setEditLabCode(e.target.value)} style={inputStyle} placeholder="Lab ID" />
                )}
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
                {row("Country", lab.country,
                  <div style={{ maxWidth: 320 }}>
                    <SearchSelect
                      value={editCountry}
                      onChange={(v) => { setEditCountry(v); setEditState(""); }}
                      options={COUNTRY_NAMES.map((n) => ({ value: n, label: n }))}
                      placeholder="Search a country…"
                      inputStyle={inputStyle}
                    />
                  </div>
                )}
                {row("State", lab.state, (() => {
                  const stateOptions = getStatesForCountry(editCountry);
                  return stateOptions.length ? (
                    <div style={{ maxWidth: 320 }}>
                      <SearchSelect
                        value={editState}
                        onChange={setEditState}
                        options={stateOptions.map((n) => ({ value: n, label: n }))}
                        placeholder={editCountry ? "Search a state…" : "Select a Country first"}
                        disabled={!editCountry}
                        inputStyle={inputStyle}
                      />
                    </div>
                  ) : (
                    <input value={editState} onChange={(e) => setEditState(e.target.value)}
                      placeholder={editCountry ? "Enter State" : "Select a Country first"} disabled={!editCountry} style={inputStyle} />
                  );
                })())}
                {row("City", lab.city || "—", (
                  <div>
                    <input value={editCity} onChange={(e) => setEditCity(e.target.value)} style={inputStyle} list="lab-city-suggestions" />
                    <datalist id="lab-city-suggestions">
                      {cityOptionsFor(labs, editState).map((c) => <option key={c} value={c} />)}
                    </datalist>
                  </div>
                ))}
                {row("Client Segment", `${seg.code} — ${SEG_NAME[seg.code]}`)}
                {row("Credit Days", lab.creditDays || "30",
                  <input
                    type="number" min="0" step="1" inputMode="numeric" value={editCreditDays}
                    onChange={(e) => setEditCreditDays(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="e.g. 30" style={inputStyle}
                  />
                )}
                {row("Yearly Visits Required", lab.yearlyVisitsRequired != null ? lab.yearlyVisitsRequired : "—",
                  <input
                    type="number" min="0" step="1" inputMode="numeric" value={editYearlyVisits}
                    onChange={(e) => setEditYearlyVisits(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder={lab.type === "Parent" ? "required, e.g. 4" : "optional"} style={inputStyle}
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
                {row("Current MRR", fmtMoney(effectiveMRR(lab), lab.region),
                  <div>
                    <input
                      type="number" min="0" step="0.01" inputMode="decimal" value={editMrr}
                      onChange={(e) => setEditMrr(e.target.value)}
                      placeholder="e.g. 25000" style={inputStyle}
                    />
                    {mrrNote && <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4, fontWeight: 400, maxWidth: 420 }}>{mrrNote}</div>}
                  </div>
                )}
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
            {/* Only a CSM Lead or Admin can move a lab to another CSM (also enforced in the database — migration 0024). */}
            {viewer.isHead && <button className="btn btn-ghost" onClick={() => { setNewCsm(lab.csm); setReassignOpen(true); }}>Reassign CSM</button>}
            <button className="btn btn-ghost" onClick={() => { setNewPlan(lab.plan); setPlanReason(""); setChangePlanOpen(true); }}>Change Plan</button>
            <button className="btn btn-ghost" onClick={() => { setNewStatus(lab.status); setStatusOpen(true); }}>Change Status</button>
            <button className="btn btn-ghost" onClick={() => { setPulseHealth(lab.healthStatus || "No Risk"); setPulseRating(lab.lastRating != null ? String(lab.lastRating) : ""); setPulseNote(""); setPulseOpen(true); }}>Log Health Check</button>
            <button className="btn btn-ghost" onClick={() => { setTestimonialCollected(lab.testimonialCollected || false); setTestimonialUrl(lab.testimonialVideoUrl || ""); setTestimonialOpen(true); }}>Edit Testimonial</button>
          </div>
        </div>
      )}
      {tab === "contacts" && SUPABASE_CONFIGURED && <LabContactsCard lab={lab} csmId={idByName?.[currentCSM]} showToast={showToast} />}
      {tab === "documents" && <LabDocumentsTab lab={lab} csmId={idByName?.[currentCSM]} showToast={showToast} />}

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
        open={!!editInv}
        title={editInv ? `Edit Invoice ${editInv.invoiceNumber}` : ""}
        onClose={() => setEditInv(null)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setEditInv(null), disabled: savingEdit },
          { label: savingEdit ? "Saving…" : "Save Changes", className: "btn-primary", onClick: handleSaveInvoiceEdit, disabled: savingEdit },
        ]}
      >
        {editInv && (() => {
          const fs = { width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" };
          const setF = (k, v) => setEditInv((e) => ({ ...e, f: { ...e.f, [k]: v } }));
          const sym = nativeCurrency(lab.region) === "USD" ? "$" : "₹";
          return (
            <>
              <div className="tmpl-field" style={{ marginBottom: 10 }}><label>Invoice Number</label><input style={fs} value={editInv.f.invoiceNumber} onChange={(e) => setF("invoiceNumber", e.target.value)} /></div>
              <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                <div className="tmpl-field" style={{ flex: 1 }}><label>Type</label>
                  <select style={fs} value={editInv.f.invoiceType} onChange={(e) => setF("invoiceType", e.target.value)}>
                    {INVOICE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="tmpl-field" style={{ flex: 1 }}><label>Invoice Date</label><input type="date" style={fs} value={editInv.f.invoiceDate} onChange={(e) => setF("invoiceDate", e.target.value)} /></div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div className="tmpl-field" style={{ flex: 1 }}><label>Sub Total ({sym})</label><input type="number" min="0" step="0.01" style={fs} value={editInv.f.subTotal} onChange={(e) => setF("subTotal", e.target.value)} /></div>
                <div className="tmpl-field" style={{ flex: 1 }}><label>Total ({sym})</label><input type="number" min="0" step="0.01" style={fs} value={editInv.f.total} onChange={(e) => setF("total", e.target.value)} /></div>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10 }}>
                Due date is recalculated from the invoice date + Credit Days. If this invoice is the one setting MRR (latest recurring invoice, or a later Pro-Rata), MRR moves by the difference.
              </div>
            </>
          );
        })()}
      </Modal>

      <Modal
        open={!!editItem}
        title="Edit Collections Item"
        onClose={() => setEditItem(null)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setEditItem(null), disabled: savingEdit },
          { label: savingEdit ? "Saving…" : "Save Changes", className: "btn-primary", onClick: handleSaveItemEdit, disabled: savingEdit },
        ]}
      >
        {editItem && (() => {
          const fs = { width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" };
          return (
            <>
              <div className="tmpl-field" style={{ marginBottom: 10 }}><label>Feature / Description</label>
                <input style={fs} value={editItem.f.label} onChange={(e) => setEditItem((x) => ({ ...x, f: { ...x.f, label: e.target.value } }))} /></div>
              {editItem.isTrial ? (
                <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>This is a trial item — use “Add Charges” to put a price on it.</div>
              ) : (
                <div className="tmpl-field"><label>Amount Owed ({nativeCurrency(lab.region) === "USD" ? "$" : "₹"})</label>
                  <input type="number" min="0" step="0.01" style={fs} value={editItem.f.amount} onChange={(e) => setEditItem((x) => ({ ...x, f: { ...x.f, amount: e.target.value } }))} /></div>
              )}
            </>
          );
        })()}
      </Modal>

      <Modal
        open={!!convertItem}
        title="Add Charges"
        onClose={() => setConvertItem(null)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setConvertItem(null), disabled: savingConvert },
          { label: savingConvert ? "Saving…" : "Add Charges", className: "btn-primary", onClick: handleConvertToChargeable, disabled: savingConvert },
        ]}
      >
        <div className="tmpl-field">
          <label>{convertItem?.label} — Monthly Charge ({nativeCurrency(lab.region) === "USD" ? "$" : "₹"})</label>
          <input
            type="number" min="0" step="0.01" inputMode="decimal" value={convertAmount}
            onChange={(e) => setConvertAmount(e.target.value)}
            placeholder="e.g. 5000" autoFocus
            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }}
          />
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>
            Moves this trial to priced and records the amount owed. {lab.name}'s MRR updates when the invoice comes in
            (a Pro-Rata invoice adds to it; the next recurring invoice sets it).
          </div>
        </div>
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
          {
            label: "Save", className: "btn-primary", onClick: handleTestimonialSave,
            disabled: savingTestimonial || (testimonialCollected && !isValidHttpUrl(testimonialUrl)),
          },
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
            <input type="url" value={testimonialUrl} onChange={(e) => setTestimonialUrl(e.target.value)} placeholder="https://…"
              style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }} />
            {testimonialUrl && !isValidHttpUrl(testimonialUrl) && (
              <div style={{ color: "var(--danger, #c0392b)", fontSize: 12, marginTop: 4 }}>
                Enter a valid http:// or https:// link.
              </div>
            )}
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
                    <td>{c.labCode || c.id}</td>
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
        <LabAdoptionTab
          key={lab.id}
          lab={lab} modules={modules} plans={plans} idByName={idByName} currentCSM={currentCSM}
          myProfileId={idByName?.[viewer.myName]} isHead={viewer.isHead}
          showToast={showToast} onPatchLab={onPatchLab}
          onChanged={() => {
            fetchLabActivity(lab.id).then(setActivity).catch((err) => console.error(err));
            loadCollections();
            fetchLabPitchStatus(lab.id).then(setPitchMap).catch((err) => console.error(err));
          }}
        />
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
              <InfoTip>Upload an invoice below — its date, amount and type are read automatically and you confirm before saving. A recurring invoice (Monthly / Quarterly / Half-yearly / Annual) sets this lab's MRR to its Sub Total ÷ the months it covers — e.g. a ₹60,000 half-yearly invoice → MRR ₹10,000 — and the lab is billed up to the end of that period. A Pro-Rata invoice adds its Sub Total to the current MRR until the next recurring invoice. Due date is the last day to pay — invoice date + this lab's Credit Days ({lab.creditDays || "30"}) − 1 — so it's overdue from the next day.</InfoTip>
            </div>

            {(() => {
              const itemSummary = labCollectionsSummary(collItems, lab.creditDays);
              const openInvoices = invoices.filter(isInvoiceOpen);
              const invOutstanding = openInvoices.reduce((s, iv) => s + invoiceBalance(iv), 0);
              const invOldestDays = openInvoices.reduce((max, iv) => Math.max(max, Math.floor((Date.now() - new Date(iv.dueDate + "T00:00:00")) / 86400000)), 0);
              const outstanding = itemSummary.outstanding + invOutstanding;
              const openCount = itemSummary.openCount + openInvoices.length;
              const daysOverdue = Math.max(itemSummary.daysOverdue, invOldestDays > 0 ? invOldestDays : 0);
              const bucket = openCount ? (daysOverdue >= 45 ? "Critical" : daysOverdue >= 30 ? "Overdue" : daysOverdue >= 15 ? "Due Soon" : "Current") : "Current";
              const lastPayment = [itemSummary.lastPayment, ...invoices.map((iv) => iv.collectedAt)].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
              // Average MRR = average per-month "Total" across this lab's recurring invoices (a quarterly invoice
              // counts as its total ÷ 3, half-yearly ÷ 6, annual ÷ 12). Pro-Rata invoices are one-off top-ups and
              // would skew an MRR-labeled average, so they're left out.
              const mrrInvoices = invoices.filter((iv) => isRecurringInvoice(iv.invoiceType));
              const avgMrr = mrrInvoices.length ? mrrInvoices.reduce((s, iv) => s + (monthlyEquivalent(iv.invoiceType, iv.total) || 0), 0) / mrrInvoices.length : null;
              // "Paid up to" = the latest end date any recurring invoice covers.
              const paidUpTo = mrrInvoices.map((iv) => coveredUntil(iv.invoiceType, iv.invoiceDate)).filter(Boolean).sort().pop() || null;
              return (
                <div className="summary-grid" style={{ margin: "12px 0" }}>
                  <div className="stile"><div className="sval">{fmtMoney(outstanding, lab.region)}</div><div className="slabel">Outstanding</div></div>
                  <div className="stile"><div className="sval">{openCount ? `${daysOverdue}d` : "—"}</div><div className="slabel">Days Overdue</div></div>
                  <div className="stile"><div className="sval" style={{ color: AGING_COLORS[bucket] }}>{bucket}</div><div className="slabel">Status</div></div>
                  <div className="stile"><div className="sval" style={{ fontSize: 12.5 }}>{lastPayment ? new Date(lastPayment).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}</div><div className="slabel">Last Payment</div></div>
                  <div className="stile"><div className="sval">{avgMrr != null ? fmtMoney(avgMrr, lab.region) : "—"}</div><div className="slabel">Average MRR</div></div>
                  <div className="stile" title="Latest date covered by a Monthly / Quarterly / Half-yearly / Annual invoice"><div className="sval" style={{ fontSize: 12.5 }}>{paidUpTo ? new Date(paidUpTo + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"}</div><div className="slabel">Billed up to</div></div>
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
                <thead><tr><th>Invoice #</th><th>Type</th><th>Invoice Date</th><th>Covers</th><th>Due Date</th><th>Sub Total</th><th>Total</th><th>Collected</th><th>Status</th><th></th></tr></thead>
                <tbody>{invoices.map((inv) => {
                  const bal = invoiceBalance(inv);
                  return (
                    <tr key={inv.id}>
                      <td>{inv.invoiceNumber}{!inv.extractedOk && <span className="cat-tag cat-Warn" title="Auto-extraction couldn't read every field — check this row's numbers"> ⚠ check</span>}</td>
                      <td><span className={`cat-tag cat-${isRecurringInvoice(inv.invoiceType) ? "Adoption" : "Expansion"}`}>{invoiceTypeLabel(inv.invoiceType)}</span></td>
                      <td style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{new Date(inv.invoiceDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" })}</td>
                      <td style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap" }} title={isRecurringInvoice(inv.invoiceType) ? `MRR ${fmtMoney(monthlyEquivalent(inv.invoiceType, inv.subTotal), lab.region)}/month` : "One-off top-up"}>
                        {isRecurringInvoice(inv.invoiceType)
                          ? `till ${new Date(coveredUntil(inv.invoiceType, inv.invoiceDate) + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" })}`
                          : "—"}
                      </td>
                      <td style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{new Date(inv.dueDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" })}</td>
                      <td className="mrr-cell">{fmtMoney(inv.subTotal, lab.region)}</td>
                      <td className="mrr-cell">{fmtMoney(inv.total, lab.region)}</td>
                      <td>
                        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input type="number" placeholder={bal > 0 ? String(inv.collectedManual || "") : undefined} value={invManualInputs[inv.id] ?? (inv.collectedManual || "")}
                              onChange={(e) => setInvManualInputs((m) => ({ ...m, [inv.id]: e.target.value }))}
                              style={{ width: 84, border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px", fontSize: 11.5 }} />
                            <button className="mark-purchased" onClick={() => handleUpdateInvoiceCollected(inv)}>Update</button>
                          </span>
                          {bal > 0 && (
                            <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>
                              Owed exactly {inv.total} — <button type="button" onClick={() => handleMarkInvoiceFullyCollected(inv)}
                                style={{ border: "none", background: "none", padding: 0, font: "inherit", color: "var(--accent, #2563eb)", cursor: "pointer", textDecoration: "underline" }}>
                                Mark Fully Collected
                              </button>
                            </span>
                          )}
                        </span>
                      </td>
                      <td>
                        <span className={`status-chip ${bal > 0 ? (inv.collectedManual > 0 ? "st-InProgress" : "st-Critical") : "st-Adopted"}`} style={{ cursor: "default" }}>
                          {invoiceStatusLabel(inv)}
                        </span>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span className="icon-btn" title="Edit invoice" style={{ cursor: "pointer" }} onClick={() => openEditInvoice(inv)}>✎</span>
                        <span className="icon-btn" title="Delete invoice" style={{ cursor: "pointer", marginLeft: 6 }} onClick={() => handleDeleteInvoice(inv)}>🗑</span>
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
                <thead><tr><th>Feature</th><th>Added</th><th>Owed</th><th>Collected</th><th>Status</th><th></th></tr></thead>
                <tbody>{collItems.map((item) => {
                  const bal = itemBalance(item);
                  return (
                    <tr key={item.id}>
                      <td>{item.label}{item.isTrial && <span className="cat-tag" style={{ background: "var(--indigo-bg)", color: "var(--indigo-text)" }}> Trial/Free</span>}</td>
                      <td style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{new Date(item.addedDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</td>
                      <td className="mrr-cell">{item.isTrial ? "—" : fmtMoney(item.amount, lab.region)}</td>
                      <td>
                        {item.isTrial ? (
                          isLostAfterPurchase(item)
                            ? <span className="cat-tag cat-Warn">Lost after purchase</span>
                            : <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => openConvertToChargeable(item)}>Add Charges</button>
                        ) : (
                          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <input type="number" placeholder={String(item.collectedManual || "")} value={collManualInputs[item.id] ?? (item.collectedManual || "")}
                                onChange={(e) => setCollManualInputs((m) => ({ ...m, [item.id]: e.target.value }))}
                                style={{ width: 84, border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px", fontSize: 11.5 }} />
                              <button className="mark-purchased" onClick={() => handleUpdateItemCollected(item)}>Update</button>
                            </span>
                            {bal > 0 && (
                              <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>
                                Owed exactly {item.amount} — <button type="button" onClick={() => handleMarkItemFullyCollected(item)}
                                  style={{ border: "none", background: "none", padding: 0, font: "inherit", color: "var(--accent, #2563eb)", cursor: "pointer", textDecoration: "underline" }}>
                                  Mark Fully Collected
                                </button>
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`status-chip ${item.isTrial ? "st-Adopted" : bal > 0 ? (item.collectedManual > 0 ? "st-InProgress" : "st-Critical") : "st-Adopted"}`} style={{ cursor: "default" }}>
                          {itemStatusLabel(item)}
                        </span>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span className="icon-btn" title="Edit item" style={{ cursor: "pointer" }} onClick={() => openEditItem(item)}>✎</span>
                        <span className="icon-btn" title="Delete item" style={{ cursor: "pointer", marginLeft: 6 }} onClick={() => handleDeleteItem(item)}>🗑</span>
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
                  {isRecurringInvoice(uploadForm.invoiceType) && (() => {
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
                    <div className="warn-banner" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ flex: "1 1 240px" }}>
                        <b>{uploadFile?.name}:</b> {uploadForm.problem || "Couldn't auto-read every field — please fill in / correct the details below."}
                      </span>
                      {uploadForm.staleApp && (
                        <button type="button" className="btn btn-primary" style={{ fontSize: 11.5, padding: "5px 12px" }} onClick={() => window.location.reload()}>Refresh now</button>
                      )}
                    </div>
                  )}
                  <div className="frow">
                    <div className="field"><label>Invoice Number</label>
                      <input value={uploadForm.invoiceNumber} onChange={(e) => setUploadForm((f) => ({ ...f, invoiceNumber: e.target.value }))} /></div>
                    <div className="field"><label>Invoice Type</label>
                      <select value={uploadForm.invoiceType} onChange={(e) => setUploadForm((f) => ({ ...f, invoiceType: e.target.value }))}>
                        {INVOICE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <div className="hint">{lab.name}'s Payment Cycle: {lab.paymentCycle || "Monthly"}.</div>
                    </div>
                  </div>
                  <div className="frow">
                    <div className="field"><label>Invoice Date</label>
                      <input type="date" value={uploadForm.invoiceDate} onChange={(e) => setUploadForm((f) => ({ ...f, invoiceDate: e.target.value }))} /></div>
                    <div className="field"><label>Due Date (auto)</label>
                      <input readOnly value={uploadForm.invoiceDate ? new Date(dueDateFor(uploadForm.invoiceDate, lab.creditDays) + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"} />
                      <div className="hint">Last day to pay: invoice date + Credit Days ({lab.creditDays || "30"}) − 1. Overdue from the next day.</div>
                    </div>
                  </div>
                  <div className="frow">
                    <div className="field"><label>Sub Total ({nativeCurrency(lab.region) === "USD" ? "$" : "₹"}) {isRecurringInvoice(uploadForm.invoiceType)
                      ? <span className="hint" style={{ fontWeight: 400 }}>— {uploadForm.invoiceType === "Monthly" ? "becomes this lab's MRR" : `÷ ${INVOICE_TYPES.find((t) => t.value === uploadForm.invoiceType).months} = this lab's MRR${uploadForm.subTotal ? ` (${fmtMoney(monthlyEquivalent(uploadForm.invoiceType, uploadForm.subTotal), lab.region)})` : ""}`}</span>
                      : <span className="hint" style={{ fontWeight: 400 }}>— added to this lab's MRR</span>}</label>
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
                        {row("Proactive / Reactive", visitDetail.engagement || "—",
                          <select value={vEngagement} onChange={(e) => setVEngagement(e.target.value)} style={inputStyle}>
                            <option value="">Not set</option><option>Proactive</option><option>Reactive</option>
                          </select>
                        )}
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
                                  background: vSentiment === s.key ? s.color : "var(--surface)", color: vSentiment === s.key ? "#fff" : "var(--text)",
                                  borderRadius: 9, padding: "7px 12px", fontSize: 12, fontWeight: 600,
                                }}
                              >
                                {s.key}
                              </button>
                            ))}
                          </div>
                        )}
                        {row("Discussed Parameters", visitDetail.discussedParams?.length ? visitDetail.discussedParams.map((k) => k.split("|")[1]).join(", ") : "—")}
                        {row("Discussed Modules", visitDetail.flaggedModules?.length ? visitDetail.flaggedModules.map((k) => modules.find((m) => m.key === k)?.name || k).join(", ") : "—",
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
            {(() => {
              // Engagement from this lab's check-ins: time spent = sum of each check-in's Duration.
              const e = labEngagementStats(labVisits);
              return (
                <div className="summary-grid" style={{ paddingTop: 0 }}>
                  <div className="stile"><div className="sval">{fmtDuration(e.totalMinutes)}</div><div className="slabel">Time spent (all)</div></div>
                  <div className="stile"><div className="sval">{fmtDuration(e.last30Minutes)}</div><div className="slabel">Time spent (30 days)</div></div>
                  <div className="stile"><div className="sval">{fmtDuration(e.yearMinutes)}</div><div className="slabel">Time spent (this year)</div></div>
                  <div className="stile"><div className="sval" style={{ color: "var(--ok)" }}>{e.proactive}</div><div className="slabel">Proactive check-ins</div></div>
                  <div className="stile"><div className="sval" style={{ color: "var(--warn)" }}>{e.reactive}</div><div className="slabel">Reactive check-ins</div></div>
                  <div className="stile"><div className="sval">{e.count - e.proactive - e.reactive}</div><div className="slabel">Not marked (older)</div></div>
                </div>
              );
            })()}

            {(() => {
              const kinds = [...new Set(activity.map((e) => e.kind).filter(Boolean))].sort();
              const shownActivity = activity.filter((e) => !activityKind || e.kind === activityKind);
              return (
            <>
            <div className="filters" style={{ margin: "4px 0 10px" }}>
              <select value={activityKind} onChange={(e) => setActivityKind(e.target.value)}>
                <option value="">All activity types</option>
                {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              {activityKind && <span className="clear" onClick={() => setActivityKind("")}>Clear filter</span>}
            </div>
            <Paginated items={shownActivity}>{(pageRows) => (
            <table className="activity-table">
              <thead><tr><th>Date &amp; Time</th><th>Activity</th><th>Details</th><th>Performed By</th></tr></thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr><td colSpan="4" style={{ textAlign: "center", color: "var(--text-faint)", padding: "20px 0" }}>{activity.length ? "No activity of this type." : "No activity logged for this lab yet."}</td></tr>
                ) : pageRows.map((e) => {
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
            )}</Paginated>
            </>
              );
            })()}
          </div>
          )
        )
      )}

    </div>
  );
}
