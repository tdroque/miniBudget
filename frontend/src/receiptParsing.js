// Best-effort extraction of "the total" from raw OCR text. This is a
// reliability-testing feature: it's shown to the person as a plain line of
// text so they (and we) can see how often it's actually right across real
// receipts — it never fills in or suggests filling in the amount field.
// There's no confidence score or "apply" affordance on purpose.

const EXCLUDE_LINE = /sub\s*total|total\s*(savings|items?|discount|qty|quantity)/i;

// Checked in priority order — a receipt sometimes has several "total"-ish
// labels (subtotal, total tax, total savings, grand total...); the more
// specific labels are less ambiguous when present, so they're tried first.
const LABEL_PATTERNS = [/grand\s*total/i, /total\s*due/i, /amount\s*due/i, /balance\s*due/i, /\btotal\b/i];

// Matches amounts like "16.86", "$16.86", "1,234.56" — always requires
// exactly two decimal places, since that's what distinguishes a currency
// amount from an arbitrary OCR'd number (a quantity, a phone number digit
// run, etc.) in this kind of noisy text.
const AMOUNT_RE = /\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/;
const AMOUNT_RE_GLOBAL = new RegExp(AMOUNT_RE.source, "g");

function parseAmount(raw) {
  const n = parseFloat(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {string|null|undefined} text raw OCR text
 * @returns {number|null} best-guess total, or null if nothing usable was found
 */
export function guessTotalFromOCRText(text) {
  if (!text) return null;
  const lines = text.split(/\r?\n/);

  for (const labelPattern of LABEL_PATTERNS) {
    // Scan bottom-up: on a real receipt the final total is near the end,
    // below the line items and subtotal/tax breakdown.
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (EXCLUDE_LINE.test(line)) continue;
      if (!labelPattern.test(line)) continue;
      const match = line.match(AMOUNT_RE);
      if (match) {
        const amount = parseAmount(match[1]);
        if (amount !== null) return amount;
      }
    }
  }

  // No recognizable "total" label at all (common with a blurrier read, or
  // a receipt format that phrases it differently). Fall back to the
  // largest currency-shaped number anywhere in the text — on a typical
  // receipt the total is the largest single amount, since it's the sum of
  // everything else.
  const amounts = [];
  let m;
  AMOUNT_RE_GLOBAL.lastIndex = 0;
  while ((m = AMOUNT_RE_GLOBAL.exec(text)) !== null) {
    const amount = parseAmount(m[1]);
    if (amount !== null) amounts.push(amount);
  }
  if (amounts.length === 0) return null;
  return Math.max(...amounts);
}
