// Calendar-date helpers that work in the browser's LOCAL time zone. `date.toISOString()` converts to
// UTC first, so in India (UTC+5:30) local midnight comes out as the PREVIOUS day — which made "today"
// read as yesterday (new tasks showing as overdue) and saved invoice due dates one day early. Always
// build YYYY-MM-DD strings with these instead of toISOString().slice(0, 10).

export function toLocalISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayISO() {
  return toLocalISODate(new Date());
}

// "2026-10-19" + 30 → "2026-11-18" (pure calendar arithmetic, no time-zone drift).
export function addDaysISO(isoDate, days) {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toLocalISODate(d);
}

// Today + n days.
export function daysFromTodayISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toLocalISODate(d);
}

// Due date = the LAST day to pay (decision, Oct 2026): invoice date + credit days − 1. Invoice on Oct 1 with 7
// credit days → due Oct 7, and Oct 8 is the first overdue day (1 day overdue). 0 credit days → due the same day.
export function dueDateFor(startISO, creditDays) {
  const days = Math.max(1, parseInt(creditDays, 10) || 0);
  return addDaysISO(startISO, days - 1);
}

// Check-ins and logged visits can be dated today or the previous day only (rule of Oct 30 2026) — keeps the log current.
// Applies to every check-in type, Proactive or Reactive, and to a logged offline visit; UI-enforced.
export function checkinDateBounds() {
  const today = todayISO();
  return { min: addDaysISO(today, -1), max: today };
}
export function isCheckinDateAllowed(iso) {
  const { min, max } = checkinDateBounds();
  return !!iso && iso >= min && iso <= max;
}
export const CHECKIN_DATE_MESSAGE = "Check-ins can only be dated today or yesterday — older entries can't be added or backdated.";
