import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";

export async function fetchAllVisits() {
  const { data, error } = await supabase
    .from("visits")
    .select("id,lab_id,csm_id,visit_type,visit_date,notes,next_followup_date,next_followup_reason,created_at")
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
    createdAt: r.created_at,
  }));
}

export async function addVisit({ labId, csmId, type, visitDate, notes, nextFollowupDate, nextFollowupReason }) {
  const { error } = await supabase.from("visits").insert({
    lab_id: labId,
    csm_id: csmId || null,
    visit_type: type,
    visit_date: visitDate,
    notes: notes || null,
    next_followup_date: nextFollowupDate || null,
    next_followup_reason: nextFollowupReason || null,
  });
  if (error) throw error;
  logActivity(labId, {
    kind: type,
    title: `${type} logged`,
    meta: notes || (nextFollowupDate ? `Next follow-up ${nextFollowupDate}${nextFollowupReason ? " — " + nextFollowupReason : ""}` : null),
    csmId,
  }).catch((err) => console.error(err));
}
