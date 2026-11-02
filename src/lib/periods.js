import { todayISO, toLocalISODate } from "./dates";

// Calendar periods for the Adoption, Expansion and KPI screens (Q4 = Oct–Dec). Dates are local "YYYY-MM-DD" strings.
export const GRANULARITIES = ["Monthly", "Quarterly", "Half-Yearly", "Yearly"];
const SPAN = { Monthly: 1, Quarterly: 3, "Half-Yearly": 6, Yearly: 12 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function make(year, startMonth, gran) {
  const span = SPAN[gran];
  const endMonth = startMonth + span - 1;
  const idx = Math.floor(startMonth / span) + 1;
  const label = gran === "Monthly" ? `${MONTHS[startMonth]} ${year}` : gran === "Quarterly" ? `Q${idx} ${year}` : gran === "Half-Yearly" ? `H${idx} ${year}` : `${year}`;
  return {
    key: `${gran}:${year}:${startMonth}`, year, gran, label,
    range: span === 1 ? "" : `${MONTHS[startMonth]}–${MONTHS[endMonth]}`,
    start: toLocalISODate(new Date(year, startMonth, 1)),
    end: toLocalISODate(new Date(year, endMonth + 1, 0)),
  };
}

// Every period of a year at this granularity ("Yearly" gives that year and the one before, so there's a comparison).
export function periodsFor(year, gran) {
  if (gran === "Yearly") return [make(year - 1, 0, gran), make(year, 0, gran)];
  const span = SPAN[gran], out = [];
  for (let m = 0; m < 12; m += span) out.push(make(year, m, gran));
  return out;
}

export function periodContaining(iso, gran) {
  const [y, m] = iso.split("-").map(Number);
  return make(y, Math.floor((m - 1) / SPAN[gran]) * SPAN[gran], gran);
}

export function previousPeriod(p) {
  const d = new Date(p.start + "T00:00:00");
  d.setDate(0);
  return periodContaining(toLocalISODate(d), p.gran);
}

export const isFuture = (p) => p.start > todayISO();

// The moment a period's score is read at: the end of its last day, or right now while it's still running.
export function asOfMs(p) {
  const [y, m, d] = p.end.split("-").map(Number);
  return Math.min(Date.now(), new Date(y, m - 1, d, 23, 59, 59, 999).getTime());
}

// "YYYY-MM" for each month of a period that has started.
export function monthsIn(p) {
  const out = [], today = todayISO().slice(0, 7);
  const d = new Date(p.start + "T00:00:00");
  while (toLocalISODate(d) <= p.end) {
    const ym = toLocalISODate(d).slice(0, 7);
    if (ym <= today) out.push(ym);
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}
