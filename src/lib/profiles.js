import { supabase } from "../supabaseClient";

// Fetches the CSM roster. Returns { directory: [{id,name,role,linked}], idByName: {name: id} } —
// components mostly want directory; write functions (labs.js, plans.js) need idByName to
// translate a CSM's name (what the UI shows) into the profiles.id the database expects.
// `linked` is true once that roster row actually has a real Supabase Auth login attached
// (profiles.auth_user_id gets backfilled the moment ANY of that person's emails first signs
// in — see migrations/0006_identity_linking.sql) — a roster entry can exist (and show up
// everywhere else in the app) well before the person behind it has ever logged in.
export async function fetchProfiles() {
  const { data, error } = await supabase.from("profiles").select("id,name,role,auth_user_id,active").order("name");
  if (error) throw error;
  const idByName = {};
  const directory = data.map((p) => {
    idByName[p.name] = p.id;
    return { id: p.id, name: p.name, role: p.role, linked: !!p.auth_user_id, active: p.active !== false };
  });
  return { directory, idByName };
}

export async function upsertProfile({ id, name, role, active }) {
  const payload = { name, role };
  if (active !== undefined) payload.active = active;
  const { data, error } = id
    ? await supabase.from("profiles").update(payload).eq("id", id).select().single()
    : await supabase.from("profiles").insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function myProfileName(authUserId) {
  // Prefer the multi-email mapping (migrations/0006) — this is what makes a second
  // email (e.g. someone's @creliohealth.com alongside their @livehealth.in) resolve to
  // the same person. Falls back to the legacy single auth_user_id column so a profile's
  // original/primary login keeps working exactly as before even before that migration
  // has run, or for someone with only one email on file.
  const linked = await supabase
    .from("profile_auth_links")
    .select("profiles(name)")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (!linked.error && linked.data?.profiles?.name) return linked.data.profiles.name;

  const { data, error } = await supabase
    .from("profiles")
    .select("name")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error) throw error;
  return data ? data.name : null;
}
