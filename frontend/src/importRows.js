const VALID_TYPES = new Set(["income", "expense"]);
const VALID_FREQUENCIES = new Set(["weekly", "biweekly", "monthly"]);

/** Accepts YYYY-MM-DD or MM/DD/YYYY (the two formats spreadsheets actually
 * produce), and rejects impossible calendar dates (e.g. Feb 30). Returns an
 * ISO date string or null. */
function normalizeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let y, m, d;

  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else if ((match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
    m = Number(match[1]);
    d = Number(match[2]);
    y = Number(match[3]);
  } else {
    return null;
  }

  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null; // e.g. 2026-02-30 doesn't round-trip
  }
  const pad = (n) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Strips currency symbols/thousands separators; keeps the sign so type
 * can be inferred from it when the type column is blank. */
function normalizeAmount(raw) {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

/**
 * @param {Record<string,string>} row - lowercased-header-keyed CSV row
 * @param {number} rowNumber - 1-indexed spreadsheet row (for error messages)
 * @returns {{ok: true, kind: "transaction"|"recurring", payload: object} | {ok: false, row: number, reason: string}}
 */
export function validateImportRow(row, rowNumber) {
  const name = (row.name || "").trim();
  const category = (row.category || "").trim();
  const description = (row.description || "").trim();
  const kind = (row.kind || "").trim().toLowerCase() === "recurring" ? "recurring" : "transaction";
  const rawType = (row.type || "").trim().toLowerCase();

  if (!name) return { ok: false, row: rowNumber, reason: "missing name" };

  const amountVal = normalizeAmount(row.amount);
  if (amountVal === null) return { ok: false, row: rowNumber, reason: "missing or invalid amount" };

  if (!category) return { ok: false, row: rowNumber, reason: "missing category" };

  let type = rawType;
  if (!VALID_TYPES.has(type)) {
    // No usable type column — infer from the amount's sign, so a plain
    // bank/spreadsheet export (which usually has no income/expense column)
    // still imports instead of getting skipped entirely.
    if (amountVal < 0) type = "expense";
    else if (rawType === "") type = "income";
    else return { ok: false, row: rowNumber, reason: `invalid type "${row.type}" (must be income or expense)` };
  }
  const amount = Math.abs(amountVal);

  const dateRaw = row.date || row.start_date || "";
  const date = normalizeDate(dateRaw);
  if (!date) return { ok: false, row: rowNumber, reason: `missing or invalid date "${dateRaw}"` };

  if (kind === "recurring") {
    const frequency = (row.frequency || "").trim().toLowerCase();
    if (!VALID_FREQUENCIES.has(frequency)) {
      const shown = row.frequency ? `"${row.frequency}"` : "(missing)";
      return {
        ok: false,
        row: rowNumber,
        reason: `invalid frequency ${shown} (must be weekly, biweekly, or monthly)`,
      };
    }
    // An unparseable end date is non-critical — just treat it as "no end
    // date" rather than skipping the whole row over it.
    const endDateRaw = (row.end_date || "").trim();
    const endDate = endDateRaw ? normalizeDate(endDateRaw) : null;

    return {
      ok: true,
      kind: "recurring",
      payload: { name, amount, category, type, frequency, start_date: date, end_date: endDate, description },
    };
  }

  return {
    ok: true,
    kind: "transaction",
    payload: { name, amount, category, type, date, description },
  };
}
