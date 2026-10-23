import { useEffect, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { fetchFeedback, addFeedback, deleteFeedback, fetchTestimonials, addTestimonial, deleteTestimonial } from "../lib/feedback";
import { todayISO } from "../lib/dates";
import { useScopedCsm } from "../lib/useScopedCsm";
import ScopeToggle from "../components/ScopeToggle";
import SearchSelect from "../components/SearchSelect";
import Paginated from "../components/Pager";
import { labSelectOptions } from "../lib/selectOptions";

const input = { border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", fontSize: 12.5, fontFamily: "inherit", background: "var(--surface)", color: "var(--text)" };
const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);
function isHttpUrl(v) {
  try { const u = new URL((v || "").trim()); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
}

// Sidebar → Feedback & NPS. Two tabs, both filterable by lab and by CSM (My Labs / Team View):
//   Feedback     — CSMs record a 1–5 rating per lab (with an optional comment); each lab shows its latest + average.
//   Testimonials — video links under each lab, labelled by the speaker's designation.
export default function FeedbackView({ labs, viewer, idByName, onOpenLab, showToast }) {
  const { isHead, scope, setScope, csmFilter, setCsmFilter, csmNames, scopeCsm, teamAll } = useScopedCsm(viewer);
  const [tab, setTab] = useState("feedback");
  const [feedback, setFeedback] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);
  const [fLab, setFLab] = useState("");
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const [f, t] = await Promise.all([fetchFeedback(), fetchTestimonials()]);
    setFeedback(f); setTestimonials(t);
  }
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return undefined;
    let cancelled = false;
    Promise.all([fetchFeedback(), fetchTestimonials()])
      .then(([f, t]) => { if (!cancelled) { setFeedback(f); setTestimonials(t); } })
      .catch((err) => { if (!cancelled) setError(/lab_feedback|lab_testimonials/.test(err.message || "") ? "Feedback & NPS isn't set up in the database yet (migration 0038)." : err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (!SUPABASE_CONFIGURED) return <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — Feedback &amp; NPS needs a database connected.</div>;
  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading feedback…</div>;

  const scopedLabs = labs.filter((l) => !scopeCsm || l.csm === scopeCsm);
  const labsById = Object.fromEntries(labs.map((l) => [l.id, l]));
  const inScope = (labId) => scopedLabs.some((l) => l.id === labId) && (!fLab || labId === fLab);
  const csmId = idByName[viewer.currentCSM];
  const nameById = Object.fromEntries(Object.entries(idByName).map(([n, id]) => [id, n]));

  async function save() {
    if (!form.labId) { showToast("Pick a lab."); return; }
    setSaving(true);
    try {
      if (tab === "feedback") {
        if (!(form.rating >= 1 && form.rating <= 5)) { showToast("Pick a rating from 1 to 5."); return; }
        await addFeedback(form, csmId);
      } else {
        if (!form.designation.trim()) { showToast("Enter the speaker's designation."); return; }
        if (!isHttpUrl(form.videoUrl)) { showToast("Enter the video link (starting with http:// or https://)."); return; }
        await addTestimonial(form, csmId);
      }
      setForm(null); await load(); showToast("Saved — also logged to the lab's Lab History.");
    } catch (err) { showToast(`⚠ ${err.message}`); } finally { setSaving(false); }
  }
  async function remove(kind, row) {
    if (!window.confirm("Delete this entry?")) return;
    try { await (kind === "feedback" ? deleteFeedback(row.id) : deleteTestimonial(row.id)); await load(); showToast("Deleted."); }
    catch (err) { showToast(`⚠ ${err.message}`); }
  }

  // Feedback: one summary row per lab that has ratings, newest rating first.
  const fbRows = feedback.filter((f) => inScope(f.labId));
  const byLab = {};
  fbRows.forEach((f) => { (byLab[f.labId] = byLab[f.labId] || []).push(f); });
  const summary = Object.entries(byLab).map(([labId, list]) => ({
    labId, lab: labsById[labId], latest: list[0], count: list.length,
    avg: list.reduce((s, f) => s + f.rating, 0) / list.length, list,
  })).sort((a, b) => (b.latest.date || "").localeCompare(a.latest.date || ""));
  const overallAvg = fbRows.length ? fbRows.reduce((s, f) => s + f.rating, 0) / fbRows.length : null;
  const tRows = testimonials.filter((t) => inScope(t.labId));
  const tByLab = {};
  tRows.forEach((t) => { (tByLab[t.labId] = tByLab[t.labId] || []).push(t); });

  return (
    <div>
      <h1 className="page-title">Feedback &amp; NPS</h1>
      <p className="page-sub">Ratings and testimonial videos for <b>{teamAll ? "the whole team" : scopeCsm}</b>'s labs.</p>
      {error && <div className="error-banner">{error}</div>}

      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={csmNames} />

      <div className="tabs" style={{ marginBottom: 12, width: "fit-content" }}>
        {[["feedback", "Feedback"], ["testimonials", "Testimonials"]].map(([k, l]) => (
          <button key={k} type="button" className={`tab-btn${tab === k ? " active" : ""}`} onClick={() => { setTab(k); setForm(null); }}>{l}</button>
        ))}
      </div>

      <div className="filters">
        <span style={{ minWidth: 220 }}><SearchSelect value={fLab} onChange={setFLab} options={labSelectOptions(scopedLabs)} emptyLabel="All labs" placeholder="All labs" /></span>
        {fLab && <span className="clear" onClick={() => setFLab("")}>Clear filter</span>}
        {!form && <button className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => setForm(tab === "feedback"
          ? { labId: fLab, rating: 0, comment: "", date: todayISO() }
          : { labId: fLab, personName: "", designation: "", videoUrl: "", note: "" })}>{tab === "feedback" ? "+ Add rating" : "+ Add testimonial"}</button>}
      </div>

      {form && (
        <div className="table-card" style={{ padding: 14, marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <span style={{ minWidth: 220 }}><SearchSelect value={form.labId} onChange={(v) => setForm((f) => ({ ...f, labId: v }))} options={labSelectOptions(scopedLabs)} placeholder="Pick a lab…" /></span>
          {tab === "feedback" ? (<>
            <span className="star-pick" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" className={n <= form.rating ? "on" : ""} onClick={() => setForm((f) => ({ ...f, rating: n }))} title={`${n} / 5`}>★</button>
              ))}
            </span>
            <input style={input} type="date" value={form.date} max={todayISO()} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            <input style={{ ...input, flex: "1 1 240px" }} placeholder="Comment (optional)" value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} />
          </>) : (<>
            <input style={{ ...input, flex: "1 1 160px" }} placeholder="Designation (e.g. Lab Director) *" value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} />
            <input style={{ ...input, flex: "1 1 140px" }} placeholder="Person's name" value={form.personName} onChange={(e) => setForm((f) => ({ ...f, personName: e.target.value }))} />
            <input style={{ ...input, flex: "2 1 240px" }} type="url" placeholder="Video link https://… *" value={form.videoUrl} onChange={(e) => setForm((f) => ({ ...f, videoUrl: e.target.value }))} />
          </>)}
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
          <button className="btn btn-ghost" disabled={saving} onClick={() => setForm(null)}>Cancel</button>
        </div>
      )}

      {tab === "feedback" ? (<>
        <div className="summary-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 180px))", gap: 12, marginBottom: 14 }}>
          <div className="stile"><div className="sval">{overallAvg == null ? "—" : overallAvg.toFixed(1)}</div><div className="slabel">Average rating</div></div>
          <div className="stile"><div className="sval">{summary.length}</div><div className="slabel">Labs rated</div></div>
          <div className="stile"><div className="sval">{fbRows.length}</div><div className="slabel">Ratings recorded</div></div>
        </div>
        <div className="table-card">
          {!summary.length ? <div style={{ padding: 20, color: "var(--text-faint)", fontSize: 12.5 }}>No ratings recorded yet.</div> : (
            <Paginated items={summary}>{(page) => (
              <div className="table-scroll"><table className="child-mini">
                <thead><tr><th>Lab</th><th>CSM</th><th>Latest rating</th><th>Average</th><th>Ratings</th><th>Latest comment</th><th>Date</th><th></th></tr></thead>
                <tbody>{page.map((s) => (
                  <tr key={s.labId}>
                    <td className="lab-name clickable" onClick={() => onOpenLab(s.labId)}>{s.lab?.name || s.labId}</td>
                    <td>{s.lab?.csm || "—"}</td>
                    <td><span className="stars" title={`${s.latest.rating} / 5`}>{stars(s.latest.rating)}</span></td>
                    <td><b>{s.avg.toFixed(1)}</b></td>
                    <td>{s.count}</td>
                    <td style={{ maxWidth: 280 }}>{s.latest.comment || <span style={{ color: "var(--text-faint)" }}>—</span>}<div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{nameById[s.latest.createdBy] || ""}</div></td>
                    <td style={{ whiteSpace: "nowrap" }}>{new Date(s.latest.date + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</td>
                    <td><span className="icon-btn" title="Delete the latest rating" style={{ cursor: "pointer" }} onClick={() => remove("feedback", s.latest)}>🗑</span></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}</Paginated>
          )}
        </div>
      </>) : (
        <div>
          {!Object.keys(tByLab).length ? <div className="table-card" style={{ padding: 20, color: "var(--text-faint)", fontSize: 12.5 }}>No testimonials yet.</div>
            : Object.entries(tByLab).map(([labId, list]) => (
              <div key={labId} className="table-card" style={{ marginBottom: 12, padding: "12px 16px" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 8 }}>
                  <span className="lab-name clickable" style={{ fontWeight: 700 }} onClick={() => onOpenLab(labId)}>{labsById[labId]?.name || labId}</span>
                  <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>CSM: {labsById[labId]?.csm || "—"}</span>
                </div>
                {list.map((t) => (
                  <div key={t.id} className="mr-row">
                    <span>🎬</span>
                    <b style={{ fontSize: 12.5 }}>{t.designation}</b>
                    {t.personName && <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{t.personName}</span>}
                    <a href={t.videoUrl} target="_blank" rel="noreferrer noopener">Watch video ↗</a>
                    <span className="mr-actions"><span className="icon-btn" title="Delete" style={{ cursor: "pointer" }} onClick={() => remove("testimonial", t)}>🗑</span></span>
                  </div>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
