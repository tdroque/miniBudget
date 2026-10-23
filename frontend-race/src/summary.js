// Pure helpers that turn the raw snapshot into what each tab shows. Kept
// separate (and free of React) so the same maths works online and offline.

export function scopedRaces(data, scope) {
  return scope === "all" ? data.races : data.races.filter((r) => String(r.id) === scope);
}

export function buildView(data, scope) {
  const races = scopedRaces(data, scope);
  const ids = new Set(races.map((r) => r.id));
  const costs = data.costs.filter((c) => ids.has(c.race_id));
  const limits = data.limits.filter((l) => ids.has(l.race_id));

  let paid = 0;
  let planned = 0;
  const cat = new Map();
  for (const c of costs) {
    if (c.status === "paid") paid += c.amount;
    else planned += c.amount;
    cat.set(c.category, (cat.get(c.category) || 0) + c.amount);
  }
  const byCategory = [...cat.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  const budget = races.reduce((sum, r) => sum + (Number(r.budget) || 0), 0);

  return { races, costs, limits, paid, planned, committed: paid + planned, budget, byCategory, spentByCategory: cat };
}

/** Planning order: dated costs first (earliest first), undated last. */
export function sortCosts(costs) {
  return [...costs].sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (!a.date !== !b.date) return a.date ? -1 : 1;
    return a.id - b.id;
  });
}

export function daysUntil(isoDate) {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 864e5);
}

export function toneFor(ratio) {
  if (ratio > 1) return "over";
  if (ratio > 0.8) return "warn";
  return "ok";
}
