import { useEffect, useMemo, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { useSessionState } from "../lib/useSessionState";
import { useScopedCsm } from "../lib/useScopedCsm";
import { filterLabsByLabType } from "../lib/labs";
import { fetchInboxUpdates, fetchMyUpdateReads, markUpdatesRead, markUpdatesUnread, updateUnread, groupBursts, describeUpdate,
  UPDATE_SEGMENTS, UPDATES_START, BURST_MINUTES } from "../lib/inboxUpdates";
import { todayISO, addDaysISO } from "../lib/dates";
import { labSelectOptions } from "../lib/selectOptions";
import ScopeToggle from "../components/ScopeToggle";
import SearchSelect from "../components/SearchSelect";
import ClearFilters from "../components/ClearFilters";
import InboxTabs from "../components/InboxTabs";

// Sidebar → Inbox → Adoption / Expansion / Account (decision Nov 27 2026): each its own inbox, read from Lab History
// (lib/inboxUpdates.js). Same shape as Check-ins & Visits: grouped by lab, newest first, read per person (activity_reads,
// migration 0054), your own changes count as read. Changes by one person on one lab within BURST_MINUTES of each other are
// one entry ("5 adoption updates"); opening it lists every change and marks them all read. The Adoption and Expansion inboxes
// also show as an "Inbox" tab on the Adoption / Expansion pages (`embedded`: no page title or inbox tabs; same read marks).

const RANGES = [["today", "Today"], ["yesterday", "Yesterday"], ["7", "Last 7 days"], ["14", "Last 2 weeks"], ["30", "Last 1 month"], ["all", "All dates"], ["custom", "Custom range…"]];
const localDate = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtWhen = (iso) => {
  if (!iso) return "";
  const d = localDate(iso);
  const time = new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const today = todayISO();
  if (d === today) return `Today ${time}`;
  if (d === addDaysISO(today, -1)) return `Yesterday ${time}`;
  return new Date(iso).toLocaleDateString(undefined, d.slice(0, 4) === today.slice(0, 4) ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
};
const fmtFull = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const NOUN = { adoption: "adoption update", expansion: "expansion update", account: "account update" };

export default function InboxUpdatesView({ segment, embedded = false, labs: allLabs, modules = [], viewer, idByName, onOpenLab, showToast, counts, onNavigate }) {
  const seg = UPDATE_SEGMENTS[segment];
  const { isHead, scope, setScope, csmFilter, setCsmFilter, teamNames, scopeCsm, teamAll, labType, setLabType } = useScopedCsm(viewer, `inbox-${segment}`);
  const labs = useMemo(() => filterLabsByLabType(allLabs, labType), [allLabs, labType]);
  const [rows, setRows] = useState([]);
  const [reads, setReads] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useSessionState(`inbox.${segment}.q`, "");
  const [fKind, setFKind] = useSessionState(`inbox.${segment}.kind`, "");
  const [unreadOnly, setUnreadOnly] = useSessionState(`inbox.${segment}.unreadOnly`, false);
  const [fLab, setFLab] = useSessionState(`inbox.${segment}.lab`, "");
  const [range, setRange] = useSessionState(`inbox.${segment}.range`, "7");
  const [from, setFrom] = useSessionState(`inbox.${segment}.from`, "");
  const [to, setTo] = useSessionState(`inbox.${segment}.to`, "");
  const [open, setOpen] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const me = idByName[viewer.myName] || idByName[viewer.currentCSM];
  const nameById = useMemo(() => Object.fromEntries(Object.entries(idByName).map(([n, id]) => [id, n])), [idByName]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchInboxUpdates({ labs: allLabs, modules }), fetchMyUpdateReads(me)])
      .then(([r, rd]) => { if (!cancelled) { setRows(r); setReads(rd); } })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps -- labs / modules only seed demo mode once

  const labsById = useMemo(() => Object.fromEntries(labs.map((l) => [l.id, l])), [labs]);
  const moduleName = (k) => modules.find((m) => m.key === k)?.name || k;
  const who = (r) => nameById[r.csmId] || (r.csmId ? "—" : (SUPABASE_CONFIGURED ? "System" : labsById[r.labId]?.csm || "—"));
  const unreadFor = (r) => updateUnread(r, reads, me);

  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading the inbox…</div>;

  const scoped = labs.filter((l) => !scopeCsm || l.csm === scopeCsm);
  const scopedIds = new Set(scoped.map((l) => l.id));
  const today = todayISO();
  const yesterday = addDaysISO(today, -1);
  const [dFrom, dTo] = range === "custom" ? [from, to] : range === "all" ? ["", ""]
    : range === "today" ? [today, today] : range === "yesterday" ? [yesterday, yesterday]
    : [addDaysISO(today, -(Number(range) - 1)), ""];
  const qq = q.trim().toLowerCase();
  const mine = rows.filter((r) => r.segment === segment && scopedIds.has(r.labId));
  const kindsHere = seg.kinds.filter((k) => mine.some((r) => r.kind === k));
  const rowOk = (r) => {
    const d = localDate(r.createdAt);
    if (dFrom && d < dFrom) return false;
    if (dTo && d > dTo) return false;
    if (fLab && r.labId !== fLab) return false;
    if (fKind && r.kind !== fKind) return false;
    if (qq) {
      const x = describeUpdate(r);
      if (!`${labsById[r.labId]?.name} ${r.title} ${r.meta} ${x.what} ${moduleName(x.moduleKey)} ${who(r)}`.toLowerCase().includes(qq)) return false;
    }
    return true;
  };
  const entries = groupBursts(mine.filter(rowOk)).filter((g) => !unreadOnly || g.rows.some(unreadFor));
  const groups = [];
  const byLab = {};
  entries.forEach((g) => { if (!byLab[g.labId]) { byLab[g.labId] = []; groups.push(g.labId); } byLab[g.labId].push(g); });
  const unreadOf = (g) => g.rows.some(unreadFor);
  const unreadCount = entries.filter(unreadOf).length;

  async function doMarkRead(gs) {
    const ids = gs.flatMap((g) => g.rows).filter(unreadFor).map((r) => r.id);
    if (!ids.length) return;
    try { await markUpdatesRead(me, ids); setReads((s) => new Set([...s, ...ids])); }
    catch (err) { showToast(`⚠ ${err.message}`); }
  }
  async function doMarkUnread(g) {
    const ids = g.rows.map((r) => r.id);
    try { await markUpdatesUnread(me, ids); setReads((s) => { const n = new Set(s); ids.forEach((id) => n.delete(id)); return n; }); }
    catch (err) { showToast(`⚠ ${err.message}`); }
  }
  function openEntry(g) { setOpen(g); doMarkRead([g]); }

  // One line for an entry: the change itself, or "N adoption updates: A, B, C…" for a burst.
  const entryLine = (g) => {
    if (g.rows.length === 1) {
      const x = describeUpdate(g.rows[0]);
      return <>{x.what ? <b>{x.what}{x.change ? ": " : ""}</b> : null}{x.change}{x.note ? <span className="fb-faint"> — {x.note}</span> : null}</>;
    }
    const names = [...new Set(g.rows.map((r) => describeUpdate(r).what).filter(Boolean))];
    return <><b>{g.rows.length} {NOUN[segment]}s</b>: {names.slice(0, 4).join(", ")}{names.length > 4 ? ` +${names.length - 4} more` : ""}</>;
  };
  const kindLabel = (g) => (g.rows.length === 1 ? g.rows[0].kind.replace(/ Updated$| Update$/, "") : seg.label);

  return (
    <div>
      {!embedded && <h1 className="page-title">Inbox</h1>}
      <p className="page-sub">{seg.label} changes on {isHead ? "your team's" : "your"} labs, newest first — {seg.sub.charAt(0).toLowerCase() + seg.sub.slice(1)}. Open one to see every change — it's then marked read for you. Viewing <b>{teamAll ? "the whole team" : scopeCsm}</b>'s labs.</p>
      {!embedded && <InboxTabs view={`inbox-${segment}`} counts={counts} onNavigate={onNavigate} />}
      {error && <div className="error-banner">{error}</div>}
      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={teamNames} labType={labType} setLabType={setLabType} />

      <div className="filters">
        <input className="ts-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={segment === "account" ? "Search lab, change, person…" : "Search lab, parameter, module…"} aria-label="Search" />
        {seg.kinds.length > 1 && (
          <select value={fKind} onChange={(e) => setFKind(e.target.value)} aria-label="Kind">
            <option value="">All kinds</option>
            {(kindsHere.includes(fKind) || !fKind ? kindsHere : [...kindsHere, fKind]).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        )}
        <div className="seg" role="group" aria-label="Read state">
          <button type="button" className={!unreadOnly ? "on" : ""} onClick={() => setUnreadOnly(false)}>Everything</button>
          <button type="button" className={unreadOnly ? "on" : ""} onClick={() => setUnreadOnly(true)}>Unread only{unreadCount ? ` (${unreadCount})` : ""}</button>
        </div>
        <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range">{RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {range === "custom" && <span className="ib-dates">
          <input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <span className="fb-faint">to</span>
          <input type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        </span>}
        <span style={{ minWidth: 220 }}><SearchSelect value={fLab} onChange={setFLab} options={labSelectOptions(scoped)} emptyLabel="All labs" placeholder="All labs — type to filter" /></span>
        <ClearFilters active={!!(q || fKind || unreadOnly || range !== "7" || fLab)}
          onClear={() => { setQ(""); setFKind(""); setUnreadOnly(false); setRange("7"); setFrom(""); setTo(""); setFLab(""); }} />
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span className="fb-faint" style={{ fontSize: 12.5 }}>{groups.length} lab{groups.length === 1 ? "" : "s"} · {entries.length} entr{entries.length === 1 ? "y" : "ies"}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!unreadCount} onClick={() => doMarkRead(entries)}>Mark all read</button>
        </span>
      </div>

      {!groups.length && <div className="table-card" style={{ padding: 24, color: "var(--text-faint)", fontSize: 13 }}>{unreadOnly ? "Nothing unread in this date range — you're all caught up." : `No ${seg.label.toLowerCase()} changes match these filters${range !== "all" ? " — try a longer date range" : ""}.`}</div>}
      {groups.slice(0, 60).map((labId) => {
        const items = byLab[labId];
        const lab = labsById[labId];
        const unread = items.filter(unreadOf).length;
        const showAll = expanded.has(labId);
        const shown = showAll ? items : items.slice(0, 3);
        return (
          <div key={labId} className={`table-card ib-card${unread ? " ib-card-unread" : ""}`}>
            <div className="ib-head">
              <span className="lab-name clickable ib-lab" onClick={() => onOpenLab(labId, segment === "adoption" ? "adoption" : "history")}>{lab?.name || labId}</span>
              {lab?.status && <span className="ib-pill">{lab.status}</span>}
              <span className="fb-faint">{lab?.csm}</span>
              {unread > 0 && <span className="ib-unread-count">{unread} unread</span>}
              <span style={{ marginLeft: "auto" }}>{unread > 0 && <button type="button" className="fb-link" style={{ fontSize: 12 }} onClick={() => doMarkRead(items)}>Mark read</button>}</span>
            </div>
            {shown.map((g) => {
              const un = unreadOf(g);
              return (
                <div key={g.id} className={`ib-row ib-row-upd${un ? " ib-row-unread" : ""}`} onClick={() => openEntry(g)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") openEntry(g); }}>
                  {un && <span className="ib-dot" aria-label="Unread" />}
                  <span className={`ib-kind ib-upd-${segment}`}>{kindLabel(g)}</span>
                  <span className="ib-sum">{entryLine(g)}</span>
                  <span className="ib-who">{who(g.rows[0])}</span>
                  <span className="ib-when">{fmtWhen(g.createdAt)}</span>
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
      <div className="fb-faint" style={{ fontSize: 11.5, marginTop: 10 }}>
        Changes made before {new Date(UPDATES_START + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} count as read, and so does anything you changed yourself.
        Changes one person makes on a lab within {BURST_MINUTES} minutes of each other show as one entry.
      </div>

      {open && (
        <>
          <div className="drawer-backdrop show" onClick={() => setOpen(null)} />
          <div className="drawer show" role="dialog" aria-label={`${seg.label} update details`}>
            <div className="drawer-head">
              <div>
                <h2>{open.rows.length === 1 ? open.rows[0].kind : `${open.rows.length} ${NOUN[segment]}s`}</h2>
                <p><span className="clickable" style={{ color: "var(--accent)", cursor: "pointer", fontWeight: 600 }} onClick={() => { setOpen(null); onOpenLab(open.labId, segment === "adoption" ? "adoption" : "history"); }}>{labsById[open.labId]?.name || open.labId}</span> · by {who(open.rows[0])} · {fmtFull(open.firstAt)}{open.rows.length > 1 ? ` – ${new Date(open.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}</p>
              </div>
              <button className="drawer-close" onClick={() => setOpen(null)} aria-label="Close">&times;</button>
            </div>
            <div className="drawer-body">
              {open.rows.map((r) => {
                const x = describeUpdate(r);
                return (
                  <div key={r.id} className="ib-upd-item">
                    <div className="ib-upd-what">
                      <b>{x.what}</b>
                      {x.moduleKey && <span className="fb-faint"> · {moduleName(x.moduleKey)}</span>}
                      <span className="fb-faint" style={{ marginLeft: "auto", fontSize: 11.5 }}>{new Date(r.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    {x.change && <div className="ib-upd-change">{x.change}</div>}
                    {x.note && <div className="ts-note" style={{ marginTop: 6 }}>{x.note}</div>}
                  </div>
                );
              })}
            </div>
            <div className="drawer-foot">
              <button className="btn btn-ghost" style={{ marginRight: "auto" }} onClick={() => { doMarkUnread(open); setOpen(null); }}>Mark unread</button>
              <button className="btn btn-ghost" onClick={() => { setOpen(null); onOpenLab(open.labId, segment === "adoption" ? "adoption" : "history"); }}>{segment === "adoption" ? "Open Adoption tab" : "Open Lab History"}</button>
              <button className="btn btn-primary" onClick={() => setOpen(null)}>Done</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
