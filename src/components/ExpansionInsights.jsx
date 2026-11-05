import { useChartTooltip } from "../lib/useChartTooltip";
import { isLiveOn, revenueOn } from "../lib/expansion";
import { periodContaining, previousPeriod } from "../lib/periods";
import { todayISO } from "../lib/dates";
import { toINR } from "../lib/format";
import { fmtCompactINR, fmtPct } from "../lib/analyticsFormat";
import { TipCard } from "./ChartTooltip";
import { Tile, Card, Donut, ValueTrend, ValueBars } from "./Analytics";

// Expansion → Deals & Purchases: the numbers above the list. `rows` = buildExpansionItems for the labs in view, `groups` = their
// clients. Everything is in INR. "Now" reads today; the trend reads each of the last six month-ends.
const STATUS_ORDER = ["Pipeline", "Onboarding", "Live", "Lost"];
const STATUS_COLOR = { Pipeline: "var(--stg-plan-2)", Onboarding: "var(--stg-plan-3)", Live: "var(--stg-plan-5)", Lost: "var(--stg-exp-3)" };
const LIST_MAX = 8;

export default function ExpansionInsights({ rows, labs, groups, modules, showByCsm }) {
  const tip = useChartTooltip();
  const today = todayISO();
  const labById = Object.fromEntries(labs.map((l) => [l.id, l]));
  const convert = (amount, labId) => toINR(amount, labById[labId]?.region);
  const sum = (list, field) => list.reduce((s, r) => s + convert(r[field], r.labId), 0);

  const now = revenueOn(rows, today, convert);
  const byStatus = STATUS_ORDER.map((status) => {
    const list = rows.filter((r) => r.status === status);
    return { status, list, count: list.length, mrr: sum(list, "monthly"), arr: sum(list, "annual") };
  });
  const live = rows.filter((r) => r.status === "Live");
  const rowsOf = (labIds) => rows.filter((r) => labIds.has(r.labId));

  const clientRows = groups.map((g) => {
    const rev = revenueOn(rowsOf(new Set(g.labs.map((l) => l.id))), today, convert);
    return { g, ...rev };
  });
  const withExpansion = clientRows.filter((c) => c.count > 0);
  const avgArr = withExpansion.length ? now.arr / withExpansion.length : null;
  const avgCount = withExpansion.length ? now.count / withExpansion.length : null;
  const conversion = rows.length ? (live.length / rows.length) * 100 : null;

  const months = [];
  for (let i = 0, p = periodContaining(today, "Monthly"); i < 6; i += 1, p = previousPeriod(p)) months.unshift(p);
  const trend = months.map((p) => {
    const rev = revenueOn(rows, p.end < today ? p.end : today, convert);
    return { label: p.label.split(" ")[0], value: rev.mrr, tip: <TipCard title={p.label} rows={[["Expansion MRR", fmtCompactINR(rev.mrr)], ["Expansion ARR", fmtCompactINR(rev.arr)], ["Live items", rev.count]]} /> };
  });

  const csms = [...new Set(labs.map((l) => l.csm).filter(Boolean))];
  const barItem = (key, label, list, value) => ({ key, label, value, tip: <TipCard title={label} rows={[["Expansion ARR", fmtCompactINR(value)], ["Live items", list.length]]} list={list.slice(0, LIST_MAX).map((r) => `${r.title || "Untitled"} — ${labById[r.labId]?.name}`)} more={list.length - LIST_MAX} /> });
  const liveNow = rows.filter((r) => isLiveOn(r, today));
  const byCsm = csms.map((name) => {
    const list = liveNow.filter((r) => labById[r.labId]?.csm === name);
    return barItem(name, name, list, sum(list, "annual"));
  }).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const byModule = modules.map((m) => {
    const list = liveNow.filter((r) => r.moduleKey === m.key);
    return barItem(m.key, m.name, list, sum(list, "annual"));
  }).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const noModule = liveNow.filter((r) => !modules.some((m) => m.key === r.moduleKey));
  if (noModule.length) byModule.push(barItem("none", "No module set", noModule, sum(noModule, "annual")));
  const topClients = clientRows.filter((c) => c.arr > 0).sort((a, b) => b.arr - a.arr).slice(0, 6).map((c) => {
    const list = liveNow.filter((r) => c.g.labs.some((l) => l.id === r.labId));
    return barItem(c.g.id, c.g.name, list, c.arr);
  });

  return (
    <>
      <div className="an-tiles">
        {byStatus.map((s) => (
          <Tile key={s.status} value={s.count} label={s.status} sub={s.mrr ? `${fmtCompactINR(s.mrr)}/mo` : "No value yet"}
            bind={tip.bind(<TipCard color={STATUS_COLOR[s.status]} title={s.status} rows={[["Monthly", fmtCompactINR(s.mrr)], ["Annual", fmtCompactINR(s.arr)]]} list={s.list.slice(0, LIST_MAX).map((r) => `${r.title || "Untitled"} — ${labById[r.labId]?.name}`)} more={s.list.length - LIST_MAX} />)} />
        ))}
        <Tile tone="good" value={fmtCompactINR(now.mrr)} label="Expansion MRR" sub="From expansion only" />
        <Tile tone="good" value={fmtCompactINR(now.arr)} label="Expansion ARR" sub="From expansion only" />
        <Tile value={fmtPct(conversion)} label="Live share" sub={`${live.length} of ${rows.length} items`} />
      </div>
      <div className="an-grid-3" style={{ marginBottom: 14 }}>
        <Card title="Expansion MRR trend" info="Expansion MRR at each month-end: priced purchases and Live deals, leaving out anything lost by then. This month reads today.">
          <ValueTrend points={trend} fmt={fmtCompactINR} bind={tip.bind} />
        </Card>
        <Card title="By status" info="Every expansion. Feature: Pitching = Pipeline, Trial = Onboarding, Purchased = Live (a purchased trial stays Onboarding). Manual: its own status.">
          <Donut centre={rows.length} centreLabel="items" bind={tip.bind} slices={byStatus.map((s) => ({
            key: s.status, label: s.status, count: s.count, color: STATUS_COLOR[s.status],
            tip: <TipCard color={STATUS_COLOR[s.status]} title={s.status} rows={[["Items", s.count], ["Monthly", fmtCompactINR(s.mrr)]]} />,
          }))} />
        </Card>
        <Card title="Account-wise average" info="Accounts = clients, counting a parent and its child labs once. Averages cover only the accounts with Live expansion revenue.">
          <div className="an-sum"><b>Accounts with expansion</b>{withExpansion.length} of {groups.length}{groups.length ? ` (${fmtPct((withExpansion.length / groups.length) * 100)})` : ""}</div>
          <div className="an-sum"><b>Average ARR per account</b>{avgArr == null ? "—" : fmtCompactINR(avgArr)}</div>
          <div className="an-sum"><b>Average live items per account</b>{avgCount == null ? "—" : avgCount.toFixed(2)}</div>
        </Card>
      </div>
      <div className="an-grid-3" style={{ marginBottom: 14 }}>
        {showByCsm && <Card title="Expansion ARR by CSM"><ValueBars items={byCsm} fmt={fmtCompactINR} bind={tip.bind} /></Card>}
        <Card title="Top clients by Expansion ARR"><ValueBars items={topClients} fmt={fmtCompactINR} bind={tip.bind} /></Card>
        <Card title="Expansion ARR by module"><ValueBars items={byModule} fmt={fmtCompactINR} bind={tip.bind} /></Card>
      </div>
      {tip.tooltip}
    </>
  );
}
