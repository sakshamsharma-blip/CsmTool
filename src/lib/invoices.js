import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";
import { updateLabMRR } from "./labs";
import { nativeCurrency } from "./format";
import { addDaysISO } from "./dates";

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

// Saves a confirmed invoice. `lab` is the full lab record (creditDays for the due date, region for the
// currency, mrr for the Pro-Rata step). MRR rule (Oct 2026):
//  - Monthly  → the lab's MRR is SET to the invoice's sub_total (the real billed run-rate);
//  - Pro-Rata → its sub_total is ADDED to the current MRR (e.g. an add-on billed mid-cycle), until the next
//               Monthly invoice sets MRR again.
// Returns { id, newMrr }.
export async function saveInvoice({ lab, invoiceNumber, invoiceType, invoiceDate, subTotal, total, extractedOk, sourceFilename, csmId }) {
  const creditDays = parseInt(lab.creditDays, 10) || 0;
  const dueDate = addDaysISO(invoiceDate, creditDays);
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
    const previousMrr = Number(lab.mrr) || 0;
    await updateLabMRR(lab.id, subTotal, lab.region);
    await logActivity(lab.id, {
      kind: "Invoice Uploaded",
      title: `Monthly invoice ${invoiceNumber} — MRR updated`,
      meta: `MRR set to ${currency === "USD" ? "$" : "₹"}${subTotal.toLocaleString("en-IN")} (was ${currency === "USD" ? "$" : "₹"}${previousMrr.toLocaleString("en-IN")}), due ${dueDate}`,
      csmId,
    }).catch((err) => console.error(err));
    return { id: data.id, newMrr: subTotal };
  }

  const sym = currency === "USD" ? "$" : "₹";
  const previousMrr = Number(lab.mrr) || 0;
  const newMrr = previousMrr + subTotal;
  await updateLabMRR(lab.id, newMrr, lab.region, "invoice");
  await logActivity(lab.id, {
    kind: "Invoice Uploaded",
    title: `Pro-Rata invoice ${invoiceNumber} — MRR increased`,
    meta: `MRR ${sym}${previousMrr.toLocaleString("en-IN")} → ${sym}${newMrr.toLocaleString("en-IN")} (+${sym}${subTotal.toLocaleString("en-IN")}), ${sym}${total.toLocaleString("en-IN")} due ${dueDate}. The next Monthly invoice sets MRR again.`,
    csmId,
  }).catch((err) => console.error(err));
  return { id: data.id, newMrr };
}

export async function updateInvoiceCollected(invoiceId, manualAmount, totalOwed, labId, csmId, invoiceNumber, region) {
  const nowIso = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("invoices")
    .update({ collected_manual: manualAmount, collected_at: nowIso })
    .eq("id", invoiceId)
    .select("id");
  if (error) throw error;
  // Row Level Security can make an UPDATE match zero rows without raising any error — the call "succeeds"
  // but nothing is saved. Treat that as a failure so the person sees it instead of a silent no-op.
  if (!updated || updated.length === 0) {
    throw new Error("The payment wasn't saved — this invoice couldn't be updated (you may not have access to this lab). Nothing changed.");
  }
  const fullyCollected = manualAmount >= totalOwed;
  logActivity(labId, {
    kind: "Collections Update",
    title: fullyCollected ? "Invoice marked fully collected" : "Payment logged against invoice",
    meta: `${region === "ROW" ? "$" : "₹"}${Number(manualAmount).toLocaleString("en-IN")} collected so far against ${invoiceNumber}`,
    csmId,
  }).catch((err) => console.error(err));
  return fullyCollected ? "Collected" : "Partially Collected";
}

// ---- editing / deleting an invoice ----
//
// What the invoices imply MRR should be: the newest Monthly invoice's sub_total plus every Pro-Rata
// sub_total dated after it (or, with no Monthly invoice yet, all Pro-Rata sub_totals). Used only as a
// before/after DIFFERENCE when an invoice is edited or deleted, so the lab's MRR moves by exactly what the
// change implies — a manual MRR edit or a Lost-after-Purchase reduction made since is kept, not wiped.
export function invoiceImpliedMrr(invoices) {
  const byDate = invoices.slice().sort((a, b) => (a.invoiceDate || "").localeCompare(b.invoiceDate || ""));
  let lastMonthlyIdx = -1;
  byDate.forEach((iv, i) => { if (iv.invoiceType === "Monthly") lastMonthlyIdx = i; });
  const base = lastMonthlyIdx >= 0 ? byDate[lastMonthlyIdx].subTotal : 0;
  return base + byDate.slice(lastMonthlyIdx + 1).filter((iv) => iv.invoiceType === "ProRata").reduce((s, iv) => s + iv.subTotal, 0);
}

