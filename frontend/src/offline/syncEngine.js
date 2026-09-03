// Offline-first data layer.
//
// The three "resource" stores (transactions, recurring, categories) always
// hold the latest state the app knows about — server-confirmed data, with
// any not-yet-synced local edits applied directly on top. Reading them is
// always just "read the store"; there's no separate overlay step.
//
// The "queue" store holds pending mutations in the order they happened.
// When connectivity returns, flushQueue() replays them against the real
// API, one at a time, reconciling temporary (offline-created) IDs with the
// real IDs the server assigns.
//
// Not covered: receipt photo uploads. Queuing a file upload (and reconciling
// it against a possibly-still-temporary transaction id) adds a lot of
// complexity for a feature that's already optional; receipts simply require
// a live connection, and the UI says so.

import { API_BASE } from "../config.js";
import { getAll, get, put, del, replaceAll } from "./db.js";
import { occurrencesInRange, parseISO } from "./recurrence.js";
import { effectiveOnline } from "./preferences.js";

const RESOURCE_PATH = {
  transactions: "/transactions",
  recurring: "/recurring",
  categories: "/categories",
  budgets: "/budgets",
};

let nextTempId = -1;
function newTempId() {
  return nextTempId--;
}

const listeners = new Set();
function notify() {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      /* listener errors shouldn't break sync */
    }
  });
}
export function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function isNetworkError(err) {
  if (!effectiveOnline()) return true;
  return err instanceof TypeError;
}

async function rawJSON(path, options) {
  if (!effectiveOnline()) {
    throw new TypeError("Offline — not attempting a network request");
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------- Bootstrap: pull the full dataset for offline caching ----------

export async function bootstrap() {
  const snapshot = await rawJSON("/sync");
  await Promise.all([
    replaceAll("transactions", snapshot.transactions),
    replaceAll("recurring", snapshot.recurring),
    replaceAll("categories", snapshot.categories),
    replaceAll("budgets", snapshot.budgets || []),
  ]);
  notify();
  return snapshot;
}

/**
 * Actively pings the backend, distinct from navigator.onLine (which only
 * reflects whether the device has *some* network — the backend could still
 * be down, unreachable, or blocked). Returns one of:
 *   "offline"       — forced offline mode or the device reports no network
 *   "reachable"      — the server responded successfully
 *   "unreachable"    — the request never got a response (DNS, timeout, CORS)
 *   "server-error"   — got a response, but it wasn't a healthy one
 */
export async function checkServerReachable() {
  if (!effectiveOnline()) return "offline";
  try {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 5000) : null;
    const res = await fetch(`${API_BASE}/health`, { cache: "no-store", signal: controller?.signal });
    if (timeout) clearTimeout(timeout);
    return res.ok ? "reachable" : "server-error";
  } catch {
    return "unreachable";
  }
}

export async function getCachedSnapshot() {
  const [transactions, recurring] = await Promise.all([getAll("transactions"), getAll("recurring")]);
  return { transactions, recurring };
}

export async function getFailedOps() {
  const failures = await getAll("failures");
  return failures.sort((a, b) => (a.failedAt < b.failedAt ? 1 : -1));
}

export async function clearFailedOps() {
  const failures = await getAll("failures");
  await Promise.all(failures.map((f) => del("failures", f.id)));
  notify();
}

// ---------- Write-through cache helpers (called on successful online calls) ----------

export async function cacheUpsert(resource, item) {
  await put(resource, item);
  notify();
}

export async function cacheRemove(resource, id) {
  await del(resource, id);
  notify();
}

export async function cacheReplaceAll(resource, items) {
  await replaceAll(resource, items);
  notify();
}

// ---------- Offline mutation queue ----------

async function enqueue(entry) {
  await put("queue", { ...entry, createdAt: new Date().toISOString() });
  notify();
}

export async function getPendingCount() {
  const queue = await getAll("queue");
  return queue.length;
}

export async function getQueue() {
  return getAll("queue");
}

/**
 * Apply a create optimistically and queue it for sync.
 * Returns the optimistic record (with a temporary negative id).
 */
export async function createOffline(resource, body) {
  const tempId = newTempId();
  const optimistic = { ...body, id: tempId, _pending: true };
  await put(resource, optimistic);
  await enqueue({ resource, method: "POST", targetId: tempId, tempId, body });
  return optimistic;
}

/**
 * Apply an update optimistically and queue it for sync. If the target is
 * still an unsynced offline-created record (negative id), merge into that
 * pending create instead of adding a second queue entry.
 */
export async function updateOffline(resource, id, body) {
  const queue = await getAll("queue");
  const pendingCreate =
    id < 0 ? queue.find((q) => q.resource === resource && q.tempId === id && q.method === "POST") : null;

  const merged = { ...body, id };
  await put(resource, { ...merged, _pending: true });

  if (pendingCreate) {
    await put("queue", { ...pendingCreate, body: { ...pendingCreate.body, ...body } });
  } else {
    await enqueue({ resource, method: "PUT", targetId: id, tempId: null, body });
  }
  notify();
  return merged;
}

/**
 * Apply a delete optimistically and queue it for sync. If the target was
 * never synced (negative id), just cancel its pending create instead.
 */
export async function deleteOffline(resource, id) {
  const queue = await getAll("queue");
  if (id < 0) {
    const pendingCreate = queue.find((q) => q.resource === resource && q.tempId === id && q.method === "POST");
    if (pendingCreate) {
      await del("queue", pendingCreate.queueId);
    }
  } else {
    await enqueue({ resource, method: "DELETE", targetId: id, tempId: null, body: null });
  }
  await del(resource, id);
  notify();
}

// ---------- Flushing the queue against the real API ----------

let flushing = false;
let lastConnectionError = null;

export function getLastConnectionError() {
  return lastConnectionError;
}

export function clearLastConnectionError() {
  lastConnectionError = null;
  notify();
}

export async function flushQueue() {
  if (flushing) return;
  if (!effectiveOnline()) return;
  flushing = true;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const queue = await getQueue();
      if (queue.length === 0) break;
      const entry = queue.sort((a, b) => a.queueId - b.queueId)[0];

      let result;
      try {
        const path = RESOURCE_PATH[entry.resource];
        if (entry.method === "POST") {
          result = await rawJSON(path, { method: "POST", body: JSON.stringify(entry.body) });
        } else if (entry.method === "PUT") {
          result = await rawJSON(`${path}/${entry.targetId}`, { method: "PUT", body: JSON.stringify(entry.body) });
        } else if (entry.method === "DELETE") {
          result = await rawJSON(`${path}/${entry.targetId}`, { method: "DELETE" });
        }
      } catch (err) {
        if (isNetworkError(err)) {
          lastConnectionError = { message: err.message || "Network error", at: new Date().toISOString() };
          notify();
          break; // offline again — stop, we'll retry later
        }
        // A real server-side rejection (validation, 404, etc). This entry
        // can never succeed as-is; drop it so it doesn't block the queue
        // forever, but keep the local optimistic state as-is so the user
        // doesn't silently lose what they typed. Log it so Settings can
        // show what happened instead of it vanishing without a trace.
        await put("failures", {
          resource: entry.resource,
          method: entry.method,
          targetId: entry.targetId,
          error: err.message || "Sync failed",
          failedAt: new Date().toISOString(),
        });
        await del("queue", entry.queueId);
        notify();
        continue;
      }

      await del("queue", entry.queueId);
      lastConnectionError = null;

      if (entry.method === "POST" && result) {
        await reconcileTempId(entry.resource, entry.tempId, result);
      } else if (entry.method === "PUT" && result) {
        await put(entry.resource, result);
      } else if (entry.method === "DELETE") {
        await del(entry.resource, entry.targetId);
      }
      notify();
    }
  } finally {
    flushing = false;
  }
}

