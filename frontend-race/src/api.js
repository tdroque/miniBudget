import { API_BASE } from "./config.js";
import * as offline from "./offline/syncEngine.js";
import * as prefs from "./offline/preferences.js";

// Same shape as Mini Budget's api.js (request + mutate with offline
// fallback), pointed at the /api/race* endpoints of the shared backend.

async function request(path, options = {}) {
  if (!prefs.effectiveOnline()) throw new TypeError("Offline mode is enabled");
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch (_) {
      /* ignore parse errors */
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

const isNetworkError = (err) => offline.isNetworkError(err);

// Try the network; on a genuine connectivity failure fall back to the
// offline queue. Real server errors (validation etc.) surface to the UI.
async function mutate(resource, method, { path, body, offlineId }) {
  try {
    const result = await request(path, { method, body: body !== undefined ? JSON.stringify(body) : undefined });
    if (method === "DELETE") await offline.cacheRemove(resource, offlineId);
    else await offline.cacheUpsert(resource, result);
    return result;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    if (method === "POST") return offline.createOffline(resource, body);
    if (method === "PUT") return offline.updateOffline(resource, offlineId, body);
    if (method === "DELETE") return offline.deleteOffline(resource, offlineId);
    throw err;
  }
}

const needsConnection = () =>
  Promise.reject(new Error("You're offline — sending to Mini Budget needs a connection. Try again once you're back online."));

export const api = {
  // One snapshot holds everything this app shows. Online it comes from the
  // server (and refreshes the offline cache when nothing is waiting to
  // sync); offline it's whatever was cached last.
  getData: async () => {
    try {
      const snapshot = await offline.fetchSnapshot();
      if ((await offline.getPendingCount()) === 0) await offline.cacheSnapshot(snapshot);
      return snapshot;
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      return offline.getCachedSnapshot();
    }
  },

  createRace: (data) => mutate("races", "POST", { path: "/races", body: data }),
  updateRace: (id, data) => mutate("races", "PUT", { path: `/races/${id}`, body: data, offlineId: id }),
  deleteRace: async (id) => {
    await mutate("races", "DELETE", { path: `/races/${id}`, offlineId: id });
    await offline.purgeRace(id);
  },

  createCost: (data) => mutate("costs", "POST", { path: "/race-costs", body: data }),
  updateCost: (id, data) => mutate("costs", "PUT", { path: `/race-costs/${id}`, body: data, offlineId: id }),
  deleteCost: (id) => mutate("costs", "DELETE", { path: `/race-costs/${id}`, offlineId: id }),

  // One-click link to Mini Budget (and its undo). Online only.
  addCostToBudget: async (id) => {
    if (!prefs.effectiveOnline() || id < 0) return needsConnection();
    try {
      const saved = await request(`/race-costs/${id}/budget`, { method: "POST" });
      await offline.cacheUpsert("costs", saved);
      return saved;
    } catch (err) {
      if (isNetworkError(err)) return needsConnection();
      throw err;
    }
  },
  removeCostFromBudget: async (id) => {
    if (!prefs.effectiveOnline() || id < 0) return needsConnection();
    try {
      const saved = await request(`/race-costs/${id}/budget`, { method: "DELETE" });
      await offline.cacheUpsert("costs", saved);
      return saved;
    } catch (err) {
      if (isNetworkError(err)) return needsConnection();
      throw err;
    }
  },

  createLimit: (data) => mutate("limits", "POST", { path: "/race-limits", body: data }),
  updateLimit: (id, data) => mutate("limits", "PUT", { path: `/race-limits/${id}`, body: data, offlineId: id }),
  deleteLimit: (id) => mutate("limits", "DELETE", { path: `/race-limits/${id}`, offlineId: id }),

  createCategory: (data) => mutate("categories", "POST", { path: "/race-categories", body: data }),
  deleteCategory: (id) => mutate("categories", "DELETE", { path: `/race-categories/${id}`, offlineId: id }),

  // Offline sync status, exposed for the (shared) SyncStatus / settings UI.
  bootstrapOfflineCache: () => offline.bootstrap(),
  flushOfflineQueue: () => offline.flushQueue(),
  getPendingSyncCount: () => offline.getPendingCount(),
  subscribeSyncStatus: (cb) => offline.subscribe(cb),

  isOfflineModeForced: () => prefs.isForcedOffline(),
  setOfflineModeForced: (value) => prefs.setForcedOffline(value),
  subscribeOfflineModePreference: (cb) => prefs.subscribe(cb),

  checkServerReachable: () => offline.checkServerReachable(),
  getLastConnectionError: () => offline.getLastConnectionError(),
  clearLastConnectionError: () => offline.clearLastConnectionError(),
  getFailedSyncOps: () => offline.getFailedOps(),
  clearFailedSyncOps: () => offline.clearFailedOps(),
};
