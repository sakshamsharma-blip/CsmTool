import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";
import { todayISO } from "./dates";

// Re-exported so existing `import { todayISO } from "../lib/tasks"` callers keep working — the real
// (local-time-zone) implementation lives in lib/dates.js.
export { todayISO };

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
// checked off forever; a one-off task is done when its status is Done.
export function isTaskDoneToday(t) {
  if (!t.repeat || t.repeat === "none") return t.status === "Done";
  return t.lastDoneDate === todayISO();
}
export const isRecurring = (t) => !!t.repeat && t.repeat !== "none";

// ---- Task management (migration 0043) ----
// Workflow status — "Overdue" isn't stored: it's an open task whose due date has passed (taskStatusLabel).
export const TASK_STATUSES = ["Open", "In Progress", "On Hold", "Done"];
export const TASK_PRIORITIES = ["High", "Medium", "Low"];
// Manual = made by a person (Add Task, Log Check-in, Visits…); Adoption / Expansion = created automatically when an
// item on a lab's Adoption tab gets under way (syncItemTask).
export const TASK_SOURCES = ["Manual", "Adoption", "Expansion"];
export const PRIORITY_COLORS = { High: "var(--bad)", Medium: "var(--warn)", Low: "var(--ok)" };

export function isTaskOverdue(t) {
  return !isRecurring(t) && t.status !== "Done" && !!t.due && taskBucket(t.due) === "overdue";
}
// What the status pill says: Overdue wins over Open / In Progress; On Hold and Done show as they are.
export function taskStatusLabel(t) {
  if (isRecurring(t)) return isTaskDoneToday(t) ? "Done" : "Open";
  if (t.status === "Done" || t.status === "On Hold") return t.status;
  if (isTaskOverdue(t)) return "Overdue";
  if (t.due && taskBucket(t.due) === "today") return "Due Today";
  return t.status;
}
const DAY = 86400000;
// Days from creation to completion (one decimal), or null while open. Recurring tasks have no TAT.
export function resolutionDays(t) {
  if (!t.completedAt || !t.createdAt) return null;
  return Math.max(0, (new Date(t.completedAt) - new Date(t.createdAt)) / DAY);
}
// Completed on or before its due date (null when it has no due date or isn't done).
export function completedOnTime(t) {
  if (!t.completedAt || !t.due) return null;
  const d = new Date(t.completedAt);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return local <= t.due;
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
  if (t.type === "adoption-item") return "Adoption";
  if (t.type === "expansion-item") return "Expansion";
  if (t.type === "follow-up") return "Follow-up";
  if (t.type === "action-item") return "Action Item";
  if (t.type === "planned-visit") return "Planned Visit";
  if (t.type === "collection") return "Collection Due";
  if (t.type === "pitch") return "Pitch Reminder";
  if (t.type === "reminder") return "Reminder";
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
    // status is the source of truth; rows from before migration 0043 fall back to the old done flag.
    status: r.status || (r.done ? "Done" : "Open"),
    done: r.status ? r.status === "Done" : r.done,
    priority: r.priority || "Medium",
    source: r.source || "Manual",
    details: r.details || "",
    completedAt: r.completed_at || null,
    moduleKey: r.module_key || null,
    paramName: r.param_name || null,
    lastDoneDate: r.last_done_date,
    repeat: r.repeat,
    repeatDay: r.repeat_day != null ? parseInt(r.repeat_day, 10) : null,
    repeatIntervalDays: r.repeat_interval_days,
    repeatAnchor: r.repeat_anchor,
    auto: r.auto,
    sourceVisitId: r.source_visit_id || null,
    createdAt: r.created_at,
  };
}

export async function fetchAllTasks(nameById) {
  const { data, error } = await supabase.from("tasks").select("*").order("due", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data || []).map((r) => fromRow(r, nameById));
}

// Creates one task per owner — a Lead broadcasting to "All CSMs" gets one independent copy per CSM
// (not one shared row), matching how every other task already works.
// sourceVisitId (optional) links a follow-up task back to the visit/check-in that created it, so
// a later edit to that visit's follow-up date can keep this task in sync — see
// syncFollowupTaskForVisit below. Returns the inserted row(s) so a caller that needs the new id
// (exactly the sourceVisitId case, always a single owner) can use it right away.
export async function addTask({ labId, desc, owners, type, repeat, repeatDay, repeatIntervalDays, repeatAnchor, due, idByName, assignedByName, sourceVisitId, priority, details }) {
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
    source_visit_id: sourceVisitId || null,
    priority: priority || "Medium",
    details: (details || "").trim() || null,
  }));
  const { data, error } = await supabase.from("tasks").insert(rows).select("id");
  if (error) throw error;
  const by = assignedById || idByName[owners[0]] || null;
  (data || []).forEach((row) => logTaskEvent(row.id, by, "Task created"));
  if (labId) {
    logActivity(labId, {
      kind: "Task Added",
      title: "Task added",
      meta: desc + (repeat && repeat !== "none" ? ` (repeats: ${repeat})` : "") + (owners.length > 1 ? " — broadcast to all CSMs" : ""),
      csmId: assignedById || idByName[owners[0]],
    }).catch((err) => console.error(err));
  }
  return data || [];
}

