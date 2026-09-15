import { useEffect, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { fmtMoney, toINR, segmentFor } from "../lib/format";
import { fetchLabAdoption, computeSavedLabScores } from "../lib/adoption";
import { fetchLabActivity, ACTIVITY_ICONS } from "../lib/activity";
import { fetchAllVisits, addVisit } from "../lib/visits";
import { addTask } from "../lib/tasks";

const CHECKIN_TYPES = [
  { key: "Call", icon: "📞" },
  { key: "Visit", icon: "🧑‍💼" },
  { key: "Email", icon: "✉️" },
  { key: "WhatsApp", icon: "💬" },
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

function snapshotStatus(pct) {
  if (pct >= 91) return "Adopted";
  if (pct > 0) return "In Progress";
  return "Not Started";
}
function statusChipClass(label) { return "st-" + label.replace(/ /g, ""); }

function plusDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function LogCheckinView({ lab, modules, plans, currentCSM, idByName, onDone, showToast }) {
  const plan = plans.find((p) => p.id === lab.plan) || plans[0];
  const seg = segmentFor(toINR(lab.mrr || 0, lab.region));

  const [type, setType] = useState("Visit");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [duration, setDuration] = useState("30");
  const [location, setLocation] = useState("");
  const [personName, setPersonName] = useState("");
  const [personDesignation, setPersonDesignation] = useState("");
  const [topics, setTopics] = useState([]);
  const [notes, setNotes] = useState("");
  const [flagged, setFlagged] = useState([]);
  const [sentiment, setSentiment] = useState("Neutral");
  const [actionItems, setActionItems] = useState([]);
  const [nextFollowup, setNextFollowup] = useState("");
  const [nextFollowupReason, setNextFollowupReason] = useState("");
  const [saving, setSaving] = useState(false);

  const [adoption, setAdoption] = useState(null);
  const [sidebarVisits, setSidebarVisits] = useState([]);
  const [sidebarActivity, setSidebarActivity] = useState([]);
  const [loadingSide, setLoadingSide] = useState(SUPABASE_CONFIGURED);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) { setLoadingSide(false); return; }
    let cancelled = false;
    setLoadingSide(true);
    Promise.all([fetchLabAdoption(lab.id), fetchAllVisits(), fetchLabActivity(lab.id)])
      .then(([a, visits, activity]) => {
        if (cancelled) return;
        setAdoption(a);
        setSidebarVisits(visits.filter((v) => v.labId === lab.id));
        setSidebarActivity(activity);
      })
      .catch((err) => console.error(err))
      .finally(() => { if (!cancelled) setLoadingSide(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lab.id]);

  const scores = computeSavedLabScores(modules, plan, adoption);

  function toggleTopic(t) {
    setTopics((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));
  }
  function toggleFlag(moduleKey) {
    setFlagged((fs) => (fs.includes(moduleKey) ? fs.filter((k) => k !== moduleKey) : [...fs, moduleKey]));
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

  async function handleSubmit() {
    setSaving(true);
    try {
      const csmId = idByName?.[currentCSM];
      await addVisit({
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
        actionItems: actionItems.filter((it) => it.text.trim()).map((it) => ({ text: it.text.trim(), dueDate: it.dueDate || null })),
      });

      // A next-follow-up date used to only ever surface on the Visits & Meetings page itself — it
      // never became a real task, so it never showed up on Dashboard/Tasks unless a module also
      // happened to get flagged. Now every follow-up date always creates its own task too, so it's
      // reliably visible everywhere tasks are, whether or not anything was flagged.
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
        });
      }

      // Flagging a module for follow-up during a check-in auto-creates a training follow-up task,
      // so it doesn't just sit silently in the snapshot — someone owns chasing it.
      if (flagged.length) {
        const dueDate = nextFollowup || plusDays(7);
        await Promise.all(flagged.map((moduleKey) => {
          const mod = modules.find((m) => m.key === moduleKey);
          return addTask({
            labId: lab.id,
            desc: `Training follow-up — ${mod ? mod.name : moduleKey} (${lab.name})`,
            owners: [currentCSM],
            type: "follow-up",
            repeat: "none",
            due: dueDate,
            idByName,
            assignedByName: currentCSM,
          });
        }));
      }

      showToast("Check-in logged.");
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
      <p className="page-sub">Everything below lands on this lab's Activity Timeline once you submit.</p>

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
                    background: type === t.key ? "var(--accent-dim)" : "#fff", color: type === t.key ? "var(--accent)" : "var(--text)",
                    borderRadius: 9, padding: "10px 8px", fontSize: 12.5, fontWeight: 600,
                  }}
                >
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{t.icon}</div>
                  {t.key}
                </button>
              ))}
            </div>
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
              <div className="tmpl-field" style={{ flex: "1 1 160px" }}><label>Logged By</label><input readOnly style={{ ...fieldStyle, background: "#f4f6f9", color: "var(--text-dim)" }} value={currentCSM} /></div>
              <div className="tmpl-field" style={{ flex: "1 1 160px" }}><label>Location</label><input style={fieldStyle} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Lab site, phone, video call" /></div>
            </div>
          </div>

          {/* 3. Person contacted */}
          <div className="table-card" style={{ padding: "16px 18px", marginBottom: 14 }}>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>3. Person Contacted</h3>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div className="tmpl-field" style={{ flex: "1 1 160px" }}><label>Name</label><input style={fieldStyle} value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="Who you spoke with" /></div>
              <div className="tmpl-field" style={{ flex: "1 1 160px" }}><label>Designation</label><input style={fieldStyle} value={personDesignation} onChange={(e) => setPersonDesignation(e.target.value)} placeholder="e.g. Lab Manager" /></div>
            </div>
          </div>

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
            <p style={{ fontSize: 11.5, color: "var(--text-dim)", margin: "0 0 10px" }}>Live from this lab's real adoption data. Flag a module if it needs a training follow-up — that creates a task automatically.</p>
            {loadingSide ? (
              <div style={{ padding: 12, color: "var(--text-faint)", fontSize: 12 }}>Loading…</div>
            ) : (
              <div className="table-scroll"><table className="child-mini">
                <thead><tr><th>Module</th><th>Overall %</th><th>Status</th><th>Flag</th></tr></thead>
                <tbody>{scores.moduleResults.filter((m) => m.inScope).map(({ mod, overallPct }) => {
                  const pct = Math.round(overallPct || 0);
                  const label = snapshotStatus(pct);
                  return (
                    <tr key={mod.key}>
                      <td>{mod.icon} {mod.name}</td>
                      <td className="mrr-cell">{pct}%</td>
                      <td><span className={`status-chip ${statusChipClass(label)}`} style={{ cursor: "default" }}>{label}</span></td>
                      <td><input type="checkbox" checked={flagged.includes(mod.key)} onChange={() => toggleFlag(mod.key)} /></td>
                    </tr>
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
                    background: sentiment === s.key ? s.color : "#fff", color: sentiment === s.key ? "#fff" : "var(--text)",
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
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>7. Action Items</h3>
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
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Next Follow-up (optional)</h3>
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
            <div className="seg-row"><span>Lab ID</span><span>{lab.id}</span></div>
            <div className="seg-row"><span>Plan</span><span>{plan.name}</span></div>
            <div className="seg-row"><span>CSM</span><span>{lab.csm}</span></div>
            <div className="seg-row"><span>Segment</span><span><span className="seg-badge" style={{ background: seg.color }}>{seg.code}</span></span></div>
            <div className="seg-row"><span>MRR</span><span>{fmtMoney(lab.mrr || 0, lab.region)}</span></div>
          </div>

          <div className="side-card">
            <h4>Adoption</h4>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div className="ring" style={{ background: `conic-gradient(${ringColor} ${scores.overallPct * 3.6}deg, #eef0f3 0deg)` }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>
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
