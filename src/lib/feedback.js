import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";

// Feedback & NPS (migrations 0038, 0039). The lab gives feedback offline — on a call or visit, through a Google
// Form, by email — and the CSM records each RESPONSE here manually so it can be reported on:
//   NPS score 0–10 and/or a 1–5 feedback rating (at least one), who gave it, the source, a comment and an optional
//   supporting link (form response, sheet, email…).
// Testimonials = video links per lab, labelled by the speaker's designation.
// Both follow the lab's visibility (a CSM sees their own labs, a Lead/Admin everyone's) and log to Lab History.
export const FEEDBACK_SOURCES = ["Call", "Visit", "Google Form", "Email", "WhatsApp", "Other"];

// Standard NPS buckets: 9–10 promoter, 7–8 passive, 0–6 detractor. NPS = % promoters − % detractors (−100…100).
export function npsBucket(score) {
  if (score == null) return null;
  return score >= 9 ? "Promoter" : score >= 7 ? "Passive" : "Detractor";
}
export function npsSummary(responses) {
  const scored = responses.filter((r) => r.npsScore != null);
  const promoters = scored.filter((r) => r.npsScore >= 9).length;
  const detractors = scored.filter((r) => r.npsScore <= 6).length;
  const rated = responses.filter((r) => r.rating != null);
  return {
    count: scored.length, promoters, passives: scored.length - promoters - detractors, detractors,
    nps: scored.length ? Math.round(((promoters - detractors) / scored.length) * 100) : null,
    avgRating: rated.length ? rated.reduce((s, r) => s + r.rating, 0) / rated.length : null,
    ratedCount: rated.length,
  };
}

const mapFeedback = (r) => ({
  id: r.id, labId: r.lab_id, rating: r.rating, npsScore: r.nps_score, comment: r.comment || "", date: r.feedback_date,
  source: r.source || "", respondentName: r.respondent_name || "", respondentDesignation: r.respondent_designation || "",
  linkUrl: r.link_url || "", createdBy: r.created_by, createdAt: r.created_at,
});
const mapTestimonial = (r) => ({ id: r.id, labId: r.lab_id, personName: r.person_name || "", designation: r.designation, videoUrl: r.video_url, note: r.note || "", createdBy: r.created_by, createdAt: r.created_at });

export async function fetchFeedback() {
  const { data, error } = await supabase.from("lab_feedback").select("*").order("feedback_date", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapFeedback);
}

function feedbackRow(f) {
  const n = (v) => (v === "" || v == null ? null : Number(v));
  return {
    lab_id: f.labId, feedback_date: f.date, nps_score: n(f.npsScore), rating: f.rating ? Number(f.rating) : null,
    source: f.source || null, respondent_name: f.respondentName?.trim() || null,
    respondent_designation: f.respondentDesignation?.trim() || null, comment: f.comment?.trim() || null,
    link_url: f.linkUrl?.trim() || null,
  };
}
function scoreText(f) {
  return [f.npsScore !== "" && f.npsScore != null ? `NPS ${f.npsScore}/10` : null, f.rating ? `rating ${f.rating}/5` : null].filter(Boolean).join(", ");
}

export async function addFeedback(f, csmId) {
  const { error } = await supabase.from("lab_feedback").insert({ ...feedbackRow(f), created_by: csmId || null });
  if (error) throw error;
  logActivity(f.labId, {
    kind: "Feedback Recorded", title: `Feedback recorded — ${scoreText(f)}`,
    meta: [f.respondentName?.trim(), f.source, f.comment?.trim()].filter(Boolean).join(" · ") || null, csmId,
  }).catch((err) => console.error(err));
}
export async function updateFeedback(id, f) {
  const { data, error } = await supabase.from("lab_feedback").update(feedbackRow(f)).eq("id", id).select("id");
  if (error) throw error;
  if (!data || !data.length) throw new Error("Nothing was saved — you may not have access to this lab.");
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
