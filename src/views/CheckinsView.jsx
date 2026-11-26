import { useEffect, useMemo, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { useSessionState } from "../lib/useSessionState";
import { useScopedCsm } from "../lib/useScopedCsm";
import { filterLabsByLabType } from "../lib/labs";
import { fetchAllVisits } from "../lib/visits";
import { fetchAllLabContacts } from "../lib/labContacts";
import { pocSchedule, cadenceLabel, STATUS_RANK } from "../lib/checkinCadence";
import { buildDemoCheckins } from "../lib/demoSeed";
import { todayISO } from "../lib/dates";
import ScopeToggle from "../components/ScopeToggle";
import Paginated from "../components/Pager";
import InfoTip from "../components/InfoTip";
import ClearFilters from "../components/ClearFilters";

// Sidebar → Check-ins (decision Nov 24 2026). Every point of contact with a "Minimum Proactive Check-ins per Month"
// target, when they were last contacted and when the next check-in is due (lib/checkinCadence.js: 4 = weekly,
// 2 = every 15 days, 1 = monthly). "Log check-in" opens the normal Log Check-in with the lab and person filled in and
// comes back here. Check-ins logged from the lab page count the same way; the KPI still counts per month.

const fmtDay = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, d.slice(0, 4) === todayISO().slice(0, 4) ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "2-digit" }) : "");
const STATUS_FILTERS = [["", "Any status"], ["overdue", "Overdue"], ["soon", "Due today or in 3 days"], ["upcoming", "Upcoming"], ["met", "Target met this month"]];

function DueBadge({ s }) {
  if (s.status === "none") return <span className="ci-badge ci-none">No target</span>;
  if (s.status === "overdue") return <span className="ci-badge ci-overdue">Overdue {-s.daysLeft}d</span>;
  if (s.status === "today") return <span className="ci-badge ci-soon">Due today</span>;
  if (s.status === "soon") return <span className="ci-badge ci-soon">In {s.daysLeft}d</span>;
  return <span className="ci-badge ci-ok">In {s.daysLeft}d</span>;
}

