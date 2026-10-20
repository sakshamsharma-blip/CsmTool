import { supabase } from "../supabaseClient";

// Documentation / training-video links per MODULE (migration 0036) — shared by everyone: added from the Adoption
// Template or any lab's Adoption tab, shown on every lab for that module.
export const RESOURCE_KINDS = ["Documentation", "Training Video", "Other"];

function mapRow(r) {
  return { id: r.id, moduleKey: r.module_key, title: r.title, url: r.url, kind: r.kind, addedBy: r.added_by, createdAt: r.created_at };
}

export async function fetchModuleResources() {
  const { data, error } = await supabase.from("module_resources").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(mapRow);
}

// addedBy must be the SIGNED-IN person's profile id (the database checks it), not whoever an Admin is previewing.
export async function addModuleResource({ moduleKey, title, url, kind }, addedBy) {
  const { error } = await supabase.from("module_resources").insert({
    module_key: moduleKey, title: title.trim(), url: url.trim(), kind: kind || "Documentation", added_by: addedBy || null,
  });
  if (error) throw error;
}

export async function updateModuleResource(id, { title, url, kind }) {
  const { data, error } = await supabase.from("module_resources").update({ title: title.trim(), url: url.trim(), kind }).eq("id", id).select("id");
  if (error) throw error;
  if (!data || !data.length) throw new Error("Only the person who added this link, or a CSM Lead / Admin, can change it.");
}

export async function deleteModuleResource(id) {
  const { data, error } = await supabase.from("module_resources").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data || !data.length) throw new Error("Only the person who added this link, or a CSM Lead / Admin, can remove it.");
}
