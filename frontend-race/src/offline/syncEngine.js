// Offline-first data layer, adapted from Mini Budget's offline/syncEngine.js.
//
// Same model: the resource stores (races, costs, limits, categories) always
// hold the latest state the app knows about, with unsynced local edits
// applied on top; the "queue" store holds pending mutations in order and
// flushQueue() replays them when the connection returns.
//
// What's different here:
//  - Records reference each other (a cost has a race_id). A race created
//    offline has a temporary negative id, so when the server assigns the
//    real one we also rewrite race_id on queued and cached costs/limits.
//  - Deleting a race cascades on the server, so purgeRace() drops its
//    costs, limits and any queued work for them locally too.
//  - "Add to Mini Budget" needs a live connection (like receipts there).

import { API_BASE } from "../config.js";
import { getAll, get, put, del, replaceAll } from "./db.js";
import { effectiveOnline } from "./preferences.js";

const RESOURCE_PATH = {
  races: "/races",
  costs: "/race-costs",
  limits: "/race-limits",
  categories: "/race-categories",
};

let nextTempId = -1;
const newTempId = () => nextTempId--;

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
  if (!effectiveOnline()) throw new TypeError("Offline — not attempting a network request");
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

// ---------- Snapshot (bootstrap + cached reads) ----------

export async function cacheSnapshot(snapshot) {
  await Promise.all([
    replaceAll("races", snapshot.races || []),
    replaceAll("costs", snapshot.costs || []),
    replaceAll("limits", snapshot.limits || []),
    replaceAll("categories", snapshot.categories || []),
    put("meta", { key: "budget_category", value: snapshot.budget_category || "Races" }),
  ]);
  notify();
}

export async function fetchSnapshot() {
  return rawJSON("/race-sync");
}

export async function bootstrap() {
  const snapshot = await fetchSnapshot();
  await cacheSnapshot(snapshot);
  return snapshot;
}

export async function getCachedSnapshot() {
  const [races, costs, limits, categories, meta] = await Promise.all([
    getAll("races"),
    getAll("costs"),
    getAll("limits"),
    getAll("categories"),
    get("meta", "budget_category"),
  ]);
  return { races, costs, limits, categories, budget_category: meta?.value || "Races" };
}

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

export async function getFailedOps() {
  const failures = await getAll("failures");
  return failures.sort((a, b) => (a.failedAt < b.failedAt ? 1 : -1));
}

export async function clearFailedOps() {
  const failures = await getAll("failures");
  await Promise.all(failures.map((f) => del("failures", f.id)));
  notify();
}

// ---------- Write-through cache helpers (called after successful online calls) ----------

export async function cacheUpsert(resource, item) {
  await put(resource, item);
  notify();
}

export async function cacheRemove(resource, id) {
  await del(resource, id);
  notify();
}

/** Mirror the server-side cascade after a race is deleted. */
export async function purgeRace(raceId) {
  const [costs, limits, queue] = await Promise.all([getAll("costs"), getAll("limits"), getAll("queue")]);
  const costIds = new Set(costs.filter((c) => c.race_id === raceId).map((c) => c.id));
  const limitIds = new Set(limits.filter((l) => l.race_id === raceId).map((l) => l.id));
  await Promise.all([...costIds].map((id) => del("costs", id)));
  await Promise.all([...limitIds].map((id) => del("limits", id)));
  for (const q of queue) {
    const dropCost = q.resource === "costs" && (costIds.has(q.targetId) || q.body?.race_id === raceId);
    const dropLimit = q.resource === "limits" && (limitIds.has(q.targetId) || q.body?.race_id === raceId);
    if (dropCost || dropLimit) await del("queue", q.queueId);
  }
  notify();
}

// ---------- Offline mutation queue ----------

async function enqueue(entry) {
  await put("queue", { ...entry, createdAt: new Date().toISOString() });
  notify();
}

export async function getPendingCount() {
  return (await getAll("queue")).length;
}

export async function createOffline(resource, body) {
  const tempId = newTempId();
  const optimistic = { ...body, id: tempId, _pending: true };
  await put(resource, optimistic);
  await enqueue({ resource, method: "POST", targetId: tempId, tempId, body });
  return optimistic;
}

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

export async function deleteOffline(resource, id) {
  const queue = await getAll("queue");
  if (id < 0) {
    const pendingCreate = queue.find((q) => q.resource === resource && q.tempId === id && q.method === "POST");
    if (pendingCreate) await del("queue", pendingCreate.queueId);
  } else {
    await enqueue({ resource, method: "DELETE", targetId: id, tempId: null, body: null });
  }
  await del(resource, id);
  notify();
}

// ---------- Flushing the queue against the real API ----------

let flushing = false;
let lastConnectionError = null;

export const getLastConnectionError = () => lastConnectionError;

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
      const queue = await getAll("queue");
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
          break; // offline again — retry later
        }
        // A real server-side rejection can never succeed as-is: drop it so it
        // doesn't block the queue, keep the local state, and log it.
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

  const queue = await getAll("queue");
  for (const q of queue) {
    if (q.resource === resource && q.targetId === tempId && q.method !== "POST") {
      await put("queue", { ...q, targetId: serverRecord.id });
    }
  }

  // A race that was created offline: costs/limits created against it carry
  // its temporary id as race_id, both in the queue and in the local cache.
  if (resource === "races") {
    for (const q of queue) {
      if ((q.resource === "costs" || q.resource === "limits") && q.body?.race_id === tempId) {
        await put("queue", { ...q, body: { ...q.body, race_id: serverRecord.id } });
      }
    }
    for (const store of ["costs", "limits"]) {
      for (const rec of await getAll(store)) {
        if (rec.race_id === tempId) await put(store, { ...rec, race_id: serverRecord.id });
      }
    }
  }
}
