import { useEffect, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import {
  FEEDBACK_SOURCES, npsBucket, npsSummary, fetchFeedback, addFeedback, updateFeedback, deleteFeedback,
  fetchTestimonials, addTestimonial, deleteTestimonial,
} from "../lib/feedback";
import { todayISO } from "../lib/dates";
import { useScopedCsm } from "../lib/useScopedCsm";
import ScopeToggle from "../components/ScopeToggle";
import SearchSelect from "../components/SearchSelect";
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
function isHttpUrl(v) {
  try { const u = new URL((v || "").trim()); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
}
function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@]/.test(s)) s = "'" + s; // keep spreadsheet apps from running it as a formula
  s = s.replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

// Sidebar → Feedback & NPS. Labs give feedback OFFLINE (call, visit, Google Form, email…); the CSM records each
// response here so it can be reported on. Three tabs, all filterable by lab, CSM (My Labs / Team View), source and
// date range:
//   Responses    — every saved response (NPS 0–10 and/or rating 1–5, who, source, comment, supporting link).
//   Report       — NPS (% promoters − % detractors), average rating, by CSM and by lab; CSV export.
//   Testimonials — video links under each lab, labelled by the speaker's designation.
export default function FeedbackView({ labs, viewer, idByName, onOpenLab, showToast }) {
  const { isHead, scope, setScope, csmFilter, setCsmFilter, csmNames, scopeCsm, teamAll } = useScopedCsm(viewer);
  const [tab, setTab] = useState("responses");
  const [feedback, setFeedback] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);
  const [fLab, setFLab] = useState("");
  const [fSource, setFSource] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [editing, setEditing] = useState(null); // response form (new or existing)
  const [tForm, setTForm] = useState(null);     // testimonial form
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
      .catch((err) => { if (!cancelled) setError(/lab_feedback|lab_testimonials|nps_score/.test(err.message || "") ? "Feedback & NPS isn't fully set up in the database yet (migration 0039)." : err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (!SUPABASE_CONFIGURED) return <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — Feedback &amp; NPS needs a database connected.</div>;
  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading feedback…</div>;

  const scopedLabs = labs.filter((l) => !scopeCsm || l.csm === scopeCsm);
  const labsById = Object.fromEntries(labs.map((l) => [l.id, l]));
  const scopedIds = new Set(scopedLabs.map((l) => l.id));
  const inScope = (labId) => scopedIds.has(labId) && (!fLab || labId === fLab);
  const csmId = idByName[viewer.currentCSM];
  const nameById = Object.fromEntries(Object.entries(idByName).map(([n, id]) => [id, n]));

  const responses = feedback.filter((f) => inScope(f.labId)
    && (!fSource || f.source === fSource) && (!from || f.date >= from) && (!to || f.date <= to));
  const tRows = testimonials.filter((t) => inScope(t.labId));
  const tByLab = {};
  tRows.forEach((t) => { (tByLab[t.labId] = tByLab[t.labId] || []).push(t); });

  async function saveResponse(f) {
    if (!f.labId) { showToast("Pick a lab."); return; }
    if (f.npsScore === "" && !f.rating) { showToast("Enter an NPS score (0–10) or a feedback rating (1–5) — at least one."); return; }
    if (f.linkUrl.trim() && !isHttpUrl(f.linkUrl)) { showToast("The supporting link must start with http:// or https://"); return; }
    setSaving(true);
    try {
      if (f.id) await updateFeedback(f.id, f); else await addFeedback(f, csmId);
      setEditing(null); await load(); showToast(f.id ? "Response updated." : "Response saved — also logged to the lab's Lab History.");
    } catch (err) { showToast(`⚠ ${err.message}`); } finally { setSaving(false); }
  }
  async function saveTestimonial() {
    if (!tForm.labId) { showToast("Pick a lab."); return; }
    if (!tForm.designation.trim()) { showToast("Enter the speaker's designation."); return; }
    if (!isHttpUrl(tForm.videoUrl)) { showToast("Enter the video link (starting with http:// or https://)."); return; }
    setSaving(true);
    try { await addTestimonial(tForm, csmId); setTForm(null); await load(); showToast("Testimonial saved."); }
    catch (err) { showToast(`⚠ ${err.message}`); } finally { setSaving(false); }
  }
  async function remove(kind, row) {
    if (!window.confirm("Delete this entry?")) return;
    try { await (kind === "feedback" ? deleteFeedback(row.id) : deleteTestimonial(row.id)); await load(); showToast("Deleted."); }
    catch (err) { showToast(`⚠ ${err.message}`); }
  }
  function exportCsv() {
    const header = ["Date", "Lab", "Lab ID", "CSM", "NPS (0-10)", "NPS group", "Rating (1-5)", "Given by", "Designation", "Source", "Comment", "Link", "Recorded by"];
    const lines = responses.map((r) => {
      const lab = labsById[r.labId];
      return [r.date, lab?.name || r.labId, lab?.labCode || r.labId, lab?.csm || "", r.npsScore ?? "", npsBucket(r.npsScore) || "", r.rating ?? "",
        r.respondentName, r.respondentDesignation, r.source, r.comment, r.linkUrl, nameById[r.createdBy] || ""].map(csvCell).join(",");
    });
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `feedback-nps-${todayISO()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  const sum = npsSummary(responses);
  const groupBy = (keyOf) => {
    const g = {};
    responses.forEach((r) => { const k = keyOf(r); if (k) (g[k] = g[k] || []).push(r); });
    return Object.entries(g).map(([k, list]) => ({ key: k, list, ...npsSummary(list), last: list[0]?.date }));
  };
  const byCsm = groupBy((r) => labsById[r.labId]?.csm).sort((a, b) => a.key.localeCompare(b.key));
  const byLab = groupBy((r) => r.labId).sort((a, b) => (b.last || "").localeCompare(a.last || ""));
  const filtersOn = fLab || fSource || from || to;

  return (
    <div>
      <h1 className="page-title">Feedback &amp; NPS</h1>
      <p className="page-sub">Record the feedback and NPS your labs give you — on a call or visit, through a Google Form, by email — so it can be reported on. Viewing <b>{teamAll ? "the whole team" : scopeCsm}</b>'s labs.</p>
      {error && <div className="error-banner">{error}</div>}

      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={csmNames} />

      <div className="tabs" style={{ marginBottom: 12, width: "fit-content" }}>
        {[["responses", `Responses (${responses.length})`], ["report", "Report"], ["testimonials", "Testimonials"]].map(([k, l]) => (
          <button key={k} type="button" className={`tab-btn${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      <div className="filters">
        <span style={{ minWidth: 220 }}><SearchSelect value={fLab} onChange={setFLab} options={labSelectOptions(scopedLabs)} emptyLabel="All labs" placeholder="All labs" /></span>
        {tab !== "testimonials" && (<>
          <select value={fSource} onChange={(e) => setFSource(e.target.value)}>
            <option value="">All sources</option>
            {FEEDBACK_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>From <input style={input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>To <input style={input} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </>)}
        {filtersOn && <span className="clear" onClick={() => { setFLab(""); setFSource(""); setFrom(""); setTo(""); }}>Clear filters</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {tab !== "testimonials" && <button className="btn btn-ghost" onClick={exportCsv} disabled={!responses.length}>Export CSV</button>}
          {tab === "testimonials"
            ? !tForm && <button className="btn btn-primary" onClick={() => setTForm({ labId: fLab, personName: "", designation: "", videoUrl: "" })}>+ Add testimonial</button>
            : <button className="btn btn-primary" onClick={() => setEditing({ labId: fLab, date: todayISO(), npsScore: "", rating: 0, source: "", respondentName: "", respondentDesignation: "", comment: "", linkUrl: "" })}>+ Record feedback</button>}
        </span>
      </div>

      {tab === "responses" && (
        <div className="table-card">
          {!responses.length ? <div style={{ padding: 20, color: "var(--text-faint)", fontSize: 12.5 }}>{feedback.length ? "No responses match these filters." : "No feedback recorded yet — use “+ Record feedback” to save one you collected offline or through a form."}</div> : (
            <Paginated items={responses}>{(page) => (
              <div className="table-scroll"><table className="child-mini">
                <thead><tr><th>Date</th><th>Lab</th><th>CSM</th><th>NPS</th><th>Rating</th><th>Given by</th><th>Source</th><th>Comment</th><th>Link</th><th></th></tr></thead>
                <tbody>{page.map((r) => {
                  const b = npsBucket(r.npsScore);
                  return (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                      <td className="lab-name clickable" onClick={() => onOpenLab(r.labId)}>{labsById[r.labId]?.name || r.labId}</td>
                      <td>{labsById[r.labId]?.csm || "—"}</td>
                      <td>{r.npsScore == null ? "—" : <><b>{r.npsScore}</b> <span style={{ fontSize: 10.5, fontWeight: 700, color: BUCKET_COLOR[b] }}>{b}</span></>}</td>
                      <td>{r.rating == null ? "—" : <span className="stars" title={`${r.rating} / 5`}>{stars(r.rating)}</span>}</td>
                      <td>{r.respondentName || "—"}{r.respondentDesignation && <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{r.respondentDesignation}</div>}</td>
                      <td>{r.source || "—"}</td>
                      <td style={{ maxWidth: 260, whiteSpace: "normal" }}>{r.comment || <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                      <td>{r.linkUrl ? <a href={r.linkUrl} target="_blank" rel="noreferrer noopener">Open ↗</a> : "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span className="icon-btn" title="Edit" style={{ cursor: "pointer" }} onClick={() => setEditing({ ...r, npsScore: r.npsScore ?? "", rating: r.rating || 0 })}>✎</span>{" "}
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

      {tab === "report" && (<>
        <div className="summary-grid" style={{ gridTemplateColumns: "repeat(5,1fr)", paddingTop: 0 }}>
          <div className="stile"><div className="sval" style={{ color: sum.nps == null ? undefined : sum.nps >= 30 ? "var(--ok)" : sum.nps >= 0 ? "var(--warn)" : "var(--bad)" }}>{sum.nps == null ? "—" : sum.nps}</div><div className="slabel">NPS (−100 to 100)</div></div>
          <div className="stile"><div className="sval">{sum.count}</div><div className="slabel">NPS responses</div></div>
          <div className="stile"><div className="sval">{sum.avgRating == null ? "—" : `${sum.avgRating.toFixed(1)} / 5`}</div><div className="slabel">Avg feedback rating</div></div>
          <div className="stile"><div className="sval">{new Set(responses.map((r) => r.labId)).size}</div><div className="slabel">Labs with feedback</div></div>
          <div className="stile"><div className="sval">{responses.length}</div><div className="slabel">Total responses</div></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, margin: "4px 0 18px" }}>
          <div className="table-card" style={{ padding: "16px 18px", overflow: "visible" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center" }}>
              NPS breakdown
              <InfoTip>Promoters score 9–10, Passives 7–8, Detractors 0–6. NPS = % Promoters − % Detractors.</InfoTip>
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
          {!byCsm.length ? <div style={{ padding: 20, color: "var(--text-faint)", fontSize: 12.5 }}>No responses in this view.</div> : (
            <div className="table-scroll"><table className="child-mini">
              <thead><tr><th>CSM</th><th>Responses</th><th>NPS</th><th>Promoters</th><th>Passives</th><th>Detractors</th><th>Avg rating</th><th>Labs</th></tr></thead>
              <tbody>{byCsm.map((c) => (
                <tr key={c.key}>
                  <td>{c.key}</td><td>{c.list.length}</td><td><b>{c.nps ?? "—"}</b></td><td>{c.promoters}</td><td>{c.passives}</td><td>{c.detractors}</td>
                  <td>{c.avgRating == null ? "—" : c.avgRating.toFixed(1)}</td><td>{new Set(c.list.map((r) => r.labId)).size}</td>
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
                <thead><tr><th>Lab</th><th>CSM</th><th>Responses</th><th>Latest NPS</th><th>NPS</th><th>Avg rating</th><th>Last feedback</th></tr></thead>
                <tbody>{page.map((l) => {
                  const latest = l.list.find((r) => r.npsScore != null);
                  return (
                    <tr key={l.key}>
                      <td className="lab-name clickable" onClick={() => onOpenLab(l.key)}>{labsById[l.key]?.name || l.key}</td>
                      <td>{labsById[l.key]?.csm || "—"}</td><td>{l.list.length}</td>
                      <td>{latest ? <><b>{latest.npsScore}</b> <span style={{ fontSize: 10.5, fontWeight: 700, color: BUCKET_COLOR[npsBucket(latest.npsScore)] }}>{npsBucket(latest.npsScore)}</span></> : "—"}</td>
                      <td><b>{l.nps ?? "—"}</b></td>
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

      {tab === "testimonials" && (<>
        {tForm && (
          <div className="table-card" style={{ padding: 14, marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <span style={{ minWidth: 220 }}><SearchSelect value={tForm.labId} onChange={(v) => setTForm((f) => ({ ...f, labId: v }))} options={labSelectOptions(scopedLabs)} placeholder="Pick a lab…" /></span>
            <input style={{ ...input, flex: "1 1 160px" }} placeholder="Designation (e.g. Lab Director) *" value={tForm.designation} onChange={(e) => setTForm((f) => ({ ...f, designation: e.target.value }))} />
            <input style={{ ...input, flex: "1 1 140px" }} placeholder="Person's name" value={tForm.personName} onChange={(e) => setTForm((f) => ({ ...f, personName: e.target.value }))} />
            <input style={{ ...input, flex: "2 1 240px" }} type="url" placeholder="Video link https://… *" value={tForm.videoUrl} onChange={(e) => setTForm((f) => ({ ...f, videoUrl: e.target.value }))} />
            <button className="btn btn-primary" disabled={saving} onClick={saveTestimonial}>{saving ? "Saving…" : "Save"}</button>
            <button className="btn btn-ghost" disabled={saving} onClick={() => setTForm(null)}>Cancel</button>
          </div>
        )}
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
      </>)}

      {editing && (
        <ResponseModal value={editing} labOptions={labSelectOptions(scopedLabs)} saving={saving}
          onClose={() => setEditing(null)} onSave={saveResponse} />
      )}
    </div>
  );
}

// Record (or edit) one feedback response collected offline / through a form.
function ResponseModal({ value, labOptions, saving, onClose, onSave }) {
  const [f, setF] = useState(value);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  return (
    <Modal open title={f.id ? "Edit feedback response" : "Record feedback"} onClose={saving ? () => {} : onClose} actions={[
      { label: "Cancel", className: "btn-ghost", onClick: onClose, disabled: saving },
      { label: saving ? "Saving…" : "Save", className: "btn-primary", onClick: () => onSave(f), disabled: saving },
    ]}>
      <div className="tmpl-field" style={{ marginBottom: 10 }}>
        <label>Lab *</label>
        <SearchSelect value={f.labId} onChange={(v) => set({ labId: v })} options={labOptions} placeholder="Pick a lab…" disabled={!!f.id} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div className="tmpl-field"><label>Date received *</label><input type="date" style={field} value={f.date} max={todayISO()} onChange={(e) => set({ date: e.target.value })} /></div>
        <div className="tmpl-field">
          <label>Source</label>
          <select style={field} value={f.source} onChange={(e) => set({ source: e.target.value })}>
            <option value="">—</option>
            {FEEDBACK_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div className="tmpl-field"><label>Given by</label><input style={field} value={f.respondentName} onChange={(e) => set({ respondentName: e.target.value })} placeholder="Name" /></div>
        <div className="tmpl-field"><label>Designation</label><input style={field} value={f.respondentDesignation} onChange={(e) => set({ respondentDesignation: e.target.value })} placeholder="e.g. Lab Director" /></div>
      </div>
      <div className="tmpl-field" style={{ marginBottom: 10 }}>
        <label>Comment / what they said</label>
        <textarea rows="3" style={{ ...field, resize: "vertical" }} value={f.comment} onChange={(e) => set({ comment: e.target.value })} />
      </div>
      <div className="tmpl-field">
        <label>Supporting link (optional)</label>
        <input style={field} type="url" value={f.linkUrl} onChange={(e) => set({ linkUrl: e.target.value })} placeholder="Google Form response, sheet, email, recording… https://" />
      </div>
    </Modal>
  );
}
