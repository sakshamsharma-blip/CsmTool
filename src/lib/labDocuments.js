import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";

// Lab → Documents tab (migration 0033): LINKS to a lab's documents kept elsewhere (Drive, etc.) — type, name, URL.
// Nothing is uploaded or stored here.
export const DOC_TYPES = ["Agreement / Contract", "Proposal / Quotation", "Purchase Order", "Invoice", "SOW", "KYC", "Training Material", "Other"];

function mapRow(r) {
  return { id: r.id, labId: r.lab_id, docType: r.doc_type, name: r.name, url: r.url, addedBy: r.added_by, createdAt: r.created_at };
}

export async function fetchLabDocuments(labId) {
  const { data, error } = await supabase.from("lab_documents").select("*").eq("lab_id", labId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRow);
}

export async function addLabDocument(labId, { docType, name, url }, csmId) {
  const { error } = await supabase.from("lab_documents").insert({ lab_id: labId, doc_type: docType, name: name.trim(), url: url.trim(), added_by: csmId || null });
  if (error) throw error;
  logActivity(labId, { kind: "Document Added", title: "Document link added", meta: `${docType}: ${name.trim()}`, csmId }).catch((err) => console.error(err));
}

export async function updateLabDocument(doc, { docType, name, url }, csmId) {
  const { error } = await supabase.from("lab_documents").update({ doc_type: docType, name: name.trim(), url: url.trim() }).eq("id", doc.id);
  if (error) throw error;
  logActivity(doc.labId, { kind: "Document Updated", title: "Document link updated", meta: `${docType}: ${name.trim()}`, csmId }).catch((err) => console.error(err));
}

export async function deleteLabDocument(doc, csmId) {
  const { error } = await supabase.from("lab_documents").delete().eq("id", doc.id);
  if (error) throw error;
  logActivity(doc.labId, { kind: "Document Removed", title: "Document link removed", meta: `${doc.docType}: ${doc.name}`, csmId }).catch((err) => console.error(err));
}
