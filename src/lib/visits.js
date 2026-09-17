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

// A plain "Log Visit" (from Visits & Meetings) passes just the base fields; the fuller
// "Log Check-in" screen passes the rest too — everything past nextFollowupReason is optional
// and simply lands as null/empty for a plain visit.
export async function addVisit({
  labId, csmId, type, visitDate, notes, nextFollowupDate, nextFollowupReason,
  durationMinutes, location, personName, personDesignation, discussionTopics,
  sentiment, flaggedModules, actionItems,
}) {
  const isCheckin = !!(personName || (discussionTopics && discussionTopics.length) || sentiment || (flaggedModules && flaggedModules.length));
  const { error } = await supabase.from("visits").insert({
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
  });
  if (error) throw error;
  logActivity(labId, {
    kind: type,
    title: isCheckin ? `${type} check-in logged` : `${type} logged`,
    meta: notes || (nextFollowupDate ? `Next follow-up ${nextFollowupDate}${nextFollowupReason ? " — " + nextFollowupReason : ""}` : null),
    csmId,
    source: isCheckin ? "checkin" : "system",
    details: isCheckin
      ? { personName, personDesignation, durationMinutes, location, discussionTopics, sentiment, flaggedModules, actionItems }
      : null,
  }).catch((err) => console.error(err));
}

// Edits an already-logged visit/check-in in place. Only the base fields shown on the
// Visits & Meetings screen are updatable here — the fuller check-in-only fields (person,
// discussion topics, etc.) aren't touched since this editor doesn't expose them.
export async function updateVisit(id, { type, visitDate, notes, nextFollowupDate, nextFollowupReason, sentiment }) {
  const { error } = await supabase.from("visits").update({
    visit_type: type,
    visit_date: visitDate,
    notes: notes || null,
    next_followup_date: nextFollowupDate || null,
    next_followup_reason: nextFollowupReason || null,
    sentiment: sentiment || null,
  }).eq("id", id);
  if (error) throw error;
}
