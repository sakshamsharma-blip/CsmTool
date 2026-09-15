// Client-side invoice PDF text extraction — no server function needed. CrelioHealth's own
// invoice template (Creliant Software Pvt Ltd "TAX INVOICE") is text-native, not scanned, so
// pdf.js's text layer is reliable here; this is not a general-purpose OCR solution.
//
// pdf.js emits text items in roughly drawing order, not always visual reading order (a value
// can appear before or after unrelated blocks) — but a label and the value right next to it on
// the invoice ("Invoice Number" / ": INV-123308") stay adjacent in the extracted stream, which
// is all these regexes rely on. Verified against two real sample invoices (one Monthly, one
// Pro-Rata) before wiring this in.
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function firstMatch(text, re) {
  const m = text.match(re);
  return m ? m[1] : null;
}
function parseAmount(s) {
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
// DD/MM/YYYY (as printed on the invoice) -> YYYY-MM-DD (what <input type="date"> and Postgres want).
function toIsoDate(ddmmyyyy) {
  const m = ddmmyyyy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export async function extractInvoiceFromFile(file) {
  const buf = await file.arrayBuffer();
  const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
  let joined = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    joined += content.items.map((it) => it.str).join("|") + "|";
  }
  // Two views of the same text: `cleaned` keeps single spaces between tokens (for "label: value"
  // regexes), `flat` removes separators entirely (for keyword detection, since a phrase like
  // "Pro-Rated Invoice" can get split across adjacent text items).
  const cleaned = joined.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
  const flat = joined.replace(/\|/g, "");

  const invoiceNumber = firstMatch(cleaned, /Invoice Number\s*:\s*(\S+)/i);
  const invoiceDateRaw = firstMatch(cleaned, /Invoice Date\s*:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const subTotal = parseAmount(firstMatch(cleaned, /Sub Total\s*[₹$]?\s*([\d,]+\.\d{2})/i));
  // Negative lookbehind so this doesn't match the "Sub Total" line itself.
  const total = parseAmount(firstMatch(cleaned, /(?<!Sub )Total\s*[₹$]?\s*([\d,]+\.\d{2})/i));

  const isProRata = /Pro-Rated Invoice/i.test(flat) || /Invoice Period\s*-/i.test(flat);
  const isMonthly = /Invoice For One Month/i.test(flat);
  const invoiceType = isProRata ? "ProRata" : isMonthly ? "Monthly" : "Monthly"; // default to Monthly when ambiguous — CSM confirms/corrects either way

  const invoiceDate = invoiceDateRaw ? toIsoDate(invoiceDateRaw) : "";
  const extractedOk = !!(invoiceNumber && invoiceDate && subTotal != null && total != null);

  return { invoiceNumber: invoiceNumber || "", invoiceDate, subTotal, total, invoiceType, extractedOk };
}
