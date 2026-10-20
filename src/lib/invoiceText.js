// Pure text → invoice-fields parsing, kept separate from the PDF reading (lib/invoiceParse.js) so it can be tested on
// its own. Built for Creliant's Zoho "TAX INVOICE" layout, with tolerance for the variants that broke it before:
// "Invoice #" / "Invoice No." labels, dd-mm-yyyy / dd.mm.yyyy / "15 Oct 2026" / "15-Oct-2026" dates, "Rs." / "INR"
// currency prefixes, amounts with or without paise.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const CUR = "(?:₹|\\$|Rs\\.?|INR|USD)?\\s*";
const AMOUNT_PAISE = `${CUR}([\\d,]+\\.\\d{2})`;          // 1,234.00 — the normal Zoho format, tried first
const AMOUNT_WHOLE = `${CUR}([\\d,]+(?:\\.\\d{1,2})?)`;   // 1,234 — fallback when there's no paise anywhere

function firstMatch(text, re) {
  const m = text.match(re);
  return m ? m[1] : null;
}
function parseAmount(s) {
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
const pad = (n) => String(n).padStart(2, "0");

// Any of: 31/08/2026, 31-08-2026, 31.08.2026, 31 Aug 2026, 31-Aug-2026, 31 August 2026 → "2026-08-31" (or "").
export function toIsoDate(raw) {
  if (!raw) return "";
  let m = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = raw.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-]+(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${pad(mon)}-${pad(m[1])}`;
  }
  return "";
}

// `joined` = every text item of the PDF joined with "|". Returns the fields plus `missing` (labels not found).
export function parseInvoiceText(joined) {
  // `cleaned` keeps single spaces between tokens (for "label: value" regexes); `flat` removes separators entirely
  // (for keyword detection, since a phrase like "Pro-Rated Invoice" can get split across adjacent text items).
  const cleaned = joined.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
  const flat = joined.replace(/\|/g, "");

  const invoiceNumber = firstMatch(cleaned, /Invoice\s*(?:Number|No\.?|#)\s*:?\s*#?\s*([A-Za-z0-9][A-Za-z0-9/_-]*\d[A-Za-z0-9/_-]*)/i);
  const dateRaw = firstMatch(cleaned, /Invoice\s*Date\s*:?\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{1,2}[\s-]+[A-Za-z]{3,9}[\s-]+\d{4})/i);
  const amountAfter = (label) =>
    parseAmount(firstMatch(cleaned, new RegExp(`${label}\\s*:?\\s*${AMOUNT_PAISE}`, "i")))
    ?? parseAmount(firstMatch(cleaned, new RegExp(`${label}\\s*:?\\s*${AMOUNT_WHOLE}`, "i")));
  const subTotal = amountAfter("Sub\\s*Total");
  // Negative lookbehind so this doesn't match the "Sub Total" line itself; "Total In Words" has no digits so it's skipped.
  const total = amountAfter("(?<!Sub\\s?)Total");

  const isProRata = /Pro-?Rated\s*Invoice/i.test(flat) || /Invoice\s*Period\s*-/i.test(flat);
  // Billing period — only the invoice's own "Invoice For …" line counts (words like "annual" can appear anywhere
  // else). Otherwise typeDetected=false and the upload form starts from the lab's own Payment Cycle.
  const period =
    /Invoice\s*For\s*((Twelve|12)\s*Months|One\s*Year)/i.test(flat) ? "Annual"
    : /Invoice\s*For\s*((Six|6)\s*Months|Half[\s-]*Year)/i.test(flat) ? "HalfYearly"
    : /Invoice\s*For\s*((Three|3)\s*Months|(One\s*)?Quarter)/i.test(flat) ? "Quarterly"
    : /Invoice\s*For\s*One\s*Month/i.test(flat) ? "Monthly"
    : null;
  const invoiceType = isProRata ? "ProRata" : period || "Monthly";
  const typeDetected = isProRata || !!period;

  const invoiceDate = toIsoDate(dateRaw);
  const missing = [];
  if (!invoiceNumber) missing.push("invoice number");
  if (!invoiceDate) missing.push("invoice date");
  if (subTotal == null) missing.push("sub total");
  if (total == null) missing.push("total");

  return {
    invoiceNumber: invoiceNumber || "", invoiceDate, subTotal, total, invoiceType, typeDetected,
    extractedOk: missing.length === 0, missing, textLength: cleaned.length,
  };
}
