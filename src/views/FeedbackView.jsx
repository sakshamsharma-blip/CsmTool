import { useEffect, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import {
  FEEDBACK_SOURCES, npsBucket, npsSummary, fetchFeedback, addFeedback, updateFeedback, deleteFeedback,
  fetchTestimonials, addTestimonial, updateTestimonial, deleteTestimonial,
} from "../lib/feedback";
import { fetchAllLabContacts, addLabContact } from "../lib/labContacts";
import { todayISO } from "../lib/dates";
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

// Sidebar → Feedback & NPS. Labs give feedback OFFLINE (Google Form, email, WhatsApp); the CSM records each response
// here so it can be reported on. PARENT labs only (a child lab's feedback counts under its parent). "Given by" is
// picked from the lab's Points of Contact (or added as a new POC right from the form). Tabs, in order:
//   Responses    — every saved response (NPS 0–10 and/or rating 1–5, given by, source, comment, supporting link).
//   Testimonials — same format: date collected, lab, given by, designation, video link, note.
//   Report       — average NPS out of 10, promoters / passives / detractors, by CSM (with feedback coverage of
//                  their labs), by lab and by designation; CSV export.
// Filters: lab, CSM (My Labs / Team View), designation, source and date range.
export default function FeedbackView({ labs, viewer, idByName, onOpenLab, showToast }) {
  const { isHead, scope, setScope, csmFilter, setCsmFilter, csmNames, scopeCsm, teamAll } = useScopedCsm(viewer);
  const [tab, setTab] = useState("responses");
  const [feedback, setFeedback] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);
  const [fLab, setFLab] = useState("");
  const [fDesignation, setFDesignation] = useState("");
  const [fSource, setFSource] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [editing, setEditing] = useState(null);  // feedback response form (new or existing)
  const [tEditing, setTEditing] = useState(null); // testimonial form (new or existing)
  const [saving, setSaving] = useState(false);

  async function load() {
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

  if (!SUPABASE_CONFIGURED) return <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — Feedback &amp; NPS needs a database connected.</div>;
  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading feedback…</div>;

  const labsById = Object.fromEntries(labs.map((l) => [l.id, l]));
  // Parent labs only; anything recorded against a child lab is counted under its parent.
  const parentOf = (labId) => { const l = labsById[labId]; return l && l.type === "Child" && l.parent ? l.parent : labId; };
  const parentLabs = labs.filter((l) => l.type !== "Child");
  const scopedLabs = parentLabs.filter((l) => !scopeCsm || l.csm === scopeCsm);
  const scopedIds = new Set(scopedLabs.map((l) => l.id));
  const labOptions = labSelectOptions(scopedLabs);
  const inScope = (labId) => { const p = parentOf(labId); return scopedIds.has(p) && (!fLab || p === fLab); };
  const inDates = (d) => (!from || (d && d >= from)) && (!to || (d && d <= to));
  const csmId = idByName[viewer.currentCSM];
  const nameById = Object.fromEntries(Object.entries(idByName).map(([n, id]) => [id, n]));
  const labName = (labId) => labsById[parentOf(labId)]?.name || labId;
  const labCsm = (labId) => labsById[parentOf(labId)]?.csm || "—";

  const responses = feedback.filter((f) => inScope(f.labId) && inDates(f.date)
    && (!fSource || f.source === fSource) && (!fDesignation || f.respondentDesignation === fDesignation));
  const tRows = testimonials.filter((t) => inScope(t.labId) && inDates(t.date) && (!fDesignation || t.designation === fDesignation));
  const designations = [...new Set([...feedback.map((f) => f.respondentDesignation), ...testimonials.map((t) => t.designation)].filter(Boolean))].sort();

  // POCs of the chosen lab (and of its child labs), for the "Given by" pickers.
  const pocsFor = (labId) => contacts.filter((c) => c.labId === labId || parentOf(c.labId) === labId);
  async function addPoc(labId, { name, designation }) {
    const c = await addLabContact(labId, { name, designation }, csmId);
    setContacts((cs) => [...cs, c]);
    return c;
  }

  async function saveResponse(f) {
    if (!f.labId) { showToast("Pick a lab."); return; }
    if (!f.respondentName.trim()) { showToast("Pick who gave the feedback (from the lab's points of contact)."); return; }
    if (f.npsScore === "" && !f.rating) { showToast("Enter an NPS score (0–10) or a feedback rating (1–5) — at least one."); return; }
    if (f.linkUrl.trim() && !isHttpUrl(f.linkUrl)) { showToast("The supporting link must start with http:// or https://"); return; }
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
    setSaving(true);
    try {
      if (t.id) await updateTestimonial(t.id, t); else await addTestimonial(t, csmId);
      setTEditing(null); await load(); showToast(t.id ? "Testimonial updated." : "Testimonial saved.");
    } catch (err) { showToast(`⚠ ${err.message}`); } finally { setSaving(false); }
  }
  async function remove(kind, row) {
    if (!window.confirm("Delete this entry?")) return;
    try { await (kind === "feedback" ? deleteFeedback(row.id) : deleteTestimonial(row.id)); await load(); showToast("Deleted."); }
    catch (err) { showToast(`⚠ ${err.message}`); }
  }
  function exportCsv() {
    if (tab === "testimonials") {
      downloadCsv("testimonials", ["Date collected", "Lab", "CSM", "Given by", "Designation", "Video link", "Note"],
        tRows.map((t) => [t.date, labName(t.labId), labCsm(t.labId), t.personName, t.designation, t.videoUrl, t.note]));
      return;
    }
    downloadCsv("feedback-nps", ["Date", "Lab", "Lab ID", "CSM", "NPS (0-10)", "NPS group", "Rating (1-5)", "Given by", "Designation", "Source", "Comment", "Link", "Recorded by"],
      responses.map((r) => {
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
  // By CSM: every CSM with labs in view — total parent labs they handle, how many of those have feedback recorded.
  const csmRows = [...new Set(scopedLabs.map((l) => l.csm).filter(Boolean))].sort().map((name) => {
    const list = responses.filter((r) => labCsm(r.labId) === name);
    const total = scopedLabs.filter((l) => l.csm === name).length;
    const withFb = new Set(list.map((r) => parentOf(r.labId))).size;
    return { key: name, list, total, withFb, ...npsSummary(list) };
  });
  const byLab = groupBy((r) => parentOf(r.labId)).sort((a, b) => (b.last || "").localeCompare(a.last || ""));
  const byDesignation = groupBy((r) => r.respondentDesignation || "Not recorded").sort((a, b) => b.list.length - a.list.length);
  const labsWithFeedback = new Set(responses.map((r) => parentOf(r.labId))).size;
  const filtersOn = fLab || fDesignation || fSource || from || to;

  const npsCell = (avg) => <b style={{ color: npsColor(avg) }}>{avg == null ? "—" : avg.toFixed(1)}</b>;

  return (
    <div>
      <h1 className="page-title">Feedback &amp; NPS</h1>
      <p className="page-sub">Record the feedback and NPS your labs give you — through a Google Form, by email or on WhatsApp — so it can be reported on. Viewing <b>{teamAll ? "the whole team" : scopeCsm}</b>'s labs.</p>
      {error && <div className="error-banner">{error}</div>}

      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={csmNames} />

      <div className="tabs" style={{ marginBottom: 12, width: "fit-content" }}>
        {[["responses", `Responses (${responses.length})`], ["testimonials", `Testimonials (${tRows.length})`], ["report", "Report"]].map(([k, l]) => (
          <button key={k} type="button" className={`tab-btn${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>{l}</button>
        ))}
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
        <label style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>From <input style={input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>To <input style={input} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {filtersOn && <span className="clear" onClick={() => { setFLab(""); setFDesignation(""); setFSource(""); setFrom(""); setTo(""); }}>Clear filters</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={exportCsv} disabled={tab === "testimonials" ? !tRows.length : !responses.length}>Export CSV</button>
          {tab === "testimonials"
            ? <button className="btn btn-primary" onClick={() => setTEditing({ labId: fLab, date: todayISO(), personName: "", designation: "", videoUrl: "", note: "" })}>+ Add testimonial</button>
            : <button className="btn btn-primary" onClick={() => setEditing({ labId: fLab, date: todayISO(), npsScore: "", rating: 0, source: "", respondentName: "", respondentDesignation: "", comment: "", linkUrl: "" })}>+ Record feedback</button>}
        </span>
      </div>

      {tab === "responses" && (
        <div className="table-card">
          {!responses.length ? <div style={{ padding: 20, color: "var(--text-faint)", fontSize: 12.5 }}>{feedback.length ? "No responses match these filters." : "No feedback recorded yet — use “+ Record feedback” to save one you collected through a form, email or WhatsApp."}</div> : (
            <Paginated items={responses}>{(page) => (
              <div className="table-scroll"><table className="child-mini">
                <thead><tr><th>Date</th><th>Lab</th><th>CSM</th><th>NPS</th><th>Rating</th><th>Given by</th><th>Designation</th><th>Source</th><th>Comment</th><th>Link</th><th></th></tr></thead>
                <tbody>{page.map((r) => {
                  const b = npsBucket(r.npsScore);
                  return (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                      <td className="lab-name clickable" onClick={() => onOpenLab(parentOf(r.labId))}>{labName(r.labId)}</td>
                      <td>{labCsm(r.labId)}</td>
                      <td>{r.npsScore == null ? "—" : <><b>{r.npsScore}</b>/10 <span style={{ fontSize: 10.5, fontWeight: 700, color: BUCKET_COLOR[b] }}>{b}</span></>}</td>
                      <td>{r.rating == null ? "—" : <span className="stars" title={`${r.rating} / 5`}>{stars(r.rating)}</span>}</td>
                      <td>{r.respondentName || "—"}</td>
                      <td>{r.respondentDesignation || "—"}</td>
                      <td>{r.source || "—"}</td>
                      <td style={{ maxWidth: 260, whiteSpace: "normal" }}>{r.comment || <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                      <td>{r.linkUrl ? <a href={r.linkUrl} target="_blank" rel="noreferrer noopener">Open ↗</a> : "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span className="icon-btn" title="Edit" style={{ cursor: "pointer" }} onClick={() => setEditing({ ...r, labId: parentOf(r.labId), npsScore: r.npsScore ?? "", rating: r.rating || 0 })}>✎</span>{" "}
                        <span className="icon-btn" title="Delete" style={{ cursor: "pointer" }} onClick={() => remove("feedback", r)}>🗑</span>
                      </td>
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
                <thead><tr><th>Date collected</th><th>Lab</th><th>CSM</th><th>Given by</th><th>Designation</th><th>Video</th><th>Note</th><th></th></tr></thead>
                <tbody>{page.map((t) => (
                  <tr key={t.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(t.date)}</td>
                    <td className="lab-name clickable" onClick={() => onOpenLab(parentOf(t.labId))}>{labName(t.labId)}</td>
                    <td>{labCsm(t.labId)}</td>
                    <td>{t.personName || "—"}</td>
                    <td>{t.designation}</td>
                    <td><a href={t.videoUrl} target="_blank" rel="noreferrer noopener">🎬 Watch ↗</a></td>
                    <td style={{ maxWidth: 260, whiteSpace: "normal" }}>{t.note || <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <span className="icon-btn" title="Edit" style={{ cursor: "pointer" }} onClick={() => setTEditing({ ...t, labId: parentOf(t.labId), date: t.date || todayISO() })}>✎</span>{" "}
                      <span className="icon-btn" title="Delete" style={{ cursor: "pointer" }} onClick={() => remove("testimonial", t)}>🗑</span>
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}</Paginated>
          )}
        </div>
      )}

      {tab === "report" && (<>
        <div className="summary-grid" style={{ gridTemplateColumns: "repeat(5,1fr)", paddingTop: 0 }}>
          <div className="stile"><div className="sval" style={{ color: npsColor(sum.avgNps) }}>{fmtNps(sum.avgNps)}</div><div className="slabel">Average NPS</div></div>
          <div className="stile"><div className="sval">{sum.count}</div><div className="slabel">NPS responses</div></div>
          <div className="stile"><div className="sval">{sum.avgRating == null ? "—" : `${sum.avgRating.toFixed(1)} / 5`}</div><div className="slabel">Avg feedback rating</div></div>
          <div className="stile"><div className="sval">{labsWithFeedback} / {scopedLabs.length}</div><div className="slabel">Labs with feedback</div></div>
          <div className="stile"><div className="sval">{tRows.length}</div><div className="slabel">Testimonials</div></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, margin: "4px 0 18px" }}>
          <div className="table-card" style={{ padding: "16px 18px", overflow: "visible" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center" }}>
              NPS breakdown
              <InfoTip>Each answer is 0–10. Promoters 9–10, Passives 7–8, Detractors 0–6. Average NPS is the average answer out of 10.</InfoTip>
            </div>
            <BarChart labelWidth={110} data={[
              { label: "Promoters (9–10)", value: sum.promoters, color: BUCKET_COLOR.Promoter },
              { label: "Passives (7–8)", value: sum.passives, color: BUCKET_COLOR.Passive },
              { label: "Detractors (0–6)", value: sum.detractors, color: BUCKET_COLOR.Detractor },
            ]} />
          </div>
          <div className="table-card" style={{ padding: "16px 18px" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 12 }}>Feedback ratings</div>
            <BarChart labelWidth={110} data={[5, 4, 3, 2, 1].map((n) => ({ label: `${n} star${n === 1 ? "" : "s"}`, value: responses.filter((r) => r.rating === n).length, color: n >= 4 ? "var(--ok)" : n === 3 ? "var(--warn)" : "var(--bad)" }))} />
          </div>
        </div>

        <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>By CSM</h3>
        <div className="table-card" style={{ marginBottom: 18 }}>
          {!csmRows.length ? <div style={{ padding: 20, color: "var(--text-faint)", fontSize: 12.5 }}>No labs in this view.</div> : (
            <div className="table-scroll"><table className="child-mini">
              <thead><tr><th>CSM</th><th>Total labs</th><th>Labs with feedback</th><th>Coverage</th><th>Responses</th><th>Avg NPS</th><th>Promoters</th><th>Passives</th><th>Detractors</th><th>Avg rating</th></tr></thead>
              <tbody>{csmRows.map((c) => (
                <tr key={c.key}>
                  <td>{c.key}</td><td>{c.total}</td><td>{c.withFb}</td>
                  <td>{c.total ? `${Math.round((c.withFb / c.total) * 100)}%` : "—"}</td>
                  <td>{c.list.length}</td><td>{npsCell(c.avgNps)}</td><td>{c.promoters}</td><td>{c.passives}</td><td>{c.detractors}</td>
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
              <tbody>{byDesignation.map((d) => (
                <tr key={d.key}>
                  <td>{d.key}</td><td>{d.list.length}</td><td>{d.labs}</td><td>{npsCell(d.avgNps)}</td>
                  <td>{d.promoters}</td><td>{d.passives}</td><td>{d.detractors}</td>
                  <td>{d.avgRating == null ? "—" : d.avgRating.toFixed(1)}</td>
                  <td>{tRows.filter((t) => t.designation === d.key).length}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>

        <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>By lab</h3>
        <div className="table-card">
          {!byLab.length ? <div style={{ padding: 20, color: "var(--text-faint)", fontSize: 12.5 }}>No responses in this view.</div> : (
            <Paginated items={byLab}>{(page) => (
              <div className="table-scroll"><table className="child-mini">
                <thead><tr><th>Lab</th><th>CSM</th><th>Responses</th><th>Latest NPS</th><th>Avg NPS</th><th>Avg rating</th><th>Last feedback</th></tr></thead>
                <tbody>{page.map((l) => {
                  const latest = l.list.find((r) => r.npsScore != null);
                  return (
                    <tr key={l.key}>
                      <td className="lab-name clickable" onClick={() => onOpenLab(l.key)}>{labsById[l.key]?.name || l.key}</td>
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

// "Given by": pick one of the lab's Points of Contact, or add a new POC on the spot (saved to the lab).
function PocPicker({ labId, name, designation, pocsFor, onAddPoc, onPick, showToast }) {
  const [adding, setAdding] = useState(null); // { name, designation }
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
          <button type="button" className="mark-purchased" onClick={() => setAdding({ name: "", designation: "" })}>+ Add POC</button>
        </div>
      )}
      {!adding && name && !match && <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 4 }}>Saved as: {name}{designation ? ` — ${designation}` : ""}</div>}
      {!adding && match && <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 4 }}>Designation: <b>{match.designation || "—"}</b></div>}
      {adding && (
        <div className="table-card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <input style={field} placeholder="Name *" value={adding.name} onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value }))} autoFocus />
          <DesignationSelect style={field} value={adding.designation} onChange={(v) => setAdding((a) => ({ ...a, designation: v }))} />
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
