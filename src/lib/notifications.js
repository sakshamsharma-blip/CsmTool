import { supabase } from "../supabaseClient";

// Per-person reminder preferences (migration 0025). The daily sender is the `send-reminders` Edge Function;
// these settings only say who wants what — sending stays off until the Admin connects email / Slack.
export async function fetchMyNotificationPrefs(profileId) {
  const { data, error } = await supabase.from("notification_prefs").select("*").eq("profile_id", profileId).maybeSingle();
  if (error) throw error;
  return data || { profile_id: profileId, email_enabled: false, slack_enabled: false, email: "", slack_member_id: "" };
}

export async function saveNotificationPrefs({ profileId, emailEnabled, slackEnabled, email, slackMemberId }) {
  const { error } = await supabase.from("notification_prefs").upsert({
    profile_id: profileId,
    email_enabled: !!emailEnabled,
    slack_enabled: !!slackEnabled,
    email: (email || "").trim() || null,
    slack_member_id: (slackMemberId || "").trim() || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "profile_id" });
  if (error) throw error;
}
