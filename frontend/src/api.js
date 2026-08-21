export const BASE = import.meta.env.VITE_API_URL || "/api";
const ORIGIN = BASE.replace(/\/api\/?$/, "");

async function request(path, options = {}) {
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

export const api = {
  getOccurrences: (start, end, category) => {
    const params = new URLSearchParams({ start, end });
    if (category) params.set("category", category);
    return request(`/transactions?${params.toString()}`);
  },
  createTransaction: (data) =>
    request("/transactions", { method: "POST", body: JSON.stringify(data) }),
  updateTransaction: (id, data) =>
    request(`/transactions/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteTransaction: (id) =>
    request(`/transactions/${id}`, { method: "DELETE" }),

  getRecurring: () => request("/recurring"),
  createRecurring: (data) =>
    request("/recurring", { method: "POST", body: JSON.stringify(data) }),
  updateRecurring: (id, data) =>
    request(`/recurring/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteRecurring: (id) =>
    request(`/recurring/${id}`, { method: "DELETE" }),

  getSummary: (start, end) => {
    const params = new URLSearchParams({ start, end });
    return request(`/summary?${params.toString()}`);
  },

  // Categories (managed from Settings)
  getCategories: (type) => request(`/categories${type ? `?type=${type}` : ""}`),
  createCategory: (data) =>
    request("/categories", { method: "POST", body: JSON.stringify(data) }),
  deleteCategory: (id) => request(`/categories/${id}`, { method: "DELETE" }),

  // Receipts — upload attaches/replaces the image on a one-off transaction
  // and flips its ocr_status to "pending", ready for a future OCR worker.
  uploadReceipt: (transactionId, file) => {
    const form = new FormData();
    form.append("receipt", file);
    return request(`/transactions/${transactionId}/receipt`, { method: "POST", body: form });
  },
  deleteReceipt: (transactionId) =>
    request(`/transactions/${transactionId}/receipt`, { method: "DELETE" }),

  // receipt_path from the API is an absolute path like "/uploads/xyz.jpg";
  // resolve it against the API origin so it works in dev (proxy) and prod.
  receiptUrl: (receiptPath) => (receiptPath ? `${ORIGIN}${receiptPath}` : null),
};