async function reconcileTempId(resource, tempId, serverRecord) {
  await del(resource, tempId);
  await put(resource, serverRecord);

  // Any still-queued PUT/DELETE that targeted the temp id needs to point at
  // the real id now that we have one.
  const queue = await getAll("queue");
  for (const q of queue) {
    if (q.resource === resource && q.targetId === tempId && q.method !== "POST") {
      await put("queue", { ...q, targetId: serverRecord.id });
    }
  }
}

// ---------- Offline reads ----------

// Single-record lookup used to poll one transaction's OCR status while its
// edit form is open. Offline, this just returns whatever was last synced —
// OCR itself needs a live connection to the backend worker, so there's
// nothing new to find while offline, but the poll shouldn't throw either.
export async function getCachedTransaction(id) {
  return get("transactions", id);
}

export async function getOfflineCategories(type) {
  const all = await getAll("categories");
  return type ? all.filter((c) => c.type === type) : all;
}

export async function getOfflineBudgets() {
  return getAll("budgets");
}

export async function getOfflineRecurring() {
  return getAll("recurring");
}

export async function getOfflineOccurrences(startISO, endISO, category) {
  const [txns, recs] = await Promise.all([getAll("transactions"), getAll("recurring")]);
  const start = parseISO(startISO);
  const end = parseISO(endISO);

  const out = [];
  for (const t of txns) {
    if (t.date < startISO || t.date > endISO) continue;
    if (category && t.category.toLowerCase() !== category.toLowerCase()) continue;
    out.push({
      id: `t-${t.id}`,
      source_id: t.id,
      source_type: "transaction",
      name: t.name,
      amount: t.amount,
      category: t.category,
      type: t.type,
      date: t.date,
      description: t.description,
      receipt_path: t.receipt_path,
      ocr_status: t.ocr_status,
      _pending: t._pending || false,
    });
  }
  for (const rec of recs) {
    if (category && rec.category.toLowerCase() !== category.toLowerCase()) continue;
    for (const dateISO of occurrencesInRange(rec, start, end)) {
      out.push({
        id: `r-${rec.id}-${dateISO}`,
        source_id: rec.id,
        source_type: "recurring",
        name: rec.name,
        amount: rec.amount,
        category: rec.category,
        type: rec.type,
        date: dateISO,
        description: rec.description,
      });
    }
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.id).localeCompare(String(a.id))));
  return out;
}

export async function getOfflineSummary(startISO, endISO) {
  const occ = await getOfflineOccurrences(startISO, endISO, "");
  let income = 0;
  let expense = 0;
  const catTotals = new Map();
  for (const o of occ) {
    if (o.type === "income") income += o.amount;
    else expense += o.amount;
    const key = `${o.type}|${o.category}`;
    catTotals.set(key, (catTotals.get(key) || 0) + o.amount);
  }
  const byCategory = Array.from(catTotals.entries())
    .map(([key, amount]) => {
      const [type, category] = key.split("|");
      return { type, category, amount };
    })
    .sort((a, b) => b.amount - a.amount);

  return {
    start: startISO,
    end: endISO,
    income,
    expense,
    net: income - expense,
    by_category: byCategory,
    transaction_count: occ.length,
  };
}
