import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";
import { updateLabMRR } from "./labs";
import { nativeCurrency } from "./format";

export async function fetchInvoicesForLab(labId) {
  const { data, error } = await supabase
    .from("invoices")
    .select("id,lab_id,invoice_number,invoice_type,currency,invoice_date,due_date,sub_total,total,collected_manual,collected_at,extracted_ok,source_filename,csm_id,created_at")
    .eq("lab_id", labId)
    .order("invoice_date", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRow);
}

export async function fetchAllInvoices() {
  const { data, error } = await supabase
    .from("invoices")
    .select("id,lab_id,invoice_number,invoice_type,currency,invoice_date,due_date,sub_total,total,collected_manual,collected_at,extracted_ok,source_filename,csm_id,created_at")
    .order("invoice_date", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRow);
}

function mapRow(r) {
  return {
    id: r.id,
    labId: r.lab_id,
    invoiceNumber: r.invoice_number,
    invoiceType: r.invoice_type,
    currency: r.currency,
    invoiceDate: r.invoice_date,
    dueDate: r.due_date,
    subTotal: Number(r.sub_total) || 0,
    total: Number(r.total) || 0,
    collectedManual: Number(r.collected_manual) || 0,
    collectedAt: r.collected_at,
    extractedOk: r.extracted_ok,
    sourceFilename: r.source_filename,
    csmId: r.csm_id,
  };
}

export function invoiceBalance(inv) {
  return Math.max(0, (inv.total || 0) - (inv.collectedManual || 0));
}
export function isInvoiceOpen(inv) {
  return invoiceBalance(inv) > 0;
}
export function invoiceStatusLabel(inv) {
  if (!inv.collectedManual) return "Pending";
  return invoiceBalance(inv) > 0 ? "Partially Collected" : "Collected";
}

// Saves a confirmed/edited invoice. `lab` is the full lab record (needed for creditDays to
// compute the due date, and region to stamp the right currency). Monthly invoices additionally
// update the lab's live MRR to the invoice's sub_total and log that as its own activity entry —
// Pro-Rata invoices never touch MRR (the next Monthly invoice already carries the new run-rate).
export async function saveInvoice({ lab, invoiceNumber, invoiceType, invoiceDate, subTotal, total, extractedOk, sourceFilename, csmId }) {
  const creditDays = parseInt(lab.creditDays, 10) || 0;
  const dueDate = addDays(invoiceDate, creditDays);
  const currency = nativeCurrency(lab.region);

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      lab_id: lab.id,
      invoice_number: invoiceNumber,
      invoice_type: invoiceType,
      currency,
      invoice_date: invoiceDate,
      due_date: dueDate,
      sub_total: subTotal,
      total,
      extracted_ok: extractedOk,
      source_filename: sourceFilename || null,
      csm_id: csmId || null,
    })
    .select("id")
    .single();
  if (error) throw error;

  if (invoiceType === "Monthly") {
    const previousMrr = lab.mrr;
    await updateLabMRR(lab.id, subTotal, lab.region);
    await logActivity(lab.id, {
      kind: "Invoice Uploaded",
      title: `Monthly invoice ${invoiceNumber} — MRR updated`,
      meta: `MRR set to ${currency === "USD" ? "$" : "₹"}${subTotal.toLocaleString("en-IN")} (was ${currency === "USD" ? "$" : "₹"}${previousMrr.toLocaleString("en-IN")}), due ${dueDate}`,
      csmId,
    }).catch((err) => console.error(err));
  } else {
    await logActivity(lab.id, {
      kind: "Invoice Uploaded",
      title: `Pro-Rata invoice ${invoiceNumber} logged`,
      meta: `${currency === "USD" ? "$" : "₹"}${total.toLocaleString("en-IN")} due ${dueDate} — a one-off top-up, MRR unchanged until the next Monthly invoice`,
      csmId,
    }).catch((err) => console.error(err));
  }

  return data.id;
}

export async function updateInvoiceCollected(invoiceId, manualAmount, totalOwed, labId, csmId, invoiceNumber) {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("invoices")
    .update({ collected_manual: manualAmount, collected_at: nowIso })
    .eq("id", invoiceId);
  if (error) throw error;
  const fullyCollected = manualAmount >= totalOwed;
  logActivity(labId, {
    kind: "Collections Update",
    title: fullyCollected ? "Invoice marked fully collected" : "Payment logged against invoice",
    meta: `₹${Number(manualAmount).toLocaleString("en-IN")} collected so far against ${invoiceNumber}`,
    csmId,
  }).catch((err) => console.error(err));
  return fullyCollected ? "Collected" : "Partially Collected";
}

function addDays(isoDate, days) {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
