import { useEffect, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { computeLabRollup, flattenRollup } from "../lib/labRollup";
import { fetchAllVisits, addVisit } from "../lib/visits";
import { taskBucket } from "../lib/tasks";
import { hasLeadAccess } from "../lib/roles";
import ScopeToggle from "../components/ScopeToggle";
import Modal from "../components/Modal";

const VISIT_TYPES = ["Visit", "Call", "Email", "WhatsApp", "Note"];

export default function VisitsView({ labs, csmDirectory, currentCSM, idByName, onOpenLab, showToast }) {
  const isHead = hasLeadAccess(csmDirectory.find((c) => c.name === currentCSM)?.role);
  const [scope, setScope] = useState("mine");
  const [csmFilter, setCsmFilter] = useState("");
  const csmNames = csmDirectory.map((c) => c.name);

  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);

  const [logOpen, setLogOpen] = useState(false);
  const [logLabId, setLogLabId] = useState("");
  const [logType, setLogType] = useState("Visit");
  const [logDate, setLogDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [logNotes, setLogNotes] = useState("");
  const [logFollowup, setLogFollowup] = useState("");
  const [logFollowupReason, setLogFollowupReason] = useState("");
  const [logError, setLogError] = useState(false);

  async function loadAll() {
    if (!SUPABASE_CONFIGURED) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try { setVisits(await fetchAllVisits()); }
    catch (err) { setError(err.message || "Failed to load visits."); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!SUPABASE_CONFIGURED) {
    return <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — Visits &amp; Meetings needs a database connected.</div>;
  }
  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading visits…</div>;
  if (error) return <div className="warn-banner" style={{ background: "var(--bad-bg)", color: "var(--bad)", borderColor: "#f3b8b8" }}>Couldn't load visits — {error}</div>;

  const teamAll = isHead && scope === "team" && !csmFilter;
  const scopeCsm = isHead && scope === "team" ? (csmFilter || null) : currentCSM;
  const scopeLabel = teamAll ? "the whole team" : scopeCsm;

  const allRows = computeLabRollup(labs);
  const rows = scopeCsm ? allRows.filter((r) => r.csm === scopeCsm || r.children.some((c) => c.csm === scopeCsm)) : allRows;
  const flat = flattenRollup(rows);
  const flatIds = new Set(flat.map((l) => l.id));
  const labsById = {};
  labs.forEach((l) => { labsById[l.id] = l; });

  const scoped = visits.filter((v) => flatIds.has(v.labId));
  const upcoming = scoped.filter((v) => v.nextFollowupDate).sort((a, b) => a.nextFollowupDate.localeCompare(b.nextFollowupDate));
  const recent = scoped.slice().sort((a, b) => new Date(b.visitDate) - new Date(a.visitDate));

  const labOptions = [];
  allRows.forEach((r) => { labOptions.push(r); r.children.forEach((c) => labOptions.push(c)); });

  async function handleLogVisit() {
    if (!logLabId) { setLogError(true); return; }
    try {
      await addVisit({
        labId: logLabId, csmId: idByName[labsById[logLabId]?.csm], type: logType, visitDate: logDate,
        notes: logNotes, nextFollowupDate: logFollowup || null, nextFollowupReason: logFollowupReason,
      });
      setLogOpen(false); setLogLabId(""); setLogType("Visit"); setLogNotes(""); setLogFollowup(""); setLogFollowupReason(""); setLogError(false);
      await loadAll();
      showToast("Visit logged.");
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  const fieldStyle = { width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" };

  return (
    <div>
      <h1 className="page-title">Visits &amp; Meetings</h1>
      <p className="page-sub">Upcoming follow-ups and logged visits for <b>{scopeLabel}</b>.</p>

      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={csmNames} />

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button className="btn btn-primary" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={() => setLogOpen(true)}>+ Log Visit</button>
      </div>

      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Upcoming</h3>
      {!upcoming.length ? (
        <div className="table-card" style={{ padding: "18px 20px", textAlign: "center", color: "var(--text-faint)", fontSize: 12.5, marginBottom: 22 }}>No upcoming follow-ups scheduled — log a visit and set a next follow-up date.</div>
      ) : (
        <div className="table-card" style={{ marginBottom: 22 }}><div className="table-scroll"><table className="child-mini">
          <thead><tr><th>Reason</th><th>Lab</th><th>Date</th></tr></thead>
          <tbody>{upcoming.map((v) => {
            const bucket = taskBucket(v.nextFollowupDate);
            const dueColor = bucket === "overdue" ? "var(--bad)" : bucket === "today" ? "var(--warn)" : "var(--text-dim)";
            const lab = labsById[v.labId];
            return (
              <tr key={v.id}>
                <td>{v.nextFollowupReason || "Follow-up"}</td>
                <td className="lab-name clickable" onClick={() => onOpenLab(v.labId)}>{lab ? lab.name : v.labId}</td>
                <td style={{ fontWeight: 700, color: dueColor }}>{bucket === "overdue" ? "Overdue · " : ""}{new Date(v.nextFollowupDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</td>
              </tr>
            );
          })}</tbody>
        </table></div></div>
      )}

      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Recent Visits Logged</h3>
      {!recent.length ? (
        <div className="table-card" style={{ padding: "18px 20px", textAlign: "center", color: "var(--text-faint)", fontSize: 12.5 }}>No visits logged yet.</div>
      ) : (
        <div className="table-card"><div className="table-scroll"><table className="child-mini">
          <thead><tr><th>Lab</th><th>Type</th><th>Date</th><th>Notes</th><th>Sentiment</th></tr></thead>
          <tbody>{recent.map((v) => {
            const lab = labsById[v.labId];
            const sentColor = v.sentiment === "Positive" ? "var(--ok)" : v.sentiment === "At Risk" ? "var(--bad)" : "var(--text-dim)";
            return (
              <tr key={v.id}>
                <td className="lab-name clickable" onClick={() => onOpenLab(v.labId)}>{lab ? lab.name : v.labId}</td>
                <td>{v.type}</td>
                <td style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{new Date(v.visitDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</td>
                <td style={{ fontSize: 12 }}>{v.notes || "—"}</td>
                <td>{v.sentiment ? <span style={{ fontSize: 11, fontWeight: 700, color: sentColor }}>{v.sentiment}</span> : "—"}</td>
              </tr>
            );
          })}</tbody>
        </table></div></div>
      )}

      <Modal
        open={logOpen}
        title="Log Visit / Meeting"
        onClose={() => setLogOpen(false)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setLogOpen(false) },
          { label: "Log Visit", className: "btn-primary", onClick: handleLogVisit },
        ]}
      >
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Lab</label>
          <select style={fieldStyle} value={logLabId} onChange={(e) => setLogLabId(e.target.value)}>
            <option value="">Select a lab…</option>
            {labOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="tmpl-field-row" style={{ marginBottom: 12, display: "flex", gap: 10 }}>
          <div className="tmpl-field" style={{ flex: 1 }}>
            <label>Type</label>
            <select style={fieldStyle} value={logType} onChange={(e) => setLogType(e.target.value)}>
              {VISIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="tmpl-field" style={{ flex: 1 }}>
            <label>Date</label>
            <input type="date" style={fieldStyle} value={logDate} onChange={(e) => setLogDate(e.target.value)} />
          </div>
        </div>
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Notes</label>
          <textarea rows="2" style={fieldStyle} value={logNotes} onChange={(e) => setLogNotes(e.target.value)} placeholder="What was discussed" />
        </div>
        <div className="tmpl-field-row" style={{ marginBottom: 4, display: "flex", gap: 10 }}>
          <div className="tmpl-field" style={{ flex: 1 }}>
            <label>Next Follow-up (optional)</label>
            <input type="date" style={fieldStyle} value={logFollowup} onChange={(e) => setLogFollowup(e.target.value)} />
          </div>
          <div className="tmpl-field" style={{ flex: 1 }}>
            <label>Follow-up Reason</label>
            <input style={fieldStyle} value={logFollowupReason} onChange={(e) => setLogFollowupReason(e.target.value)} placeholder="e.g. QBR" />
          </div>
        </div>
        {logError && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>Pick a lab first.</div>}
      </Modal>
    </div>
  );
}
