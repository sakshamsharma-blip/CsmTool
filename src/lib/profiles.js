import { supabase } from "../supabaseClient";

// Fetches the CSM roster. Returns { directory: [{id,name,role}], idByName: {name: id} } —
// components mostly want directory; write functions (labs.js, plans.js) need idByName to
// translate a CSM's name (what the UI shows) into the profiles.id the database expects.
export async function fetchProfiles() {
  const { data, error } = await supabase.from("profiles").select("id,name,role").order("name");
  if (error) throw error;
  const idByName = {};
  data.forEach((p) => { idByName[p.name] = p.id; });
  return { directory: data, idByName };
}

export async function upsertProfile({ id, name, role }) {
  const { data, error } = id
    ? await supabase.from("profiles").update({ name, role }).eq("id", id).select().single()
    : await supabase.from("profiles").insert({ name, role }).select().single();
  if (error) throw error;
  return data;
}

export async function myProfileName(authUserId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("name")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error) throw error;
  return data ? data.name : null;
}
