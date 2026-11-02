import { useMemo } from "react";
import { useSessionState } from "../lib/useSessionState";
import { useChartTooltip } from "../lib/useChartTooltip";
import { useScopedCsm } from "../lib/useScopedCsm";
import { clientGroups } from "../lib/labRollup";
import { filterLabsByLabType } from "../lib/labs";
import { labSelectOptions } from "../lib/selectOptions";
import { GRANULARITIES, periodsFor, periodContaining, previousPeriod, isFuture } from "../lib/periods";
import { todayISO } from "../lib/dates";
import { toINR } from "../lib/format";
import { computeSentimentHealth } from "../lib/labHealth";
import { KPI_DEFS, computeKpis, scoreKpis, targetFor } from "../lib/kpi";
import ScopeToggle from "./ScopeToggle";
import SearchSelect from "./SearchSelect";
import Paginated from "./Pager";
import { TipCard } from "./ChartTooltip";
import { Tile, Card, TrendChart, ScoreBars, Donut, Heat, Change } from "./Analytics";
import { RANGES, rangeOf, fmtPct, fmtPP, fmtCompactINR, downloadCsv } from "../lib/analyticsFormat";

// The analytics shared by the Adoption and Expansion screens (decision Nov 2 2026): tiles, trend, by CSM, by range, then
// lab-wise / CSM / module-wise tables. `pipeline` only picks the score shown first and the KPI target it's held against;
// the Metric dropdown switches to any of the four scores. Everything counts per CLIENT (parent + children averaged, see
// clientGroups / groupScores). Past periods come from replaying param_changes (lib/scoreHistory.js).
const METRICS = [
  { key: "adoptionPct", label: "Adoption pipeline", modKey: "adoptionPct" },
  { key: "expansionPct", label: "Expansion pipeline", modKey: "expansionPct" },
  { key: "overallPct", label: "Overall", modKey: "overallPct" },
  { key: "mandatoryPct", label: "Mandatory", modKey: "mandPct" },
];
const LINE = "var(--stg-plan-2)";
const LIST_MAX = 8;
const avg = (vals) => { const v = vals.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const diff = (a, b) => (a == null || b == null ? null : a - b);

export default function PipelineAnalytics({ pipeline, page, labs: allLabs, viewer, idByName, onOpenLab, onOpenCsm, kpi, tab, onTab, extraTabs = [] }) {
  const { isHead, scope, setScope, csmFilter, setCsmFilter, teamNames, scopeCsm, teamAll, labType, setLabType } = useScopedCsm(viewer, page);
  const thisYear = Number(todayISO().slice(0, 4));
  const [year, setYear] = useSessionState(`${page}.year`, thisYear);
  const [gran, setGran] = useSessionState(`${page}.gran`, "Quarterly");
  const [sub, setSub] = useSessionState(`${page}.sub`, "labs");
  const [metricKey, setMetricKey] = useSessionState(`${page}.metric`, pipeline === "expansion" ? "expansionPct" : "adoptionPct");
  const [fClient, setFClient] = useSessionState(`${page}.client`, "");
  const [pickA, setPickA] = useSessionState(`${page}.compareA`, "");
  const [pickB, setPickB] = useSessionState(`${page}.compareB`, "");
  const tip = useChartTooltip();

  const metric = METRICS.find((m) => m.key === metricKey) || METRICS[0];
  const kpiKey = metric.key === "expansionPct" ? "expansion" : "adoption";
  const { data, clientScores } = kpi;
  const settings = data.settings;
  const target = targetFor(settings, kpiKey, scopeCsm ? idByName?.[scopeCsm] : null);

  const labs = useMemo(() => filterLabsByLabType(allLabs, labType), [allLabs, labType]);
  const allGroups = useMemo(() => clientGroups(labs, scopeCsm), [labs, scopeCsm]);
  const groups = fClient ? allGroups.filter((g) => g.id === fClient) : allGroups;

  // Periods: the chosen year's, leaving out those not started yet. The tiles compare B (latest by default) with A.
  const periods = useMemo(() => periodsFor(year, gran).filter((p) => !isFuture(p)), [year, gran]);
  const today = todayISO();
  const defaultB = periods[periods.length - 1] || periodContaining(today, gran);
  const periodChoices = useMemo(() => {
    const prior = periods[0] ? previousPeriod(periods[0]) : null;
    return prior ? [prior, ...periods] : periods;
  }, [periods]);
  const periodB = periodChoices.find((p) => p.key === pickB) || defaultB;
  const periodA = periodChoices.find((p) => p.key === pickA) || previousPeriod(periodB);

  const scoreOf = (g, p) => clientScores(g, p)?.[metric.key] ?? null;
  const moduleScoreOf = (g, p, modKey) => clientScores(g, p)?.moduleResults.find((m) => m.mod.key === modKey)?.[metric.modKey] ?? null;
  const teamScore = (gs, p) => avg(gs.map((g) => scoreOf(g, p)));

  const curAvg = teamScore(groups, periodB);
  const prevAvg = teamScore(groups, periodA);
  const totalLabs = groups.reduce((s, g) => s + g.labs.length, 0);
  const totalMrr = groups.reduce((s, g) => s + g.mrrINR, 0);
  const achievement = curAvg != null && target > 0 ? (curAvg / target) * 100 : null;

  const trend = periods.map((p) => ({
    label: p.label.replace(` ${year}`, ""), value: teamScore(groups, p),
    tip: <TipCard title={`${p.label} · ${metric.label}`} rows={[["Score", fmtPct(teamScore(groups, p))], ["Target", fmtPct(target)], ["Clients scored", groups.filter((g) => scoreOf(g, p) != null).length]]} />,
  }));

  // Per-CSM (only Team View, no CSM chosen).
  const csmRows = useMemo(() => {
    if (!teamAll) return [];
    return teamNames.map((name) => {
      const gs = clientGroups(labs, name);
      return { name, id: idByName?.[name], groups: gs, labs: gs.flatMap((g) => g.labs), clients: gs.length, mrr: gs.reduce((s, g) => s + g.mrrINR, 0) };
    }).filter((c) => c.clients > 0);
  }, [teamAll, teamNames, labs, idByName]);

  const ranged = RANGES.map((r) => {
    const rows = groups.map((g) => ({ g, v: scoreOf(g, periodB) })).filter((x) => x.v != null && rangeOf(x.v).key === r.key).sort((a, b) => a.v - b.v);
    return {
      ...r, count: rows.length,
      tip: <TipCard color={r.color} title={r.label} rows={[["Clients", rows.length]]} listTitle="Lowest first" list={rows.slice(0, LIST_MAX).map((x) => `${x.g.name} — ${fmtPct(x.v)}`)} more={rows.length - LIST_MAX} />,
    };
  });
  const tiles = (
    <div className="an-tiles">
      <Tile value={groups.length} label="Clients" sub={`${totalLabs} labs`} />
      <Tile value={fmtCompactINR(totalMrr)} label="Total MRR" sub={`ARR ${fmtCompactINR(totalMrr * 12)}`} />
      <Tile tone="good" value={fmtPct(curAvg)} label={metric.label} sub={periodB.label} />
      <Tile value={fmtPct(prevAvg)} label="Compared with" sub={periodA.label} />
      <Tile value={fmtPP(diff(curAvg, prevAvg))} label={`Change, ${gran === "Monthly" ? "MoM" : gran === "Quarterly" ? "QoQ" : gran === "Yearly" ? "YoY" : "HoH"}`} />
      <Tile value={fmtPct(target)} label="Target" sub={`${KPI_DEFS.find((k) => k.key === kpiKey).label} KPI`} />
      <Tile tone={achievement != null && achievement >= 100 ? "good" : undefined} value={fmtPct(achievement)} label="Target achievement" />
    </div>
  );

  const clientOptions = labSelectOptions(allGroups.map((g) => g.top));

  // ---- tab: analytics ----
  const labRows = groups.map((g) => {
    const cells = periods.map((p) => scoreOf(g, p));
    const first = cells.find((v) => v != null) ?? null;
    return { g, cells, cur: scoreOf(g, periodB), prev: scoreOf(g, periodA), first };
  }).sort((a, b) => (b.g.mrrINR - a.g.mrrINR));

  const scored = labRows.filter((r) => r.cur != null);
  const atOrAbove = scored.filter((r) => r.cur >= target);
  const movers = labRows.filter((r) => diff(r.cur, r.prev) != null).sort((a, b) => (b.cur - b.prev) - (a.cur - a.prev));
  const takeaways = [
    curAvg != null && prevAvg != null ? `${metric.label} ${diff(curAvg, prevAvg) >= 0 ? "up" : "down"} ${Math.abs(Math.round(diff(curAvg, prevAvg)))} pp (${fmtPct(prevAvg)} → ${fmtPct(curAvg)}).` : curAvg != null ? `${metric.label} is ${fmtPct(curAvg)} for ${periodB.label}; nothing recorded for ${periodA.label} to compare.` : null,
    scored.length ? `${atOrAbove.length} of ${scored.length} clients at or above the ${fmtPct(target)} target.` : null,
    ranged[3].count ? `${ranged[3].count} client${ranged[3].count === 1 ? " is" : "s are"} below 40% and need focus.` : null,
    movers.length && movers[0].cur > movers[0].prev ? `Most improved: ${movers[0].g.name} (${fmtPP(movers[0].cur - movers[0].prev)}).` : null,
  ].filter(Boolean);

  const analyticsTab = (
    <>
      <div className="an-grid-3">
        <Card title={`${gran} trend`} info={`The ${metric.label} score of these clients at the end of each period. Past periods are worked out from the change history of every parameter, using today's template weights.`}>
          <TrendChart series={[{ name: metric.label, color: LINE, points: trend }]} target={target} bind={tip.bind} />
        </Card>
        {csmRows.length ? (
          <Card title={`By CSM · ${periodB.label}`} info="Each CSM's clients, averaged. A CSM is scored on the labs they handle. Click a bar for their KPI report.">
            <ScoreBars target={target} bind={tip.bind} items={csmRows.map((c) => {
              const v = teamScore(c.groups, periodB);
              return { key: c.name, label: c.name, value: v, onClick: onOpenCsm ? () => onOpenCsm(c.name) : undefined, tip: <TipCard title={c.name} rows={[["Score", fmtPct(v)], ["Compared with " + periodA.label, fmtPct(teamScore(c.groups, periodA))], ["Clients", c.clients], ["Labs", c.labs.length], ["MRR", fmtCompactINR(c.mrr)]]} /> };
            })} />
          </Card>
        ) : (
          <Card title={`By module · ${periodB.label}`} info={`Average ${metric.label} score of each module across these clients, weakest first.`}>
            <ScoreBars target={target} bind={tip.bind} items={data.modules.map((m) => {
              const v = avg(groups.map((g) => moduleScoreOf(g, periodB, m.key)));
              return { key: m.key, label: m.name, value: v, tip: <TipCard title={m.name} rows={[["Score", fmtPct(v)], ["Weight in the template", `${m.weight}%`]]} /> };
            }).filter((x) => x.value != null).sort((a, b) => a.value - b.value).slice(0, 8)} />
          </Card>
        )}
        <Card title={`Clients by range · ${periodB.label}`}>
          <Donut slices={ranged} centre={scored.length} centreLabel="clients" bind={tip.bind} />
        </Card>
      </div>
      <div className="tabbar" style={{ margin: "18px 0 12px" }}>
        {[["labs", `Lab-wise (${gran})`], ["targets", "Target vs Actual"], ["insights", "Improvement Insights"]].map(([k, l]) => (
          <button key={k} className={`tabbtn${sub === k ? " active" : ""}`} onClick={() => setSub(k)}>{l}</button>
        ))}
      </div>
      <div className="an-side-layout">
        <div style={{ minWidth: 0 }}>
          {sub === "labs" && <LabWiseTable rows={labRows} periods={periods} periodA={periodA} periodB={periodB} onOpenLab={onOpenLab} />}
          {sub === "targets" && <TargetTable rows={labRows} target={target} onOpenLab={onOpenLab} />}
          {sub === "insights" && <Insights rows={labRows} groups={groups} periodB={periodB} moduleScoreOf={moduleScoreOf} target={target} modules={kpi.data.modules} onOpenLab={onOpenLab} />}
        </div>
        <div className="table-card pf-card an-side">
          <div className="pf-card-title">Comparison</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <select className="dash-select" style={{ flex: 1, minWidth: 0 }} value={periodA.key} onChange={(e) => setPickA(e.target.value)} aria-label="Compare from">{periodChoices.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
            <select className="dash-select" style={{ flex: 1, minWidth: 0 }} value={periodB.key} onChange={(e) => setPickB(e.target.value)} aria-label="Compare to">{periodChoices.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
          </div>
          <div className="an-compare">
            <div><span>{periodA.label}</span><b>{fmtPct(prevAvg)}</b></div>
            <div><span>{periodB.label}</span><b>{fmtPct(curAvg)}</b></div>
            <div><span>Change</span><b>{fmtPP(diff(curAvg, prevAvg))}</b></div>
          </div>
          <div className="pf-card-title" style={{ margin: "14px 0 6px" }}>Key takeaways</div>
          {takeaways.length ? <ul className="an-list">{takeaways.map((t) => <li key={t}>{t}</li>)}</ul> : <div className="an-empty" style={{ padding: 0 }}>Nothing to report yet.</div>}
        </div>
      </div>
    </>
  );

  // ---- tab: CSM performance ----
  const csmTab = (
    <CsmPerformance rows={csmRows} groups={groups} periods={periods} periodA={periodA} periodB={periodB} metric={metric} kpiKey={kpiKey} settings={settings} data={data}
      teamScore={teamScore} scoreOf={scoreOf} clientScores={clientScores} tip={tip} gran={gran} target={target} onOpenLab={onOpenLab} onOpenCsm={onOpenCsm} persist={page} />
  );

  // ---- tab: module-wise ----
  const moduleTab = (
    <ModuleWise groups={groups} csmRows={csmRows} periods={periods} periodB={periodB} metric={metric} moduleScoreOf={moduleScoreOf} modules={data.modules} target={target}
      tip={tip} onOpenLab={onOpenLab} persist={page} year={year} />
  );

  const TABS = [
    { key: "analytics", label: "Analytics" },
    ...(isHead ? [{ key: "csm", label: "CSM Performance" }] : []),
    { key: "modules", label: "Module-wise" },
    ...extraTabs,
  ];
  const activeTab = TABS.some((t) => t.key === tab) ? tab : "analytics";
  const extra = extraTabs.find((t) => t.key === activeTab);

  function exportCsv() {
    const rows = [["Client", "CSM", "MRR (INR)", ...periods.map((p) => p.label), "Change"]];
    labRows.forEach((r) => rows.push([r.g.name, r.g.csm, Math.round(r.g.mrrINR), ...r.cells.map((v) => (v == null ? "" : Math.round(v))), diff(r.cur, r.prev) == null ? "" : Math.round(r.cur - r.prev)]));
    downloadCsv(`${page}-${metric.label.replace(/\s+/g, "-").toLowerCase()}-${year}-${gran.toLowerCase()}.csv`, rows);
  }

  return (
    <div>
      <div className="tabbar">
        {TABS.map((t) => <button key={t.key} className={`tabbtn${activeTab === t.key ? " active" : ""}`} onClick={() => onTab(t.key)}>{t.label}</button>)}
      </div>
      {extra?.render ? extra.render() : (
        <>
          <div className="an-filters">
            <select className="dash-select" value={year} onChange={(e) => { setYear(Number(e.target.value)); setPickA(""); setPickB(""); }} aria-label="Year">
              {[thisYear, thisYear - 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <div className="an-seg" role="group" aria-label="Comparison">
              {GRANULARITIES.map((g) => <button key={g} className={gran === g ? "on" : ""} onClick={() => { setGran(g); setPickA(""); setPickB(""); }}>{g}</button>)}
            </div>
            <select className="dash-select" value={metric.key} onChange={(e) => setMetricKey(e.target.value)} aria-label="Metric">
              {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <div style={{ minWidth: 190 }}><SearchSelect value={fClient} onChange={setFClient} options={clientOptions} emptyLabel="All clients" placeholder="All clients" inputStyle={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5, fontFamily: "inherit", background: "var(--surface)", color: "var(--text)" }} /></div>
            <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "6px 12px", marginLeft: "auto" }} onClick={exportCsv}>Export CSV</button>
          </div>
          <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={teamNames} labType={labType} setLabType={setLabType} />
          {tiles}
          {activeTab === "analytics" && analyticsTab}
          {activeTab === "csm" && csmTab}
          {activeTab === "modules" && moduleTab}
        </>
      )}
      {tip.tooltip}
    </div>
  );
}

function LabWiseTable({ rows, periods, periodA, periodB, onOpenLab }) {
  if (!rows.length) return <div className="table-card an-empty">No clients in view.</div>;
  return (
    <div className="table-card"><Paginated items={rows}>{(page) => (
      <div className="table-scroll"><table className="child-mini an-table">
        <thead><tr><th>Client</th><th>CSM</th><th>MRR</th>{periods.map((p) => <th key={p.key} className="c">{p.label}{p.range && <div className="an-th-sub">{p.range}</div>}</th>)}<th className="c">Change<div className="an-th-sub">{periodA.label} → {periodB.label}</div></th></tr></thead>
        <tbody>{page.map((r) => (
          <tr key={r.g.id}>
            <td className="lab-name clickable" onClick={() => onOpenLab(r.g.id, r.g.labs.length > 1 ? "overalladoption" : "adoption")}>{r.g.name}{r.g.labs.length > 1 && <span className="an-count"> · {r.g.labs.length} labs</span>}</td>
            <td>{r.g.csm || "—"}</td>
            <td style={{ whiteSpace: "nowrap" }}>{fmtCompactINR(r.g.mrrINR)}</td>
            {r.cells.map((v, i) => <td key={periods[i].key} className="c"><Heat value={v} /></td>)}
            <td className="c"><Change value={diff(r.cur, r.prev)} /></td>
          </tr>
        ))}</tbody>
      </table></div>
    )}</Paginated></div>
  );
}

function TargetTable({ rows, target, onOpenLab }) {
  const list = rows.filter((r) => r.cur != null).sort((a, b) => a.cur - b.cur);
  if (!list.length) return <div className="table-card an-empty">No scores for this period.</div>;
  return (
    <div className="table-card"><Paginated items={list}>{(page) => (
      <div className="table-scroll"><table className="child-mini an-table">
        <thead><tr><th>Client</th><th>CSM</th><th className="c">Target</th><th className="c">Actual</th><th className="c">Gap</th><th className="c">Achievement</th></tr></thead>
        <tbody>{page.map((r) => (
          <tr key={r.g.id}>
            <td className="lab-name clickable" onClick={() => onOpenLab(r.g.id)}>{r.g.name}</td><td>{r.g.csm || "—"}</td>
            <td className="c">{fmtPct(target)}</td><td className="c"><Heat value={r.cur} /></td><td className="c"><Change value={r.cur - target} /></td>
            <td className="c">{target > 0 ? fmtPct((r.cur / target) * 100) : "—"}</td>
          </tr>
        ))}</tbody>
      </table></div>
    )}</Paginated></div>
  );
}

function Insights({ rows, groups, periodB, moduleScoreOf, target, modules, onOpenLab }) {
  const moved = rows.filter((r) => diff(r.cur, r.prev) != null);
  const up = [...moved].filter((r) => r.cur > r.prev).sort((a, b) => (b.cur - b.prev) - (a.cur - a.prev)).slice(0, 5);
  const down = [...moved].filter((r) => r.cur < r.prev).sort((a, b) => (a.cur - a.prev) - (b.cur - b.prev)).slice(0, 5);
  const low = rows.filter((r) => r.cur != null && r.cur < 40).sort((a, b) => a.cur - b.cur).slice(0, 5);
  const weak = modules.map((m) => ({ m, v: avg(groups.map((g) => moduleScoreOf(g, periodB, m.key))) })).filter((x) => x.v != null && x.v < target).sort((a, b) => a.v - b.v).slice(0, 5);
  const block = (title, items, render) => (
    <div className="table-card pf-card"><div className="pf-card-title">{title}</div>
      {items.length ? <ul className="an-list plain">{items.map(render)}</ul> : <div className="an-empty" style={{ padding: 0 }}>None.</div>}
    </div>
  );
  const row = (r, value) => <li key={r.g.id}><span className="lab-name clickable" onClick={() => onOpenLab(r.g.id)}>{r.g.name}</span><b>{value}</b></li>;
  return (
    <div className="an-grid-2">
      {block("Most improved", up, (r) => row(r, fmtPP(r.cur - r.prev)))}
      {block("Biggest drops", down, (r) => row(r, fmtPP(r.cur - r.prev)))}
      {block("Clients below 40%", low, (r) => row(r, fmtPct(r.cur)))}
      {block(`Modules below the ${fmtPct(target)} target`, weak, (x) => <li key={x.m.key}><span>{x.m.name}</span><b>{fmtPct(x.v)}</b></li>)}
    </div>
  );
}

function CsmPerformance({ rows, groups, periods, periodA, periodB, metric, kpiKey, settings, data, teamScore, scoreOf, clientScores, tip, gran, target, onOpenLab, onOpenCsm, persist }) {
  const [sub, setSub] = useSessionState(`${persist}.csmSub`, "summary");
  const [fCsm, setFCsm] = useSessionState(`${persist}.csmList`, "");
  if (!rows.length) return <div className="table-card an-empty">Switch to Team View with All CSMs to compare people.</div>;

  const withStats = rows.map((c) => {
    const cur = teamScore(c.groups, periodB), prev = teamScore(c.groups, periodA);
    const t = targetFor(settings, kpiKey, c.id);
    const scores = { adoption: avg(c.groups.map((g) => clientScores(g, periodB)?.adoptionPct)), expansion: avg(c.groups.map((g) => clientScores(g, periodB)?.expansionPct)), clients: c.clients };
    const k = computeKpis({ labs: c.labs, tasks: data.tasks.filter((x) => x.owner === c.name), scores, period: periodB, data });
    const ids = new Set(c.labs.map((l) => l.id));
    const pipelineMrr = data.opps.filter((o) => ids.has(o.labId) && (o.status === "Pipeline" || o.status === "Onboarding"))
      .reduce((s, o) => s + toINR(o.monthlyRevenue, c.labs.find((l) => l.id === o.labId)?.region), 0);
    const risky = c.labs.filter((l) => l.status === "At Risk" || computeSentimentHealth(data.visitsByLab[l.id]).bucket === "At Risk");
    const kpiScore = scoreKpis(k, settings.weights, (key) => targetFor(settings, key, c.id)).total;
    return { ...c, cur, prev, t, retention: k.retention.value, pipelineMrr, risky, kpiScore };
  });

  const cols = (
    <Card title={`By CSM · ${periodB.label}`} info="Dashed line = the team target. Click a bar for the CSM's KPI report.">
      <ScoreBars target={target} bind={tip.bind} items={withStats.map((c) => ({ key: c.name, label: c.name, value: c.cur, onClick: onOpenCsm ? () => onOpenCsm(c.name) : undefined, tip: <TipCard title={c.name} rows={[["Score", fmtPct(c.cur)], ["Target", fmtPct(c.t)], ["Clients", c.clients], ["MRR", fmtCompactINR(c.mrr)]]} /> }))} />
    </Card>
  );
  const allLabsCount = rows.reduce((s, c) => s + c.labs.length, 0);
  const share = (
    <Card title="Labs by CSM">
      <Donut centre={allLabsCount} centreLabel="labs" bind={tip.bind} slices={rows.map((c, i) => ({
        key: c.name, label: c.name, count: c.labs.length, color: `var(--an-cat-${(i % 8) + 1})`,
        tip: <TipCard title={c.name} rows={[["Labs", c.labs.length], ["Clients", c.clients], ["MRR", fmtCompactINR(c.mrr)]]} />,
      }))} />
    </Card>
  );
  const trend = (
    <Card title={`${gran} trend · team`}>
      <TrendChart series={[{ name: metric.label, color: LINE, points: periods.map((p) => ({ label: p.label.replace(` ${p.year}`, ""), value: teamScore(groups, p), tip: <TipCard title={p.label} rows={[["Score", fmtPct(teamScore(groups, p))]]} /> })) }]} target={target} bind={tip.bind} />
    </Card>
  );
  const listed = fCsm ? rows.filter((c) => c.name === fCsm) : rows;
  return (
    <>
      <div className="an-grid-3">{cols}{trend}{share}</div>
      <div className="tabbar" style={{ margin: "18px 0 12px" }}>
        {[["summary", "Summary"], ["progress", "Progress"], ["list", "Lab List by CSM"]].map(([k, l]) => <button key={k} className={`tabbtn${sub === k ? " active" : ""}`} onClick={() => setSub(k)}>{l}</button>)}
      </div>
      {sub === "summary" && (
        <div className="table-card"><div className="table-scroll"><table className="child-mini an-table">
          <thead><tr><th>CSM</th><th className="c">Labs</th><th>MRR</th><th className="c">{periodA.label}</th><th className="c">{periodB.label}</th><th className="c">Change</th><th className="c">Target</th><th className="c">Achievement</th><th className="c">Retention</th><th>Open deals</th><th className="c">At risk</th><th className="c">KPI score</th><th></th></tr></thead>
          <tbody>
            {withStats.map((c) => (
              <tr key={c.name}>
                <td style={{ fontWeight: 600 }}>{c.name}</td><td className="c">{c.labs.length}</td><td style={{ whiteSpace: "nowrap" }}>{fmtCompactINR(c.mrr)}</td>
                <td className="c"><Heat value={c.prev} /></td><td className="c"><Heat value={c.cur} /></td><td className="c"><Change value={diff(c.cur, c.prev)} /></td>
                <td className="c">{fmtPct(c.t)}</td><td className="c">{c.cur != null && c.t > 0 ? fmtPct((c.cur / c.t) * 100) : "—"}</td>
                <td className="c">{fmtPct(c.retention)}</td><td style={{ whiteSpace: "nowrap" }}>{fmtCompactINR(c.pipelineMrr)}</td>
                <td className="c" {...tip.bind(<TipCard title={`${c.name} · labs at risk`} rows={[["Labs", c.risky.length]]} list={c.risky.slice(0, LIST_MAX).map((l) => l.name)} more={c.risky.length - LIST_MAX} />)} style={{ color: c.risky.length ? "var(--bad)" : undefined, fontWeight: 700 }}>{c.risky.length}</td>
                <td className="c"><Heat value={c.kpiScore} /></td>
                <td>{onOpenCsm && <span className="mark-purchased" onClick={() => onOpenCsm(c.name)}>View</span>}</td>
              </tr>
            ))}
          </tbody>
        </table></div></div>
      )}
      {sub === "progress" && (
        <div className="table-card"><div className="table-scroll"><table className="child-mini an-table">
          <thead><tr><th>CSM</th>{periods.map((p) => <th key={p.key} className="c">{p.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((c) => <tr key={c.name}><td style={{ fontWeight: 600 }}>{c.name}</td>{periods.map((p) => <td key={p.key} className="c"><Heat value={teamScore(c.groups, p)} /></td>)}</tr>)}
            <tr style={{ fontWeight: 700 }}><td>Team</td>{periods.map((p) => <td key={p.key} className="c"><Heat value={teamScore(groups, p)} /></td>)}</tr>
          </tbody>
        </table></div></div>
      )}
      {sub === "list" && (
        <>
          <div className="filters"><select value={fCsm} onChange={(e) => setFCsm(e.target.value)}><option value="">All CSMs</option>{rows.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select></div>
          <div className="table-card"><Paginated items={listed.flatMap((c) => c.groups.map((g) => ({ c, g })))}>{(page) => (
            <div className="table-scroll"><table className="child-mini an-table">
              <thead><tr><th>Client</th><th>CSM</th><th className="c">Labs</th><th>MRR</th><th className="c">{periodB.label}</th></tr></thead>
              <tbody>{page.map(({ c, g }) => <tr key={`${c.name}|${g.id}`}><td className="lab-name clickable" onClick={() => onOpenLab(g.id)}>{g.name}</td><td>{c.name}</td><td className="c">{g.labs.length}</td><td style={{ whiteSpace: "nowrap" }}>{fmtCompactINR(g.mrrINR)}</td><td className="c"><Heat value={scoreOf(g, periodB)} /></td></tr>)}</tbody>
            </table></div>
          )}</Paginated></div>
        </>
      )}
    </>
  );
}

function ModuleWise({ groups, csmRows, periods, periodB, metric, moduleScoreOf, modules, target, tip, onOpenLab, persist, year }) {
  const [sub, setSub] = useSessionState(`${persist}.modSub`, "labs");
  const avgFor = (m, gs, p) => avg(gs.map((g) => moduleScoreOf(g, p, m.key)));
  const rows = modules.map((m) => ({ m, v: avgFor(m, groups, periodB) }));
  const sorted = rows.filter((x) => x.v != null).sort((a, b) => b.v - a.v);
  const top = sorted.slice(0, 2), weak = sorted.slice(-2).reverse();
  const belowTarget = sorted.filter((x) => x.v < target);
  const seriesPick = [...top.slice(0, 1), ...sorted.slice(Math.floor(sorted.length / 2), Math.floor(sorted.length / 2) + 1), ...weak.slice(0, 1)]
    .filter((x, i, a) => a.findIndex((y) => y.m.key === x.m.key) === i);
  const SERIES = ["var(--stg-plan-5)", "var(--stg-plan-2)", "var(--stg-exp-2)"];
  return (
    <>
      <div className="an-grid-3">
        <Card title={`By module · ${periodB.label}`} info={`Average ${metric.label} score of each module across these clients, strongest first. Modules with nothing counted are left out.`} style={{ gridColumn: "span 2" }}>
          <ScoreBars target={target} bind={tip.bind} items={sorted.map((x) => ({ key: x.m.key, label: x.m.name, value: x.v, tip: <TipCard title={x.m.name} rows={[["Score", fmtPct(x.v)], ["Weight in the template", `${x.m.weight}%`], ["Clients scored", groups.filter((g) => moduleScoreOf(g, periodB, x.m.key) != null).length]]} /> }))} />
        </Card>
        <Card title="Summary">
          <div className="an-sum"><b>Top performing</b>{top.length ? top.map((x) => `${x.m.name} (${fmtPct(x.v)})`).join(", ") : "—"}</div>
          <div className="an-sum"><b>Needs attention</b>{weak.length ? weak.map((x) => `${x.m.name} (${fmtPct(x.v)})`).join(", ") : "—"}</div>
          <div className="an-sum"><b>Below the {fmtPct(target)} target</b>{belowTarget.length} of {sorted.length} modules</div>
        </Card>
      </div>
      <div className="tabbar" style={{ margin: "18px 0 12px" }}>
        {[["labs", "Lab-wise"], ...(csmRows.length ? [["csm", "CSM-wise"]] : []), ["trend", "Module Trend"], ["gap", "Gap Analysis"]].map(([k, l]) => <button key={k} className={`tabbtn${sub === k ? " active" : ""}`} onClick={() => setSub(k)}>{l}</button>)}
      </div>
      {sub === "labs" && (
        <div className="table-card"><Paginated items={groups}>{(page) => (
          <div className="table-scroll"><table className="child-mini an-table">
            <thead><tr><th className="an-sticky">Client</th><th>CSM</th>{modules.map((m) => <th key={m.key} className="c">{m.name}</th>)}</tr></thead>
            <tbody>{page.map((g) => <tr key={g.id}><td className="lab-name clickable an-sticky" onClick={() => onOpenLab(g.id)}>{g.name}</td><td>{g.csm || "—"}</td>{modules.map((m) => <td key={m.key} className="c"><Heat value={moduleScoreOf(g, periodB, m.key)} /></td>)}</tr>)}</tbody>
          </table></div>
        )}</Paginated></div>
      )}
      {sub === "csm" && (
        <div className="table-card"><div className="table-scroll"><table className="child-mini an-table">
          <thead><tr><th className="an-sticky">CSM</th>{modules.map((m) => <th key={m.key} className="c">{m.name}</th>)}</tr></thead>
          <tbody>{csmRows.map((c) => <tr key={c.name}><td className="an-sticky" style={{ fontWeight: 600 }}>{c.name}</td>{modules.map((m) => <td key={m.key} className="c"><Heat value={avgFor(m, c.groups, periodB)} /></td>)}</tr>)}</tbody>
        </table></div></div>
      )}
      {sub === "trend" && (
        <>
          <Card title={`Strongest, middle and weakest module · ${year}`} style={{ marginBottom: 14 }}>
            <TrendChart bind={tip.bind} series={seriesPick.map((x, i) => ({ name: x.m.name, color: SERIES[i], points: periods.map((p) => ({ label: p.label.replace(` ${p.year}`, ""), value: avgFor(x.m, groups, p), tip: <TipCard color={SERIES[i]} title={`${x.m.name} · ${p.label}`} rows={[["Score", fmtPct(avgFor(x.m, groups, p))]]} /> })) }))} />
          </Card>
          <div className="table-card"><div className="table-scroll"><table className="child-mini an-table">
            <thead><tr><th>Module</th>{periods.map((p) => <th key={p.key} className="c">{p.label}</th>)}</tr></thead>
            <tbody>{modules.map((m) => <tr key={m.key}><td>{m.name}</td>{periods.map((p) => <td key={p.key} className="c"><Heat value={avgFor(m, groups, p)} /></td>)}</tr>)}</tbody>
          </table></div></div>
        </>
      )}
      {sub === "gap" && (
        <div className="table-card"><div className="table-scroll"><table className="child-mini an-table">
          <thead><tr><th>Module</th><th className="c">Score</th><th className="c">Target</th><th className="c">Gap</th><th className="c">Clients below target</th><th>Weakest clients</th></tr></thead>
          <tbody>{[...sorted].reverse().map((x) => {
            const below = groups.map((g) => ({ g, v: moduleScoreOf(g, periodB, x.m.key) })).filter((r) => r.v != null && r.v < target).sort((a, b) => a.v - b.v);
            return (
              <tr key={x.m.key}><td>{x.m.name}</td><td className="c"><Heat value={x.v} /></td><td className="c">{fmtPct(target)}</td><td className="c"><Change value={x.v - target} /></td><td className="c">{below.length}</td>
                <td style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{below.slice(0, 3).map((r) => `${r.g.name} ${fmtPct(r.v)}`).join(" · ") || "—"}</td></tr>
            );
          })}</tbody>
        </table></div></div>
      )}
    </>
  );
}
