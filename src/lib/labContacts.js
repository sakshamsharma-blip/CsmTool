import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";

// Points of contact (POCs) per lab — migration 0032. Managed on the lab page's Points of Contact tab; offered as a
// dropdown under "Person Contacted" in Log Check-in and "Given by" in Feedback & NPS.

// Designation choices (list replaced Oct 30 2026). Stored as plain text, so POCs saved with an older list keep their
// own wording until edited; "Other" lets someone type a designation that isn't listed.
export const POC_DESIGNATIONS = [
  "Owner / Founder / Managing Director",
  "Lab Director - Pathology",
  "Lab Director - Radiology",
  "IT Manager / System Administrator",
  "Signing Doctor - Pathology",
  "Signing Doctor - Radiology",
  "Laboratory Manager / Technical Manager",
  "Radiology Manager / Imaging Center Manager",
  "Front Office / Billing Supervisor",
  "Quality Manager",
  "Finance / Accounts Manager",
  "Inventory Manager",
];

// Every POC across the labs this person can see (one query) — used by Feedback & NPS.
export async function fetchAllLabContacts() {
  const { data, error } = await supabase.from("lab_contacts").select("*").order("name");
  if (error) throw error;
  return (data || []).map(mapRow);
}
function mapRow(r) {
  return {
    id: r.id, labId: r.lab_id, name: r.name, designation: r.designation || "", phone: r.phone || "", email: r.email || "", createdAt: r.created_at,
    // "Minimum Proactive Check-ins per Month" for this person (migration 0042); null = no target.
    minProactive: r.min_proactive_per_month != null ? Number(r.min_proactive_per_month) : null,
  };
}

export async function fetchLabContacts(labId) {
  const { data, error } = await supabase.from("lab_contacts").select("*").eq("lab_id", labId).order("name");
  if (error) throw error;
  return (data || []).map(mapRow);
}

// "" / null / undefined = no monthly target.
function minOrNull(v) {
  if (v === "" || v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function addLabContact(labId, { name, designation, phone, email, minProactive }, csmId) {
  const { data, error } = await supabase.from("lab_contacts").insert({
    lab_id: labId, name: name.trim(), designation: (designation || "").trim() || null,
    phone: (phone || "").trim() || null, email: (email || "").trim() || null, created_by: csmId || null,
    min_proactive_per_month: minOrNull(minProactive),
  }).select("*").single();
  if (error) throw error;
  logActivity(labId, { kind: "Contact Added", title: "Point of contact added", meta: `${name.trim()}${designation ? ` — ${designation.trim()}` : ""}`, csmId })
    .catch((err) => console.error(err));
  return mapRow(data);
}

export async function updateLabContact(contact, { name, designation, phone, email, minProactive }, csmId) {
  const { error } = await supabase.from("lab_contacts").update({
    name: name.trim(), designation: (designation || "").trim() || null,
    phone: (phone || "").trim() || null, email: (email || "").trim() || null,
    min_proactive_per_month: minOrNull(minProactive),
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

// ---- Monthly proactive check-in target (internal compliance) ----
// Done this month = this lab's Proactive check-ins dated in the current calendar month whose "Person Contacted" is
// this POC (matched by name, ignoring case). `month` is "YYYY-MM" (build it from todayISO(), never from a UTC date).
export function pocMonthStatus(contact, labVisits, month) {
  const required = contact.minProactive || 0;
  const name = contact.name.trim().toLowerCase();
  const done = (labVisits || []).filter((v) =>
    v.engagement === "Proactive" && (v.visitDate || "").slice(0, 7) === month && (v.personName || "").trim().toLowerCase() === name).length;
  return { required, done, left: Math.max(0, required - done), met: required > 0 && done >= required };
}

// Per CSM, across every POC that has a target: how many are on target this month, and the check-ins owed vs done
// (each POC's done is capped at its target so extra calls to one person don't hide a miss on another).
// `labs` gives each POC's CSM; returns rows sorted by CSM name.
export function pocCompliance(contacts, visits, labs, month) {
  const labById = {};
  labs.forEach((l) => { labById[l.id] = l; });
  const visitsByLab = {};
  (visits || []).forEach((v) => { (visitsByLab[v.labId] = visitsByLab[v.labId] || []).push(v); });
  const byCsm = {};
  contacts.filter((c) => c.minProactive > 0 && labById[c.labId]).forEach((c) => {
    const csm = labById[c.labId].csm || "Unassigned";
    const g = (byCsm[csm] = byCsm[csm] || { csm, pocs: 0, onTarget: 0, required: 0, done: 0 });
    const st = pocMonthStatus(c, visitsByLab[c.labId], month);
    g.pocs += 1; g.required += st.required; g.done += Math.min(st.done, st.required);
    if (st.met) g.onTarget += 1;
  });
  return Object.values(byCsm)
    .map((g) => ({ ...g, pct: g.required ? Math.round((g.done / g.required) * 100) : 100 }))
    .sort((a, b) => a.csm.localeCompare(b.csm));
}
