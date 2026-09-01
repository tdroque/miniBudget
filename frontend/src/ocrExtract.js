// Best-effort extraction of a single "total" figure from OCR'd receipt
// text. Deliberately narrow in scope (testing/reliability phase): find the
// total, show it, nothing else — no merchant/date parsing, no auto-fill,
// no "apply" action. The goal right now is to observe how often this is
// actually right before building anything on top of it.
//
// Two-pass design, tuned by testing against real Tesseract output rather
// than guessed:
//
//   1. EXACT pass — plain "total" (not "subtotal"), word-boundary match.
//      Runs first and wins if it finds anything, so a cleanly-OCR'd
//      receipt never risks a fuzzy false positive.
//   2. FUZZY pass — only runs if the exact pass found nothing anywhere in
//      the text. Matches tokens within edit-distance 2 of "total" (catches
//      real misreads like "torat", "totai", "toial") while excluding
//      anything that's a fuzzy match for "subtotal" instead. Distance 2 is
//      the minimum needed to catch "torat" specifically; distance 1 misses
//      it, and going any looser starts matching unrelated words like
//      "postal"/"portal" — see the exact-first design above for why that's
//      an acceptable tradeoff rather than a real risk: fuzzy matching only
//      ever activates on text where no clean "total" line exists at all.
//
// Amount parsing within a matched line also tries a "lenient" reading
// (treating O/o, I/l/i, S/s, B, Z/z as possible misread digits) before
// falling back to strict digits-only — needed because a garbled keyword
// often comes with a garbled amount right next to it (e.g. "toial $l2.32"
// should read as $12.32, not silently drop the leading digit). A
// letter-boundary guard keeps this from bleeding into an adjacent word
// with no space before a number.

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function isFuzzyWord(token, target, maxDist) {
  const t = token.toLowerCase();
  if (Math.abs(t.length - target.length) > maxDist) return false; // cheap reject before running DP
  return levenshtein(t, target) <= maxDist;
}

function tokenize(line) {
  return line.split(/[^a-zA-Z]+/).filter(Boolean);
}

const EXACT_TOTAL_RE = /\btotal\b/i;
const EXACT_SUBTOTAL_RE = /\bsub[\s-]?total\b/i;

function lineHasFuzzySubtotal(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (isFuzzyWord(tokens[i], "subtotal", 2)) return true;
    if (isFuzzyWord(tokens[i], "sub", 1) && i + 1 < tokens.length && isFuzzyWord(tokens[i + 1], "total", 2)) {
      return true;
    }
  }
  return false;
}

function lineHasFuzzyTotal(tokens) {
  return tokens.some((t) => isFuzzyWord(t, "total", 2));
}

// Strict: digits only. Superset (LENIENT below) also matches this exactly
// when there's nothing ambiguous nearby, so this mainly exists as a
// fallback for the rare case the lenient pattern doesn't fire.
const STRICT_AMOUNT_RE = /(\d+[.,]\d{2})(?!\d)/g;

// Lenient: allows common OCR digit misreads in place of actual digits.
// The (?<![a-zA-Z]) guard stops a match from starting right after a letter
// with no space — otherwise a word glued directly to a real number (e.g.
// "ITEMS16.86" with a dropped space) could get misread as starting inside
// the word itself.
const LENIENT_DIGIT_CLASS = "[0-9OoQIlIiSsBZz]";
const LENIENT_AMOUNT_RE = new RegExp(
  `(?<![a-zA-Z])(${LENIENT_DIGIT_CLASS}{1,3}[.,]${LENIENT_DIGIT_CLASS}{2})(?!${LENIENT_DIGIT_CLASS})`,
  "g"
);

function normalizeConfusableDigits(str) {
  return str
    .replace(/[OoQ]/g, "0")
    .replace(/[IlIi]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8")
    .replace(/[Zz]/g, "2");
}

function lastMatchValue(matches, normalize) {
  if (matches.length === 0) return null;
  const raw = matches[matches.length - 1][1];
  const cleaned = (normalize ? normalizeConfusableDigits(raw) : raw).replace(",", ".");
  const value = parseFloat(cleaned);
  return Number.isNaN(value) ? null : value;
}

function parseAmountFromLine(line) {
  const lenient = lastMatchValue([...line.matchAll(LENIENT_AMOUNT_RE)], true);
  if (lenient !== null) return lenient;
  return lastMatchValue([...line.matchAll(STRICT_AMOUNT_RE)], false);
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

  // Pass 1: exact match. Prefer the LAST qualifying line — receipts
  // conventionally list subtotal, then tax, then the grand total last.
  let exactCandidate = null;
  for (const line of lines) {
    if (!EXACT_TOTAL_RE.test(line)) continue;
    if (EXACT_SUBTOTAL_RE.test(line)) continue;
    const amount = parseAmountFromLine(line);
    if (amount !== null) exactCandidate = amount;
  }
  if (exactCandidate !== null) return exactCandidate;

  // Pass 2: fuzzy fallback, only reached when pass 1 found nothing at all.
  let fuzzyCandidate = null;
  for (const line of lines) {
    const tokens = tokenize(line);
    if (tokens.length === 0) continue;
    if (lineHasFuzzySubtotal(tokens)) continue;
    if (!lineHasFuzzyTotal(tokens)) continue;
    const amount = parseAmountFromLine(line);
    if (amount !== null) fuzzyCandidate = amount;
  }
  return fuzzyCandidate;
}
