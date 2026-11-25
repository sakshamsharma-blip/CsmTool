import { useEffect, useState } from "react";
import { useSessionState } from "../lib/useSessionState";
import { useChartTooltip } from "../lib/useChartTooltip";
import { todayISO } from "../lib/dates";
import {
  TESTIMONIAL_FORMATS, TESTIMONIAL_SOURCES, TESTIMONIAL_STATUSES, TESTIMONIAL_CONSENTS, RATING_STEPS,
  needsConsent, isApprovedOrPublished, topicGroups, topicInfo, sourceText,
} from "../lib/testimonials";
import { Donut } from "./Analytics";
import BarChart from "./BarChart";
import SearchSelect from "./SearchSelect";
import Paginated from "./Pager";
import PocPicker from "./PocPicker";
import InfoTip from "./InfoTip";
import { HINTS } from "../lib/hints";

// Feedback & NPS → Testimonials (decision Nov 24 2026, migration 0051). Tiles, four charts (format, designation, topic,
// written source) and the list, all narrowed by the page's period / lab type / CSM scope plus the filters here. Every
// chart mark clicks through to the list. Rules and the topic list: supabase/functions/_shared/testimonials.js.

const FORMAT_COLOR = { Video: "var(--stg-plan-3)", Written: "var(--stg-plan-2)" };
const STATUS_CLASS = { Pending: "ts-pending", "In Review": "ts-review", Approved: "ts-approved", Published: "ts-published" };
const CONSENT_ICON = { Received: "✓", Requested: "◷", "Not Requested": "○" };
const field = { border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", background: "var(--surface)", color: "var(--text)", width: "100%" };
const fmtDate = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
// In the list: no year when it is this year, like Tasks.
const fmtShortDate = (d) => (!d ? "—" : new Date(d + "T12:00:00").toLocaleDateString(undefined, d.slice(0, 4) === todayISO().slice(0, 4) ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "2-digit" }));
const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : "0%");
const stars = (r) => (r == null ? "—" : `★ ${Number(r).toFixed(1)}`);

