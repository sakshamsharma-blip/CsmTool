import { useEffect, useMemo, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { useSessionState } from "../lib/useSessionState";
import { useScopedCsm } from "../lib/useScopedCsm";
import { filterLabsByLabType } from "../lib/labs";
import { fetchAllVisits } from "../lib/visits";
import { fetchMyReads, markRead, markUnread, isUnread, visitKind, INBOX_START } from "../lib/inbox";
import { buildDemoCheckins } from "../lib/demoSeed";
import { todayISO, addDaysISO } from "../lib/dates";
import { computeSentimentHealth, HEALTH_BUCKET_COLORS } from "../lib/labHealth";
import { labSelectOptions } from "../lib/selectOptions";
import ScopeToggle from "../components/ScopeToggle";
import SearchSelect from "../components/SearchSelect";
import ClearFilters from "../components/ClearFilters";

// Sidebar → Inbox (decision Nov 24 2026; open to every CSM since Nov 26 2026 — a CSM sees their own labs, a Lead / Manager /
// Admin the team). Check-ins and logged visits, newest first, grouped by lab. Entries you logged yourself count as read.
// Filters include the check-in's sentiment or the lab's health (lib/labHealth.js) and a date range (default last 7 days). Opening an entry shows everything that was logged and marks it read for you (visit_reads,
// migration 0052). "Mark all read" per lab or for the whole filtered list. Entries before INBOX_START count as read.

const SENT_CLASS = { Positive: "fb-done", Neutral: "fb-faint", "At Risk": "fb-never" };
const fmtWhen = (v) => {
  const d = v.visitDate;
  if (!d) return "";
  const today = todayISO();
  if (d === today) return "Today";
  return new Date(d + "T12:00:00").toLocaleDateString(undefined, d.slice(0, 4) === today.slice(0, 4) ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
};
// Date range on the check-in / visit date. Default = the last 7 days (decision Nov 26 2026), for daily / weekly reviews.
const RANGES = [["7", "Last 7 days"], ["14", "Last 2 weeks"], ["30", "Last 1 month"], ["all", "All dates"], ["custom", "Custom range…"]];
// Two separate filters (Nov 26 2026): the entry's own sentiment, and the lab's Lab Health (Sentiment) bucket.
const SENTIMENTS = [["Positive", "Positive"], ["Neutral", "Neutral"], ["At Risk", "At Risk"], ["none", "Not set"]];
const HEALTH_BUCKETS = ["Healthy", "Needs Attention", "At Risk", "Not Assessed"];
const summaryOf = (v) => [v.notes, v.discussionTopics?.length ? `Topics: ${v.discussionTopics.join(", ")}` : null].filter(Boolean).join(" · ") || "No notes.";

export default function InboxView({ labs: allLabs, modules = [], viewer, idByName, onOpenLab, showToast }) {
  const { isHead, scope, setScope, csmFilter, setCsmFilter, teamNames, scopeCsm, teamAll, labType, setLabType } = useScopedCsm(viewer, "inbox");
  const labs = useMemo(() => filterLabsByLabType(allLabs, labType), [allLabs, labType]);
  const [demo] = useState(() => (SUPABASE_CONFIGURED ? null : buildDemoCheckins(todayISO())));
  const [visits, setVisits] = useState(() => demo?.visits || []);
  const [reads, setReads] = useState(() => new Set());
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);
  const [q, setQ] = useSessionState("inbox.q", "");
  const [fKind, setFKind] = useSessionState("inbox.kind", "");
  const [unreadOnly, setUnreadOnly] = useSessionState("inbox.unreadOnly", false);
  const [fLab, setFLab] = useSessionState("inbox.lab", "");
  const [fSent, setFSent] = useSessionState("inbox.sent", "");
  const [fHealth, setFHealth] = useSessionState("inbox.health", "");
  const [range, setRange] = useSessionState("inbox.range", "7");
  const [from, setFrom] = useSessionState("inbox.from", "");
  const [to, setTo] = useSessionState("inbox.to", "");
  const [open, setOpen] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const me = idByName[viewer.myName] || idByName[viewer.currentCSM];
  const nameById = useMemo(() => Object.fromEntries(Object.entries(idByName).map(([n, id]) => [id, n])), [idByName]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([SUPABASE_CONFIGURED ? fetchAllVisits() : Promise.resolve(null), fetchMyReads(me)])
      .then(([v, r]) => { if (!cancelled) { if (v) setVisits(v); setReads(r); } })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [me]);

  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading the inbox…</div>;

  const labsById = Object.fromEntries(labs.map((l) => [l.id, l]));
  const scoped = labs.filter((l) => !scopeCsm || l.csm === scopeCsm);
  const scopedIds = new Set(scoped.map((l) => l.id));
  const qq = q.trim().toLowerCase();
  // Lab health uses every check-in of the lab (not just the date range), like Total Labs.
  const visitsByLab = {};
  visits.forEach((v) => { (visitsByLab[v.labId] ||= []).push(v); });
  const healthCache = {};
  const healthOf = (labId) => (healthCache[labId] ||= computeSentimentHealth(visitsByLab[labId]).bucket);
  const today = todayISO();
  const [dFrom, dTo] = range === "custom" ? [from, to] : range === "all" ? ["", ""] : [addDaysISO(today, -(Number(range) - 1)), ""];
  const inRange = (v) => (!dFrom || (v.visitDate || "") >= dFrom) && (!dTo || (v.visitDate || "") <= dTo);
  const sentOk = (v) => (!fSent || (fSent === "none" ? !v.sentiment : v.sentiment === fSent)) && (!fHealth || healthOf(v.labId) === fHealth);
  const unreadFor = (v) => isUnread(v, reads) && v.csmId !== me; // what you logged yourself is never unread for you
  const who = (v) => nameById[v.csmId] || labsById[v.labId]?.csm || "—";
  const list = visits
    .filter((v) => scopedIds.has(v.labId) && (!fLab || v.labId === fLab) && (!fKind || visitKind(v) === fKind) && inRange(v) && sentOk(v) && (!unreadOnly || unreadFor(v))
      && (!qq || `${labsById[v.labId]?.name} ${v.notes} ${v.personName} ${(v.discussionTopics || []).join(" ")} ${who(v)}`.toLowerCase().includes(qq)))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "") || (b.visitDate || "").localeCompare(a.visitDate || ""));
  const groups = [];
  const byLab = {};
  list.forEach((v) => { if (!byLab[v.labId]) { byLab[v.labId] = []; groups.push(v.labId); } byLab[v.labId].push(v); });
  const unreadCount = list.filter((v) => unreadFor(v)).length;

  async function doMarkRead(items) {
    const ids = items.filter((v) => isUnread(v, reads)).map((v) => v.id);
    if (!ids.length) return;
    try { await markRead(me, ids); setReads((r) => new Set([...r, ...ids])); }
    catch (err) { showToast(`⚠ ${err.message}`); }
  }
  async function doMarkUnread(v) {
    try { await markUnread(me, v.id); setReads((r) => { const n = new Set(r); n.delete(v.id); return n; }); }
    catch (err) { showToast(`⚠ ${err.message}`); }
  }
  function openEntry(v) { setOpen(v); doMarkRead([v]); }
  const moduleName = (k) => modules.find((m) => m.key === k)?.name || k;

  return (
    <div>
      <h1 className="page-title">Inbox</h1>
      <p className="page-sub">{isHead ? "Your team's" : "Your labs'"} check-ins and logged visits, newest first. Open one to see everything that was logged — it's then marked read for you. Viewing <b>{teamAll ? "the whole team" : scopeCsm}</b>'s labs.</p>
      {error && <div className="error-banner">{error}</div>}
      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={teamNames} labType={labType} setLabType={setLabType} />

      <div className="filters">
        <input className="ts-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lab, note, person…" aria-label="Search" />
        <select value={fKind} onChange={(e) => setFKind(e.target.value)} aria-label="Kind"><option value="">All kinds</option><option>Check-in</option><option>Visit</option></select>
        <div className="seg" role="group" aria-label="Read state">
          <button type="button" className={!unreadOnly ? "on" : ""} onClick={() => setUnreadOnly(false)}>Everything</button>
          <button type="button" className={unreadOnly ? "on" : ""} onClick={() => setUnreadOnly(true)}>Unread only{unreadCount ? ` (${unreadCount})` : ""}</button>
        </div>
        <select value={fSent} onChange={(e) => setFSent(e.target.value)} aria-label="Check-in sentiment" title="The sentiment logged on the check-in or visit">
          <option value="">Any check-in sentiment</option>
          {SENTIMENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={fHealth} onChange={(e) => setFHealth(e.target.value)} aria-label="Lab health" title="Lab Health (Sentiment): 75% the lab's last 5 check-ins, 25% all-time">
          <option value="">Any lab health</option>
          {HEALTH_BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range">{RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {range === "custom" && <span className="ib-dates">
          <input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <span className="fb-faint">to</span>
          <input type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        </span>}
        <span style={{ minWidth: 220 }}><SearchSelect value={fLab} onChange={setFLab} options={labSelectOptions(scoped)} emptyLabel="All labs" placeholder="All labs — type to filter" /></span>
        <ClearFilters active={!!(q || fKind || unreadOnly || fSent || fHealth || range !== "7" || fLab)}
          onClear={() => { setQ(""); setFKind(""); setUnreadOnly(false); setFSent(""); setFHealth(""); setRange("7"); setFrom(""); setTo(""); setFLab(""); }} />
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span className="fb-faint" style={{ fontSize: 12.5 }}>{groups.length} lab{groups.length === 1 ? "" : "s"} · {list.length} entr{list.length === 1 ? "y" : "ies"}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!unreadCount} onClick={() => doMarkRead(list)}>Mark all read</button>
        </span>
      </div>

      {!groups.length && <div className="table-card" style={{ padding: 24, color: "var(--text-faint)", fontSize: 13 }}>{unreadOnly ? "Nothing unread in this date range — you're all caught up." : `No check-ins or visits match these filters${range !== "all" ? " — try a longer date range" : ""}.`}</div>}
      {groups.slice(0, 60).map((labId) => {
        const items = byLab[labId];
        const lab = labsById[labId];
        const unread = items.filter((v) => unreadFor(v)).length;
        const showAll = expanded.has(labId);
        const shown = showAll ? items : items.slice(0, 3);
        return (
          <div key={labId} className={`table-card ib-card${unread ? " ib-card-unread" : ""}`}>
            <div className="ib-head">
              <span className="lab-name clickable ib-lab" onClick={() => onOpenLab(labId, "history")}>{lab?.name || labId}</span>
              {lab?.status && <span className="ib-pill">{lab.status}</span>}
              <span className="ib-health" style={{ color: HEALTH_BUCKET_COLORS[healthOf(labId)] }} title="Lab Health (Sentiment): 75% the last 5 check-ins, 25% all-time">{healthOf(labId)}</span>
              <span className="fb-faint">{lab?.csm}</span>
              {unread > 0 && <span className="ib-unread-count">{unread} unread</span>}
              <span style={{ marginLeft: "auto" }}>{unread > 0 && <button type="button" className="fb-link" style={{ fontSize: 12 }} onClick={() => doMarkRead(items)}>Mark read</button>}</span>
            </div>
            <div className="ib-latest">{visitKind(items[0])} by {who(items[0])}: {summaryOf(items[0])}</div>
            {shown.map((v) => {
              const un = unreadFor(v);
              return (
                <div key={v.id} className={`ib-row${un ? " ib-row-unread" : ""}`} onClick={() => openEntry(v)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") openEntry(v); }}>
                  {un && <span className="ib-dot" aria-label="Unread" />}
                  <span className={`ib-kind ib-${visitKind(v) === "Visit" ? "visit" : "checkin"}`}>{visitKind(v)}{v.type && v.type !== "Visit" ? ` · ${v.type}` : ""}</span>
                  {v.engagement && <span className="ib-eng">{v.engagement}</span>}
                  {v.sentiment && <span className={`ib-sent ${SENT_CLASS[v.sentiment] || ""}`}>{v.sentiment}</span>}
                  <span className="ib-sum">{v.personName ? <b>{v.personName}: </b> : null}{summaryOf(v)}</span>
                  <span className="ib-who">{who(v)}</span>
                  <span className="ib-when">{fmtWhen(v)}</span>
                  <span className={un ? "ib-state" : "ib-state fb-done"}>{un ? "unread" : "✓ read"}</span>
                </div>
              );
            })}
            {items.length > 3 && (
              <button type="button" className="fb-link ib-more" onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(labId)) n.delete(labId); else n.add(labId); return n; })}>
                {showAll ? "Show fewer" : `Show all ${items.length}`}
              </button>
            )}
          </div>
        );
      })}
      {groups.length > 60 && <div className="fb-faint" style={{ padding: 10, fontSize: 12.5 }}>Showing the 60 most recent labs — narrow the filters to see more.</div>}
      <div className="fb-faint" style={{ fontSize: 11.5, marginTop: 10 }}>Entries logged before {new Date(INBOX_START + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} count as read, and so does anything you logged yourself.</div>

      {open && (
        <>
          <div className="drawer-backdrop show" onClick={() => setOpen(null)} />
          <div className="drawer show" role="dialog" aria-label={`${visitKind(open)} details`}>
            <div className="drawer-head">
              <div>
                <h2>{visitKind(open)}{open.type && open.type !== "Visit" ? ` · ${open.type}` : ""}</h2>
                <p><span className="clickable" style={{ color: "var(--accent)", cursor: "pointer", fontWeight: 600 }} onClick={() => { setOpen(null); onOpenLab(open.labId, "history"); }}>{labsById[open.labId]?.name || open.labId}</span> · {fmtWhen(open)} · by {who(open)}</p>
              </div>
              <button className="drawer-close" onClick={() => setOpen(null)} aria-label="Close">&times;</button>
            </div>
            <div className="drawer-body">
              {[
                ["Engagement", open.engagement],
                ["Person contacted", open.personName ? `${open.personName}${open.personDesignation ? ` — ${open.personDesignation}` : ""}` : null],
                ["Duration", open.durationMinutes ? `${open.durationMinutes} min` : null],
                ["Location", open.location],
                ["Sentiment", open.sentiment],
                ["Topics", open.discussionTopics?.length ? open.discussionTopics.join(", ") : null],
                ["Modules discussed", open.flaggedModules?.length ? open.flaggedModules.map(moduleName).join(", ") : null],
                ["Parameters discussed", open.discussedParams?.length ? open.discussedParams.map((p) => p.split("|").reverse().join(" · ")).join(", ") : null],
                ["Next follow-up", open.nextFollowupDate ? `${fmtWhen({ visitDate: open.nextFollowupDate })}${open.nextFollowupTime ? ` at ${open.nextFollowupTime}` : ""}${open.nextFollowupReason ? ` — ${open.nextFollowupReason}` : ""}` : null],
                ["Logged", open.createdAt ? new Date(open.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : null],
              ].map(([label, value]) => (
                <div key={label} className="ib-detail-row"><span>{label}</span><span>{value || "—"}</span></div>
              ))}
              <div className="ts-section-label" style={{ marginTop: 16 }}>Notes</div>
              <div className="ts-note">{open.notes || <span className="fb-faint">No notes.</span>}</div>
              {open.actionItems?.length > 0 && <>
                <div className="ts-section-label" style={{ marginTop: 16 }}>Action items</div>
                <ul className="ib-actions">{open.actionItems.map((a, i) => <li key={i}>{a.text}{a.dueDate ? <span className="fb-faint"> · due {fmtWhen({ visitDate: a.dueDate })}</span> : null}</li>)}</ul>
              </>}
            </div>
            <div className="drawer-foot">
              <button className="btn btn-ghost" style={{ marginRight: "auto" }} onClick={() => { doMarkUnread(open); setOpen(null); }}>Mark unread</button>
              <button className="btn btn-ghost" onClick={() => { setOpen(null); onOpenLab(open.labId, "history"); }}>Open Lab History</button>
              <button className="btn btn-primary" onClick={() => setOpen(null)}>Done</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
