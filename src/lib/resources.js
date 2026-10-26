import { supabase } from "../supabaseClient";

// Team-wide Resources (sidebar → Resources, migration 0038): common documents and training material that aren't
// tied to one module. Anyone signed in can read and add; the adder or a CSM Lead / Admin can edit/remove.
export const TEAM_RESOURCE_KINDS = ["Document", "Training", "Other"];
// Who a resource is useful for (migration 0041). "All" = both regions.
export const RESOURCE_REGIONS = ["All", "Domestic", "ROW"];
export const REGION_LABEL = { All: "All regions", Domestic: "Domestic", ROW: "ROW (Rest of the World)" };

function mapRow(r) {
  return { id: r.id, title: r.title, url: r.url, kind: r.kind, description: r.description || "", region: r.region || "All", addedBy: r.added_by, createdAt: r.created_at };
}

export async function fetchResources() {
  const { data, error } = await supabase.from("resources").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRow);
}

// addedBy must be the SIGNED-IN person's profile id (the database checks it).
export async function addResource({ title, url, kind, description, region }, addedBy) {
  const { error } = await supabase.from("resources").insert({
    title: title.trim(), url: url.trim(), kind: kind || "Document", description: description?.trim() || null,
    region: region || "All", added_by: addedBy || null,
  });
  if (error) throw error;
}

export async function updateResource(id, { title, url, kind, description, region }) {
  const { data, error } = await supabase.from("resources")
    .update({ title: title.trim(), url: url.trim(), kind, description: description?.trim() || null, region: region || "All" }).eq("id", id).select("id");
  if (error) throw error;
  if (!data || !data.length) throw new Error("Only the person who added this, or a CSM Lead / Admin, can change it.");
}

export async function deleteResource(id) {
  const { data, error } = await supabase.from("resources").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data || !data.length) throw new Error("Only the person who added this, or a CSM Lead / Admin, can remove it.");
}
