import InfoTip from "./InfoTip";
import { fmtPct } from "../lib/analyticsFormat";

// Shared pieces of the Adoption, Expansion and KPI screens. Every mark takes a `bind` from useChartTooltip for its hover
// card; every number is also printed as text or in a table, so colour is never the only signal.

export function Heat({ value }) {
  if (value == null) return <span className="heat heat-none">—</span>;
  const cls = value >= 80 ? "heat-a" : value >= 60 ? "heat-b" : value >= 40 ? "heat-c" : "heat-d";
  return <span className={`heat ${cls}`}>{Math.round(value)}%</span>;
}

export function Tile({ value, label, sub, tone, bind }) {
  return (
    <div className={`stile an-tile${tone ? ` an-tile-${tone}` : ""}`} {...(bind || {})}>
      <div className="sval">{value}</div>
      <div className="slabel">{label}</div>
      {sub && <div className="an-tile-sub">{sub}</div>}
    </div>
  );
}

export function Card({ title, info, children, right, style }) {
  return (
    <div className="table-card pf-card" style={style}>
      <div className="pf-card-title" style={{ justifyContent: "space-between" }}>
        <span style={{ display: "flex", alignItems: "center" }}>{title}{info && <InfoTip>{info}</InfoTip>}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

// One or more lines over periods, 0–100%. `points` = [{ label, value, tip }]; a null value is a gap. Optional dashed target.
export function TrendChart({ series, target, bind, min = 0 }) {
  const W = 380, H = 190, L = 32, R = 10, T = 20, B = 22, PAD = 16;
  const labels = series[0]?.points.map((p) => p.label) || [];
  const x = (i) => (labels.length < 2 ? (L + W - R) / 2 : L + PAD + (i * (W - L - R - PAD * 2)) / (labels.length - 1));
  const y = (v) => T + ((100 - v) * (H - T - B)) / (100 - min);
  const ticks = [0, 25, 50, 75, 100].filter((t) => t >= min);
  const showAll = labels.length <= 6;
  const isHasData = series.some((s) => s.points.some((p) => p.value != null));
  return (
    <div>
      {series.length > 1 && (
        <div className="modseg-legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={series.map((s) => `${s.name}: ${s.points.map((p) => `${p.label} ${fmtPct(p.value)}`).join(", ")}`).join("; ")}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={L - 6} y={y(t)} textAnchor="end" dominantBaseline="central" fontSize="10" fill="var(--text-faint)">{t}%</text>
          </g>
        ))}
        {labels.map((l, i) => <text key={l} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--text-dim)">{l}</text>)}
        {target != null && isHasData && <line x1={L} x2={W - R} y1={y(target)} y2={y(target)} stroke="var(--text-dim)" strokeWidth="1.5" strokeDasharray="5 4" />}
        {target != null && isHasData && <text x={W - R} y={y(target) - 5} textAnchor="end" fontSize="10" fill="var(--text-dim)">Target {Math.round(target)}%</text>}
        {series.map((s) => {
          // Consecutive scored points make a line; a lone point still shows as a dot.
          const runs = [];
          let run = [];
          s.points.forEach((p, i) => { if (p.value == null) { if (run.length) runs.push(run); run = []; } else run.push([x(i), y(p.value)]); });
          if (run.length) runs.push(run);
          return (
            <g key={s.name}>
              {runs.filter((r) => r.length > 1).map((r, i) => <polyline key={i} points={r.map((c) => c.join(",")).join(" ")} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />)}
              {s.points.map((p, i) => p.value != null && (
                <g key={p.label} {...(bind && p.tip ? bind(p.tip) : {})} style={{ outline: "none" }}>
                  <circle cx={x(i)} cy={y(p.value)} r="12" fill="transparent" />
                  <circle cx={x(i)} cy={y(p.value)} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" />
                  {series.length === 1 && (showAll || i === 0 || i === labels.length - 1 || s.points[i + 1]?.value == null) && (
                    <text x={x(i)} y={y(p.value) - 10} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--text)">{fmtPct(p.value)}</text>
                  )}
                </g>
              ))}
            </g>
          );
        })}
      </svg>
      {!isHasData && <div className="an-empty">No scores yet for this period range.</div>}
    </div>
  );
}

// Vertical bars out of 100, one per person / module, with an optional target line. `items` = [{ key, label, value, tip, onClick }].
export function ScoreBars({ items, target, bind, color = "var(--stg-plan-3)" }) {
  if (!items.length) return <div className="an-empty">Nothing to show.</div>;
  // Long lists (modules) read better sideways: their names don't fit under a narrow bar.
  if (items.length > 6) {
    return (
      <div>
        {items.map((it) => (
          <div key={it.key} className="pf-hbar" {...(bind && it.tip ? bind(it.tip) : {})}>
            <span className="pf-hbar-label" title={it.label}>{it.label}</span>
            <div className="pf-hbar-track" style={{ position: "relative" }}>
              <div style={{ width: `${it.value ?? 0}%`, background: color }} />
              {target != null && <i className="an-hbar-target" style={{ left: `${target}%` }} />}
            </div>
            <b className="pf-hbar-val">{fmtPct(it.value)}</b>
          </div>
        ))}
        {target != null && <div className="an-tile-sub" style={{ marginTop: 6 }}>Marker = target {Math.round(target)}%</div>}
      </div>
    );
  }
  return (
    <div className="an-bars" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {target != null && <div className="an-bars-target" style={{ bottom: `calc(${target} * (100% - 52px) / 100 + 34px)` }} title={`Target ${Math.round(target)}%`} />}
      {items.map((it) => (
        <div key={it.key} className={`pf-col${it.onClick ? " an-click" : ""}`} onClick={it.onClick} {...(bind && it.tip ? bind(it.tip) : {})}>
          <div className="pf-col-val">{fmtPct(it.value)}</div>
          <div className="pf-col-track" style={{ maxWidth: 46 }}>{it.value != null && <div className="pf-col-bar" style={{ height: `${Math.max(it.value, 1)}%`, background: color }} />}</div>
          <div className="pf-col-label an-bar-label" title={it.label}>{it.label}</div>
        </div>
      ))}
    </div>
  );
}

// Share of a whole. `slices` = [{ key, label, count, color, tip }]; centre = a big value and a small label.
export function Donut({ slices, centre, centreLabel, bind }) {
  const total = slices.reduce((s, x) => s + x.count, 0);
  const C = 70, R = 62, IR = 40;
  const pt = (deg, r) => [C + r * Math.sin((deg * Math.PI) / 180), C - r * Math.cos((deg * Math.PI) / 180)];
  const share = (s) => (total ? (s.count / total) * 360 : 0);
  const arcs = slices.map((s, i) => {
    const start = slices.slice(0, i).reduce((a, x) => a + share(x), 0);
    return { ...s, start, end: start + share(s) };
  });
  const path = (a) => {
    const big = a.end - a.start > 180 ? 1 : 0;
    const [x1, y1] = pt(a.start, R), [x2, y2] = pt(a.end, R), [x3, y3] = pt(a.end, IR), [x4, y4] = pt(a.start, IR);
    return `M${x1},${y1} A${R},${R} 0 ${big} 1 ${x2},${y2} L${x3},${y3} A${IR},${IR} 0 ${big} 0 ${x4},${y4} Z`;
  };
  return (
    <div className="pie-body">
      <svg viewBox="0 0 140 140" width="130" height="130" style={{ flex: "none", overflow: "visible" }} role="img" aria-label={slices.map((s) => `${s.label} ${s.count}`).join(", ")}>
        {!total && <circle cx={C} cy={C} r={(R + IR) / 2} fill="none" stroke="var(--surface-3)" strokeWidth={R - IR} />}
        {arcs.map((a) => a.count > 0 && (a.end - a.start >= 359.9
          ? <circle key={a.key} cx={C} cy={C} r={(R + IR) / 2} fill="none" stroke={a.color} strokeWidth={R - IR} style={{ outline: "none" }} {...(bind && a.tip ? bind(a.tip) : {})} />
          : <path key={a.key} d={path(a)} fill={a.color} stroke="var(--surface)" strokeWidth="2" style={{ outline: "none" }} {...(bind && a.tip ? bind(a.tip) : {})} />))}
        <text x={C} y={C - 5} textAnchor="middle" dominantBaseline="central" fontSize="19" fontWeight="700" fill="var(--text)">{centre}</text>
        <text x={C} y={C + 13} textAnchor="middle" dominantBaseline="central" fontSize="9.5" fill="var(--text-dim)">{centreLabel}</text>
      </svg>
      <div className="pie-legend">
        {slices.map((s) => (
          <div key={s.key} className={`pie-leg-row${s.count ? "" : " zero"}`} {...(bind && s.tip && s.count ? bind(s.tip) : {})}>
            <span className="pie-dot" style={{ background: s.color }} />
            <span className="pie-leg-label">{s.label}</span>
            <b>{s.count}</b>
            <span className="pie-leg-count">{total ? `${Math.round((s.count / total) * 100)}%` : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// One line of amounts over periods, for money rather than scores. `points` = [{ label, value, tip }], `fmt` prints a value.
export function ValueTrend({ points, fmt, bind }) {
  const W = 380, H = 190, L = 52, R = 14, T = 22, B = 22;
  const max = Math.max(...points.map((p) => p.value || 0));
  const x = (i) => (points.length < 2 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (points.length - 1));
  const y = (v) => T + (max ? (max - v) / max : 1) * (H - T - B);
  const ticks = max ? [0, max / 2, max] : [0];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={points.map((p) => `${p.label} ${fmt(p.value)}`).join(", ")}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
          <text x={L - 6} y={y(t)} textAnchor="end" dominantBaseline="central" fontSize="10" fill="var(--text-faint)">{fmt(t)}</text>
        </g>
      ))}
      {points.map((p, i) => <text key={p.label} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--text-dim)">{p.label}</text>)}
      <polyline points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} fill="none" stroke="var(--stg-plan-5)" strokeWidth="2" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={p.label} {...(bind && p.tip ? bind(p.tip) : {})} style={{ outline: "none" }}>
          <circle cx={x(i)} cy={y(p.value)} r="12" fill="transparent" />
          <circle cx={x(i)} cy={y(p.value)} r="4" fill="var(--stg-plan-5)" stroke="var(--surface)" strokeWidth="2" />
        </g>
      ))}
      <text x={Math.min(x(points.length - 1), W - R - 24)} y={y(points[points.length - 1].value) - 10} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--text)">{fmt(points[points.length - 1].value)}</text>
    </svg>
  );
}

