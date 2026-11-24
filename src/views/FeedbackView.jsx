import { useEffect, useState, useMemo, useRef } from "react";
import { useSessionState } from "../lib/useSessionState";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import {
  FEEDBACK_SOURCES, npsBucket, npsSummary, fetchFeedback, addFeedback, updateFeedback, deleteFeedback,
  fetchTestimonials, addTestimonial, updateTestimonial, deleteTestimonial, feedbackCoverage, feedbackTrend,
} from "../lib/feedback";
import { buildDemoFeedback } from "../lib/demoSeed";
import { computeLabRollup } from "../lib/labRollup";
import { toINR, fmtAmount } from "../lib/format";
import { periodContaining, previousPeriod } from "../lib/periods";
import { useChartTooltip } from "../lib/useChartTooltip";
import { Card, ScaleTrend } from "../components/Analytics";
import { fetchAllLabContacts, addLabContact } from "../lib/labContacts";
import { todayISO, addDaysISO } from "../lib/dates";
import { filterLabsByLabType } from "../lib/labs";
import { useScopedCsm } from "../lib/useScopedCsm";
import ScopeToggle from "../components/ScopeToggle";
import SearchSelect from "../components/SearchSelect";
import DesignationSelect from "../components/DesignationSelect";
import Paginated from "../components/Pager";
import Modal from "../components/Modal";
import BarChart from "../components/BarChart";
import InfoTip from "../components/InfoTip";
import { labSelectOptions } from "../lib/selectOptions";

const input = { border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", fontSize: 12.5, fontFamily: "inherit", background: "var(--surface)", color: "var(--text)" };
const field = { ...input, width: "100%", fontSize: 13, padding: "8px 10px" };
const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);
const BUCKET_COLOR = { Promoter: "var(--ok)", Passive: "var(--warn)", Detractor: "var(--bad)" };
const fmtDate = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
const fmtNps = (v) => (v == null ? "—" : `${v.toFixed(1)} / 10`);
const npsColor = (v) => (v == null ? undefined : v >= 9 ? "var(--ok)" : v >= 7 ? "var(--warn)" : "var(--bad)");
function isHttpUrl(v) {
  try { const u = new URL((v || "").trim()); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
}
function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@]/.test(s)) s = "'" + s; // keep spreadsheet apps from running it as a formula
  s = s.replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}
