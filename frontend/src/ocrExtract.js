// Best-effort extraction of a single "total" figure from OCR'd receipt
// text. This is deliberately narrow in scope (testing/reliability phase):
// find the total, show it, nothing else — no merchant/date parsing, no
// auto-fill, no "apply" action. The goal right now is to observe how often
// this is actually right before building anything on top of it.

const TOTAL_LINE_RE = /\btotal\b/i;
const SUBTOTAL_RE = /\bsub[\s-]?total\b/i;
// Matches a trailing price-like number on a line: 1-3 digits of dollars,
// a '.' or ',' decimal separator, exactly 2 digits of cents. Deliberately
// doesn't try to handle thousands separators — not a realistic concern for
// a personal receipt total, and handling both "1,234.56" and "1.234,56"
// unambiguously isn't possible without knowing the receipt's locale.
const AMOUNT_RE = /(\d+[.,]\d{2})(?!\d)/g;

function parseAmountFromLine(line) {
  const matches = [...line.matchAll(AMOUNT_RE)];
  if (matches.length === 0) return null;
  // If a line has more than one number, the amount is the rightmost one
  // (e.g. a quantity or item code earlier in the line, price at the end).
  const last = matches[matches.length - 1][1].replace(",", ".");
  const value = parseFloat(last);
  return Number.isNaN(value) ? null : value;
}

/**
 * @param {string|null|undefined} text - raw OCR text (transaction.ocr_text)
 * @returns {number|null} the detected total, or null if nothing looked like one
 */
export function extractTotalFromOCRText(text) {
  if (!text) return null;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Prefer the LAST line that says "total" (but not "subtotal") — receipts
  // conventionally list subtotal, then tax, then the grand total last, so
  // scanning top-to-bottom and keeping overwriting the candidate naturally
  // lands on the real total rather than an earlier "total" mention.
  let candidate = null;
  for (const line of lines) {
    if (!TOTAL_LINE_RE.test(line)) continue;
    if (SUBTOTAL_RE.test(line)) continue;
    const amount = parseAmountFromLine(line);
    if (amount !== null) candidate = amount;
  }
  return candidate;
}
