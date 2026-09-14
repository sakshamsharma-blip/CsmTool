import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";

export function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

// A one-off task counts as due/shown every day until checked (however old). A recurring task is only
// "due" on the day its pattern says — daily every day, weekly/fortnightly on their weekday, monthly on
// their day-of-month, custom every N days from its anchor date.
export function isTaskDueToday(t) {
  if (!t.repeat || t.repeat === "none") return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (t.repeat === "daily") return true;
  if (t.repeat === "weekly") return today.getDay() === t.repeatDay;
  if (t.repeat === "fortnightly") {
    if (today.getDay() !== t.repeatDay) return false;
    const anchor = new Date((t.repeatAnchor || todayISO()) + "T00:00:00");
    const diffDays = Math.round((today - anchor) / 86400000);
    const diffWeeks = Math.floor(diffDays / 7);
    return diffWeeks >= 0 && diffWeeks % 2 === 0;
  }
  if (t.repeat === "monthly") return today.getDate() === t.repeatDay;
  if (t.repeat === "custom") {
    const anchor = new Date((t.due || todayISO()) + "T00:00:00");
    const diffDays = Math.round((today - anchor) / 86400000);
    return diffDays >= 0 && diffDays % Math.max(1, t.repeatIntervalDays || 1) === 0;
  }
  return true;
}

// A recurring task's "done" resets each day (lastDoneDate no longer matches today) rather than staying
// checked off forever; a one-off task's done state is just its done flag.
export function isTaskDoneToday(t) {
  if (!t.repeat || t.repeat === "none") return !!t.done;
  return t.lastDoneDate === todayISO();
}

export function taskBucket(due) {
  if (!due) return "none";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(due + "T00:00:00");
  if (d < today) return "overdue";
  if (d.getTime() === today.getTime()) return "today";
  return "upcoming";
}
export function taskDisplayBucket(t) {
  if (isTaskDoneToday(t)) return "done";
  if (t.repeat && t.repeat !== "none") return "today";
  return taskBucket(t.due);
}
export function repeatLabel(t) {
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (t.repeat === "daily") return "Daily";
  if (t.repeat === "weekly") return "Weekly · " + DOW[t.repeatDay];
  if (t.repeat === "fortnightly") return "Fortnightly · " + DOW[t.repeatDay];
  if (t.repeat === "monthly") return "Monthly · day " + t.repeatDay;
  if (t.repeat === "custom") return "Every " + (t.repeatIntervalDays || 1) + "d";
  return "";
}
export function taskTypeLabel(t) {
  if (t.type === "follow-up") return "Follow-up";
  if (t.type === "action-item") return "Action Item";
  if (t.type === "collection") return "Collection Due";
  if (t.type === "pitch") return "Pitch Reminder";
  return t.repeat && t.repeat !== "none" ? "Recurring" : "Personal";
}

// Basecamp-style grouping — Overdue / Today / Upcoming / Someday / Done — so a CSM scans "what's late"
// and "what's done" at a glance.
export const TASK_SECTIONS = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "none", label: "Someday" },
  { key: "done", label: "Done" },
];

// "Open" = pending right now (Dashboard tiles, By-CSM breakdown). A recurring task only counts as open
// on a day it's actually due; a one-off counts as open until checked, however old.
export function getOpenTasksFor(tasks, csmName) {
  return tasks.filter((t) => {
    if (csmName && t.owner !== csmName) return false;
    if (t.repeat && t.repeat !== "none" && !isTaskDueToday(t)) return false;
    return !isTaskDoneToday(t);
  });
}
// Every task worth showing in "Tasks for Today" — every one-off (done or not, so a completed one still
// shows struck through instead of vanishing), plus recurring tasks only on the day they're due.
export function getTasksForPanel(tasks, csmName) {
  return tasks.filter((t) => {
    if (csmName && t.owner !== csmName) return false;
    if (t.repeat && t.repeat !== "none") return isTaskDueToday(t);
    return true;
  });
}

function fromRow(r, nameById) {
  return {
    id: r.id,
    labId: r.lab_id,
    desc: r.description,
    owner: nameById[r.owner_id] || "",
    ownerId: r.owner_id,
    assignedBy: r.assigned_by ? nameById[r.assigned_by] || "" : null,
    broadcastId: r.broadcast_id,
    type: r.type,
    due: r.due,
    done: r.done,
    lastDoneDate: r.last_done_date,
    repeat: r.repeat,
    repeatDay: r.repeat_day != null ? parseInt(r.repeat_day, 10) : null,
    repeatIntervalDays: r.repeat_interval_days,
    repeatAnchor: r.repeat_anchor,
    auto: r.auto,
  };
}

export async function fetchAllTasks(nameById) {
  const { data, error } = await supabase.from("tasks").select("*").order("due", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data || []).map((r) => fromRow(r, nameById));
}

// Creates one task per owner — a Lead broadcasting to "All CSMs" gets one independent copy per CSM
// (not one shared row), matching how every other task already works.
export async function addTask({ labId, desc, owners, type, repeat, repeatDay, repeatIntervalDays, repeatAnchor, due, idByName, assignedByName }) {
  const broadcastId = owners.length > 1 ? crypto.randomUUID() : null;
  const assignedById = assignedByName ? idByName[assignedByName] || null : null;
  const rows = owners.map((owner) => ({
    lab_id: labId || null,
    owner_id: idByName[owner],
    assigned_by: assignedById && (owners.length > 1 || assignedByName !== owner) ? assignedById : null,
    broadcast_id: broadcastId,
    description: desc,
    type: type || "personal",
    due: due || null,
    repeat: repeat || "none",
    repeat_day: repeatDay != null ? String(repeatDay) : null,
    repeat_interval_days: repeatIntervalDays || null,
    repeat_anchor: repeatAnchor || null,
  }));
  const { error } = await supabase.from("tasks").insert(rows);
  if (error) throw error;
  if (labId) {
    const lab = { id: labId };
    logActivity(labId, {
      kind: "Task Added",
      title: "Task added",
      meta: desc + (repeat && repeat !== "none" ? ` (repeats: ${repeat})` : "") + (owners.length > 1 ? " — broadcast to all CSMs" : ""),
      csmId: assignedById || idByName[owners[0]],
    }).catch((err) => console.error(err));
  }
}

export async function toggleTaskDone(task) {
  const patch = (!task.repeat || task.repeat === "none")
    ? { done: !task.done }
    : { last_done_date: isTaskDoneToday(task) ? null : todayISO() };
  const { error } = await supabase.from("tasks").update(patch).eq("id", task.id);
  if (error) throw error;
}

export async function deleteTask(id) {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}
