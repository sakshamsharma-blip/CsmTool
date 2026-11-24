import { addDaysISO, todayISO } from "./dates";
import { pocMonthStatus } from "./labContacts";

// POC check-in cadence (decision Nov 24 2026). A POC's "Minimum Proactive Check-ins per Month" also sets how often they
// should be contacted: every 30 ÷ target days, rounded down (4 = weekly, 7 days; 2 = every 15 days; 1 = monthly, 30 days).
// Next due = the POC's last Proactive check-in (Person Contacted matching their name) + that gap; never contacted =
// counted from when the POC was added. The KPI is unchanged: it still counts done ÷ required per calendar month.

export const intervalDays = (target) => (target > 0 ? Math.max(1, Math.floor(30 / target)) : null);
export function cadenceLabel(target) {
  if (!target) return "No target";
  const d = intervalDays(target);
  const every = d === 7 ? "weekly" : d === 30 ? "monthly" : d === 15 ? "every 15 days" : `every ${d} days`;
  return `${target} / month · ${every}`;
}
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// One POC: target, gap, last Proactive check-in, next due date, days until due (negative = overdue), status and this
// month's done / required. `labVisits` = that lab's check-ins.
export function pocSchedule(contact, labVisits, today = todayISO()) {
  const target = contact.minProactive || 0;
  const name = (contact.name || "").trim().toLowerCase();
  const mine = (labVisits || []).filter((v) => v.engagement === "Proactive" && (v.personName || "").trim().toLowerCase() === name && v.visitDate <= today)
    .sort((a, b) => b.visitDate.localeCompare(a.visitDate));
  const last = mine[0] || null;
  const month = pocMonthStatus(contact, labVisits, today.slice(0, 7));
  if (!target) return { target, gap: null, last, nextDue: null, daysLeft: null, status: "none", month };
  const gap = intervalDays(target);
  const base = last ? last.visitDate : (contact.createdAt || today).slice(0, 10);
  const nextDue = addDaysISO(base, gap);
  const daysLeft = daysBetween(today, nextDue);
  const status = daysLeft < 0 ? "overdue" : daysLeft === 0 ? "today" : daysLeft <= 3 ? "soon" : "upcoming";
  return { target, gap, last, nextDue, daysLeft, status, month };
}
export const STATUS_RANK = { overdue: 0, today: 1, soon: 2, upcoming: 3, none: 4 };
