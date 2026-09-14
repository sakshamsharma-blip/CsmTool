import { supabase } from "../supabaseClient";

export const ACTIVITY_ICONS = {
  "Lab Created": "🏷️",
  "Lab Reassigned": "🔁",
  "Plan Changed": "💳",
  "Adoption Updated": "📈",
  "Collections Update": "💰",
  "Collections Reminder": "🔔",
  "Task Added": "✅",
  Visit: "🧑‍💼",
  Call: "📞",
  Email: "✉️",
  WhatsApp: "💬",
  Note: "📝",
};

export async function fetchLabActivity(labId) {
  const { data, error } = await supabase
    .from("activity_log")
    .select("id,source,kind,title,meta,details,csm_id,created_at")
    .eq("lab_id", labId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Best-effort, fire-and-forget from callers — logging an event should never block or fail the action
// that triggered it (adding a lab, reassigning a CSM, etc). `details` is the structured jsonb payload
// Log Check-in fills in (discussion topics, sentiment, flagged modules, action items, …) — every other
// caller leaves it null and the Activity Timeline just shows `meta`.
export async function logActivity(labId, { kind, title, meta, csmId, source = "system", details = null }) {
  const { error } = await supabase.from("activity_log").insert({
    lab_id: labId,
    source,
    kind,
    title,
    meta: meta || null,
    details,
    csm_id: csmId || null,
  });
  if (error) throw error;
}