export default function TestimonialsTab({ rows, totalAll, modules, labName, labCsm, parentOf, onOpenLab, onView, onEdit, onDelete, onSetStatus, labFilter }) {
  const [fDesig, setFDesig] = useSessionState("feedback.t.designation", "");
  const [fTopic, setFTopic] = useSessionState("feedback.t.topic", "");
  const [fFormat, setFFormat] = useSessionState("feedback.t.format", "");
  const [fStatus, setFStatus] = useSessionState("feedback.t.status", "");
  const [fSource, setFSource] = useSessionState("feedback.t.source", "");
  const [search, setSearch] = useSessionState("feedback.t.search", "");
  const [menuFor, setMenuFor] = useState(null);
  const tip = useChartTooltip();
  useEffect(() => {
    if (!menuFor) return undefined;
    const close = () => setMenuFor(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuFor]);

  const q = search.trim().toLowerCase();
  const list = rows
    .filter((t) => (!fDesig || t.designation === fDesig) && (!fTopic || t.topics.includes(fTopic)) && (!fFormat || t.format === fFormat)
      && (!fStatus || (fStatus === "none" ? !t.status : t.status === fStatus)) && (!fSource || t.source === fSource)
      && (!q || `${labName(t.labId)} ${t.personName} ${t.designation}`.toLowerCase().includes(q)))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));

  // ---- figures (over the filtered list) ----
  const video = list.filter((t) => t.format === "Video").length, written = list.length - video;
  const rated = list.filter((t) => t.rating != null);
  const avgRating = rated.length ? rated.reduce((s, t) => s + t.rating, 0) / rated.length : null;
  const published = list.filter((t) => isApprovedOrPublished(t.status)).length;
  const designationsAll = [...new Set(rows.map((t) => t.designation).filter(Boolean))].sort();
  const topicCount = {};
  list.forEach((t) => t.topics.forEach((k) => { topicCount[k] = (topicCount[k] || 0) + 1; }));
  const topicsSorted = Object.entries(topicCount).sort((a, b) => b[1] - a[1]);
  const byDesig = Object.entries(list.reduce((m, t) => { const k = t.designation || "Not recorded"; (m[k] ||= { Video: 0, Written: 0 })[t.format] += 1; return m; }, {}))
    .map(([k, v]) => ({ key: k, ...v, total: v.Video + v.Written })).sort((a, b) => b.total - a.total);
  const maxDesig = Math.max(1, ...byDesig.map((d) => d.total));
  const writtenRows = list.filter((t) => t.format === "Written");
  const groups = topicGroups();
  const topicOptions = groups.flatMap((g) => g.topics.map((t) => ({ value: t.key, label: t.label, hint: g.label })));
  const filtersOn = fDesig || fTopic || fFormat || fStatus || fSource || search;

  const tile = (icon, value, label, sub, onClick) => (
    <button type="button" className="stile fb-tile ts-tile" onClick={onClick}>
      <span className="ts-ico" aria-hidden="true">{icon}</span>
      <span><span className="sval">{value}</span><span className="slabel">{label}</span>{sub && <span className="fb-tile-sub">{sub}</span>}</span>
    </button>
  );

  return (
    <div>
      <div className="ts-tiles">
        {tile("❝", list.length, "Total testimonials", totalAll > rows.length ? `of ${totalAll} recorded` : null, () => { setFFormat(""); setFStatus(""); })}
        {tile("▶", video, "Video", pct(video, list.length), () => setFFormat("Video"))}
        {tile("✎", written, "Written", pct(written, list.length), () => setFFormat("Written"))}
        {tile("👥", new Set(list.map((t) => t.designation).filter(Boolean)).size, "Designations covered")}
        {tile("◈", topicsSorted.length, "Topics covered")}
        {tile("★", avgRating == null ? "—" : `${avgRating.toFixed(1)} / 5`, "Avg rating", rated.length ? `${rated.length} rated` : null)}
        {tile("✓", published, "Approved / Published", pct(published, list.length), () => setFStatus("Published"))}
      </div>

      <div className="filters">
        {labFilter}
        <select value={fDesig} onChange={(e) => setFDesig(e.target.value)} aria-label="Designation"><option value="">All designations</option>{designationsAll.map((d) => <option key={d}>{d}</option>)}</select>
        <span style={{ minWidth: 190 }}><SearchSelect value={fTopic} onChange={setFTopic} options={topicOptions} emptyLabel="All topics" placeholder="All topics" /></span>
        <select value={fFormat} onChange={(e) => setFFormat(e.target.value)} aria-label="Format"><option value="">All formats</option>{TESTIMONIAL_FORMATS.map((f) => <option key={f}>{f}</option>)}</select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{TESTIMONIAL_STATUSES.map((s) => <option key={s}>{s}</option>)}<option value="none">Not set</option></select>
        <select value={fSource} onChange={(e) => setFSource(e.target.value)} aria-label="Source"><option value="">All sources</option>{TESTIMONIAL_SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
        <input className="ts-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search lab or contact…" aria-label="Search" />
        {filtersOn && <span className="clear" onClick={() => { setFDesig(""); setFTopic(""); setFFormat(""); setFStatus(""); setFSource(""); setSearch(""); }}>Clear filters</span>}
      </div>

      <div className="ts-charts">
        <div className="table-card pf-card">
          <div className="pf-card-title">Testimonials by format</div>
          <Donut centre={list.length} centreLabel="total" bind={tip.bind}
            slices={TESTIMONIAL_FORMATS.map((f) => ({ key: f, label: f, count: f === "Video" ? video : written, color: FORMAT_COLOR[f], tip: <><div className="chart-tip-title">{f}</div><div className="chart-tip-row"><span>Testimonials</span><b>{f === "Video" ? video : written}</b></div></> }))} />
          <div className="ts-legend-links">{TESTIMONIAL_FORMATS.map((f) => <button key={f} type="button" className="fb-link" onClick={() => setFFormat(f)}>Show {f.toLowerCase()} only</button>)}</div>
        </div>
        <div className="table-card pf-card">
          <div className="pf-card-title">By designation <span className="ts-key"><i style={{ background: FORMAT_COLOR.Video }} />Video <i style={{ background: FORMAT_COLOR.Written }} />Written</span></div>
          {!byDesig.length ? <div className="an-empty">No testimonials yet.</div> : byDesig.slice(0, 7).map((d) => (
            <div key={d.key} className="ts-hbar" onClick={() => d.key !== "Not recorded" && setFDesig(d.key)} title={`${d.key}: ${d.Video} video, ${d.Written} written`}>
              <span className="ts-hbar-label">{d.key}</span>
              <span className="ts-hbar-track">
                <span style={{ width: `${(d.Video / maxDesig) * 100}%`, background: FORMAT_COLOR.Video }} />
                <span style={{ width: `${(d.Written / maxDesig) * 100}%`, background: FORMAT_COLOR.Written }} />
              </span>
              <b>{d.total}</b>
            </div>
          ))}
        </div>
        <div className="table-card pf-card">
          <div className="pf-card-title">By topic <InfoTip>How many testimonials mention each topic (one can mention several). Top 8. Click a bar to see them.</InfoTip></div>
          <BarChart labelWidth={96} barHeight={16} gap={8} data={topicsSorted.slice(0, 8).map(([k, n]) => ({ label: topicInfo(k, modules).short, value: n, color: "var(--stg-plan-3)", onClick: () => setFTopic(k) }))} />
        </div>
        <div className="table-card pf-card">
          <div className="pf-card-title">Written by source <InfoTip>Only written testimonials have a source (Email, WhatsApp, Google Form or Other). Click a bar to see them.</InfoTip></div>
          {!writtenRows.length ? <div className="an-empty">No written testimonials.</div>
            : <BarChart labelWidth={96} barHeight={16} gap={8} data={TESTIMONIAL_SOURCES.map((s) => ({ label: s, value: writtenRows.filter((t) => t.source === s).length, color: "var(--stg-plan-2)", onClick: () => setFSource(s) })).filter((d) => d.value > 0)} />}
        </div>
      </div>
      {tip.tooltip}

      <div className="table-card">
        {!list.length ? <div style={{ padding: 20, color: "var(--text-faint)", fontSize: 12.5 }}>{rows.length ? "No testimonials match these filters." : "No testimonials yet — use “+ Add Testimonial”."}</div> : (
          <Paginated items={list}>{(page) => (
            <div className="table-scroll"><table className="child-mini ts-table">
              <thead><tr><th>Lab</th><th>CSM</th><th>Contact</th><th>Format</th><th>Source</th><th>Topics</th><th>Collected</th><th>Rating</th><th>Status</th><th>Consent</th><th></th></tr></thead>
              <tbody>{page.map((t) => (
                <tr key={t.id} className="fb-row" onClick={() => onView(t)} title="Open the full testimonial">
                  <td className="lab-name clickable fb-cut" style={{ maxWidth: 110 }} onClick={(e) => { e.stopPropagation(); onOpenLab(parentOf(t.labId)); }}>{labName(t.labId)}</td>
                  <td className="fb-cut" style={{ maxWidth: 90 }}>{labCsm(t.labId)}</td>
                  <td className="ts-contact"><b>{t.personName || "—"}</b><span>{t.designation}</span></td>
                  <td><span className={`ts-format ts-${t.format.toLowerCase()}`}>{t.format === "Video" ? "▶" : "✎"} {t.format}</span></td>
                  <td className="fb-cut" style={{ maxWidth: 90 }} title={t.format === "Written" ? sourceText(t.source, t.sourceDetail) : undefined}>{t.format === "Written" ? sourceText(t.source, t.sourceDetail) || "—" : "—"}</td>
                  <td><div className="ts-topics">{t.topics.slice(0, 2).map((k) => <span key={k} className="ts-chip" title={topicInfo(k, modules).label}>{topicInfo(k, modules).short}</span>)}{t.topics.length > 2 && <span className="ts-chip ts-more" title={t.topics.slice(2).map((k) => topicInfo(k, modules).label).join(", ")}>+{t.topics.length - 2}</span>}{!t.topics.length && <span className="fb-faint">—</span>}</div></td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtShortDate(t.date)}</td>
                  <td style={{ whiteSpace: "nowrap", color: t.rating != null ? "var(--warn)" : undefined, fontWeight: 700 }}>{stars(t.rating)}</td>
                  <td>{t.status ? <span className={`ts-status ${STATUS_CLASS[t.status]}`}>{t.status}</span> : <span className="fb-faint">Not set</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }} className={t.consent === "Received" ? "fb-done" : t.consent === "Requested" ? "fb-due" : "fb-faint"} title={t.consent ? `Consent ${t.consent.toLowerCase()}` : "Consent not set"}>{t.consent ? `${CONSENT_ICON[t.consent]} ${t.consent === "Not Requested" ? "Not asked" : t.consent}` : "Not set"}</td>
                  <td style={{ whiteSpace: "nowrap", position: "relative" }} onClick={(e) => e.stopPropagation()}>
                    <a className="ts-act" href={t.videoUrl} target="_blank" rel="noreferrer noopener" title={t.format === "Video" ? "Open the video" : "Open the review"} aria-label={t.format === "Video" ? "Open the video" : "Open the review"}>↗</a>
                    <button type="button" className="ts-act" title="View details" aria-label="View details" onClick={() => onView(t)}>👁</button>
                    <button type="button" className="ts-act" title="More" aria-label="More actions" onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === t.id ? null : t.id); }}>⋮</button>
                    {menuFor === t.id && (
                      <div className="ts-menu" role="menu">
                        <button type="button" role="menuitem" onClick={() => { setMenuFor(null); onEdit(t); }}>Edit</button>
                        <div className="ts-menu-sub">Move to</div>
                        {TESTIMONIAL_STATUSES.filter((s) => s !== t.status).map((s) => (
                          <button key={s} type="button" role="menuitem" onClick={() => { setMenuFor(null); onSetStatus(t, s); }}>{s}{needsConsent(s) && t.consent !== "Received" ? " (needs consent)" : ""}</button>
                        ))}
                        <button type="button" role="menuitem" className="ts-menu-bad" onClick={() => { setMenuFor(null); onDelete(t); }}>Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}</Paginated>
        )}
      </div>
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

// Full details of one testimonial (side panel).
export function TestimonialDetail({ row: t, modules, labName, csm, onOpenLab, onClose, onEdit, onDelete }) {
  const rec = t.createdAt ? new Date(t.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : null;
  return (
    <>
      <div className="drawer-backdrop show" onClick={onClose} />
      <div className="drawer show" role="dialog" aria-label="Testimonial">
        <div className="drawer-head">
          <div>
            <h2>{t.format} testimonial</h2>
            <p><span className="clickable" style={{ color: "var(--accent)", cursor: "pointer", fontWeight: 600 }} onClick={onOpenLab}>{labName}</span> · {fmtDate(t.date)}</p>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="drawer-body">
          <Row label="Given by">{t.personName}</Row>
          <Row label="Designation">{t.designation}</Row>
          <Row label="CSM">{csm}</Row>
          <Row label="Format">{t.format}</Row>
          {t.format === "Written" && <Row label="Source">{sourceText(t.source, t.sourceDetail)}</Row>}
          <Row label={t.format === "Video" ? "Video link" : "Review link"}>{t.videoUrl ? <a href={t.videoUrl} target="_blank" rel="noreferrer noopener">{t.videoUrl}</a> : null}</Row>
          <Row label="Rating">{t.rating != null ? `${Number(t.rating).toFixed(1)} / 5` : null}</Row>
          <Row label="Status">{t.status || "Not set"}</Row>
          <Row label="Consent">{t.consent || "Not set"}</Row>
          {rec && <Row label="Recorded">{rec}</Row>}
          <div style={{ marginTop: 16 }}>
            <div className="ts-section-label">Topics</div>
            {t.topics.length ? <div className="ts-topics" style={{ flexWrap: "wrap" }}>{t.topics.map((k) => <span key={k} className="ts-chip" title={topicInfo(k, modules).group}>{topicInfo(k, modules).label}</span>)}</div> : <span className="fb-faint">None recorded.</span>}
          </div>
          <div style={{ marginTop: 16 }}>
            <div className="ts-section-label">Note</div>
            <div className="ts-note">{t.note || <span className="fb-faint">No note.</span>}</div>
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

// Add / edit a testimonial (side panel). The CSM always comes from the lab.
export function TestimonialForm({ value, modules, labOptions, labCsm, pocsFor, onAddPoc, saving, onClose, onSave, showToast }) {
  const [t, setT] = useState(value);
  const [topicSearch, setTopicSearch] = useState("");
  const [open, setOpen] = useState(() => new Set()); // every group starts collapsed; open the ones you need
  const set = (patch) => setT((x) => ({ ...x, ...patch }));
  const groups = topicGroups();
  const q = topicSearch.trim().toLowerCase();
  const toggle = (k) => set({ topics: t.topics.includes(k) ? t.topics.filter((x) => x !== k) : [...t.topics, k] });
  return (
    <>
      <div className="drawer-backdrop show" onClick={saving ? undefined : onClose} />
      <div className="drawer show ts-form" role="dialog" aria-label={t.id ? "Edit Testimonial" : "Add Testimonial"}>
        <div className="drawer-head">
          <div><h2>{t.id ? "Edit Testimonial" : "Add Testimonial"}</h2><p>Fields marked * are required.</p></div>
          <button className="drawer-close" onClick={onClose} aria-label="Close" disabled={saving}>&times;</button>
        </div>
        <div className="drawer-body">
          <div className="ts-grid2">
            <div className="tmpl-field"><label>Lab *</label>
              <SearchSelect value={t.labId} onChange={(v) => set({ labId: v, personName: "", designation: "" })} options={labOptions} placeholder="Pick a lab…" disabled={!!t.id} />
            </div>
            <div className="tmpl-field"><label>CSM</label><input style={{ ...field, background: "var(--surface-2)" }} value={t.labId ? labCsm(t.labId) : ""} placeholder="From the lab" readOnly title="Always the lab's CSM" /></div>
          </div>
          <div className="tmpl-field" style={{ marginTop: 10 }}><label>Contact person *</label>
            <PocPicker labId={t.labId} name={t.personName} designation={t.designation} pocsFor={pocsFor} onAddPoc={onAddPoc}
              onPick={(c) => set({ personName: c.name, designation: c.designation || "" })} showToast={showToast} />
          </div>

          <div className="tmpl-field" style={{ marginTop: 12 }}><label>Testimonial format *</label>
            <div className="ts-formats">
              {TESTIMONIAL_FORMATS.map((f) => (
                <button key={f} type="button" className={t.format === f ? "on" : ""} onClick={() => set({ format: f, source: f === "Video" ? "" : t.source })}>
                  {f === "Video" ? "▶ Video (recorded / link)" : "✎ Written (review / text)"}
                </button>
              ))}
            </div>
          </div>

          <div className="tmpl-field" style={{ marginTop: 12 }}>
            <label>Testimonial topics * <span className="fb-faint">(pick one or more{t.topics.length ? ` — ${t.topics.length} picked` : ""})</span></label>
            {t.topics.length > 0 && <div className="ts-topics" style={{ flexWrap: "wrap", marginBottom: 6 }}>{t.topics.map((k) => <span key={k} className="ts-chip">{topicInfo(k, modules).short}<button type="button" aria-label={`Remove ${topicInfo(k, modules).label}`} onClick={() => toggle(k)}>×</button></span>)}</div>}
            <input style={field} type="search" value={topicSearch} onChange={(e) => setTopicSearch(e.target.value)} placeholder="Search topic (e.g. Inventory, Support…)" />
            <div className="ts-groups">
              {groups.map((g) => {
                const shown = g.topics.filter((x) => !q || x.label.toLowerCase().includes(q) || g.label.toLowerCase().includes(q));
                if (q && !shown.length) return null;
                const isOpen = !!q || open.has(g.key);
                const picked = g.topics.filter((x) => t.topics.includes(x.key)).length;
                return (
                  <div key={g.key} className="ts-group">
                    <button type="button" className="ts-group-head" onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })} aria-expanded={isOpen}>
                      <span>{isOpen ? "▾" : "▸"} {g.label}</span>{picked > 0 && <span className="ts-picked">{picked}</span>}
                    </button>
                    {isOpen && (
                      <div className="ts-group-body">
                        {shown.map((x) => (
                          <label key={x.key} className="ts-check"><input type="checkbox" checked={t.topics.includes(x.key)} onChange={() => toggle(x.key)} /> {x.label}</label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {t.format === "Written" && (
            <div className="tmpl-field" style={{ marginTop: 12 }}><label>Source / platform *</label>
              <select style={field} value={t.source} onChange={(e) => set({ source: e.target.value, sourceDetail: e.target.value === "Other" ? t.sourceDetail : "" })}>
                <option value="">Select…</option>
                {TESTIMONIAL_SOURCES.map((s) => <option key={s}>{s}</option>)}
              </select>
              {t.source === "Other" && (
                <input style={{ ...field, marginTop: 8 }} value={t.sourceDetail || ""} onChange={(e) => set({ sourceDetail: e.target.value })} placeholder="What was it? (e.g. LinkedIn post, phone call) *" aria-label="Other source" />
              )}
            </div>
          )}
          <div className="tmpl-field" style={{ marginTop: 12 }}><label>{t.format === "Video" ? "Video link" : "Review link"} *</label>
            <input style={field} type="url" value={t.videoUrl} onChange={(e) => set({ videoUrl: e.target.value })} placeholder="Paste the video URL or the link to the written testimonial https://" />
          </div>
          <div className="ts-grid2" style={{ marginTop: 12 }}>
            <div className="tmpl-field"><label>Collected date *</label><input type="date" style={field} value={t.date} max={todayISO()} onChange={(e) => set({ date: e.target.value })} /></div>
            <div className="tmpl-field"><label>Rating (optional)</label>
              <select style={field} value={t.rating ?? ""} onChange={(e) => set({ rating: e.target.value === "" ? null : Number(e.target.value) })}>
                <option value="">No rating</option>
                {RATING_STEPS.map((r) => <option key={r} value={r}>{r.toFixed(1)} ★</option>)}
              </select>
            </div>
          </div>
          <div className="ts-grid2" style={{ marginTop: 12 }}>
            <div className="tmpl-field"><label>Customer consent *</label>
              <select style={field} value={t.consent} onChange={(e) => set({ consent: e.target.value })}>
                <option value="">Select…</option>
                {TESTIMONIAL_CONSENTS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="tmpl-field"><label>Status *</label>
              <select style={field} value={t.status} onChange={(e) => set({ status: e.target.value })}>
                <option value="">Select…</option>
                {TESTIMONIAL_STATUSES.map((s) => <option key={s} disabled={needsConsent(s) && t.consent !== "Received"}>{s}{needsConsent(s) && t.consent !== "Received" ? " (needs consent received)" : ""}</option>)}
              </select>
            </div>
          </div>
          <div className="tmpl-field" style={{ marginTop: 12 }}><label>Note (optional)</label>
            <textarea rows="3" style={{ ...field, resize: "vertical" }} value={t.note} onChange={(e) => set({ note: e.target.value })} placeholder={HINTS.testimonialNote} />
          </div>
        </div>
        <div className="drawer-foot">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(t)} disabled={saving}>{saving ? "Saving…" : "Save Testimonial"}</button>
        </div>
      </div>
    </>
  );
}