function downloadCsv(name, header, lines) {
  const blob = new Blob([[header.map(csvCell).join(","), ...lines.map((l) => l.map(csvCell).join(","))].join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${name}-${todayISO()}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

// Date choices (Nov 24 2026). Each names the range and, where there is one, the range before it to compare against.
const PERIOD_OPTIONS = [["all", "All time"], ["month", "This month"], ["last30", "Last 30 days"], ["quarter", "This quarter"], ["lastQuarter", "Last quarter"], ["year", "This year"], ["custom", "Custom dates…"]];
function periodRange(kind, today, from, to) {
  const span = (p) => ({ from: p.start, to: p.end, label: p.label });
  const GRAN = { month: "Monthly", quarter: "Quarterly", year: "Yearly" };
  if (GRAN[kind]) {
    const p = periodContaining(today, GRAN[kind]);
    const name = { month: "This month", quarter: "This quarter", year: "This year" }[kind];
    return { from: p.start, to: today, label: `${name} (${p.label})`, prev: span(previousPeriod(p)) };
  }
  if (kind === "lastQuarter") {
    const p = previousPeriod(periodContaining(today, "Quarterly"));
    return { from: p.start, to: p.end, label: `Last quarter (${p.label})`, prev: span(previousPeriod(p)) };
  }
  if (kind === "last30") return { from: addDaysISO(today, -29), to: today, label: "Last 30 days", prev: { from: addDaysISO(today, -59), to: addDaysISO(today, -30), label: "the 30 days before" } };
  if (kind === "custom" && (from || to)) return { from, to, label: `${from ? fmtDate(from) : "…"} – ${to ? fmtDate(to) : "…"}`, prev: null };
  return { from: "", to: "", label: "All time", prev: null };
}
const fmtShort = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const BUCKET_LABEL = { Promoter: "Promoters (9–10)", Passive: "Passives (7–8)", Detractor: "Detractors (0–6)" };

// Sidebar → Feedback & NPS. Labs give feedback OFFLINE (Google Form, email, WhatsApp); the CSM records each response
// here so it can be reported on. PARENT labs only (a child lab's feedback counts under its parent). "Given by" is
// picked from the lab's Points of Contact (or added as a new POC right from the form). Tabs, in order:
//   Report       — a plain-words headline, tiles, NPS-by-quarter and rating-by-month trends, who still owes this month's
//                  feedback / this quarter's NPS (rules in _shared/feedbackCoverage.js), breakdowns by NPS group,
//                  rating, CSM, designation and lab. Every number clicks through to the responses behind it.
//   Responses    — every saved response, newest first; click a row for the full details.
//   Testimonials — same format: date collected, lab, given by, designation, video link, note.
// Filters: lab, CSM (My Labs / Team View), designation, source and a date range (presets or custom).
export default function FeedbackView({ labs: allLabs, viewer, idByName, onOpenLab, showToast }) {
  const { isHead, scope, setScope, csmFilter, setCsmFilter, teamNames, scopeCsm, teamAll, labType, setLabType } = useScopedCsm(viewer, "feedback", "team");
  const labs = useMemo(() => filterLabsByLabType(allLabs, labType), [allLabs, labType]);
  const [tab, setTab] = useSessionState("feedback.view", "report");
  const [viewing, setViewing] = useState(null); // { kind: "feedback" | "testimonial", row } shown in the side panel
  // Demo mode (no database): fake responses so the report, coverage and trends can be tried; changes last until reload.
  const [demo] = useState(() => (SUPABASE_CONFIGURED ? null : buildDemoFeedback(todayISO())));
  const [feedback, setFeedback] = useState(() => demo?.feedback || []);
  const [testimonials, setTestimonials] = useState(() => demo?.testimonials || []);
  const [contacts, setContacts] = useState(() => demo?.contacts || []);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);
  const [fLab, setFLab] = useSessionState("feedback.fLab", "");
  const [fDesignation, setFDesignation] = useSessionState("feedback.fDesignation", "");
  const [fSource, setFSource] = useSessionState("feedback.fSource", "");
  const [from, setFrom] = useSessionState("feedback.from", "");
  const [to, setTo] = useSessionState("feedback.to", "");
  const [fPeriod, setFPeriod] = useSessionState("feedback.period", "all");
  // Set by clicking a chart bar, tile or headline on the Report; narrow the Responses list only.
  const [fBucket, setFBucket] = useSessionState("feedback.fBucket", "");
  const [fRating, setFRating] = useSessionState("feedback.fRating", "");
  const [dueShow, setDueShow] = useSessionState("feedback.dueShow", "due");
  const coverageRef = useRef(null);
  const tip = useChartTooltip();
  const [editing, setEditing] = useState(null);  // feedback response form (new or existing)
  const [tEditing, setTEditing] = useState(null); // testimonial form (new or existing)
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!SUPABASE_CONFIGURED) return;
    const [f, t, c] = await Promise.all([fetchFeedback(), fetchTestimonials(), fetchAllLabContacts().catch(() => [])]);
    setFeedback(f); setTestimonials(t); setContacts(c);
  }
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return undefined;
    let cancelled = false;
    Promise.all([fetchFeedback(), fetchTestimonials(), fetchAllLabContacts().catch(() => [])])
      .then(([f, t, c]) => { if (!cancelled) { setFeedback(f); setTestimonials(t); setContacts(c); } })
      .catch((err) => { if (!cancelled) setError(/lab_feedback|lab_testimonials|nps_score|collected_on/.test(err.message || "") ? "Feedback & NPS isn't fully set up in the database yet (migration 0040)." : err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading feedback…</div>;

  const labsById = Object.fromEntries(labs.map((l) => [l.id, l]));
  // Parent labs only; anything recorded against a child lab is counted under its parent.
  const parentOf = (labId) => { const l = labsById[labId]; return l && l.type === "Child" && l.parent ? l.parent : labId; };
  const parentLabs = labs.filter((l) => l.type !== "Child");
  const scopedLabs = parentLabs.filter((l) => !scopeCsm || l.csm === scopeCsm);
  const scopedIds = new Set(scopedLabs.map((l) => l.id));
  const labOptions = labSelectOptions(scopedLabs);
  const inScope = (labId) => { const p = parentOf(labId); return scopedIds.has(p) && (!fLab || p === fLab); };
  const today = todayISO();
  const range = periodRange(fPeriod, today, from, to);
  const inDates = (d) => (!range.from || (d && d >= range.from)) && (!range.to || (d && d <= range.to));
  const csmId = idByName[viewer.currentCSM];
  const nameById = Object.fromEntries(Object.entries(idByName).map(([n, id]) => [id, n]));
  const labName = (labId) => labsById[parentOf(labId)]?.name || labId;
  const labCsm = (labId) => labsById[parentOf(labId)]?.csm || "—";

  // Newest first: by date, then by when it was recorded.
  const newestFirst = (a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || "");
  // Every filter except the dates (the trend charts and the comparison use this).
  const matchesBase = (f) => inScope(f.labId) && (!fSource || f.source === fSource) && (!fDesignation || f.respondentDesignation === fDesignation);
  const responses = feedback.filter((f) => matchesBase(f) && inDates(f.date)).sort(newestFirst);
  const prevResponses = range.prev ? feedback.filter((f) => matchesBase(f) && f.date >= range.prev.from && f.date <= range.prev.to) : null;
  // The Responses list also honours a drill-down from the Report (an NPS group or a star rating).
  const listRows = responses.filter((r) => (!fBucket || npsBucket(r.npsScore) === fBucket) && (!fRating || String(r.rating) === fRating));
  const tRows = testimonials.filter((t) => inScope(t.labId) && inDates(t.date) && (!fDesignation || t.designation === fDesignation)).sort(newestFirst);
  const designations = [...new Set([...feedback.map((f) => f.respondentDesignation), ...testimonials.map((t) => t.designation)].filter(Boolean))].sort();

  // POCs of the chosen lab (and of its child labs), for the "Given by" pickers.
  const pocsFor = (labId) => contacts.filter((c) => c.labId === labId || parentOf(c.labId) === labId);
  async function addPoc(labId, { name, designation, minProactive }) {
    if (!SUPABASE_CONFIGURED) { const c = { id: `demo-poc-${Date.now()}`, labId, name, designation, minProactive }; setContacts((cs) => [...cs, c]); return c; }
    const c = await addLabContact(labId, { name, designation, minProactive }, csmId);
    setContacts((cs) => [...cs, c]);
    return c;
  }

  async function saveResponse(f) {
    if (!f.labId) { showToast("Pick a lab."); return; }
    if (!f.respondentName.trim()) { showToast("Pick who gave the feedback (from the lab's points of contact)."); return; }
    if (f.npsScore === "" && !f.rating) { showToast("Enter an NPS score (0–10) or a feedback rating (1–5) — at least one."); return; }
    if (f.linkUrl.trim() && !isHttpUrl(f.linkUrl)) { showToast("The supporting link must start with http:// or https://"); return; }
    if (!SUPABASE_CONFIGURED) {
      const row = { ...f, npsScore: f.npsScore === "" ? null : Number(f.npsScore), rating: f.rating ? Number(f.rating) : null, id: f.id || `demo-fb-${Date.now()}`, createdAt: f.createdAt || new Date().toISOString() };
      setFeedback((xs) => [row, ...xs.filter((x) => x.id !== row.id)]); setEditing(null); showToast("Saved for this demo session only.");
      return;
    }
    setSaving(true);
    try {
      if (f.id) await updateFeedback(f.id, f); else await addFeedback(f, csmId);
      setEditing(null); await load(); showToast(f.id ? "Response updated." : "Response saved — also logged to the lab's Lab History.");
    } catch (err) { showToast(`⚠ ${err.message}`); } finally { setSaving(false); }
  }
  async function saveTestimonial(t) {
    if (!t.labId) { showToast("Pick a lab."); return; }
    if (!t.personName.trim() || !t.designation.trim()) { showToast("Pick who gave the testimonial (from the lab's points of contact)."); return; }
    if (!isHttpUrl(t.videoUrl)) { showToast("Enter the video link (starting with http:// or https://)."); return; }
    if (!t.date) { showToast("Enter the date it was collected."); return; }
    if (!SUPABASE_CONFIGURED) {
      const row = { ...t, id: t.id || `demo-t-${Date.now()}`, createdAt: t.createdAt || new Date().toISOString() };
      setTestimonials((xs) => [row, ...xs.filter((x) => x.id !== row.id)]); setTEditing(null); showToast("Saved for this demo session only.");
      return;
    }
    setSaving(true);
    try {
      if (t.id) await updateTestimonial(t.id, t); else await addTestimonial(t, csmId);
      setTEditing(null); await load(); showToast(t.id ? "Testimonial updated." : "Testimonial saved.");
    } catch (err) { showToast(`⚠ ${err.message}`); } finally { setSaving(false); }
  }
  async function remove(kind, row) {
    if (!window.confirm("Delete this entry?")) return false;
    if (!SUPABASE_CONFIGURED) { (kind === "feedback" ? setFeedback : setTestimonials)((xs) => xs.filter((x) => x.id !== row.id)); return true; }
    try { await (kind === "feedback" ? deleteFeedback(row.id) : deleteTestimonial(row.id)); await load(); showToast("Deleted."); return true; }
    catch (err) { showToast(`⚠ ${err.message}`); return false; }
  }
  function exportCsv() {
    if (tab === "testimonials") {
      downloadCsv("testimonials", ["Date collected", "Lab", "CSM", "Given by", "Designation", "Video link", "Note"],
        tRows.map((t) => [t.date, labName(t.labId), labCsm(t.labId), t.personName, t.designation, t.videoUrl, t.note]));
      return;
    }
    const rows = tab === "responses" ? listRows : responses;
    downloadCsv("feedback-nps", ["Date", "Lab", "Lab ID", "CSM", "NPS (0-10)", "NPS group", "Rating (1-5)", "Given by", "Designation", "Source", "Comment", "Link", "Recorded by"],
      rows.map((r) => {
        const lab = labsById[parentOf(r.labId)];
        return [r.date, lab?.name || r.labId, lab?.labCode || r.labId, lab?.csm || "", r.npsScore ?? "", npsBucket(r.npsScore) || "", r.rating ?? "",
          r.respondentName, r.respondentDesignation, r.source, r.comment, r.linkUrl, nameById[r.createdBy] || ""];
      }));
  }

  // ---- report ----
  const sum = npsSummary(responses);
  const groupBy = (keyOf) => {
    const g = {};
    responses.forEach((r) => { const k = keyOf(r); if (k) (g[k] = g[k] || []).push(r); });
    return Object.entries(g).map(([k, list]) => ({ key: k, list, ...npsSummary(list), labs: new Set(list.map((r) => parentOf(r.labId))).size, last: list[0]?.date }));
  };
  const prevSum = prevResponses ? npsSummary(prevResponses) : null;

  // Cadence (decision Nov 24 2026): feedback (a 1–5 rating) monthly, NPS quarterly — rules in _shared/feedbackCoverage.js.
  // Uses the lab, CSM and lab-type filters, not the dates or designation / source: it's about whether the client answered.
  const clientMrr = Object.fromEntries(computeLabRollup(labs).map((r) => [r.id, toINR(r.mrr, r.region)]));
  const asRow = (f) => ({ lab: parentOf(f.labId), date: f.date, rating: f.rating, nps: f.npsScore });
  const cov = feedbackCoverage(scopedLabs.filter((l) => !fLab || l.id === fLab), feedback.filter((f) => inScope(f.labId)).map(asRow), today);
  const feedbackDue = cov.total - cov.feedbackThisMonth, npsDue = cov.total - cov.npsThisQuarter;
  const dueRows = cov.labs
    .filter((x) => dueShow === "all" || (dueShow === "feedback" ? !x.feedbackThisMonth : dueShow === "nps" ? !x.npsThisQuarter : !x.feedbackThisMonth || !x.npsThisQuarter))
    .sort((a, b) => ((!b.feedbackThisMonth) + (!b.npsThisQuarter)) - ((!a.feedbackThisMonth) + (!a.npsThisQuarter)) || (clientMrr[b.lab.id] || 0) - (clientMrr[a.lab.id] || 0));
  // Trends over time: every filter except the dates.
  const trendRows = feedback.filter(matchesBase).map(asRow);
  const npsTrend = feedbackTrend(trendRows, "quarter", 6, today);
  const ratingTrend = feedbackTrend(trendRows, "month", 12, today);

  // By CSM: every CSM with clients in view — this month's feedback and this quarter's NPS coverage, then the scores.
  const csmRows = [...new Set(cov.labs.map((x) => x.lab.csm).filter(Boolean))].sort().map((name) => {
    const list = responses.filter((r) => labCsm(r.labId) === name);
    const mine = cov.labs.filter((x) => x.lab.csm === name);
    return { key: name, list, total: mine.length, fbDone: mine.filter((x) => x.feedbackThisMonth).length, npsDone: mine.filter((x) => x.npsThisQuarter).length, ...npsSummary(list) };
  });
  const byLab = groupBy((r) => parentOf(r.labId)).sort((a, b) => (b.last || "").localeCompare(a.last || ""));
  const byDesignation = groupBy((r) => r.respondentDesignation || "Not recorded").sort((a, b) => b.list.length - a.list.length);
  const filtersOn = fLab || fDesignation || fSource || fPeriod !== "all" || fBucket || fRating;
  const clearFilters = () => { setFLab(""); setFDesignation(""); setFSource(""); setFrom(""); setTo(""); setFPeriod("all"); setFBucket(""); setFRating(""); };

  // Click-through from the Report to the responses behind a number.
  function drill({ bucket = "", rating = "", designation, lab, csm } = {}) {
    setFBucket(bucket); setFRating(rating ? String(rating) : "");
    if (designation !== undefined) setFDesignation(designation);
    if (lab !== undefined) setFLab(lab);
    if (csm && isHead) { setScope("team"); setCsmFilter(csm); }
    setTab("responses");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function showDue(kind) {
    setDueShow(kind);
    coverageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const blankResponse = (labId) => ({ labId, date: todayISO(), npsScore: "", rating: 0, source: "", respondentName: "", respondentDesignation: "", comment: "", linkUrl: "" });
  const cadenceCell = (done, date, value, scale, days) => (done
    ? <span className="fb-done">✓ {value}/{scale} <span className="fb-faint">· {fmtShort(date)}</span></span>
    : date
      ? <span className="fb-due">Due <span className="fb-faint">· last {fmtShort(date)} ({days} days ago)</span></span>
      : <span className="fb-never">Never recorded</span>);
  let npsChange = null;
  if (prevSum?.count && sum.count) {
    const d = Math.round((sum.avgNps - prevSum.avgNps) * 10) / 10;
    npsChange = d === 0 ? `the same as ${range.prev.label}` : `${d > 0 ? "up" : "down"} ${Math.abs(d).toFixed(1)} on ${range.prev.label}`;
  }

  const npsCell = (avg) => <b style={{ color: npsColor(avg) }}>{avg == null ? "—" : avg.toFixed(1)}</b>;

  return (
    <div>
      <h1 className="page-title">Feedback &amp; NPS</h1>
      <p className="page-sub">Record the feedback and NPS your labs give you — through a Google Form, by email or on WhatsApp — so it can be reported on. Viewing <b>{teamAll ? "the whole team" : scopeCsm}</b>'s labs.</p>
      {error && <div className="error-banner">{error}</div>}

      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={teamNames} labType={labType} setLabType={setLabType} />

      {/* Tabs on the left, Export / Record on the right; filters below (Nov 24 2026). */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div className="tabs" style={{ marginBottom: 0, width: "fit-content" }}>
          {[["report", "Report"], ["responses", `Responses (${listRows.length})`], ["testimonials", `Testimonials (${tRows.length})`]].map(([k, l]) => (
            <button key={k} type="button" className={`tab-btn${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={exportCsv} disabled={tab === "testimonials" ? !tRows.length : !(tab === "responses" ? listRows : responses).length}>Export CSV</button>
          {tab === "testimonials"
            ? <button className="btn btn-primary" onClick={() => setTEditing({ labId: fLab, date: todayISO(), personName: "", designation: "", videoUrl: "", note: "" })}>+ Add testimonial</button>
            : <button className="btn btn-primary" onClick={() => setEditing(blankResponse(fLab))}>+ Record feedback</button>}
        </span>
      </div>

      <div className="filters">
        <span style={{ minWidth: 220 }}><SearchSelect value={fLab} onChange={setFLab} options={labOptions} emptyLabel="All parent labs" placeholder="All parent labs" /></span>
        <select value={fDesignation} onChange={(e) => setFDesignation(e.target.value)} aria-label="Filter by designation">
          <option value="">All designations</option>
          {designations.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {tab !== "testimonials" && (
          <select value={fSource} onChange={(e) => setFSource(e.target.value)}>
            <option value="">All sources</option>
            {FEEDBACK_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <select value={fPeriod} onChange={(e) => setFPeriod(e.target.value)} aria-label="Date range">
          {PERIOD_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {fPeriod === "custom" && <>
          <label style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>From <input style={input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>To <input style={input} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </>}
        {tab === "responses" && fBucket && <span className="fb-chip">NPS: {BUCKET_LABEL[fBucket]} <button type="button" aria-label="Remove" onClick={() => setFBucket("")}>×</button></span>}
        {tab === "responses" && fRating && <span className="fb-chip">Rating: {plural(Number(fRating), "star")} <button type="button" aria-label="Remove" onClick={() => setFRating("")}>×</button></span>}
        {filtersOn && <span className="clear" onClick={clearFilters}>Clear filters</span>}
      </div>

      {tab === "responses" && (
        <div className="table-card">
          {!listRows.length ? <div style={{ padding: 20, color: "var(--text-faint)", fontSize: 12.5 }}>{feedback.length ? "No responses match these filters." : "No feedback recorded yet — use “+ Record feedback” to save one you collected through a form, email or WhatsApp."}</div> : (
            <Paginated items={listRows}>{(page) => (
              <div className="table-scroll"><table className="child-mini">
                <thead><tr><th>Date</th><th>Lab</th><th>CSM</th><th>NPS</th><th>Rating</th><th>Given by</th><th>Designation</th><th>Source</th><th>Comment</th><th>Link</th></tr></thead>
                <tbody>{page.map((r) => {
                  const b = npsBucket(r.npsScore);
                  return (
                    <tr key={r.id} className="fb-row" onClick={() => setViewing({ kind: "feedback", row: r })} title="Open the full response">
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                      <td className="lab-name clickable fb-cut" onClick={(e) => { e.stopPropagation(); onOpenLab(parentOf(r.labId)); }}>{labName(r.labId)}</td>
                      <td>{labCsm(r.labId)}</td>
                      <td>{r.npsScore == null ? "—" : <><b>{r.npsScore}</b>/10 <span style={{ fontSize: 10.5, fontWeight: 700, color: BUCKET_COLOR[b] }}>{b}</span></>}</td>
                      <td>{r.rating == null ? "—" : <span className="stars" title={`${r.rating} / 5`}>{stars(r.rating)}</span>}</td>
                      <td className="fb-cut">{r.respondentName || "—"}</td>
                      <td className="fb-cut">{r.respondentDesignation || "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.source || "—"}</td>
                      <td className="fb-cut fb-comment">{r.comment || <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.linkUrl ? <a href={r.linkUrl} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>Open ↗</a> : "—"}</td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            )}</Paginated>
          )}
        </div>
      )}

      {tab === "testimonials" && (
        <div className="table-card">
          {!tRows.length ? <div style={{ padding: 20, color: "var(--text-faint)", fontSize: 12.5 }}>{testimonials.length ? "No testimonials match these filters." : "No testimonials yet — use “+ Add testimonial”."}</div> : (
            <Paginated items={tRows}>{(page) => (
              <div className="table-scroll"><table className="child-mini">
                <thead><tr><th>Date collected</th><th>Lab</th><th>CSM</th><th>Given by</th><th>Designation</th><th>Video</th><th>Note</th></tr></thead>
                <tbody>{page.map((t) => (
                  <tr key={t.id} className="fb-row" onClick={() => setViewing({ kind: "testimonial", row: t })} title="Open the full testimonial">
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(t.date)}</td>
                    <td className="lab-name clickable fb-cut" onClick={(e) => { e.stopPropagation(); onOpenLab(parentOf(t.labId)); }}>{labName(t.labId)}</td>
                    <td>{labCsm(t.labId)}</td>
                    <td className="fb-cut">{t.personName || "—"}</td>
                    <td className="fb-cut">{t.designation}</td>
                    <td style={{ whiteSpace: "nowrap" }}><a href={t.videoUrl} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>🎬 Watch ↗</a></td>
                    <td className="fb-cut fb-comment">{t.note || <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}</Paginated>
          )}
        </div>
      )}

      {viewing && (
        <FeedbackDetail
          kind={viewing.kind} row={viewing.row} labName={labName(viewing.row.labId)} csm={labCsm(viewing.row.labId)}
          onOpenLab={() => { setViewing(null); onOpenLab(parentOf(viewing.row.labId)); }}
          onClose={() => setViewing(null)}
          onEdit={() => {
            const r = viewing.row; setViewing(null);
            if (viewing.kind === "feedback") setEditing({ ...r, labId: parentOf(r.labId), npsScore: r.npsScore ?? "", rating: r.rating || 0 });
            else setTEditing({ ...r, labId: parentOf(r.labId), date: r.date || todayISO() });
          }}
          onDelete={async () => { const v = viewing; if (await remove(v.kind, v.row)) setViewing(null); }}
        />
      )}

      {tab === "report" && (<>
        {/* 1. The answer first, in words, with links to the responses / clients behind it. */}
        <div className="table-card fb-headline">
          <div className="fb-hl-title">{range.label}{fLab ? ` · ${labsById[fLab]?.name || ""}` : ""}{!teamAll ? ` · ${scopeCsm}` : ""}</div>
          <ul>
            <li>
              {sum.count
                ? <>Average NPS <b style={{ color: npsColor(sum.avgNps) }}>{sum.avgNps.toFixed(1)} / 10</b> from {plural(sum.count, "response")}{npsChange ? <>, {npsChange}</> : null}</>
                : <>No NPS scores recorded in this period</>}
              {sum.ratedCount ? <>; average rating <b>{sum.avgRating.toFixed(1)} / 5</b> from {plural(sum.ratedCount, "rating")}</> : null}.
            </li>
            {sum.count > 0 && (
              <li>{sum.detractors
                ? <><button type="button" className="fb-link fb-link-bad" onClick={() => drill({ bucket: "Detractor" })}>{plural(sum.detractors, "detractor")}</button> (scored 0–6) to follow up.</>
                : <>No detractors in this period.</>}</li>
            )}
            <li>Monthly feedback: <b>{cov.feedbackThisMonth} of {plural(cov.total, "client")}</b> so far in {cov.monthLabel}{feedbackDue
              ? <> — <button type="button" className="fb-link" onClick={() => showDue("feedback")}>{feedbackDue} still due</button></>
              : cov.total ? " — all done" : ""}.</li>
            <li>Quarterly NPS: <b>{cov.npsThisQuarter} of {plural(cov.total, "client")}</b> in {cov.quarterLabel}{npsDue
              ? <> — <button type="button" className="fb-link" onClick={() => showDue("nps")}>{npsDue} still due</button></>
              : cov.total ? " — all done" : ""}.</li>
          </ul>
          {!feedback.length && <div className="fb-faint" style={{ marginTop: 6 }}>Nothing recorded yet. After a call or visit, click <b>+ Record feedback</b> — it takes under a minute.</div>}
        </div>

        {/* 2. Tiles: each opens what's behind it. */}
        <div className="summary-grid" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))", paddingTop: 0 }}>
          <button type="button" className="stile fb-tile" onClick={() => drill()} title="See these responses">
            <div className="sval" style={{ color: npsColor(sum.avgNps) }}>{fmtNps(sum.avgNps)}</div><div className="slabel">Average NPS</div>
            {npsChange && <div className="fb-tile-sub">{npsChange}</div>}
          </button>
          <button type="button" className="stile fb-tile" onClick={() => drill()} title="See these responses"><div className="sval">{sum.count}</div><div className="slabel">NPS responses</div></button>
          <button type="button" className="stile fb-tile" onClick={() => drill({ bucket: "Detractor" })} title="See the detractors"><div className="sval" style={{ color: sum.detractors ? "var(--bad)" : undefined }}>{sum.detractors}</div><div className="slabel">Detractors</div></button>
          <button type="button" className="stile fb-tile" onClick={() => drill()} title="See these responses"><div className="sval">{sum.avgRating == null ? "—" : `${sum.avgRating.toFixed(1)} / 5`}</div><div className="slabel">Avg feedback rating</div></button>
          <button type="button" className="stile fb-tile" onClick={() => showDue("feedback")} title="See who still owes this month's feedback"><div className="sval">{cov.feedbackThisMonth} / {cov.total}</div><div className="slabel">Feedback · {cov.monthLabel}</div></button>
          <button type="button" className="stile fb-tile" onClick={() => showDue("nps")} title="See who still owes this quarter's NPS"><div className="sval">{cov.npsThisQuarter} / {cov.total}</div><div className="slabel">NPS · {cov.quarterLabel}</div></button>
        </div>

        <div className="fb-two">
          <div className="table-card" style={{ padding: "16px 18px", overflow: "visible" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center" }}>
              NPS breakdown
              <InfoTip>Each answer is 0–10. Promoters 9–10, Passives 7–8, Detractors 0–6. Average NPS is the average answer out of 10. Click a bar to see those responses.</InfoTip>
            </div>
            <BarChart labelWidth={110} data={["Promoter", "Passive", "Detractor"].map((b) => ({
              label: BUCKET_LABEL[b], value: { Promoter: sum.promoters, Passive: sum.passives, Detractor: sum.detractors }[b], color: BUCKET_COLOR[b], onClick: () => drill({ bucket: b }),
            }))} />
          </div>
          <div className="table-card" style={{ padding: "16px 18px" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 12 }}>Feedback ratings</div>
            <BarChart labelWidth={110} data={[5, 4, 3, 2, 1].map((n) => ({ label: plural(n, "star"), value: responses.filter((r) => r.rating === n).length, color: n >= 4 ? "var(--ok)" : n === 3 ? "var(--warn)" : "var(--bad)", onClick: () => drill({ rating: n }) }))} />
          </div>
        </div>

        {/* 6. Trends: NPS by quarter, feedback rating by month (their cadences). */}
        <div className="fb-two">
          <Card title="NPS by quarter" info="Average NPS (out of 10) of the responses recorded in each of the last 6 quarters, with how many clients answered. Hover a point for promoters, passives and detractors. Uses every filter except the dates.">
            <ScaleTrend min={0} max={10} ticks={[0, 2, 4, 6, 8, 10]} fmt={(v) => v.toFixed(1)} color="var(--stg-plan-3)" bind={tip.bind} empty="No NPS recorded in the last 6 quarters."
              points={npsTrend.map((p) => ({
                label: p.label, value: p.nps.average, sub: p.nps.labs ? plural(p.nps.labs, "client") : "",
                tip: <><div className="chart-tip-title">{p.label}</div>
                  <div className="chart-tip-row"><span>Average NPS</span><b>{p.nps.average == null ? "—" : p.nps.average.toFixed(1)}</b></div>
                  <div className="chart-tip-row"><span>Responses</span><b>{p.nps.responses}</b></div>
                  <div className="chart-tip-row"><span>Promoters</span><b>{p.nps.promoters}</b></div>
                  <div className="chart-tip-row"><span>Passives</span><b>{p.nps.passives}</b></div>
                  <div className="chart-tip-row"><span>Detractors</span><b>{p.nps.detractors}</b></div></>,
              }))} />
          </Card>
          <Card title="Feedback rating by month" info="Average 1–5 rating of the feedback recorded in each of the last 12 months, with how many clients answered. Uses every filter except the dates.">
            <ScaleTrend min={1} max={5} ticks={[1, 2, 3, 4, 5]} fmt={(v) => v.toFixed(1)} color="var(--stg-plan-5)" bind={tip.bind} empty="No ratings recorded in the last 12 months."
              points={ratingTrend.map((p) => ({
                label: p.label.replace(/ \d{2}(\d{2})$/, " '$1"), value: p.rating.average, sub: p.rating.labs ? String(p.rating.labs) : "",
                tip: <><div className="chart-tip-title">{p.label}</div>
                  <div className="chart-tip-row"><span>Average rating</span><b>{p.rating.average == null ? "—" : p.rating.average.toFixed(1)}</b></div>
                  <div className="chart-tip-row"><span>Ratings</span><b>{p.rating.responses}</b></div>
                  <div className="chart-tip-row"><span>Clients</span><b>{p.rating.labs}</b></div></>,
              }))} />
          </Card>
        </div>
        {tip.tooltip}

        <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>By CSM</h3>
        <div className="table-card" style={{ marginBottom: 18 }}>
          {!csmRows.length ? <div style={{ padding: 20, color: "var(--text-faint)", fontSize: 12.5 }}>No labs in this view.</div> : (
            <div className="table-scroll"><table className="child-mini">
              <thead><tr><th>CSM</th><th>Clients</th><th>Feedback · {cov.monthLabel}</th><th>NPS · {cov.quarterLabel}</th><th>Responses</th><th>Avg NPS</th><th>Promoters</th><th>Passives</th><th>Detractors</th><th>Avg rating</th></tr></thead>
              <tbody>{csmRows.map((c) => (
                <tr key={c.key} className="fb-row" onClick={() => drill({ csm: c.key })} title={`See ${c.key}'s responses`}>
                  <td>{c.key}</td><td>{c.total}</td>
                  <td>{c.fbDone} / {c.total} <span className="fb-faint">({c.total ? Math.round((c.fbDone / c.total) * 100) : 0}%)</span></td>
                  <td>{c.npsDone} / {c.total} <span className="fb-faint">({c.total ? Math.round((c.npsDone / c.total) * 100) : 0}%)</span></td>
                  <td>{c.list.length}</td><td>{npsCell(c.avgNps)}</td><td>{c.promoters}</td><td>{c.passives}</td><td style={{ color: c.detractors ? "var(--bad)" : undefined }}>{c.detractors}</td>
                  <td>{c.avgRating == null ? "—" : c.avgRating.toFixed(1)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>

        <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>By designation</h3>
        <div className="table-card" style={{ marginBottom: 18 }}>
          {!byDesignation.length ? <div style={{ padding: 20, color: "var(--text-faint)", fontSize: 12.5 }}>No responses in this view.</div> : (
            <div className="table-scroll"><table className="child-mini">
              <thead><tr><th>Designation</th><th>Responses</th><th>Labs</th><th>Avg NPS</th><th>Promoters</th><th>Passives</th><th>Detractors</th><th>Avg rating</th><th>Testimonials</th></tr></thead>
              <tbody>{byDesignation.map((d) => {
                const can = d.key !== "Not recorded";
                return (
                  <tr key={d.key} className={can ? "fb-row" : undefined} onClick={can ? () => drill({ designation: d.key }) : undefined} title={can ? "See these responses" : undefined}>
                    <td>{d.key}</td><td>{d.list.length}</td><td>{d.labs}</td><td>{npsCell(d.avgNps)}</td>
                    <td>{d.promoters}</td><td>{d.passives}</td><td>{d.detractors}</td>
                    <td>{d.avgRating == null ? "—" : d.avgRating.toFixed(1)}</td>
                    <td>{tRows.filter((t) => t.designation === d.key).length}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </div>

        <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>By lab</h3>
        <div className="table-card" style={{ marginBottom: 18 }}>
          {!byLab.length ? <div style={{ padding: 20, color: "var(--text-faint)", fontSize: 12.5 }}>No responses in this view.</div> : (
            <Paginated items={byLab}>{(page) => (
              <div className="table-scroll"><table className="child-mini">
                <thead><tr><th>Lab</th><th>CSM</th><th>Responses</th><th>Latest NPS</th><th>Avg NPS</th><th>Avg rating</th><th>Last feedback</th></tr></thead>
                <tbody>{page.map((l) => {
                  const latest = l.list.find((r) => r.npsScore != null);
                  return (
                    <tr key={l.key} className="fb-row" onClick={() => drill({ lab: l.key })} title="See this lab's responses">
                      <td className="lab-name clickable" onClick={(e) => { e.stopPropagation(); onOpenLab(l.key); }}>{labsById[l.key]?.name || l.key}</td>
                      <td>{labsById[l.key]?.csm || "—"}</td><td>{l.list.length}</td>
                      <td>{latest ? <><b>{latest.npsScore}</b>/10 <span style={{ fontSize: 10.5, fontWeight: 700, color: BUCKET_COLOR[npsBucket(latest.npsScore)] }}>{npsBucket(latest.npsScore)}</span></> : "—"}</td>
                      <td>{npsCell(l.avgNps)}</td>
                      <td>{l.avgRating == null ? "—" : l.avgRating.toFixed(1)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(l.last)}</td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            )}</Paginated>
          )}
        </div>

        {/* Last (decision Nov 24 2026): the working list of clients still due — after the report of what's been recorded. */}
        <div ref={coverageRef} className="table-card" style={{ marginBottom: 18, scrollMarginTop: 80 }}>
          <div className="fb-card-head">
            <span style={{ display: "flex", alignItems: "center", fontWeight: 700, fontSize: 13 }}>
              Monthly feedback &amp; quarterly NPS
              <InfoTip>Each client is asked for feedback (a 1–5 rating) once a month and for NPS (0–10) once a quarter. A response with a rating counts for its month; one with an NPS score counts for its quarter. Parent labs only (a child lab's response counts for its parent); Inactive and Churned clients are left out. Uses the lab, CSM and lab-type filters, not the dates. Highest MRR first.</InfoTip>
            </span>
            <select value={dueShow} onChange={(e) => setDueShow(e.target.value)} aria-label="Which clients">
              <option value="due">Anything due ({cov.labs.filter((x) => !x.feedbackThisMonth || !x.npsThisQuarter).length})</option>
              <option value="feedback">Feedback due · {cov.monthLabel} ({feedbackDue})</option>
              <option value="nps">NPS due · {cov.quarterLabel} ({npsDue})</option>
              <option value="all">All clients ({cov.total})</option>
            </select>
          </div>
          {!dueRows.length ? <div style={{ padding: 20, color: "var(--text-faint)", fontSize: 12.5 }}>{cov.total ? "Nothing due — every client is up to date." : "No clients in this view."}</div> : (
            <Paginated items={dueRows}>{(page) => (
              <div className="table-scroll"><table className="child-mini">
                <thead><tr><th>Client</th><th>CSM</th><th>MRR</th><th>Feedback · {cov.monthLabel}</th><th>NPS · {cov.quarterLabel}</th><th></th></tr></thead>
                <tbody>{page.map((x) => (
                  <tr key={x.lab.id}>
                    <td className="lab-name clickable fb-cut" onClick={() => onOpenLab(x.lab.id)}>{x.lab.name}</td>
                    <td className="fb-cut">{x.lab.csm || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtAmount(clientMrr[x.lab.id] || 0)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{cadenceCell(x.feedbackThisMonth, x.lastRatingDate, x.lastRating, 5, x.daysSinceRating)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{cadenceCell(x.npsThisQuarter, x.lastNpsDate, x.lastNps, 10, x.daysSinceNps)}</td>
                    <td style={{ textAlign: "right" }}>{(!x.feedbackThisMonth || !x.npsThisQuarter) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(blankResponse(x.lab.id))}>+ Record</button>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}</Paginated>
          )}
        </div>
      </>)}

      {editing && (
        <ResponseModal value={editing} labOptions={labOptions} pocsFor={pocsFor} onAddPoc={addPoc} saving={saving}
          onClose={() => setEditing(null)} onSave={saveResponse} showToast={showToast} />
      )}
      {tEditing && (
        <TestimonialModal value={tEditing} labOptions={labOptions} pocsFor={pocsFor} onAddPoc={addPoc} saving={saving}
          onClose={() => setTEditing(null)} onSave={saveTestimonial} showToast={showToast} />
      )}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
      <span style={{ color: "var(--text-dim)" }}>{label}</span><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{children || "—"}</span>
    </div>
  );
}

// Full details of one response or testimonial (Nov 2026) — the tables cut long text to one line.
function FeedbackDetail({ kind, row: r, labName, csm, onOpenLab, onClose, onEdit, onDelete }) {
  const isFb = kind === "feedback";
  const b = isFb ? npsBucket(r.npsScore) : null;
  const rec = r.createdAt ? new Date(r.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : null;
  const text = isFb ? r.comment : r.note;
  return (
    <>
      <div className="drawer-backdrop show" onClick={onClose} />
      <div className="drawer show" role="dialog" aria-label={isFb ? "Feedback response" : "Testimonial"}>
        <div className="drawer-head">
          <div>
            <h2>{isFb ? "Feedback response" : "Testimonial"}</h2>
            <p><span className="clickable" style={{ color: "var(--accent)", cursor: "pointer", fontWeight: 600 }} onClick={onOpenLab}>{labName}</span> · {fmtDate(r.date)}</p>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="drawer-body">
          {isFb ? (<>
            <Row label="NPS">{r.npsScore == null ? null : <><b>{r.npsScore}</b>/10 <span style={{ fontSize: 11, fontWeight: 700, color: BUCKET_COLOR[b] }}>{b}</span></>}</Row>
            <Row label="Rating">{r.rating == null ? null : <span className="stars">{stars(r.rating)}</span>}</Row>
            <Row label="Given by">{r.respondentName}</Row>
            <Row label="Designation">{r.respondentDesignation}</Row>
            <Row label="Source">{r.source}</Row>
            <Row label="Supporting link">{r.linkUrl ? <a href={r.linkUrl} target="_blank" rel="noreferrer noopener">{r.linkUrl}</a> : null}</Row>
          </>) : (<>
            <Row label="Given by">{r.personName}</Row>
            <Row label="Designation">{r.designation}</Row>
            <Row label="Video">{r.videoUrl ? <a href={r.videoUrl} target="_blank" rel="noreferrer noopener">🎬 {r.videoUrl}</a> : null}</Row>
          </>)}
          <Row label="CSM">{csm}</Row>
          {rec && <Row label="Recorded">{rec}</Row>}
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 8 }}>{isFb ? "Comment" : "Note"}</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", color: text ? "var(--text)" : "var(--text-faint)" }}>{text || "No " + (isFb ? "comment" : "note") + "."}</div>
          </div>
        </div>
        <div className="drawer-foot">
          <button className="btn btn-ghost" onClick={onDelete} style={{ marginRight: "auto", color: "var(--bad)" }}>Delete</button>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={onEdit}>Edit</button>
        </div>
      </div>
    </>
  );
}

// "Given by": pick one of the lab's Points of Contact, or add a new POC on the spot (saved to the lab).
function PocPicker({ labId, name, designation, pocsFor, onAddPoc, onPick, showToast }) {
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

// Record (or edit) one feedback response collected through a form, email or WhatsApp.
function ResponseModal({ value, labOptions, pocsFor, onAddPoc, saving, onClose, onSave, showToast }) {
  const [f, setF] = useState(value);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const sources = f.source && !FEEDBACK_SOURCES.includes(f.source) ? [...FEEDBACK_SOURCES, f.source] : FEEDBACK_SOURCES;
  return (
    <Modal open title={f.id ? "Edit feedback response" : "Record feedback"} onClose={saving ? () => {} : onClose} actions={[
      { label: "Cancel", className: "btn-ghost", onClick: onClose, disabled: saving },
      { label: saving ? "Saving…" : "Save", className: "btn-primary", onClick: () => onSave(f), disabled: saving },
    ]}>
      <div className="tmpl-field" style={{ marginBottom: 10 }}>
        <label>Lab (parent) *</label>
        <SearchSelect value={f.labId} onChange={(v) => set({ labId: v, respondentName: "", respondentDesignation: "" })} options={labOptions} placeholder="Pick a lab…" disabled={!!f.id} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div className="tmpl-field"><label>Date received *</label><input type="date" style={field} value={f.date} max={todayISO()} onChange={(e) => set({ date: e.target.value })} /></div>
        <div className="tmpl-field">
          <label>Source</label>
          <select style={field} value={f.source} onChange={(e) => set({ source: e.target.value })}>
            <option value="">—</option>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="tmpl-field" style={{ marginBottom: 10 }}>
        <label>Given by *</label>
        <PocPicker labId={f.labId} name={f.respondentName} designation={f.respondentDesignation} pocsFor={pocsFor} onAddPoc={onAddPoc}
          onPick={(c) => set({ respondentName: c.name, respondentDesignation: c.designation || "" })} showToast={showToast} />
      </div>
      <div className="tmpl-field" style={{ marginBottom: 10 }}>
        <label>NPS — how likely are they to recommend us? (0–10)</label>
        <div className="nps-pick" role="radiogroup" aria-label="NPS score">
          {Array.from({ length: 11 }, (_, n) => (
            <button key={n} type="button" className={String(f.npsScore) === String(n) ? `on nps-${npsBucket(n)}` : ""} onClick={() => set({ npsScore: String(f.npsScore) === String(n) ? "" : n })}>{n}</button>
          ))}
        </div>
      </div>
      <div className="tmpl-field" style={{ marginBottom: 10 }}>
        <label>Feedback rating (1–5)</label>
        <span className="star-pick" role="radiogroup" aria-label="Feedback rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" className={n <= f.rating ? "on" : ""} onClick={() => set({ rating: f.rating === n ? 0 : n })} title={`${n} / 5`}>★</button>
          ))}
        </span>
        <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Fill in the NPS, the rating, or both. Click a selected value again to clear it.</div>
      </div>
      <div className="tmpl-field" style={{ marginBottom: 10 }}>
        <label>Comment / what they said</label>
        <textarea rows="3" style={{ ...field, resize: "vertical" }} value={f.comment} onChange={(e) => set({ comment: e.target.value })} />
      </div>
      <div className="tmpl-field">
        <label>Supporting link (optional)</label>
        <input style={field} type="url" value={f.linkUrl} onChange={(e) => set({ linkUrl: e.target.value })} placeholder="Google Form response, sheet, email… https://" />
      </div>
    </Modal>
  );
}

// Add (or edit) a testimonial video — same shape as a feedback response.
function TestimonialModal({ value, labOptions, pocsFor, onAddPoc, saving, onClose, onSave, showToast }) {
  const [t, setT] = useState(value);
  const set = (patch) => setT((x) => ({ ...x, ...patch }));
  return (
    <Modal open title={t.id ? "Edit testimonial" : "Add testimonial"} onClose={saving ? () => {} : onClose} actions={[
      { label: "Cancel", className: "btn-ghost", onClick: onClose, disabled: saving },
      { label: saving ? "Saving…" : "Save", className: "btn-primary", onClick: () => onSave(t), disabled: saving },
    ]}>
      <div className="tmpl-field" style={{ marginBottom: 10 }}>
        <label>Lab (parent) *</label>
        <SearchSelect value={t.labId} onChange={(v) => set({ labId: v, personName: "", designation: "" })} options={labOptions} placeholder="Pick a lab…" disabled={!!t.id} />
      </div>
      <div className="tmpl-field" style={{ marginBottom: 10 }}>
        <label>Date collected *</label>
        <input type="date" style={field} value={t.date} max={todayISO()} onChange={(e) => set({ date: e.target.value })} />
      </div>
      <div className="tmpl-field" style={{ marginBottom: 10 }}>
        <label>Given by *</label>
        <PocPicker labId={t.labId} name={t.personName} designation={t.designation} pocsFor={pocsFor} onAddPoc={onAddPoc}
          onPick={(c) => set({ personName: c.name, designation: c.designation || "" })} showToast={showToast} />
      </div>
      <div className="tmpl-field" style={{ marginBottom: 10 }}>
        <label>Video link *</label>
        <input style={field} type="url" value={t.videoUrl} onChange={(e) => set({ videoUrl: e.target.value })} placeholder="https://…" />
      </div>
      <div className="tmpl-field">
        <label>Note (optional)</label>
        <textarea rows="2" style={{ ...field, resize: "vertical" }} value={t.note} onChange={(e) => set({ note: e.target.value })} />
      </div>
    </Modal>
  );
}