// The tick box (Dashboard / My Portfolio "Tasks for Today", the Tasks list): Done ⇄ Open for a one-off task, done-for-
// today for a recurring one.
export async function toggleTaskDone(task, actorId) {
  if (isRecurring(task)) {
    const { error } = await supabase.from("tasks").update({ last_done_date: isTaskDoneToday(task) ? null : todayISO() }).eq("id", task.id);
    if (error) throw error;
    return;
  }
  await setTaskStatus(task, task.status === "Done" ? "Open" : "Done", actorId);
}

// Status change — keeps `done` and completed_at in step, and records it in the task's activity history.
export async function setTaskStatus(task, status, actorId) {
  if (status === task.status) return;
  const patch = { status, done: status === "Done", completed_at: status === "Done" ? new Date().toISOString() : null };
  const { error } = await supabase.from("tasks").update(patch).eq("id", task.id);
  if (error) throw error;
  logTaskEvent(task.id, actorId, `Status changed to ${status}`);
}

// Field edits from the task panel. `changes` = any of { desc, details, priority, due, ownerId }; `ownerName` labels an
// owner change in the history. Each real change becomes one activity entry.
export async function updateTaskFields(task, changes, actorId, { ownerName } = {}) {
  const patch = {};
  const events = [];
  if (changes.desc !== undefined && changes.desc.trim() && changes.desc.trim() !== task.desc) { patch.description = changes.desc.trim(); events.push("Title changed"); }
  if (changes.details !== undefined && (changes.details || "").trim() !== (task.details || "")) { patch.details = (changes.details || "").trim() || null; events.push("Description updated"); }
  if (changes.priority !== undefined && changes.priority !== task.priority) { patch.priority = changes.priority; events.push(`Priority set to ${changes.priority}`); }
  if (changes.due !== undefined && (changes.due || null) !== (task.due || null)) {
    patch.due = changes.due || null;
    events.push(changes.due ? `Due date set to ${new Date(changes.due + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : "Due date removed");
  }
  if (changes.ownerId !== undefined && changes.ownerId !== task.ownerId) { patch.owner_id = changes.ownerId; events.push(`Reassigned to ${ownerName || "another CSM"}`); }
  if (!Object.keys(patch).length) return;
  const { error } = await supabase.from("tasks").update(patch).eq("id", task.id);
  if (error) throw error;
  events.forEach((e) => logTaskEvent(task.id, actorId, e));
}

// ---- comments & activity history (task_updates) ----
function logTaskEvent(taskId, actorId, body) {
  supabase.from("task_updates").insert({ task_id: taskId, author_id: actorId || null, kind: "event", body })
    .then(({ error }) => { if (error) console.error(error); });
}
export async function fetchTaskUpdates(taskId) {
  const { data, error } = await supabase.from("task_updates").select("id,task_id,author_id,kind,body,created_at")
    .eq("task_id", taskId).order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((r) => ({ id: r.id, taskId: r.task_id, authorId: r.author_id, kind: r.kind, body: r.body, createdAt: r.created_at }));
}
// Comment counts for the list (one query; RLS limits it to tasks this person can see).
export async function fetchTaskCommentCounts() {
  const { data, error } = await supabase.from("task_updates").select("task_id").eq("kind", "comment");
  if (error) throw error;
  const counts = {};
  (data || []).forEach((r) => { counts[r.task_id] = (counts[r.task_id] || 0) + 1; });
  return counts;
}
export async function addTaskComment(taskId, body, authorId) {
  const { error } = await supabase.from("task_updates").insert({ task_id: taskId, author_id: authorId, kind: "comment", body: body.trim() });
  if (error) throw error;
}
export async function deleteTaskUpdate(id) {
  const { error } = await supabase.from("task_updates").delete().eq("id", id);
  if (error) throw error;
}

// ---- tasks for Adoption / Expansion items (decision Oct 30 2026) ----
// When a parameter on a lab's Adoption tab gets under way (moves past To-Do), it gets ONE task — Source "Adoption" (In-plan
// list) or "Expansion" (Not-in-plan list) — owned by the lab's CSM, with NO due date unless one is given (the stage-change
// dialog offers one; it can also be added later on Tasks). Moving between under-way stages keeps the same task and updates
// its title; reaching a final stage (Adopted, Purchased, Not Required, Lost…) marks it Done. Called from the single entry
// points for stage changes (setParamStatus / applyPitchStageChange / setParamInPlan), so every screen behaves the same.
export async function syncItemTask({ labId, moduleKey, paramName, source, stage, active, due, actorId }) {
  const { data: open, error } = await supabase.from("tasks").select("id,status,description,due")
    .eq("lab_id", labId).eq("module_key", moduleKey).eq("param_name", paramName).eq("source", source).neq("status", "Done")
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  const existing = open && open[0];
  const title = `${paramName} — ${stage}`;
  if (!active) {
    if (existing) await setTaskStatus({ id: existing.id, status: existing.status }, "Done", actorId);
    return;
  }
  if (existing) {
    const patch = { description: title };
    if (due) patch.due = due;
    const { error: e2 } = await supabase.from("tasks").update(patch).eq("id", existing.id);
    if (e2) throw e2;
    logTaskEvent(existing.id, actorId, `Stage changed to ${stage}${due ? ` · due ${due}` : ""}`);
    return;
  }
  const { data: lab, error: e3 } = await supabase.from("labs").select("csm_id").eq("id", labId).single();
  if (e3) throw e3;
  const ownerId = lab?.csm_id || actorId;
  if (!ownerId) return;
  const { data: created, error: e4 } = await supabase.from("tasks").insert({
    lab_id: labId, owner_id: ownerId, assigned_by: actorId && actorId !== ownerId ? actorId : null,
    description: title, type: source === "Adoption" ? "adoption-item" : "expansion-item", source,
    module_key: moduleKey, param_name: paramName, due: due || null, repeat: "none", priority: "Medium", auto: true,
  }).select("id").single();
  if (e4) throw e4;
  logTaskEvent(created.id, actorId, `Task created — ${paramName} got under way (${stage})`);
}

// Closes every open item task of one parameter (both lists) — used when it switches In plan ⇄ Not in plan or is lost.
export async function closeItemTasks(labId, moduleKey, paramName, actorId) {
  const { data, error } = await supabase.from("tasks").select("id,status")
    .eq("lab_id", labId).eq("module_key", moduleKey).eq("param_name", paramName).neq("status", "Done");
  if (error) throw error;
  await Promise.all((data || []).map((t) => setTaskStatus(t, "Done", actorId)));
}

// Generic patch — used by syncFollowupTaskForVisit to update a linked task's due date/description
// after its source visit is edited, without touching its done/repeat state.
export async function updateTask(id, { desc, due }) {
  const patch = {};
  if (desc !== undefined) patch.description = desc;
  if (due !== undefined) patch.due = due || null;
  const { error } = await supabase.from("tasks").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteTask(id) {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}

// Keeps a visit's follow-up task in sync when the visit itself is edited: updates the linked
// task's due date/description if one exists, creates one if a follow-up date was just added
// where there wasn't one before, and removes it if the follow-up date was cleared. Called from
// the Visit Detail edit-save flow (LabDetailView) — never from visit creation, which already
// creates its own task inline via addTask with sourceVisitId set.
// `type` / `descPrefix` let Visits & Meetings keep its next visit as a "planned-visit" task (so it shows under
// Upcoming Planned Visits) while Log Check-in follow-ups stay plain "follow-up" tasks.
export async function syncFollowupTaskForVisit({ visitId, labId, labName, ownerName, idByName, nextFollowupDate, nextFollowupReason, type = "follow-up", descPrefix = "Follow-up" }) {
  const { data: existing, error: e1 } = await supabase.from("tasks").select("id").eq("source_visit_id", visitId).limit(1);
  if (e1) throw e1;
  const existingId = existing && existing[0] ? existing[0].id : null;
  const desc = `${descPrefix} — ${labName}${nextFollowupReason ? `: ${nextFollowupReason}` : ""}`;

  if (!nextFollowupDate) {
    if (existingId) await deleteTask(existingId);
    return;
  }
  if (existingId) {
    await updateTask(existingId, { desc, due: nextFollowupDate });
  } else {
    await addTask({
      labId, desc, owners: [ownerName], type, repeat: "none",
      due: nextFollowupDate, idByName, assignedByName: ownerName, sourceVisitId: visitId,
    });
  }
}