export default function CheckinsView({ labs: allLabs, viewer, onOpenLab, onLogCheckin }) {
  const { isHead, scope, setScope, csmFilter, setCsmFilter, teamNames, scopeCsm, teamAll, labType, setLabType } = useScopedCsm(viewer, "checkins");
  const labs = useMemo(() => filterLabsByLabType(allLabs, labType), [allLabs, labType]);
  const [demo] = useState(() => (SUPABASE_CONFIGURED ? null : buildDemoCheckins(todayISO())));
  const [contacts, setContacts] = useState(() => demo?.contacts || []);
  const [visits, setVisits] = useState(() => demo?.visits || []);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);
  const [q, setQ] = useSessionState("checkins.q", "");
  const [fStatus, setFStatus] = useSessionState("checkins.status", "");
  const [showNoTarget, setShowNoTarget] = useSessionState("checkins.noTarget", false);
  const [sort, setSort] = useSessionState("checkins.sort", "urgent");

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return undefined;
    let cancelled = false;
    Promise.all([fetchAllLabContacts(), fetchAllVisits()])
      .then(([c, v]) => { if (!cancelled) { setContacts(c); setVisits(v); } })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading check-ins…</div>;

  const today = todayISO();
  const labsById = Object.fromEntries(labs.map((l) => [l.id, l]));
  const visitsByLab = {};
  visits.forEach((v) => { (visitsByLab[v.labId] ||= []).push(v); });
  const all = contacts
    .filter((c) => labsById[c.labId] && (!scopeCsm || labsById[c.labId].csm === scopeCsm))
    .map((c) => ({ c, lab: labsById[c.labId], s: pocSchedule(c, visitsByLab[c.labId], today) }));
  const withTarget = all.filter((r) => r.s.target > 0);
  const qq = q.trim().toLowerCase();
  const rows = (showNoTarget ? all : withTarget)
    .filter((r) => !qq || `${r.lab.name} ${r.c.name} ${r.c.designation} ${r.lab.csm}`.toLowerCase().includes(qq))
    .filter((r) => !fStatus || (fStatus === "soon" ? ["today", "soon"].includes(r.s.status) : fStatus === "met" ? r.s.month.met : r.s.status === fStatus))
    .sort((a, b) => (sort === "lab" ? a.lab.name.localeCompare(b.lab.name) || a.c.name.localeCompare(b.c.name)
      : sort === "csm" ? (a.lab.csm || "").localeCompare(b.lab.csm || "") || a.lab.name.localeCompare(b.lab.name)
        : STATUS_RANK[a.s.status] - STATUS_RANK[b.s.status] || (a.s.daysLeft ?? 999) - (b.s.daysLeft ?? 999) || a.lab.name.localeCompare(b.lab.name)));

  const overdue = withTarget.filter((r) => r.s.status === "overdue").length;
  const soon = withTarget.filter((r) => ["today", "soon"].includes(r.s.status)).length;
  const required = withTarget.reduce((s, r) => s + r.s.month.required, 0);
  const done = withTarget.reduce((s, r) => s + Math.min(r.s.month.done, r.s.month.required), 0);
  const noTarget = all.length - withTarget.length;
  const monthName = new Date(today + "T12:00:00").toLocaleDateString(undefined, { month: "long" });

  const tile = (label, value, tone, onClick, sub) => (
    <button type="button" className={`stile fb-tile ci-tile${tone ? ` ci-tile-${tone}` : ""}`} onClick={onClick}>
      <div className="sval">{value}</div><div className="slabel">{label}</div>{sub && <div className="fb-tile-sub">{sub}</div>}
    </button>
  );

  return (
    <div>
      <h1 className="page-title">Check-ins</h1>
      <p className="page-sub">Every point of contact with a check-in target — who is overdue, who is due soon, and a quick way to log it. Viewing <b>{teamAll ? "the whole team" : scopeCsm}</b>'s labs.</p>
      {error && <div className="error-banner">{error}</div>}
      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={teamNames} labType={labType} setLabType={setLabType} />

      <div className="summary-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", paddingTop: 0 }}>
        {tile("POCs with a target", withTarget.length, "", () => setFStatus(""), noTarget ? `${noTarget} without a target` : null)}
        {tile("Overdue", overdue, overdue ? "bad" : "", () => setFStatus("overdue"))}
        {tile("Due today or in 3 days", soon, soon ? "warn" : "", () => setFStatus("soon"))}
        {tile(`Done in ${monthName}`, `${done} / ${required}`, "", () => setFStatus("met"), required ? `${Math.round((done / required) * 100)}% — what the KPI counts` : null)}
      </div>

      <div className="filters">
        <input className="ts-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lab, contact, CSM…" aria-label="Search" />
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Status">{STATUS_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <label className="ci-toggle"><input type="checkbox" checked={!!showNoTarget} onChange={(e) => setShowNoTarget(e.target.checked)} /> Show POCs without a target</label>
        <ClearFilters active={!!(q || fStatus || showNoTarget)} onClear={() => { setQ(""); setFStatus(""); setShowNoTarget(false); }} />
        <InfoTip>A POC's Minimum Proactive Check-ins per Month also sets how often to contact them: every 30 ÷ target days (4 = weekly, 2 = every 15 days, 1 = monthly). Next due = their last Proactive check-in + that gap; never contacted = counted from when the POC was added. A check-in counts for a POC when its Person Contacted matches their name. Set targets on a lab's Points of Contact tab. The KPI still counts check-ins done ÷ required per month.</InfoTip>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" style={{ marginLeft: "auto" }}>
          <option value="urgent">Most urgent first</option><option value="lab">Lab A–Z</option><option value="csm">CSM</option>
        </select>
      </div>

      <div className="table-card">
        {!rows.length ? <div style={{ padding: 20, color: "var(--text-faint)", fontSize: 12.5 }}>{withTarget.length ? "No POCs match these filters." : "No point of contact has a check-in target yet — set “Minimum Proactive Check-ins per Month” on a lab's Points of Contact tab."}</div> : (
          <Paginated items={rows}>{(page) => (
            <div className="table-scroll"><table className="child-mini">
              <thead><tr><th>Lab</th><th>Point of contact</th><th>CSM</th><th>Target</th><th>This month</th><th>Last check-in</th><th>Next due</th><th></th></tr></thead>
              <tbody>{page.map(({ c, lab, s }) => (
                <tr key={c.id}>
                  <td className="lab-name clickable fb-cut" style={{ maxWidth: 170 }} onClick={() => onOpenLab(lab.id, "contacts")} title={lab.name}>{lab.name}</td>
                  <td className="ts-contact" style={{ maxWidth: 190 }}><b title={c.name}>{c.name}</b><span title={c.designation}>{c.designation || "—"}</span></td>
                  <td className="fb-cut" style={{ maxWidth: 120 }}>{lab.csm || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{cadenceLabel(s.target)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{s.target ? (
                    <span className="ci-month" title={`${s.month.done} Proactive check-in${s.month.done === 1 ? "" : "s"} with ${c.name} this month`}>
                      <span className="ci-bar"><i style={{ width: `${Math.min(100, (s.month.done / s.month.required) * 100)}%`, background: s.month.met ? "var(--ok)" : "var(--stg-plan-3)" }} /></span>
                      {s.month.done}/{s.month.required}
                    </span>) : "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{s.last ? <>{fmtDay(s.last.visitDate)} <span className="fb-faint">· {s.last.type}</span></> : <span className="fb-faint">Never</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}><DueBadge s={s} />{s.nextDue && <span className="fb-faint" style={{ marginLeft: 6 }}>{fmtDay(s.nextDue)}</span>}</td>
                  <td style={{ textAlign: "right" }}><button type="button" className="btn btn-ghost btn-sm" onClick={() => onLogCheckin(lab.id, { personName: c.name, personDesignation: c.designation || "" })}>Log check-in</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}</Paginated>
        )}
      </div>
    </div>
  );
}
