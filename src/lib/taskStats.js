import { isRecurring, isTaskOverdue, isTaskDoneToday, isTaskDueToday, resolutionDays, completedOnTime, taskDueBucket } from "./tasks";

// Numbers for the Tasks page (decision Oct 30 2026). Period (decision Nov 26 2026: All time = default, This week, Last week,
// This month, Last month, Last 90 days, Custom — `taskPeriod`): the period picks the tasks CREATED in it and every tile and
// chart counts only those (`tasksInPeriod`, `periodNumbers`). Arrows compare with the tasks created in the same number of
// days just before; All time has nothing to compare with, so no arrows.
// Recurring tasks have no completion time, so they're left out of everything except "Due Today".
const DAY = 86400000;
const WINDOW = 30 * DAY;

// The period the rate figures cover: { from, to (exclusive), prevFrom, label, days }. Weeks start on Monday.
export const TASK_PERIODS = [["all", "All time"], ["week", "This week"], ["lastWeek", "Last week"], ["month", "This month"], ["lastMonth", "Last month"], ["90", "Last 90 days"], ["custom", "Custom range…"]];
export function taskPeriod(kind, customFrom, customTo, now = new Date()) {
  if (!kind || kind === "all") return null;
  const day0 = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const plus = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const today = day0(now);
  const tomorrow = plus(today, 1);
  const monday = plus(today, -((today.getDay() + 6) % 7));
  let from; let to; let label;
  if (kind === "week") { from = monday; to = tomorrow; label = "This week"; }
  else if (kind === "lastWeek") { from = plus(monday, -7); to = monday; label = "Last week"; }
  else if (kind === "lastMonth") { from = new Date(today.getFullYear(), today.getMonth() - 1, 1); to = new Date(today.getFullYear(), today.getMonth(), 1); label = "Last month"; }
  else if (kind === "90") { from = plus(today, -89); to = tomorrow; label = "Last 90 days"; }
  else if (kind === "custom" && (customFrom || customTo)) {
    from = customFrom ? new Date(customFrom + "T00:00:00") : plus(today, -29);
    to = customTo ? plus(new Date(customTo + "T00:00:00"), 1) : tomorrow;
    if (to <= from) to = plus(from, 1);
    const f = (d) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    label = `${f(from)} – ${f(plus(to, -1))}`;
  } else { from = new Date(today.getFullYear(), today.getMonth(), 1); to = tomorrow; label = "This month"; }
  const days = Math.max(1, Math.round((to - from) / DAY));
  return { from, to, prevFrom: new Date(from.getTime() - days * DAY), label, days };
}

// Tasks created in [from, to) — all of them when there's no period.
const createdIn = (tasks, from, to) => tasks.filter((t) => t.createdAt && new Date(t.createdAt) >= from && new Date(t.createdAt) < to);
export function tasksInPeriod(tasks, period) {
  return period ? createdIn(tasks, period.from, period.to) : tasks;
}
// Every number on the Tasks page for one period: { kpi, dist, aging, bySource, team }. Rates (completed, TAT, on-time) count
// every completed task of the set, whenever it was completed; arrows compare with the set created just before the period.
const EVERYTHING = { from: new Date(0), to: new Date(8.64e15), prevFrom: new Date(0) };
export function periodNumbers(tasks, period, { sources, owners } = {}) {
  const cur = tasksInPeriod(tasks, period);
  const prev = period ? createdIn(tasks, period.prevFrom, period.from) : null;
  const kpi = taskKpis(cur, EVERYTHING);
  if (prev) {
    const c = windowStats(cur, EVERYTHING.from, EVERYTHING.to);
    const p = windowStats(prev, EVERYTHING.from, EVERYTHING.to);
    Object.assign(kpi, {
      totalChange: pctChange(c.created, p.created),
      completedChange: pctChange(c.completed, p.completed),
      avgTatChange: pctChange(c.avgTat, p.avgTat),
      onTimeChange: c.onTimePct != null && p.onTimePct != null ? c.onTimePct - p.onTimePct : null,
    });
  }
  const grouped = (keyOf, keys) => {
    const rows = groupedStats(cur, keyOf, keys, EVERYTHING);
    if (!prev) return rows;
    const before = Object.fromEntries(groupedStats(prev, keyOf, keys, EVERYTHING).map((r) => [r.key, r]));
    return rows.map((r) => ({ ...r, prevAvgTat: before[r.key]?.avgTat ?? null, avgTatChange: pctChange(r.avgTat, before[r.key]?.avgTat ?? null) }));
  };
  return {
    tasks: cur, kpi, dist: statusDistribution(cur, EVERYTHING), aging: overdueAging(cur),
    bySource: sources ? grouped((t) => t.source, sources) : [],
    team: owners ? grouped((t) => t.owner, owners) : null,
  };
}

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

// The chosen period (taskPeriod) and the same number of days before it; without one, the last 30 days.
function defaultPeriod(now = new Date()) {
  const to = new Date(now.getTime() + 1);
  const from = new Date(to.getTime() - WINDOW);
  return { from, to, prevFrom: new Date(from.getTime() - WINDOW) };
}
export function periodStats(tasks, period = defaultPeriod()) {
  return { cur: windowStats(tasks, period.from, period.to), prev: windowStats(tasks, period.prevFrom, period.from) };
}

// KPI tiles across the tasks in view.
export function taskKpis(tasks, period) {
  const oneOff = tasks.filter((t) => !isRecurring(t));
  const open = oneOff.filter((t) => t.status !== "Done");
  const { cur, prev } = periodStats(tasks, period);
  return {
    total: open.length,
    totalChange: pctChange(cur.created, prev.created),
    overdue: open.filter(isTaskOverdue).length,
    dueToday: tasks.filter((t) => (isRecurring(t) ? isTaskDueToday(t) && !isTaskDoneToday(t) : t.status !== "Done" && t.due && taskDueBucket(t) === "today")).length,
    completed: cur.completed,
    completedChange: pctChange(cur.completed, prev.completed),
    avgTat: cur.avgTat,
    avgTatChange: pctChange(cur.avgTat, prev.avgTat),
    onTime: cur.onTimePct,
    onTimeChange: cur.onTimePct != null && prev.onTimePct != null ? cur.onTimePct - prev.onTimePct : null, // points, not %
  };
}

// Status distribution: Open / In Progress / Overdue / On Hold among open one-off tasks (now), plus Done in the period.
export function statusDistribution(tasks, period = defaultPeriod()) {
  const since = period.from.getTime();
  const until = period.to.getTime();
  const counts = { Open: 0, "In Progress": 0, Overdue: 0, "On Hold": 0, Done: 0 };
  tasks.filter((t) => !isRecurring(t)).forEach((t) => {
    if (t.status === "Done") { const c = t.completedAt && new Date(t.completedAt).getTime(); if (c && c >= since && c < until) counts.Done += 1; return; }
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

// One row per value of `keyOf` (e.g. owner, or source) with the period's numbers.
export function groupedStats(tasks, keyOf, keys, period) {
  return keys.map((key) => {
    const mine = tasks.filter((t) => keyOf(t) === key);
    const { cur, prev } = periodStats(mine, period);
    const bySource = {};
    ["Manual", "Adoption", "Expansion"].forEach((src) => { bySource[src] = periodStats(mine.filter((t) => t.source === src), period).cur.avgTat; });
    return { key, ...cur, prevAvgTat: prev.avgTat, avgTatChange: pctChange(cur.avgTat, prev.avgTat), tatBySource: bySource };
  });
}
