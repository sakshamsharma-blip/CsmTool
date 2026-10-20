import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";

// Points of contact (POCs) per lab — migration 0032. Managed on Lab Details; offered as a dropdown under
// "Person Contacted" in Log Check-in.
function mapRow(r) {
  return { id: r.id, labId: r.lab_id, name: r.name, designation: r.designation || "", phone: r.phone || "", email: r.email || "", createdAt: r.created_at };
}

export async function fetchLabContacts(labId) {
  const { data, error } = await supabase.from("lab_contacts").select("*").eq("lab_id", labId).order("name");
  if (error) throw error;
  return (data || []).map(mapRow);
}

export async function addLabContact(labId, { name, designation, phone, email }, csmId) {
  const { data, error } = await supabase.from("lab_contacts").insert({
    lab_id: labId, name: name.trim(), designation: (designation || "").trim() || null,
    phone: (phone || "").trim() || null, email: (email || "").trim() || null, created_by: csmId || null,
  }).select("*").single();
  if (error) throw error;
  logActivity(labId, { kind: "Contact Added", title: "Point of contact added", meta: `${name.trim()}${designation ? ` — ${designation.trim()}` : ""}`, csmId })
    .catch((err) => console.error(err));
  return mapRow(data);
}

export async function updateLabContact(contact, { name, designation, phone, email }, csmId) {
  const { error } = await supabase.from("lab_contacts").update({
    name: name.trim(), designation: (designation || "").trim() || null,
    phone: (phone || "").trim() || null, email: (email || "").trim() || null,
  }).eq("id", contact.id);
  if (error) throw error;
  logActivity(contact.labId, { kind: "Contact Updated", title: "Point of contact updated", meta: `${name.trim()}${designation ? ` — ${designation.trim()}` : ""}`, csmId })
    .catch((err) => console.error(err));
}

export async function deleteLabContact(contact, csmId) {
  const { error } = await supabase.from("lab_contacts").delete().eq("id", contact.id);
  if (error) throw error;
  logActivity(contact.labId, { kind: "Contact Removed", title: "Point of contact removed", meta: contact.name, csmId })
    .catch((err) => console.error(err));
}
