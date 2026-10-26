import { Fragment, useEffect, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { fmtMoney, toINR, segmentFor } from "../lib/format";
import { fetchLabAdoption, computeSavedLabScores } from "../lib/adoption";
import { fetchLabPitchStatus, PITCH_ACTIVE_STATUSES } from "../lib/pitch";
import { fetchLabActivity, ACTIVITY_ICONS } from "../lib/activity";
import { fetchAllVisits, addVisit } from "../lib/visits";
import { addTask } from "../lib/tasks";
import { todayISO, daysFromTodayISO } from "../lib/dates";
import { fetchLabContacts, addLabContact } from "../lib/labContacts";
import DesignationSelect from "../components/DesignationSelect";

const CHECKIN_TYPES = [
  { key: "Call", icon: "📞" },
  { key: "Visit", icon: "🧑‍💼" },
  { key: "Email", icon: "✉️" },
  { key: "WhatsApp", icon: "💬" },
  { key: "GMeet", icon: "🎥" },
  { key: "Note", icon: "📝" },
];
const DISCUSSION_TOPICS = [
  "Adoption/Usage", "Billing & Payments", "Support Issue", "Renewal/Expansion",
  "Training Need", "Relationship/Escalation", "Other",
];
const SENTIMENTS = [
  { key: "Positive", color: "var(--ok)" },
  { key: "Neutral", color: "var(--text-dim)" },
  { key: "At Risk", color: "var(--bad)" },
];

// A module's rollout at a glance, from its parameters (adoption model v2): every counted parameter adopted →
// Adopted; anything rolled out or under way → In Progress; otherwise Not Started.
function snapshotStatus(params) {
  const counted = params.filter((r) => r.score != null);
  if (counted.length && counted.every((r) => (r.inPlan || r.purchased) && r.status === "Adopted")) return "Adopted";
  if (counted.some((r) => ((r.inPlan || r.purchased) && r.status !== "To-Do") || PITCH_ACTIVE_STATUSES.includes(r.pitch))) return "In Progress";
  return "Not Started";
}
function statusChipClass(label) { return "st-" + label.replace(/ /g, ""); }

function plusDays(n) {
  return daysFromTodayISO(n);
}

export default function LogCheckinView({ lab, modules, plans, viewer, idByName, onDone, showToast }) {
  const { currentCSM } = viewer;
  const plan = plans.find((p) => p.id === lab.plan) || plans[0];
  const seg = segmentFor(toINR(lab.mrr || 0, lab.region));

  const [type, setType] = useState("Visit");
  // Required on every check-in (decision, Oct 2026): did the CSM reach out (Proactive) or respond to the lab (Reactive)?
  const [engagement, setEngagement] = useState("");
  const [engagementError, setEngagementError] = useState(false);
  const [date, setDate] = useState(() => todayISO());
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [duration, setDuration] = useState("30");
  const [location, setLocation] = useState("");
  const [personName, setPersonName] = useState("");
  const [personDesignation, setPersonDesignation] = useState("");
  // This lab's points of contact (lab page → Points of Contact tab), offered as a type-or-pick list.
  const [contacts, setContacts] = useState([]);
  const [saveAsPoc, setSaveAsPoc] = useState(true);
  const [topics, setTopics] = useState([]);
  const [notes, setNotes] = useState("");
  // Adoption Snapshot "Discussed" marks (decision, Oct 2026): which modules — and optionally which parameters
  // inside them — were points of discussion in this check-in. Saved on the visit for lab-wise reporting. They no
  // longer create follow-up tasks.
  const [flagged, setFlagged] = useState([]);
  const [discussedParams, setDiscussedParams] = useState([]); // "moduleKey|paramName"
  const [openSnapshot, setOpenSnapshot] = useState({});
  const [sentiment, setSentiment] = useState("Neutral");
  const [actionItems, setActionItems] = useState([]);
  const [nextFollowup, setNextFollowup] = useState("");
  const [nextFollowupReason, setNextFollowupReason] = useState("");
  const [saving, setSaving] = useState(false);

  const [adoption, setAdoption] = useState(null);
  const [pitch, setPitch] = useState({});
  const [sidebarVisits, setSidebarVisits] = useState([]);
  const [sidebarActivity, setSidebarActivity] = useState([]);
  const [loadingSide, setLoadingSide] = useState(SUPABASE_CONFIGURED);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) { setLoadingSide(false); return; }
    let cancelled = false;
    setLoadingSide(true);
    // Contacts are optional extras — a missing table (migration 0032 not run) must not block the check-in.
    fetchLabContacts(lab.id).then((rows) => { if (!cancelled) setContacts(rows); }).catch(() => {});
    Promise.all([fetchLabAdoption(lab.id), fetchAllVisits(), fetchLabActivity(lab.id), fetchLabPitchStatus(lab.id)])
      .then(([a, visits, activity, p]) => {
        if (cancelled) return;
        setAdoption(a);
        setPitch(p);
        setSidebarVisits(visits.filter((v) => v.labId === lab.id));
        setSidebarActivity(activity);
      })
      .catch((err) => console.error(err))
      .finally(() => { if (!cancelled) setLoadingSide(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lab.id]);

  const scores = computeSavedLabScores(modules, plan, adoption, pitch);

  function toggleTopic(t) {
    setTopics((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));
  }
  function toggleFlag(moduleKey) {
    setFlagged((fs) => (fs.includes(moduleKey) ? fs.filter((k) => k !== moduleKey) : [...fs, moduleKey]));
  }
  // Ticking a parameter also marks its module as discussed.
  function toggleDiscussedParam(moduleKey, paramName) {
    const key = `${moduleKey}|${paramName}`;
    setDiscussedParams((ps) => (ps.includes(key) ? ps.filter((k) => k !== key) : [...ps, key]));
    setFlagged((fs) => (fs.includes(moduleKey) ? fs : [...fs, moduleKey]));
  }
  function addActionItem() {
    setActionItems((items) => [...items, { text: "", dueDate: plusDays(7) }]);
  }
  function updateActionItem(i, patch) {
    setActionItems((items) => items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function removeActionItem(i) {
    setActionItems((items) => items.filter((_, idx) => idx !== i));
  }

  const knownContact = contacts.find((c) => c.name.trim().toLowerCase() === personName.trim().toLowerCase());
  function handlePersonNameChange(v) {
    setPersonName(v);
    const match = contacts.find((c) => c.name.trim().toLowerCase() === v.trim().toLowerCase());
    if (match) setPersonDesignation(match.designation || "");
  }

  async function handleSubmit() {
    if (!engagement) {
      setEngagementError(true);
      showToast("Choose Proactive or Reactive before logging the check-in.");
      window.scrollTo?.({ top: 0, behavior: "smooth" });
      return;
    }
    setSaving(true);
    try {
      const csmId = idByName?.[currentCSM];
      // Someone new was typed in and "save as a point of contact" is ticked → add them to the lab's POCs.
      if (personName.trim() && !knownContact && saveAsPoc) {
        await addLabContact(lab.id, { name: personName, designation: personDesignation }, csmId).catch((err) => console.error(err));
      }
      const newVisitId = await addVisit({
        labId: lab.id,
        csmId,
        type,
        visitDate: date,
        notes,
        nextFollowupDate: nextFollowup || null,
        nextFollowupReason,
        durationMinutes: duration ? Number(duration) : null,
        location,
        personName,
        personDesignation,
        discussionTopics: topics,
        sentiment,
        flaggedModules: flagged,
        discussedParams,
        engagement,
        actionItems: actionItems.filter((it) => it.text.trim()).map((it) => ({ text: it.text.trim(), dueDate: it.dueDate || null })),
      });

      // A next-follow-up date used to only ever surface on the Visits & Meetings page itself — it
      // never became a real task, so it never showed up on Dashboard/Tasks unless a module also
      // happened to get flagged. Now every follow-up date always creates its own task too, so it's
      // reliably visible everywhere tasks are, whether or not anything was flagged. sourceVisitId
      // links it back to this check-in so a later edit from the Visit Detail view can keep it in
      // sync — the per-module training tasks below aren't tied to this field, so they don't get it.
      if (nextFollowup) {
        await addTask({
          labId: lab.id,
          desc: `Follow-up — ${lab.name}${nextFollowupReason ? `: ${nextFollowupReason}` : ""}`,
          owners: [currentCSM],
          type: "follow-up",
          repeat: "none",
          due: nextFollowup,
          idByName,
          assignedByName: currentCSM,
          sourceVisitId: newVisitId,
        });
      }

      // Every action item typed into the check-in becomes a real task (type "Action Item") due on its
      // date, owned by whoever logged the check-in — so it appears under Tasks / the Dashboard instead of
      // only living inside the check-in record. (Kept separate from sourceVisitId on purpose: that link
      // is reserved for the single follow-up task, which edits to the visit keep in sync.)
      const cleanItems = actionItems.filter((it) => it.text.trim());
      if (cleanItems.length) {
        await Promise.all(cleanItems.map((it) => addTask({
          labId: lab.id,
          desc: `Action item — ${lab.name}: ${it.text.trim()}`,
          owners: [currentCSM],
          type: "action-item",
          repeat: "none",
          due: it.dueDate || null,
          idByName,
          assignedByName: currentCSM,
        })));
      }

      const taskCount = cleanItems.length + (nextFollowup ? 1 : 0);
      showToast(taskCount ? `Check-in logged — ${taskCount} task${taskCount > 1 ? "s" : ""} added to Tasks.` : "Check-in logged.");
      onDone("history");
    } catch (err) {
      console.error(err);
      showToast(`⚠ ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  const fieldStyle = { width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" };
  const totalCheckins = sidebarVisits.length;
  const lastCheckin = sidebarVisits.slice().sort((a, b) => new Date(b.visitDate) - new Date(a.visitDate))[0];
  const ringColor = scores.overallPct >= 75 ? "var(--ok)" : scores.overallPct >= 40 ? "var(--warn)" : "var(--bad)";

  if (!SUPABASE_CONFIGURED) {
    return <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — Log Check-in needs a database connected.</div>;
  }

  return (
    <div>
      <div className="crumb">
        <a onClick={() => onDone("details")}>Customer Master &gt; Total Labs</a> &gt; <a onClick={() => onDone("details")}>{lab.name}</a> &gt; <span>Log Check-in</span>
      </div>
      <h1 className="page-title">Log Check-in — {lab.name}</h1>
      <p className="page-sub">Everything below lands on this lab's Lab History once you submit. Action items and the follow-up date also become tasks in Tasks.</p>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, alignItems: "start" }}>
        <div>
          {/* 1. Check-in type */}
          <div className="table-card" style={{ padding: "16px 18px", marginBottom: 14 }}>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>1. Check-in Type</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {CHECKIN_TYPES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setType(t.key)}
                  className="btn"
                  style={{
                    flex: "1 1 100px", border: `1.5px solid ${type === t.key ? "var(--accent)" : "var(--border)"}`,
                    background: type === t.key ? "var(--accent-dim)" : "var(--surface)", color: type === t.key ? "var(--accent)" : "var(--text)",
                    borderRadius: 9, padding: "10px 8px", fontSize: 12.5, fontWeight: 600,
                  }}
                >
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{t.icon}</div>
                  {t.key}
                </button>
              ))}
            </div>
          </div>

          {/* 1b. Proactive / Reactive — required */}
          <div className="table-card" style={{ padding: "16px 18px", marginBottom: 14, ...(engagementError ? { borderColor: "var(--bad)" } : {}) }}>
            <h3 style={{ fontSize: 13, margin: "0 0 4px" }}>Proactive or Reactive? <span style={{ color: "var(--bad)" }}>*</span></h3>
            <p style={{ fontSize: 11.5, color: "var(--text-dim)", margin: "0 0 10px" }}>Proactive = you reached out. Reactive = the lab reached out, or you're responding to an issue.</p>
            <div style={{ display: "flex", gap: 8 }}>
              {["Proactive", "Reactive"].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setEngagement(k); setEngagementError(false); }}
                  className="btn"
                  style={{
                    flex: 1, border: `1.5px solid ${engagement === k ? "var(--accent)" : "var(--border)"}`,
                    background: engagement === k ? "var(--accent-dim)" : "var(--surface)", color: engagement === k ? "var(--accent)" : "var(--text)",
                    borderRadius: 9, padding: "9px 8px", fontSize: 12.5, fontWeight: 600,
                  }}
                >
                  {k}
                </button>
              ))}
            </div>
            {engagementError && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>Required — choose one.</div>}
          </div>

          {/* 2. Meeting details */}
          <div className="table-card" style={{ padding: "16px 18px", marginBottom: 14 }}>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>2. Meeting Details</h3>
            <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
              <div className="tmpl-field" style={{ flex: "1 1 120px" }}><label>Date</label><input type="date" style={fieldStyle} value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div className="tmpl-field" style={{ flex: "1 1 100px" }}><label>Time</label><input type="time" style={fieldStyle} value={time} onChange={(e) => setTime(e.target.value)} /></div>
              <div className="tmpl-field" style={{ flex: "1 1 100px" }}><label>Duration (min)</label><input type="number" min="0" style={fieldStyle} value={duration} onChange={(e) => setDuration(e.target.value)} /></div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div className="tmpl-field" style={{ flex: "1 1 160px" }}><label>Logged By</label><input readOnly style={{ ...fieldStyle, background: "var(--bg)", color: "var(--text-dim)" }} value={currentCSM} /></div>
              <div className="tmpl-field" style={{ flex: "1 1 160px" }}><label>Location</label><input style={fieldStyle} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Lab site, phone, video call" /></div>
            </div>
          </div>

          {/* 3. Person contacted */}
          <div className="table-card" style={{ padding: "16px 18px", marginBottom: 14 }}>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>3. Person Contacted</h3>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div className="tmpl-field" style={{ flex: "1 1 160px" }}>
                <label>Name</label>
                <input style={fieldStyle} value={personName} onChange={(e) => handlePersonNameChange(e.target.value)} list="lab-poc-names"
                  placeholder={contacts.length ? "Pick a point of contact or type a name" : "Who you spoke with"} autoComplete="off" />
                <datalist id="lab-poc-names">
                  {contacts.map((c) => <option key={c.id} value={c.name}>{c.designation}</option>)}
                </datalist>
              </div>
              <div className="tmpl-field" style={{ flex: "1 1 160px" }}><label>Designation</label><DesignationSelect style={fieldStyle} value={personDesignation} onChange={setPersonDesignation} /></div>
            </div>
          </div>

          {personName.trim() && !knownContact && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, margin: "-6px 0 14px 4px", cursor: "pointer" }}>
              <input type="checkbox" checked={saveAsPoc} onChange={(e) => setSaveAsPoc(e.target.checked)} />
              Save {personName.trim()} as a point of contact for {lab.name}
            </label>
          )}

          {/* 4. Discussion topics */}
          <div className="table-card" style={{ padding: "16px 18px", marginBottom: 14 }}>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>4. Discussion Topics</h3>
            <div className="rule-chip-row" style={{ marginBottom: 12 }}>
              {DISCUSSION_TOPICS.map((t) => (
                <label key={t} className="rule-chip" style={topics.includes(t) ? { borderColor: "var(--accent)", background: "var(--accent-dim)", color: "var(--accent)" } : undefined}>
                  <input type="checkbox" checked={topics.includes(t)} onChange={() => toggleTopic(t)} /> {t}
                </label>
              ))}
            </div>
            <div className="tmpl-field">
              <label>Notes</label>
              <textarea rows="3" style={fieldStyle} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was discussed" />
            </div>
          </div>

          {/* 5. Adoption snapshot */}
          <div className="table-card" style={{ padding: "16px 18px", marginBottom: 14 }}>
            <h3 style={{ fontSize: 13, margin: "0 0 4px" }}>5. Adoption Snapshot</h3>
            <p style={{ fontSize: 11.5, color: "var(--text-dim)", margin: "0 0 10px" }}>Live from this lab's adoption data. Optional: tick what was discussed — a whole module, or open it (▸) and tick specific parameters. Saved with this check-in for reporting.</p>
            {loadingSide ? (
              <div style={{ padding: 12, color: "var(--text-faint)", fontSize: 12 }}>Loading…</div>
            ) : (
              <div className="table-scroll"><table className="child-mini">
                <thead><tr><th>Module</th><th>Score</th><th>Status</th><th>Discussed</th></tr></thead>
                <tbody>{scores.moduleResults.map(({ mod, overallPct, params }) => {
                  const pct = overallPct == null ? null : Math.round(overallPct);
                  const label = snapshotStatus(params);
                  const open = !!openSnapshot[mod.key];
                  const ticked = params.filter((r) => discussedParams.includes(`${mod.key}|${r.def.name}`)).length;
                  return (
                    <Fragment key={mod.key}>
                      <tr>
                        <td style={{ cursor: "pointer" }} onClick={() => setOpenSnapshot((o) => ({ ...o, [mod.key]: !o[mod.key] }))}>
                          <span style={{ display: "inline-block", width: 14, color: "var(--text-dim)" }}>{open ? "▾" : "▸"}</span>{mod.icon} {mod.name}
                          {ticked > 0 && <span className="cat-tag cat-Indigo" style={{ marginLeft: 6 }}>{ticked} param{ticked > 1 ? "s" : ""}</span>}
                        </td>
                        <td className="mrr-cell">{pct == null ? "—" : `${pct}%`}</td>
                        <td><span className={`status-chip ${statusChipClass(label)}`} style={{ cursor: "default" }}>{label}</span></td>
                        <td><input type="checkbox" checked={flagged.includes(mod.key)} onChange={() => toggleFlag(mod.key)} title="Discussed" /></td>
                      </tr>
                      {open && params.map((r) => (
                        <tr key={r.key} className="child-row">
                          <td style={{ paddingLeft: 30, fontSize: 12 }}>{r.def.name} <span style={{ color: "var(--text-faint)", fontSize: 11 }}>· {r.inPlan ? "In plan" : r.purchased ? "Purchased" : "Not in plan"}</span></td>
                          <td className="mrr-cell" style={{ fontSize: 12 }}>{r.score == null ? "n/a" : r.score}</td>
                          <td style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{r.inPlan || r.purchased ? r.status : r.pitch}</td>
                          <td><input type="checkbox" checked={discussedParams.includes(r.key)} onChange={() => toggleDiscussedParam(mod.key, r.def.name)} title="Discussed" /></td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}</tbody>
              </table></div>
            )}
          </div>

          {/* 6. Sentiment */}
          <div className="table-card" style={{ padding: "16px 18px", marginBottom: 14 }}>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>6. Sentiment</h3>
            <div style={{ display: "flex", gap: 8 }}>
              {SENTIMENTS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSentiment(s.key)}
                  className="btn"
                  style={{
                    flex: 1, border: `1.5px solid ${sentiment === s.key ? s.color : "var(--border)"}`,
                    background: sentiment === s.key ? s.color : "var(--surface)", color: sentiment === s.key ? "#fff" : "var(--text)",
                    borderRadius: 9, padding: "9px 8px", fontSize: 12.5, fontWeight: 600,
                  }}
                >
                  {s.key}
                </button>
              ))}
            </div>
          </div>

          {/* 7. Action items */}
          <div className="table-card" style={{ padding: "16px 18px", marginBottom: 14 }}>
            <h3 style={{ fontSize: 13, margin: "0 0 4px" }}>7. Action Items</h3>
            <p style={{ fontSize: 11.5, color: "var(--text-dim)", margin: "0 0 10px" }}>Each action item becomes a task (due on its date) in Tasks, and is saved with this check-in in Lab History.</p>
            {actionItems.map((it, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                <input style={{ ...fieldStyle, flex: 1 }} value={it.text} onChange={(e) => updateActionItem(i, { text: e.target.value })} placeholder="Action item" />
                <input type="date" style={{ ...fieldStyle, width: 150 }} value={it.dueDate || ""} onChange={(e) => updateActionItem(i, { dueDate: e.target.value })} />
                <span className="icon-btn" title="Remove" onClick={() => removeActionItem(i)}>✕</span>
              </div>
            ))}
            <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={addActionItem}>+ Add Action Item</button>
          </div>

          {/* Next follow-up */}
          <div className="table-card" style={{ padding: "16px 18px", marginBottom: 14 }}>
            <h3 style={{ fontSize: 13, margin: "0 0 4px" }}>Next Follow-up / Reminder (optional)</h3>
            <p style={{ fontSize: 11.5, color: "var(--text-dim)", margin: "0 0 10px" }}>Creates a follow-up task on this date in Tasks.</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div className="tmpl-field" style={{ flex: "1 1 160px" }}><label>Date</label><input type="date" style={fieldStyle} value={nextFollowup} onChange={(e) => setNextFollowup(e.target.value)} /></div>
              <div className="tmpl-field" style={{ flex: "1 1 160px" }}><label>Reason</label><input style={fieldStyle} value={nextFollowupReason} onChange={(e) => setNextFollowupReason(e.target.value)} placeholder="e.g. QBR" /></div>
            </div>
          </div>

          <div className="form-actions">
            <button className="btn btn-ghost" onClick={() => onDone("details")} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>{saving ? "Saving…" : "Log Check-in"}</button>
          </div>
        </div>

        {/* Right sidebar */}
        <div>
          <div className="side-card">
            <h4>Lab Summary</h4>
            <div className="seg-row"><span>Lab ID</span><span>{lab.labCode || lab.id}</span></div>
            <div className="seg-row"><span>Plan</span><span>{plan.name}</span></div>
            <div className="seg-row"><span>CSM</span><span>{lab.csm}</span></div>
            <div className="seg-row"><span>Segment</span><span><span className="seg-badge" style={{ background: seg.color }}>{seg.code}</span></span></div>
            <div className="seg-row"><span>MRR</span><span>{fmtMoney(lab.mrr || 0, lab.region)}</span></div>
          </div>

          <div className="side-card">
            <h4>Adoption</h4>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div className="ring" style={{ background: `conic-gradient(${ringColor} ${scores.overallPct * 3.6}deg, var(--surface-3) 0deg)` }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>
                  {Math.round(scores.overallPct)}%
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>Overall Adoption</div>
            </div>
            <a onClick={() => onDone("adoption")} style={{ display: "block", marginTop: 10, fontSize: 12, color: "var(--accent)", cursor: "pointer" }}>View Adoption tab →</a>
          </div>

          <div className="side-card">
            <h4>Check-in Stats</h4>
            <div className="seg-row"><span>Total logged</span><span>{loadingSide ? "…" : totalCheckins}</span></div>
            <div className="seg-row"><span>Last check-in</span><span>{lastCheckin ? new Date(lastCheckin.visitDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}</span></div>
          </div>

          <div className="side-card">
            <h4>Recent Activity</h4>
            {loadingSide ? (
              <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Loading…</div>
            ) : sidebarActivity.length ? (
              <div style={{ fontSize: 12 }}>
                <div style={{ marginBottom: 4 }}>{ACTIVITY_ICONS[sidebarActivity[0].kind] || "📝"} {sidebarActivity[0].title}</div>
                <div style={{ color: "var(--text-dim)", fontSize: 11 }}>{new Date(sidebarActivity[0].created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--text-faint)" }}>No activity yet.</div>
            )}
            <a onClick={() => onDone("history")} style={{ display: "block", marginTop: 10, fontSize: 12, color: "var(--accent)", cursor: "pointer" }}>View full history →</a>
          </div>
        </div>
      </div>
    </div>
  );
}
