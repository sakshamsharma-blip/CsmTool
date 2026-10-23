import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";

// Feedback & NPS (migration 0038). Feedback = a 1–5 rating a CSM records for a lab (with an optional comment);
// Testimonials = video links per lab, labelled by the speaker's designation. Both follow the lab's visibility
// (a CSM sees their own labs, a Lead/Admin everyone's) and are logged to Lab History.
const mapFeedback = (r) => ({ id: r.id, labId: r.lab_id, rating: r.rating, comment: r.comment || "", date: r.feedback_date, createdBy: r.created_by, createdAt: r.created_at });
const mapTestimonial = (r) => ({ id: r.id, labId: r.lab_id, personName: r.person_name || "", designation: r.designation, videoUrl: r.video_url, note: r.note || "", createdBy: r.created_by, createdAt: r.created_at });

export async function fetchFeedback() {
  const { data, error } = await supabase.from("lab_feedback").select("*").order("feedback_date", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapFeedback);
}
export async function addFeedback({ labId, rating, comment, date }, csmId) {
  const { error } = await supabase.from("lab_feedback").insert({ lab_id: labId, rating, comment: comment?.trim() || null, feedback_date: date, created_by: csmId || null });
  if (error) throw error;
  logActivity(labId, { kind: "Feedback Recorded", title: `Feedback rating: ${rating}/5`, meta: comment?.trim() || null, csmId }).catch((err) => console.error(err));
}
export async function deleteFeedback(id) {
  const { error } = await supabase.from("lab_feedback").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchTestimonials() {
  const { data, error } = await supabase.from("lab_testimonials").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapTestimonial);
}
export async function addTestimonial({ labId, personName, designation, videoUrl, note }, csmId) {
  const { error } = await supabase.from("lab_testimonials").insert({
    lab_id: labId, person_name: personName?.trim() || null, designation: designation.trim(), video_url: videoUrl.trim(), note: note?.trim() || null, created_by: csmId || null,
  });
  if (error) throw error;
  logActivity(labId, { kind: "Testimonial Added", title: `Testimonial video added — ${designation.trim()}`, meta: personName?.trim() || null, csmId }).catch((err) => console.error(err));
}
export async function deleteTestimonial(id) {
  const { error } = await supabase.from("lab_testimonials").delete().eq("id", id);
  if (error) throw error;
}
