import { supabase } from "../supabaseClient";
import { logActivity } from "./activity";
import { updateLabMRR } from "./labs";
import { nativeCurrency } from "./format";
import { dueDateFor, addDaysISO } from "./dates";

// ---- billing periods (Oct 2026) ----
// Recurring invoices can cover 1, 3, 6 or 12 months. MRR from a recurring invoice = sub total ÷ its months, and it
// covers that many months from its invoice date. ProRata is a one-off top-up (no period; added to MRR).
export const INVOICE_TYPES = [
  { value: "Monthly", label: "Monthly", months: 1 },
  { value: "Quarterly", label: "Quarterly (3 months)", months: 3 },
  { value: "HalfYearly", label: "Half-yearly (6 months)", months: 6 },
  { value: "Annual", label: "Annual (12 months)", months: 12 },
  { value: "ProRata", label: "Pro-Rata (one-off top-up)", months: null },
];
export function invoiceMonths(type) {
  return INVOICE_TYPES.find((t) => t.value === type)?.months ?? null;
}
export function isRecurringInvoice(type) {
  return invoiceMonths(type) != null;
}
export function invoiceTypeLabel(type) {
  return { Monthly: "Monthly", Quarterly: "Quarterly", HalfYearly: "Half-yearly", Annual: "Annual", ProRata: "Pro-Rata" }[type] || type;
}
// What a recurring invoice is worth per month (2 decimals). ProRata → null.
export function monthlyEquivalent(type, subTotal) {
  const m = invoiceMonths(type);
  return m ? Math.round(((Number(subTotal) || 0) / m) * 100) / 100 : null;
}
// Last day a recurring invoice covers: invoice date + its months − 1 day (Oct 1, half-yearly → Mar 31).
export function coveredUntil(type, invoiceDate) {
  const m = invoiceMonths(type);
  if (!m || !invoiceDate) return null;
  // Same day-of-month m months later (clamped to that month's last day, so Jan 31 + 1 month = Feb 28), minus a day.
  const [y, mo, day] = invoiceDate.split("-").map(Number);
  const targetMonthIndex = mo - 1 + m;                       // 0-based, may run past December
  const ty = y + Math.floor(targetMonthIndex / 12);
  const tm = (targetMonthIndex % 12) + 1;
  const lastDay = new Date(ty, tm, 0).getDate();
  const iso = `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
  return addDaysISO(iso, -1);
}
// The lab's billing cycle (Lab Details → Payment Cycle) → the matching recurring invoice type.
export function invoiceTypeForCycle(paymentCycle) {
  return { Monthly: "Monthly", Quarterly: "Quarterly", "Half Yearly": "HalfYearly", Annual: "Annual" }[paymentCycle] || "Monthly";
}

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
//  - Recurring (Monthly / Quarterly / Half-yearly / Annual) → MRR is SET to sub total ÷ its months
//    (a ₹60,000 half-yearly invoice → MRR ₹10,000), and it covers that many months;
//  - Pro-Rata → its sub_total is ADDED to the current MRR (e.g. an add-on billed mid-cycle), until the next
//    recurring invoice sets MRR again.
// Returns { id, newMrr }.
export async function saveInvoice({ lab, invoiceNumber, invoiceType, invoiceDate, subTotal, total, extractedOk, sourceFilename, csmId }) {
  const creditDays = lab.creditDays;
  const dueDate = dueDateFor(invoiceDate, creditDays);
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

  if (isRecurringInvoice(invoiceType)) {
    const previousMrr = Number(lab.mrr) || 0;
    const months = invoiceMonths(invoiceType);
    const newMrr = monthlyEquivalent(invoiceType, subTotal);
    const s$ = currency === "USD" ? "$" : "₹";
    await updateLabMRR(lab.id, newMrr, lab.region);
    await logActivity(lab.id, {
      kind: "Invoice Uploaded",
      title: `${invoiceTypeLabel(invoiceType)} invoice ${invoiceNumber} — MRR updated`,
      meta: `MRR set to ${s$}${newMrr.toLocaleString("en-IN")}${months > 1 ? ` (${s$}${subTotal.toLocaleString("en-IN")} ÷ ${months} months)` : ""} (was ${s$}${previousMrr.toLocaleString("en-IN")}); covers ${invoiceDate} to ${coveredUntil(invoiceType, invoiceDate)}; due ${dueDate}`,
      csmId,
    }).catch((err) => console.error(err));
    return { id: data.id, newMrr };
  }

  const sym = currency === "USD" ? "$" : "₹";
  const previousMrr = Number(lab.mrr) || 0;
  const newMrr = previousMrr + subTotal;
  await updateLabMRR(lab.id, newMrr, lab.region, "invoice");
  await logActivity(lab.id, {
    kind: "Invoice Uploaded",
    title: `Pro-Rata invoice ${invoiceNumber} — MRR increased`,
    meta: `MRR ${sym}${previousMrr.toLocaleString("en-IN")} → ${sym}${newMrr.toLocaleString("en-IN")} (+${sym}${subTotal.toLocaleString("en-IN")}), ${sym}${total.toLocaleString("en-IN")} due ${dueDate}. The next recurring invoice sets MRR again.`,
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
// What the invoices imply MRR should be: the newest recurring invoice's monthly equivalent (sub total ÷ months) plus
// every Pro-Rata sub_total dated after it (or, with no recurring invoice yet, all Pro-Rata sub_totals). Used only as a
// before/after DIFFERENCE when an invoice is edited or deleted, so the lab's MRR moves by exactly what the
// change implies — a manual MRR edit or a Lost-after-Purchase reduction made since is kept, not wiped.
export function invoiceImpliedMrr(invoices) {
  const byDate = invoices.slice().sort((a, b) => (a.invoiceDate || "").localeCompare(b.invoiceDate || ""));
  let lastMonthlyIdx = -1;
  byDate.forEach((iv, i) => { if (isRecurringInvoice(iv.invoiceType)) lastMonthlyIdx = i; });
  const base = lastMonthlyIdx >= 0 ? monthlyEquivalent(byDate[lastMonthlyIdx].invoiceType, byDate[lastMonthlyIdx].subTotal) : 0;
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
  const dueDate = dueDateFor(invoiceDate, lab.creditDays);
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
    meta: `${invoiceTypeLabel(invoiceType)}, ${invoiceDate}, sub total ${sym}${subTotal.toLocaleString("en-IN")}, total ${sym}${total.toLocaleString("en-IN")}, due ${dueDate}`,
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
    meta: `${invoiceTypeLabel(inv.invoiceType)} invoice dated ${inv.invoiceDate}${inv.collectedManual ? ` (had ${inv.collectedManual} collected against it)` : ""}`,
    csmId,
  }).catch((err) => console.error(err));
  const newMrr = await applyInvoiceMrrDelta(lab, before, after, csmId, `invoice ${inv.invoiceNumber} deleted`);
  return { newMrr };
}
