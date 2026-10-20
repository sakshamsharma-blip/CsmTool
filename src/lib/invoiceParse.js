// Client-side invoice PDF reading — no server function needed. CrelioHealth's own invoices (Creliant Software Pvt Ltd
// "TAX INVOICE", exported from Zoho) are text PDFs, so pdf.js's text layer is reliable here; this is not OCR. The
// field parsing itself lives in lib/invoiceText.js.
//
// It never throws: every outcome comes back with `problem` — a plain-English reason when something couldn't be read
// (password-protected, damaged, scanned/no text, or specific fields not found) — so the upload form can say WHY it's
// empty instead of a generic message.
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { parseInvoiceText } from "./invoiceText";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const EMPTY = { invoiceNumber: "", invoiceDate: "", subTotal: null, total: null, invoiceType: "Monthly", typeDetected: false, extractedOk: false };

export async function extractInvoiceFromFile(file) {
  let doc;
  try {
    const buf = await file.arrayBuffer();
    doc = await getDocument({ data: new Uint8Array(buf) }).promise;
  } catch (err) {
    console.error("Invoice PDF could not be opened:", err);
    const name = err && err.name;
    const problem = name === "PasswordException"
      ? "This PDF is password-protected, so it can't be read — download an unprotected copy from Zoho, or type the details in below."
      : name === "InvalidPDFException"
        ? "This file doesn't look like a valid PDF (it may be damaged or not fully downloaded) — re-download it, or type the details in below."
        : `This PDF couldn't be opened (${(err && err.message) || "unknown error"}) — try again, or type the details in below.`;
    return { ...EMPTY, problem };
  }

  let joined = "";
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      joined += content.items.map((it) => it.str).join("|") + "|";
    }
  } catch (err) {
    console.error("Invoice PDF text could not be read:", err);
    return { ...EMPTY, problem: "The text inside this PDF couldn't be read — type the details in below." };
  }

  const parsed = parseInvoiceText(joined);
  let problem = null;
  if (parsed.textLength < 20) {
    problem = "This PDF has no readable text — it's probably a scan or an image. Type the details in below (or download the original PDF from Zoho).";
  } else if (!parsed.extractedOk) {
    problem = `Couldn't find the ${parsed.missing.join(", ")} in this PDF — it may use a different layout. Please fill ${parsed.missing.length > 1 ? "them" : "it"} in below.`;
  }
  return { ...parsed, problem };
}
