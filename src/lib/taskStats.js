import { isRecurring, isTaskOverdue, isTaskDoneToday, isTaskDueToday, resolutionDays, completedOnTime, taskBucket } from "./tasks";

// Numbers for the Tasks page (decision Oct 30 2026). Every "rate" figure covers the last 30 days and is compared with the
// 30 days before. Recurring tasks have no completion time, so they're left out of everything except "Due Today".
const DAY = 86400000;
const WINDOW = 30 * DAY;

function avg(list) { return list.length ? list.reduce((s, v) => s + v, 0) / list.length : null; }
// % change from `prev` to `cur` (null when there's nothing to compare with).
export function pctChange(cur, prev) {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

// Completed / avg TAT (days) / on-time % for tasks completed in [from, to).
export function windowStats(tasks, from, to) {
  const done = tasks.filter((t) => !isRecurring(t) && t.completedAt && new Date(t.completedAt) >= from && new Date(t.completedAt) < to);
  const tats = done.map(resolutionDays).filter((v) => v != null);
  const withDue = done.map(completedOnTime).filter((v) => v != null);
  return {
    completed: done.length,
    avgTat: avg(tats),
    onTimePct: withDue.length ? (withDue.filter(Boolean).length / withDue.length) * 100 : null,
    created: tasks.filter((t) => !isRecurring(t) && t.createdAt && new Date(t.createdAt) >= from && new Date(t.createdAt) < to).length,
  };
}

// The last 30 days and the 30 before, for one set of tasks.
export function periodStats(tasks, now = new Date()) {
  const end = new Date(now.getTime() + 1);
  const mid = new Date(end.getTime() - WINDOW);
  const start = new Date(mid.getTime() - WINDOW);
  return { cur: windowStats(tasks, mid, end), prev: windowStats(tasks, start, mid) };
}

// KPI tiles across the tasks in view.
export function taskKpis(tasks) {
  const oneOff = tasks.filter((t) => !isRecurring(t));
  const open = oneOff.filter((t) => t.status !== "Done");
  const { cur, prev } = periodStats(tasks);
  return {
    total: open.length,
    totalChange: pctChange(cur.created, prev.created),
    overdue: open.filter(isTaskOverdue).length,
    dueToday: tasks.filter((t) => (isRecurring(t) ? isTaskDueToday(t) && !isTaskDoneToday(t) : t.status !== "Done" && t.due && taskBucket(t.due) === "today")).length,
    completed: cur.completed,
    completedChange: pctChange(cur.completed, prev.completed),
    avgTat: cur.avgTat,
    avgTatChange: pctChange(cur.avgTat, prev.avgTat),
    onTime: cur.onTimePct,
    onTimeChange: cur.onTimePct != null && prev.onTimePct != null ? cur.onTimePct - prev.onTimePct : null, // points, not %
  };
}

// Status distribution: Open / In Progress / Overdue / On Hold among open one-off tasks, plus Done in the last 30 days.
export function statusDistribution(tasks) {
  const since = Date.now() - WINDOW;
  const counts = { Open: 0, "In Progress": 0, Overdue: 0, "On Hold": 0, Done: 0 };
  tasks.filter((t) => !isRecurring(t)).forEach((t) => {
    if (t.status === "Done") { if (t.completedAt && new Date(t.completedAt).getTime() >= since) counts.Done += 1; return; }
    if (t.status === "On Hold") counts["On Hold"] += 1;
    else if (isTaskOverdue(t)) counts.Overdue += 1;
    else counts[t.status] = (counts[t.status] || 0) + 1;
  });
  return counts;
}

// How late the overdue tasks are.
export const AGING_BUCKETS = [
  { key: "1-2", label: "1–2 days", min: 1, max: 2 },
  { key: "3-7", label: "3–7 days", min: 3, max: 7 },
  { key: "8-15", label: "8–15 days", min: 8, max: 15 },
  { key: "15+", label: "15+ days", min: 16, max: Infinity },
];
export function daysOverdue(t) {
  if (!t.due) return 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((today - new Date(t.due + "T00:00:00")) / DAY);
}
export function overdueAging(tasks) {
  const late = tasks.filter(isTaskOverdue).map(daysOverdue);
  return AGING_BUCKETS.map((b) => ({ ...b, count: late.filter((d) => d >= b.min && d <= b.max).length }));
}

// One row per value of `keyOf` (e.g. owner, or source) with the 30-day numbers.
export function groupedStats(tasks, keyOf, keys) {
  return keys.map((key) => {
    const mine = tasks.filter((t) => keyOf(t) === key);
    const { cur, prev } = periodStats(mine);
    const bySource = {};
    ["Manual", "Adoption", "Expansion"].forEach((src) => { bySource[src] = periodStats(mine.filter((t) => t.source === src)).cur.avgTat; });
    return { key, ...cur, prevAvgTat: prev.avgTat, avgTatChange: pctChange(cur.avgTat, prev.avgTat), tatBySource: bySource };
  });
}
