// Mirrors backend/models.go's occurrencesInRange exactly, so the app can
// materialize recurring income/expenses into dated occurrences even with no
// network connection. Dates are treated as UTC calendar dates throughout to
// avoid local-timezone drift, matching the Go side (which parses/formats in
// UTC too).

function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toISO(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function addMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function lastDayOfMonth(year, monthIndex) {
  // monthIndex is 0-based; day 0 of the next month = last day of this one.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function clampedDate(year, monthIndex, day) {
  const last = lastDayOfMonth(year, monthIndex);
  return new Date(Date.UTC(year, monthIndex, Math.min(day, last)));
}

function withinItemBounds(date, itemEnd) {
  if (!itemEnd) return true;
  return date.getTime() <= itemEnd.getTime();
}

/**
 * Expand a recurring item into concrete occurrence dates within [start, end]
 * (inclusive), matching the Go implementation's semantics precisely.
 * @param {{start_date: string, end_date?: string|null, frequency: string}} item
 * @param {Date} start
 * @param {Date} end
 * @returns {string[]} ISO date strings
 */
export function occurrencesInRange(item, start, end) {
  const out = [];
  let itemStart;
  try {
    itemStart = parseISO(item.start_date);
  } catch {
    return out;
  }
  if (Number.isNaN(itemStart.getTime())) return out;

  let itemEnd = null;
  if (item.end_date) {
    const t = parseISO(item.end_date);
    if (!Number.isNaN(t.getTime())) itemEnd = t;
  }

  if (item.frequency === "weekly" || item.frequency === "biweekly") {
    const step = item.frequency === "weekly" ? 7 : 14;
    let cursor = itemStart;
    while (cursor.getTime() <= end.getTime()) {
      if (cursor.getTime() >= start.getTime() && withinItemBounds(cursor, itemEnd)) {
        out.push(toISO(cursor));
      }
      if (itemEnd && cursor.getTime() > itemEnd.getTime()) break;
      cursor = addDays(cursor, step);
    }
  } else if (item.frequency === "monthly") {
    const day = itemStart.getUTCDate();
    let monthCursor = new Date(Date.UTC(itemStart.getUTCFullYear(), itemStart.getUTCMonth(), 1));
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const occDate = clampedDate(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth(), day);
      if (occDate.getTime() > end.getTime()) break;
      if (
        occDate.getTime() >= itemStart.getTime() &&
        occDate.getTime() >= start.getTime() &&
        withinItemBounds(occDate, itemEnd)
      ) {
        out.push(toISO(occDate));
      }
      monthCursor = addMonths(monthCursor, 1);
      if (itemEnd) {
        const nextClamped = clampedDate(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth(), day);
        if (monthCursor.getTime() > itemEnd.getTime() && nextClamped.getTime() > itemEnd.getTime()) break;
      }
      if (monthCursor.getUTCFullYear() > end.getUTCFullYear() + 1) break;
    }
  }

  return out;
}

export { parseISO, toISO };
