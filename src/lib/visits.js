import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";

export async function fetchAllVisits() {
  const { data, error } = await supabase
    .from("visits")
    .select("id,lab_id,csm_id,visit_type,visit_date,notes,next_followup_date,next_followup_reason,duration_minutes,location,person_name,person_designation,discussion_topics,sentiment,flagged_modules,action_items,created_at")
    .order("visit_date", { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    labId: r.lab_id,
    csmId: r.csm_id,
    type: r.visit_type,
    visitDate: r.visit_date,
    notes: r.notes || "",
    nextFollowupDate: r.next_followup_date,
    nextFollowupReason: r.next_followup_reason || "",
    durationMinutes: r.duration_minutes,
    location: r.location || "",
    personName: r.person_name || "",
    personDesignation: r.person_designation || "",
    discussionTopics: r.discussion_topics || [],
    sentiment: r.sentiment || null,
    flaggedModules: r.flagged_modules || [],
    actionItems: r.action_items || [],
    createdAt: r.created_at,
  }));
}

export async function fetchVisitById(id) {
  const { data, error } = await supabase
    .from("visits")
    .select("id,lab_id,csm_id,visit_type,visit_date,notes,next_followup_date,next_followup_reason,duration_minutes,location,person_name,person_designation,discussion_topics,sentiment,flagged_modules,action_items,created_at")
    .eq("id", id)
    .single();
  if (error) throw error;
  return {
    id: data.id, labId: data.lab_id, csmId: data.csm_id, type: data.visit_type, visitDate: data.visit_date,
    notes: data.notes || "", nextFollowupDate: data.next_followup_date, nextFollowupReason: data.next_followup_reason || "",
    durationMinutes: data.duration_minutes, location: data.location || "", personName: data.person_name || "",
    personDesignation: data.person_designation || "", discussionTopics: data.discussion_topics || [],
    sentiment: data.sentiment || null, flaggedModules: data.flagged_modules || [], actionItems: data.action_items || [],
    createdAt: data.created_at,
  };
}

// A plain "Log Visit" (from Visits & Meetings) passes just the base fields; the fuller
// "Log Check-in" screen passes the rest too — everything past nextFollowupReason is optional
// and simply lands as null/empty for a plain visit. Returns the new visit's id so a caller that
// creates a follow-up task right after can link it via sourceVisitId (lib/tasks.js), and so the
// Activity Timeline entry this writes can be opened later from Lab History for viewing/editing.
export async function addVisit({
  labId, csmId, type, visitDate, notes, nextFollowupDate, nextFollowupReason,
  durationMinutes, location, personName, personDesignation, discussionTopics,
  sentiment, flaggedModules, actionItems,
}) {
  const isCheckin = !!(personName || (discussionTopics && discussionTopics.length) || sentiment || (flaggedModules && flaggedModules.length));
  const { data, error } = await supabase.from("visits").insert({
    lab_id: labId,
    csm_id: csmId || null,
    visit_type: type,
    visit_date: visitDate,
    notes: notes || null,
    next_followup_date: nextFollowupDate || null,
    next_followup_reason: nextFollowupReason || null,
    duration_minutes: durationMinutes || null,
    location: location || null,
    person_name: personName || null,
    person_designation: personDesignation || null,
    discussion_topics: discussionTopics && discussionTopics.length ? discussionTopics : null,
    sentiment: sentiment || null,
    flagged_modules: flaggedModules && flaggedModules.length ? flaggedModules : null,
    action_items: actionItems && actionItems.length ? actionItems : null,
  }).select("id").single();
  if (error) throw error;
  const visitId = data.id;
  logActivity(labId, {
    kind: type,
    title: isCheckin ? `${type} check-in logged` : `${type} logged`,
    meta: notes || (nextFollowupDate ? `Next follow-up ${nextFollowupDate}${nextFollowupReason ? " — " + nextFollowupReason : ""}` : null),
    csmId,
    source: isCheckin ? "checkin" : "system",
    // visitId is always included (not just for check-ins) — it's what lets Lab History's
    // Activity Timeline open this specific visit's detail/edit view later.
    details: { visitId, ...(isCheckin ? { personName, personDesignation, durationMinutes, location, discussionTopics, sentiment, flaggedModules, actionItems } : {}) },
  }).catch((err) => console.error(err));
  return visitId;
}

// Edits an already-logged visit/check-in in place — covers every field the Visit Detail view
// (LabDetailView's Lab History tab) can show, not just the base subset the simpler Visits &
// Meetings list editor uses. Also best-effort refreshes the matching Activity Timeline entry's
// summary text so the list doesn't go stale next to the corrected record.
export async function updateVisit(id, {
  type, visitDate, notes, nextFollowupDate, nextFollowupReason, sentiment,
  durationMinutes, location, personName, personDesignation, discussionTopics, flaggedModules, actionItems,
}) {
  const patch = {
    visit_type: type,
    visit_date: visitDate,
    notes: notes || null,
    next_followup_date: nextFollowupDate || null,
    next_followup_reason: nextFollowupReason || null,
    sentiment: sentiment || null,
  };
  if (durationMinutes !== undefined) patch.duration_minutes = durationMinutes || null;
  if (location !== undefined) patch.location = location || null;
  if (personName !== undefined) patch.person_name = personName || null;
  if (personDesignation !== undefined) patch.person_designation = personDesignation || null;
  if (discussionTopics !== undefined) patch.discussion_topics = discussionTopics && discussionTopics.length ? discussionTopics : null;
  if (flaggedModules !== undefined) patch.flagged_modules = flaggedModules && flaggedModules.length ? flaggedModules : null;
  if (actionItems !== undefined) patch.action_items = actionItems && actionItems.length ? actionItems : null;

  const { error } = await supabase.from("visits").update(patch).eq("id", id);
  if (error) throw error;

  const isCheckin = !!(personName || (discussionTopics && discussionTopics.length) || sentiment || (flaggedModules && flaggedModules.length));
  supabase.from("activity_log")
    .update({
      title: isCheckin ? `${type} check-in logged` : `${type} logged`,
      meta: notes || (nextFollowupDate ? `Next follow-up ${nextFollowupDate}${nextFollowupReason ? " — " + nextFollowupReason : ""}` : null),
    })
    .filter("details->>visitId", "eq", id)
    .then(({ error: e2 }) => { if (e2) console.error(e2); });
}
