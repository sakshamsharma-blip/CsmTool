// Feedback & NPS cadence (decision Nov 24 2026), shared by the app (re-exported by src/lib/feedback.js) and the
// connector (csm-mcp), so both count coverage the same way. Pure JS, no imports.
//
// Every client is asked for FEEDBACK — a 1–5 rating — once a calendar MONTH, and for NPS — 0–10 — once a calendar
// QUARTER (Q1 Jan–Mar … Q4 Oct–Dec). A response counts as the month's feedback if it has a rating, and as the quarter's
// NPS if it has an NPS score; one response can be both. Counted on PARENT labs (a child lab's response counts for its
// parent). Inactive and Churned clients aren't expected to give feedback, so they're left out of coverage.
//
// Rows passed in are { lab, date: "YYYY-MM-DD", rating, nps } with `lab` already the parent lab's id.

export const FEEDBACK_EVERY = "month";
export const NPS_EVERY = "quarter";
export const COVERAGE_SKIPPED_STATUSES = ["Inactive", "Churned"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const monthKey = (iso) => iso.slice(0, 7);
export function quarterKey(iso) {
  const [y, m] = iso.split("-").map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}
export function periodLabel(key) {
  if (key.includes("Q")) { const [y, q] = key.split("-Q"); return `Q${q} ${y}`; }
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
// The `count` periods ending with the one containing `today`, oldest first.
export function lastPeriods(unit, count, today) {
  let [y, m] = today.split("-").map(Number);
  if (unit === "quarter") m = Math.floor((m - 1) / 3) * 3 + 1;
  const step = unit === "quarter" ? 3 : 1, out = [];
  for (let i = 0; i < count; i++) {
    const iso = `${y}-${String(m).padStart(2, "0")}-01`;
    out.unshift(unit === "quarter" ? quarterKey(iso) : monthKey(iso));
    m -= step;
    if (m < 1) { m += 12; y -= 1; }
  }
  return out;
}
export const keyFor = (unit, iso) => (unit === "quarter" ? quarterKey(iso) : monthKey(iso));

function daysBetween(a, b) {
  const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// One client's position against the cadence: its latest rating and NPS, and whether this month / quarter is done.
export function labCadence(rows, today) {
  const sorted = [...rows].filter((r) => r.date && r.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  const rated = sorted.find((r) => r.rating != null);
  const scored = sorted.find((r) => r.nps != null);
  return {
    lastRating: rated ? rated.rating : null, lastRatingDate: rated ? rated.date : null,
    lastNps: scored ? scored.nps : null, lastNpsDate: scored ? scored.date : null,
    feedbackThisMonth: !!rated && monthKey(rated.date) === monthKey(today),
    npsThisQuarter: !!scored && quarterKey(scored.date) === quarterKey(today),
    daysSinceRating: rated ? daysBetween(rated.date, today) : null,
    daysSinceNps: scored ? daysBetween(scored.date, today) : null,
  };
}

// Coverage for a set of parent labs ({ id, status, … }): how many gave this month's feedback and this quarter's NPS,
// and each lab's cadence. Inactive / Churned labs are left out.
export function feedbackCoverage(labs, rows, today) {
  const byLab = {};
  rows.forEach((r) => { (byLab[r.lab] ||= []).push(r); });
  const counted = labs.filter((l) => !COVERAGE_SKIPPED_STATUSES.includes(l.status));
  const perLab = counted.map((l) => ({ lab: l, ...labCadence(byLab[l.id] || [], today) }));
  return {
    month: monthKey(today), monthLabel: periodLabel(monthKey(today)),
    quarter: quarterKey(today), quarterLabel: periodLabel(quarterKey(today)),
    total: perLab.length,
    feedbackThisMonth: perLab.filter((x) => x.feedbackThisMonth).length,
    npsThisQuarter: perLab.filter((x) => x.npsThisQuarter).length,
    labs: perLab,
  };
}

const avg = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

// Averages per month or quarter, oldest first: NPS (average out of 10 + promoter / passive / detractor counts), the
// 1–5 rating, and how many clients answered each.
export function feedbackTrend(rows, unit, count, today) {
  return lastPeriods(unit, count, today).map((key) => {
    const inP = rows.filter((r) => r.date && keyFor(unit, r.date) === key);
    const nps = inP.filter((r) => r.nps != null), rated = inP.filter((r) => r.rating != null);
    return {
      key, label: periodLabel(key),
      nps: {
        average: avg(nps.map((r) => r.nps)), responses: nps.length, labs: new Set(nps.map((r) => r.lab)).size,
        promoters: nps.filter((r) => r.nps >= 9).length, passives: nps.filter((r) => r.nps >= 7 && r.nps <= 8).length,
        detractors: nps.filter((r) => r.nps <= 6).length,
      },
      rating: { average: avg(rated.map((r) => r.rating)), responses: rated.length, labs: new Set(rated.map((r) => r.lab)).size },
    };
  });
}
