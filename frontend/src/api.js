import { API_BASE, API_ORIGIN } from "./config.js";
import * as offline from "./offline/syncEngine.js";
import * as prefs from "./offline/preferences.js";

export const BASE = API_BASE;

async function request(path, options = {}) {
  if (!prefs.effectiveOnline()) {
    throw new TypeError("Offline mode is enabled");
  }
  const isForm = options.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: isForm ? options.headers : { "Content-Type": "application/json", ...options.headers },
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

function isNetworkError(err) {
  return offline.isNetworkError(err);
}

// A generic "try the network, fall back to the offline queue" wrapper for
// create/update/delete. Real validation/server errors (4xx/5xx that made it
// to the server) are NOT caught here — only genuine connectivity failures
// fall back to offline mode; everything else surfaces to the UI as before.
async function mutate(resource, method, { path, body, offlineId }) {
  try {
    const result = await request(path, { method, body: body !== undefined ? JSON.stringify(body) : undefined });
    if (method === "DELETE") {
      await offline.cacheRemove(resource, offlineId);
    } else {
      await offline.cacheUpsert(resource, result);
    }
    return result;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    if (method === "POST") return offline.createOffline(resource, body);
    if (method === "PUT") return offline.updateOffline(resource, offlineId, body);
    if (method === "DELETE") return offline.deleteOffline(resource, offlineId);
    throw err;
  }
}

export const api = {
  getOccurrences: async (start, end, category) => {
    const params = new URLSearchParams({ start, end });
    if (category) params.set("category", category);
    try {
      return await request(`/transactions?${params.toString()}`);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      return offline.getOfflineOccurrences(start, end, category);
    }
  },
  createTransaction: (data) => mutate("transactions", "POST", { path: "/transactions", body: data }),
  // Single-record lookup, distinct from getOccurrences — used to poll one
  // transaction's OCR status while its edit form is open, without needing
  // to know (or re-fetch) the currently-selected date range.
  getTransaction: async (id) => {
    try {
      return await request(`/transactions/${id}`);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      return offline.getCachedTransaction(id);
    }
  },
  updateTransaction: (id, data) =>
    mutate("transactions", "PUT", { path: `/transactions/${id}`, body: data, offlineId: id }),
  deleteTransaction: (id) => mutate("transactions", "DELETE", { path: `/transactions/${id}`, offlineId: id }),

  getRecurring: async () => {
    try {
      return await request("/recurring");
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      return offline.getOfflineRecurring();
    }
  },
  createRecurring: (data) => mutate("recurring", "POST", { path: "/recurring", body: data }),
  updateRecurring: (id, data) => mutate("recurring", "PUT", { path: `/recurring/${id}`, body: data, offlineId: id }),
  deleteRecurring: (id) => mutate("recurring", "DELETE", { path: `/recurring/${id}`, offlineId: id }),

  getSummary: async (start, end) => {
    const params = new URLSearchParams({ start, end });
    try {
      return await request(`/summary?${params.toString()}`);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      return offline.getOfflineSummary(start, end);
    }
  },

  // Categories (managed from Settings)
  getCategories: async (type) => {
    try {
      return await request(`/categories${type ? `?type=${type}` : ""}`);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      return offline.getOfflineCategories(type);
    }
  },
  createCategory: (data) => mutate("categories", "POST", { path: "/categories", body: data }),
  deleteCategory: (id) => mutate("categories", "DELETE", { path: `/categories/${id}`, offlineId: id }),

  // Budgets (per expense category — Budget tab)
  getBudgets: async () => {
    try {
      return await request("/budgets");
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      return offline.getOfflineBudgets();
    }
  },
  createBudget: (data) => mutate("budgets", "POST", { path: "/budgets", body: data }),
  updateBudget: (id, data) => mutate("budgets", "PUT", { path: `/budgets/${id}`, body: data, offlineId: id }),
  deleteBudget: (id) => mutate("budgets", "DELETE", { path: `/budgets/${id}`, offlineId: id }),

  // Receipts require a live connection — offline photo queueing isn't
  // supported (see offline/syncEngine.js header comment for why).
  uploadReceipt: (transactionId, file) => {
    if (!prefs.effectiveOnline()) {
      return Promise.reject(new Error("You're offline — receipts need a connection. Try again once you're back online."));
    }
    const form = new FormData();
    form.append("receipt", file);
    return request(`/transactions/${transactionId}/receipt`, { method: "POST", body: form });
  },
  deleteReceipt: (transactionId) => {
    if (!prefs.effectiveOnline()) {
      return Promise.reject(new Error("You're offline — try again once you're back online."));
    }
    return request(`/transactions/${transactionId}/receipt`, { method: "DELETE" });
  },

  receiptUrl: (receiptPath) => (receiptPath ? `${API_ORIGIN}${receiptPath}` : null),

  // Offline sync status, exposed for the UI badge.
  bootstrapOfflineCache: () => offline.bootstrap(),
  flushOfflineQueue: () => offline.flushQueue(),
  getPendingSyncCount: () => offline.getPendingCount(),
  subscribeSyncStatus: (cb) => offline.subscribe(cb),
  getCachedSnapshot: () => offline.getCachedSnapshot(),

  // Manual "force offline" toggle (Settings tab).
  isOfflineModeForced: () => prefs.isForcedOffline(),
  setOfflineModeForced: (value) => prefs.setForcedOffline(value),
  subscribeOfflineModePreference: (cb) => prefs.subscribe(cb),

  // Connection + sync diagnostics (Settings tab).
  checkServerReachable: () => offline.checkServerReachable(),
  getLastConnectionError: () => offline.getLastConnectionError(),
  clearLastConnectionError: () => offline.clearLastConnectionError(),
  getFailedSyncOps: () => offline.getFailedOps(),
  clearFailedSyncOps: () => offline.clearFailedOps(),
};