// Sideways bars of amounts, longest = the largest. `items` = [{ key, label, value, tip }].
export function ValueBars({ items, fmt, bind, color = "var(--stg-plan-5)" }) {
  if (!items.length) return <div className="an-empty">Nothing live yet.</div>;
  const max = Math.max(...items.map((it) => it.value));
  return (
    <div>
      {items.map((it) => (
        <div key={it.key} className="pf-hbar" style={{ gridTemplateColumns: "104px 1fr 72px" }} {...(bind && it.tip ? bind(it.tip) : {})}>
          <span className="pf-hbar-label" title={it.label}>{it.label}</span>
          <div className="pf-hbar-track"><div style={{ width: `${max ? (it.value / max) * 100 : 0}%`, background: color }} /></div>
          <b className="pf-hbar-val">{fmt(it.value)}</b>
        </div>
      ))}
    </div>
  );
}

// A KPI's actual as a ring; green when the target is met, amber within 10 points, red otherwise.
export function Ring({ value, target, size = 84 }) {
  const R = 34, C = 2 * Math.PI * R;
  const pct = value == null ? 0 : Math.min(100, Math.max(0, value));
  const color = value == null ? "var(--surface-3)" : value >= target ? "var(--ok)" : value >= target - 10 ? "var(--warn)" : "var(--bad)";
  return (
    <svg viewBox="0 0 84 84" width={size} height={size} style={{ flex: "none" }} role="img" aria-label={`${fmtPct(value)} against a target of ${Math.round(target)}%`}>
      <circle cx="42" cy="42" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="8" />
      <circle cx="42" cy="42" r={R} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(pct / 100) * C} ${C}`} transform="rotate(-90 42 42)" />
      <text x="42" y="42" textAnchor="middle" dominantBaseline="central" fontSize="16" fontWeight="700" fill="var(--text)">{fmtPct(value)}</text>
    </svg>
  );
}

export function Change({ value, suffix = "pp" }) {
  if (value == null) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  const r = Math.round(value);
  const color = r > 0 ? "var(--ok)" : r < 0 ? "var(--bad)" : "var(--text-dim)";
  return <b style={{ color, whiteSpace: "nowrap" }}>{r > 0 ? "▲ +" : r < 0 ? "▼ " : "– "}{r} {suffix}</b>;
}
