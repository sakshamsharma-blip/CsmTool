import { useMemo, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { useSessionState } from "../lib/useSessionState";
import { useKpiData } from "../lib/useKpiData";
import { useChartTooltip } from "../lib/useChartTooltip";
import { useScopedCsm } from "../lib/useScopedCsm";
import { clientGroups } from "../lib/labRollup";
import { filterLabsByLabType, LAB_TYPES } from "../lib/labs";
import { KPI_DEFS, computeKpis, scoreKpis, targetFor, saveKpiSettings } from "../lib/kpi";
import { GRANULARITIES, periodsFor, periodContaining, previousPeriod, isFuture } from "../lib/periods";
import { todayISO, daysFromTodayISO } from "../lib/dates";
import { toINR } from "../lib/format";
import { TipCard } from "../components/ChartTooltip";
import InfoTip from "../components/InfoTip";
import Modal from "../components/Modal";
import { Tile, Card, TrendChart, ScoreBars, Ring, Heat, Change } from "../components/Analytics";
import { fmtPct, fmtPP, fmtCompactINR, downloadCsv } from "../lib/analyticsFormat";

// KPI Management (decision Nov 2 2026; rules in lib/kpi.js). A Lead / Admin sees the team dashboard and can open any CSM's
// report; a plain CSM goes straight to their own. No photos of people anywhere on these screens.
const CSM_ON_TARGET = 90; // "CSMs at 90%+" tile
const avg = (vals) => { const v = vals.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const LINE = "var(--stg-plan-2)";

export default function KpiView({ labs: allLabs, modules, plans, viewer, idByName, onOpenLab, showToast }) {
  const { isHead, teamNames } = useScopedCsm(viewer, "kpi");
  const kpi = useKpiData({ labs: allLabs, modules, plans, idByName });
  const thisYear = Number(todayISO().slice(0, 4));
  const [gran, setGran] = useSessionState("kpi.gran", "Quarterly");
  const [periodKey, setPeriodKey] = useSessionState("kpi.period", "");
  const [compareKey, setCompareKey] = useSessionState("kpi.compare", "");
  const [labType, setLabType] = useSessionState("kpi.labType", "");
  const [picked, setPicked] = useSessionState("kpi.csm", "");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const tip = useChartTooltip();

  const labs = useMemo(() => filterLabsByLabType(allLabs, labType), [allLabs, labType]);
  const csm = isHead ? picked : viewer.currentCSM;

  // Every started period of this year and last, newest first, for the two dropdowns.
  const choices = useMemo(() => [...periodsFor(thisYear, gran), ...(gran === "Yearly" ? [] : periodsFor(thisYear - 1, gran))]
    .filter((p) => !isFuture(p)).sort((a, b) => (a.start < b.start ? 1 : -1)), [thisYear, gran]);
  const period = choices.find((p) => p.key === periodKey) || periodContaining(todayISO(), gran);
  const compare = choices.find((p) => p.key === compareKey) || previousPeriod(period);
  const trendPeriods = useMemo(() => periodsFor(period.year, gran).filter((p) => !isFuture(p)), [period.year, gran]);

  if (!SUPABASE_CONFIGURED) {
    return <div><h1 className="page-title">KPI Management</h1><div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — KPI Management needs a database connected.</div></div>;
  }
  if (kpi.loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading KPIs…</div>;
  if (kpi.error) return <div className="error-banner">Couldn't load KPIs — {kpi.error}</div>;

  const { data, clientScores } = kpi;
  const settings = data.settings;
  const ids = new Set(labs.map((l) => l.id));

  // Tasks measured: a CSM's own (as owner); for the team, all of them (narrowed to these labs under a Lab Type filter).
  const tasksOf = (name) => data.tasks.filter((t) => (name ? t.owner === name : true) && (!labType || ids.has(t.labId)));

  // `groups` = the clients measured (clientGroups). A CSM's are narrowed to the labs they handle.
  function measure(groups, tasks, p, csmId) {
    const subsetLabs = groups.flatMap((g) => g.labs);
    const atP = groups.map((g) => clientScores(g, p));
    const scores = { adoption: avg(atP.map((s) => s?.adoptionPct)), expansion: avg(atP.map((s) => s?.expansionPct)), clients: atP.filter(Boolean).length };
    const kpis = computeKpis({ labs: subsetLabs, tasks, scores, period: p, data });
    return { kpis, ...scoreKpis(kpis, settings.weights, (key) => targetFor(settings, key, csmId)) };
  }
  const csmGroups = (name) => clientGroups(labs, name);
  const forCsm = (name, p) => measure(csmGroups(name), tasksOf(name), p, idByName?.[name]);
  const forTeam = (p) => measure(clientGroups(labs), tasksOf(null), p, null);

  const filters = (
    <div className="an-filters">
      <select className="dash-select" value={gran} onChange={(e) => { setGran(e.target.value); setPeriodKey(""); setCompareKey(""); }} aria-label="Period type">
        {GRANULARITIES.map((g) => <option key={g} value={g}>{g}</option>)}
      </select>
      <select className="dash-select" value={period.key} onChange={(e) => setPeriodKey(e.target.value)} aria-label="Period">
        {choices.map((p) => <option key={p.key} value={p.key}>{p.label}{p.range ? ` (${p.range})` : ""}</option>)}
      </select>
      <span style={{ fontSize: 12, color: "var(--text-dim)" }}>compared with</span>
      <select className="dash-select" value={compare.key} onChange={(e) => setCompareKey(e.target.value)} aria-label="Compare with">
        {[compare, ...choices.filter((p) => p.key !== compare.key)].map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
      {isHead && (
        <select className="dash-select" value={picked} onChange={(e) => setPicked(e.target.value)} aria-label="CSM">
          <option value="">All CSMs</option>
          {teamNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      )}
      <select className="dash-select" value={labType} onChange={(e) => setLabType(e.target.value)} aria-label="Lab Type">
        <option value="">All Lab Types</option>
        {LAB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      {isHead && <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "6px 12px", marginLeft: "auto" }} onClick={() => setSettingsOpen(true)}>Targets &amp; weights</button>}
    </div>
  );

  const body = csm
    ? <CsmReport name={csm} isHead={isHead} onBack={() => setPicked("")} period={period} compare={compare} trendPeriods={trendPeriods} forCsm={forCsm} measure={measure} csmGroups={csmGroups}
        settings={settings} csmId={idByName?.[csm]} data={data} clientScores={clientScores} tip={tip} onOpenLab={onOpenLab} />
    : <TeamDashboard names={teamNames} labs={labs} period={period} compare={compare} trendPeriods={trendPeriods} forCsm={forCsm} forTeam={forTeam} csmGroups={csmGroups} settings={settings}
        data={data} clientScores={clientScores} tip={tip} onOpenCsm={setPicked} />;

  return (
    <div>
      <h1 className="page-title">KPI Management
        <InfoTip>Six KPIs, each a % for the period. Points = actual ÷ target (at most 100%) × weight. The KPI score = points earned ÷ weights counted × 100; a KPI with nothing to measure in the period is left out. Hover ⓘ on each KPI for how it's measured.</InfoTip>
      </h1>
      <p className="page-sub">Track core CSM performance across Adoption, POC check-ins, Retention, Expansion, Collection and Task Closure.</p>
      {filters}
      {body}
      {settingsOpen && <KpiSettingsModal settings={settings} names={teamNames} idByName={idByName} onClose={() => setSettingsOpen(false)}
        onSaved={async () => { setSettingsOpen(false); showToast("KPI targets and weights saved."); await kpi.reload(); }} />}
      {tip.tooltip}
    </div>
  );
}

function KpiCards({ cur, prev, settings, csmId, showPoints }) {
  return (
    <div className="kpi-cards">
      {KPI_DEFS.map((d) => {
        const v = cur.kpis[d.key]?.value, t = targetFor(settings, d.key, csmId), w = settings.weights[d.key];
        const pv = prev.kpis[d.key]?.value;
        return (
          <div key={d.key} className="kpi-card">
            <div className="kpi-card-title"><span>{d.icon}</span>{d.label}<InfoTip>{d.info}</InfoTip></div>
            <div className="kpi-card-body">
              <Ring value={v} target={t} size={72} />
              <div className="kpi-card-stats">
                <div>Target <b>{fmtPct(t)}</b></div>
                {showPoints ? <div>Weight <b>{w}%</b></div> : <div>Actual <b>{fmtPct(v)}</b></div>}
                {showPoints ? <div>Points <b>{cur.points[d.key] == null ? "—" : `${Math.round(cur.points[d.key])}/${w}`}</b></div> : <div><Change value={v == null || pv == null ? null : v - pv} /></div>}
              </div>
            </div>
            <div className="kpi-card-note">{cur.kpis[d.key]?.note}</div>
          </div>
        );
      })}
    </div>
  );
}

function TeamDashboard({ names, labs, period, compare, trendPeriods, forCsm, forTeam, csmGroups, settings, data, clientScores, tip, onOpenCsm }) {
  const team = forTeam(period), teamPrev = forTeam(compare);
  const rows = names.map((name) => {
    const gs = csmGroups(name);
    return { name, labs: gs.flatMap((g) => g.labs), mrr: gs.reduce((s, g) => s + g.mrrINR, 0), m: forCsm(name, period) };
  }).filter((r) => r.labs.length);
  const totalMrr = clientGroups(labs).reduce((s, g) => s + g.mrrINR, 0);
  const onTarget = rows.filter((r) => r.m.total != null && r.m.total >= CSM_ON_TARGET).length;
  const trend = trendPeriods.map((p) => {
    const t = forTeam(p);
    return { label: p.label.replace(` ${p.year}`, ""), value: t.total, tip: <TipCard title={p.label} rows={[["KPI score", fmtPct(t.total)], ...KPI_DEFS.map((d) => [d.label, fmtPct(t.kpis[d.key]?.value)])]} /> };
  });

  // Attention list.
  const today = todayISO();
  const groups = clientGroups(labs);
  const lowAdoption = groups.filter((g) => { const v = clientScores(g, period)?.adoptionPct; return v != null && v < 50; });
  const cutoff = daysFromTodayISO(-30);
  const noCheckin = labs.filter((l) => !(data.visitsByLab[l.id] || []).some((v) => v.visitDate >= cutoff));
  const ids = new Set(labs.map((l) => l.id)), byId = Object.fromEntries(labs.map((l) => [l.id, l]));
  const overdue = data.invoices.filter((i) => ids.has(i.labId) && i.dueDate && i.dueDate < today && i.total > i.collectedManual)
    .reduce((s, i) => s + toINR(i.total - i.collectedManual, byId[i.labId].region), 0);
  const weekAgo = daysFromTodayISO(-7);
  const staleHigh = data.tasks.filter((t) => t.priority === "High" && t.status !== "Done" && !t.done && t.createdAt && t.createdAt.slice(0, 10) < weekAgo);

  const met = KPI_DEFS.filter((d) => team.kpis[d.key]?.value != null && team.kpis[d.key].value >= settings.targets[d.key]);
  const missed = KPI_DEFS.filter((d) => team.kpis[d.key]?.value != null && team.kpis[d.key].value < settings.targets[d.key]);
  const change = team.total != null && teamPrev.total != null ? team.total - teamPrev.total : null;

  function exportCsv() {
    const out = [["CSM", "Labs", "ARR (INR)", ...KPI_DEFS.map((d) => d.label), "KPI score"]];
    rows.forEach((r) => out.push([r.name, r.labs.length, Math.round(r.mrr * 12), ...KPI_DEFS.map((d) => (r.m.kpis[d.key]?.value == null ? "" : Math.round(r.m.kpis[d.key].value))), r.m.total == null ? "" : Math.round(r.m.total)]));
    downloadCsv(`kpi-scorecard-${period.label.replace(/\s+/g, "-").toLowerCase()}.csv`, out);
  }

  return (
    <>
      <div className="an-tiles" style={{ gridTemplateColumns: "repeat(6, minmax(0,1fr))" }}>
        <Tile value={labs.length} label="Total Labs" />
        <Tile value={fmtCompactINR(totalMrr * 12)} label="Total ARR" />
        <Tile value={rows.length} label="CSMs" />
        <Tile tone="good" value={fmtPct(team.total)} label="Overall KPI score" sub={period.label} />
        <Tile value={fmtPP(change)} label={`vs ${compare.label}`} sub={teamPrev.total == null ? "No earlier data" : fmtPct(teamPrev.total)} />
        <Tile value={`${onTarget} / ${rows.length}`} label={`CSMs at ${CSM_ON_TARGET}%+`} />
      </div>
      <KpiCards cur={team} prev={teamPrev} settings={settings} csmId={null} />
      <div className="an-grid-3">
        <Card title="KPI score trend · team"><TrendChart series={[{ name: "KPI score", color: LINE, points: trend }]} bind={tip.bind} /></Card>
        <Card title={`KPI score by CSM · ${period.label}`} info="Click a bar for the CSM's report.">
          <ScoreBars target={CSM_ON_TARGET} bind={tip.bind} items={rows.map((r) => ({
            key: r.name, label: r.name, value: r.m.total, onClick: () => onOpenCsm(r.name),
            tip: <TipCard title={r.name} rows={[["KPI score", fmtPct(r.m.total)], ...KPI_DEFS.map((d) => [d.label, fmtPct(r.m.kpis[d.key]?.value)])]} />,
          }))} />
        </Card>
        <Card title={`Key insights · ${period.label}`}>
          <ul className="an-list">
            {team.total != null && <li>Overall KPI {fmtPct(team.total)}{change != null ? ` (${fmtPP(change)} vs ${compare.label})` : ""}.</li>}
            {met.length > 0 && <li>On target: {met.map((d) => `${d.label} ${fmtPct(team.kpis[d.key].value)}`).join(", ")}.</li>}
            {missed.length > 0 && <li>Need focus: {missed.map((d) => `${d.label} ${fmtPct(team.kpis[d.key].value)} (target ${fmtPct(settings.targets[d.key])})`).join(", ")}.</li>}
            <li>{lowAdoption.length} client{lowAdoption.length === 1 ? "" : "s"} below 50% adoption.</li>
            <li>{noCheckin.length} lab{noCheckin.length === 1 ? "" : "s"} with no check-in in the last 30 days.</li>
            <li>{fmtCompactINR(overdue)} of collection overdue.</li>
            <li>{staleHigh.length} high-priority task{staleHigh.length === 1 ? "" : "s"} open for more than 7 days.</li>
          </ul>
        </Card>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "18px 0 8px" }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>CSM KPI scorecard · {period.label}</h3>
        <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={exportCsv}>Export CSV</button>
      </div>
      <div className="table-card"><div className="table-scroll"><table className="child-mini an-table">
        <thead><tr><th>CSM</th><th className="c">Labs</th><th>ARR</th>{KPI_DEFS.map((d) => <th key={d.key} className="c">{d.label}<div className="an-th-sub">T: {fmtPct(settings.targets[d.key])} · W: {settings.weights[d.key]}%</div></th>)}<th className="c">KPI score</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="lab-name clickable" onClick={() => onOpenCsm(r.name)}>{r.name}</td><td className="c">{r.labs.length}</td><td style={{ whiteSpace: "nowrap" }}>{fmtCompactINR(r.mrr * 12)}</td>
              {KPI_DEFS.map((d) => <td key={d.key} className="c"><Heat value={r.m.kpis[d.key]?.value} /></td>)}
              <td className="c"><Heat value={r.m.total} /></td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700 }}>
            <td>Team</td><td className="c">{labs.length}</td><td style={{ whiteSpace: "nowrap" }}>{fmtCompactINR(totalMrr * 12)}</td>
            {KPI_DEFS.map((d) => <td key={d.key} className="c"><Heat value={team.kpis[d.key]?.value} /></td>)}
            <td className="c"><Heat value={team.total} /></td>
          </tr>
        </tbody>
      </table></div></div>
    </>
  );
}

function CsmReport({ name, isHead, onBack, period, compare, trendPeriods, forCsm, measure, csmGroups, settings, csmId, data, clientScores, tip, onOpenLab }) {
  const groups = csmGroups(name);
  const labCount = groups.reduce((s, g) => s + g.labs.length, 0);
  const cur = forCsm(name, period), prev = forCsm(name, compare);
  const mrr = groups.reduce((s, g) => s + g.mrrINR, 0);
  const change = cur.total != null && prev.total != null ? cur.total - prev.total : null;
  const trend = trendPeriods.map((p) => {
    const t = forCsm(name, p);
    return { label: p.label.replace(` ${p.year}`, ""), value: t.total, tip: <TipCard title={p.label} rows={[["KPI score", fmtPct(t.total)], ...KPI_DEFS.map((d) => [d.label, fmtPct(t.kpis[d.key]?.value)])]} /> };
  });
  const modules = data.modules.map((m) => {
    const v = avg(groups.map((g) => clientScores(g, period)?.moduleResults.find((r) => r.mod.key === m.key)?.adoptionPct));
    return { key: m.key, label: m.name, value: v, tip: <TipCard title={m.name} rows={[["Adoption pipeline", fmtPct(v)]]} /> };
  }).filter((m) => m.value != null);
  const clientRows = groups.map((g) => {
    const idSet = new Set(g.labs.map((l) => l.id));
    return { g, m: measure([g], data.tasks.filter((t) => idSet.has(t.labId) && t.owner === name), period, csmId) };
  }).sort((a, b) => (a.m.total ?? 101) - (b.m.total ?? 101));

  const highlights = KPI_DEFS.map((d) => {
    const v = cur.kpis[d.key];
    return v?.value == null ? `${d.label}: ${v?.note || "nothing to measure"}.` : `${d.label}: ${fmtPct(v.value)} (${v.note}).`;
  });

  return (
    <>
      <div className="table-card kpi-head">
        {isHead && <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={onBack}>← All CSMs</button>}
        <div className="kpi-head-num"><b>{name}</b><span>CSM performance report</span></div>
        <div className="kpi-head-num"><b>{labCount}</b><span>Labs ({groups.length} clients)</span></div>
        <div className="kpi-head-num"><b>{fmtCompactINR(mrr * 12)}</b><span>ARR</span></div>
        <div className="kpi-head-num"><b>{fmtCompactINR(mrr)}</b><span>MRR</span></div>
        <div className="kpi-head-num" style={{ marginLeft: "auto" }}><b>{fmtPct(cur.total)}</b><span>Overall KPI score</span></div>
        <div className="kpi-head-num"><b><Change value={change} /></b><span>vs {compare.label}</span></div>
      </div>
      <KpiCards cur={cur} prev={prev} settings={settings} csmId={csmId} showPoints />
      <div className="an-grid-3">
        <Card title={`KPI score trend · ${name}`}><TrendChart series={[{ name: "KPI score", color: LINE, points: trend }]} bind={tip.bind} /></Card>
        <Card title={`Adoption by module · ${period.label}`}><ScoreBars target={targetFor(settings, "adoption", csmId)} bind={tip.bind} items={modules} /></Card>
        <Card title={`Highlights · ${period.label}`}><ul className="an-list">{highlights.map((h) => <li key={h}>{h}</li>)}</ul></Card>
      </div>
      <div style={{ marginTop: 14 }}>
        <div>
          <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Client-wise performance</h3>
          <div className="table-card"><div className="table-scroll"><table className="child-mini an-table">
            <thead><tr><th>Client</th><th>MRR</th>{KPI_DEFS.map((d) => <th key={d.key} className="c">{d.label}</th>)}<th className="c">KPI score</th></tr></thead>
            <tbody>
              {!clientRows.length && <tr><td colSpan={KPI_DEFS.length + 3} className="an-empty">No labs assigned.</td></tr>}
              {clientRows.map(({ g, m }) => (
                <tr key={g.id}>
                  <td className="lab-name clickable" onClick={() => onOpenLab(g.id)}>{g.name}</td><td style={{ whiteSpace: "nowrap" }}>{fmtCompactINR(g.mrrINR)}</td>
                  {KPI_DEFS.map((d) => <td key={d.key} className="c"><Heat value={m.kpis[d.key]?.value} /></td>)}
                  <td className="c"><Heat value={m.total} /></td>
                </tr>
              ))}
            </tbody>
          </table></div></div>
        </div>
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>{compare.label} vs {period.label}</h3>
          <div className="table-card"><div className="table-scroll"><table className="child-mini an-table">
            <thead><tr><th>KPI</th><th className="c">{compare.label}</th><th className="c">{period.label}</th><th className="c">Change</th></tr></thead>
            <tbody>
              {KPI_DEFS.map((d) => {
                const a = prev.kpis[d.key]?.value, b = cur.kpis[d.key]?.value;
                return <tr key={d.key}><td>{d.label}</td><td className="c">{fmtPct(a)}</td><td className="c"><Heat value={b} /></td><td className="c"><Change value={a == null || b == null ? null : b - a} /></td></tr>;
              })}
              <tr style={{ fontWeight: 700 }}><td>Overall KPI</td><td className="c">{fmtPct(prev.total)}</td><td className="c"><Heat value={cur.total} /></td><td className="c"><Change value={change} /></td></tr>
            </tbody>
          </table></div></div>
        </div>
      </div>
    </>
  );
}

function KpiSettingsModal({ settings, names, idByName, onClose, onSaved }) {
  const [weights, setWeights] = useState({ ...settings.weights });
  const [targets, setTargets] = useState({ ...settings.targets });
  const [overrides, setOverrides] = useState(() => {
    const out = {};
    names.forEach((n) => { out[n] = { ...(settings.csmTargets[idByName?.[n]] || {}) }; });
    return out;
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const total = KPI_DEFS.reduce((s, d) => s + (Number(weights[d.key]) || 0), 0);
  const inRange = (v) => v !== "" && Number(v) >= 0 && Number(v) <= 100;

  async function save() {
    if (Math.abs(total - 100) > 0.001) { setError(`Weights must total exactly 100% (they total ${total}%).`); return; }
    if (!KPI_DEFS.every((d) => inRange(weights[d.key]) && inRange(targets[d.key]))) { setError("Weights and targets must be between 0 and 100."); return; }
    const csmTargets = {};
    for (const n of names) {
      for (const d of KPI_DEFS) {
        const v = overrides[n]?.[d.key];
        if (v === "" || v == null) continue;
        if (!inRange(v)) { setError(`${n}'s ${d.label} target must be between 0 and 100.`); return; }
        (csmTargets[idByName[n]] = csmTargets[idByName[n]] || {})[d.key] = Number(v);
      }
    }
    setBusy(true); setError("");
    try {
      await saveKpiSettings({
        weights: Object.fromEntries(KPI_DEFS.map((d) => [d.key, Number(weights[d.key])])),
        targets: Object.fromEntries(KPI_DEFS.map((d) => [d.key, Number(targets[d.key])])),
        csmTargets,
      });
      await onSaved();
    } catch (err) {
      setBusy(false);
      setError(/kpi_/.test(err.message || "") ? "Run migration 0044_kpi_settings.sql in Supabase first." : err.message || "Couldn't save.");
    }
  }

  return (
    <Modal open title="KPI targets & weights" onClose={onClose} actions={[
      { label: "Cancel", className: "btn-ghost", onClick: onClose },
      { label: busy ? "Saving…" : "Save", className: "btn-primary", onClick: save },
    ]}>
      <div className="table-scroll"><table className="child-mini an-table">
        <thead><tr><th>KPI</th><th className="c">Weight %</th><th className="c">Team target %</th></tr></thead>
        <tbody>
          {KPI_DEFS.map((d) => (
            <tr key={d.key}><td>{d.label}</td>
              <td className="c"><input className="kpi-input" type="number" min="0" max="100" aria-label={`${d.label} weight`} value={weights[d.key]} onChange={(e) => setWeights((w) => ({ ...w, [d.key]: e.target.value }))} /></td>
              <td className="c"><input className="kpi-input" type="number" min="0" max="100" aria-label={`${d.label} target`} value={targets[d.key]} onChange={(e) => setTargets((t) => ({ ...t, [d.key]: e.target.value }))} /></td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700 }}><td>Total</td><td className="c" style={{ color: Math.abs(total - 100) > 0.001 ? "var(--bad)" : undefined }}>{total}%</td><td></td></tr>
        </tbody>
      </table></div>
      <h4 style={{ fontSize: 13, margin: "16px 0 4px" }}>Target for a specific CSM</h4>
      <p style={{ fontSize: 11.5, color: "var(--text-dim)", margin: "0 0 8px" }}>Leave blank to use the team target. New targets also apply when looking back at earlier periods.</p>
      <div className="table-scroll"><table className="child-mini an-table">
        <thead><tr><th>CSM</th>{KPI_DEFS.map((d) => <th key={d.key} className="c">{d.label}</th>)}</tr></thead>
        <tbody>{names.map((n) => (
          <tr key={n}><td style={{ whiteSpace: "nowrap" }}>{n}</td>
            {KPI_DEFS.map((d) => <td key={d.key} className="c"><input className="kpi-input" style={{ width: 54 }} type="number" min="0" max="100" aria-label={`${n} ${d.label} target`} placeholder={String(targets[d.key])} value={overrides[n]?.[d.key] ?? ""} onChange={(e) => setOverrides((o) => ({ ...o, [n]: { ...o[n], [d.key]: e.target.value } }))} /></td>)}
          </tr>
        ))}</tbody>
      </table></div>
      {error && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}