async function applyInvoiceMrrDelta(lab, before, after, csmId, why) {
  const delta = Math.round((after - before) * 100) / 100;
  if (!delta) return Number(lab.mrr) || 0;
  const previousMrr = Number(lab.mrr) || 0;
  const newMrr = Math.max(0, previousMrr + delta);
  await updateLabMRR(lab.id, newMrr, lab.region, "invoice");
  const sym = lab.region === "ROW" ? "$" : "₹";
  await logActivity(lab.id, {
    kind: "MRR Updated",
    title: `MRR set to ${sym}${newMrr.toLocaleString("en-IN")}`,
    meta: `${delta > 0 ? "+" : "−"}${sym}${Math.abs(delta).toLocaleString("en-IN")} — ${why}`,
    csmId,
  }).catch((err) => console.error(err));
  return newMrr;
}

// Edits an invoice's number / type / date / amounts (due date is recomputed from the new date + credit
// days). `labInvoices` = this lab's current invoices (to work out the MRR effect). Returns { newMrr }.
export async function updateInvoice(inv, { invoiceNumber, invoiceType, invoiceDate, subTotal, total }, lab, labInvoices, csmId) {
  const dueDate = addDaysISO(invoiceDate, parseInt(lab.creditDays, 10) || 0);
  const { data: updated, error } = await supabase.from("invoices").update({
    invoice_number: invoiceNumber, invoice_type: invoiceType, invoice_date: invoiceDate, due_date: dueDate,
    sub_total: subTotal, total,
  }).eq("id", inv.id).select("id");
  if (error) throw error;
  if (!updated || !updated.length) throw new Error("The invoice wasn't updated — you may not have access to this lab.");
  const before = invoiceImpliedMrr(labInvoices);
  const after = invoiceImpliedMrr(labInvoices.map((iv) => (iv.id === inv.id ? { ...iv, invoiceType, invoiceDate, subTotal } : iv)));
  const sym = lab.region === "ROW" ? "$" : "₹";
  await logActivity(lab.id, {
    kind: "Invoice Uploaded",
    title: `Invoice ${invoiceNumber} edited`,
    meta: `${invoiceType === "Monthly" ? "Monthly" : "Pro-Rata"}, ${invoiceDate}, sub total ${sym}${subTotal.toLocaleString("en-IN")}, total ${sym}${total.toLocaleString("en-IN")}, due ${dueDate}`,
    csmId,
  }).catch((err) => console.error(err));
  const newMrr = await applyInvoiceMrrDelta(lab, before, after, csmId, `invoice ${invoiceNumber} edited`);
  return { newMrr };
}

// Deletes an invoice (and any payment recorded against it). Returns { newMrr }.
export async function deleteInvoice(inv, lab, labInvoices, csmId) {
  const { data: deleted, error } = await supabase.from("invoices").delete().eq("id", inv.id).select("id");
  if (error) throw error;
  if (!deleted || !deleted.length) throw new Error("The invoice wasn't deleted — you may not have access to this lab.");
  const before = invoiceImpliedMrr(labInvoices);
  const after = invoiceImpliedMrr(labInvoices.filter((iv) => iv.id !== inv.id));
  await logActivity(lab.id, {
    kind: "Invoice Uploaded",
    title: `Invoice ${inv.invoiceNumber} deleted`,
    meta: `${inv.invoiceType === "Monthly" ? "Monthly" : "Pro-Rata"} invoice dated ${inv.invoiceDate}${inv.collectedManual ? ` (had ${inv.collectedManual} collected against it)` : ""}`,
    csmId,
  }).catch((err) => console.error(err));
  const newMrr = await applyInvoiceMrrDelta(lab, before, after, csmId, `invoice ${inv.invoiceNumber} deleted`);
  return { newMrr };
}
