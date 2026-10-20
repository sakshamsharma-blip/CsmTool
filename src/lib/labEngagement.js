import { todayISO, daysFromTodayISO } from "./dates";

// Per-lab engagement numbers from its visits / check-ins: time spent (sum of each check-in's Duration) and the
// Proactive / Reactive split. One place so the lab page and the reports always agree.
export function labEngagementStats(visits) {
  const today = todayISO();
  const since30 = daysFromTodayISO(-30);
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const mins = (v) => Number(v.durationMinutes) || 0;
  const list = visits || [];
  return {
    totalMinutes: list.reduce((s, v) => s + mins(v), 0),
    last30Minutes: list.filter((v) => v.visitDate >= since30 && v.visitDate <= today).reduce((s, v) => s + mins(v), 0),
    yearMinutes: list.filter((v) => v.visitDate >= yearStart && v.visitDate <= today).reduce((s, v) => s + mins(v), 0),
    count: list.length,
    timedCount: list.filter((v) => mins(v) > 0).length,
    proactive: list.filter((v) => v.engagement === "Proactive").length,
    reactive: list.filter((v) => v.engagement === "Reactive").length,
  };
}
