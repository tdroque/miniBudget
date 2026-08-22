const DB_NAME = "ledger-offline";
const DB_VERSION = 2;
const STORES = ["transactions", "recurring", "categories", "queue", "meta", "failures"];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("transactions")) db.createObjectStore("transactions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("recurring")) db.createObjectStore("recurring", { keyPath: "id" });
      if (!db.objectStoreNames.contains("categories")) db.createObjectStore("categories", { keyPath: "id" });
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "queueId", autoIncrement: true });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("failures")) db.createObjectStore("failures", { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(storeName) {
  const db = await openDB();
  return wrap(tx(db, storeName, "readonly").getAll());
}

export async function get(storeName, key) {
  const db = await openDB();
  return wrap(tx(db, storeName, "readonly").get(key));
}

export async function put(storeName, value) {
  const db = await openDB();
  return wrap(tx(db, storeName, "readwrite").put(value));
}

export async function putAll(storeName, values) {
  const db = await openDB();
  const store = db.transaction(storeName, "readwrite").objectStore(storeName);
  await Promise.all(values.map((v) => wrap(store.put(v))));
}

export async function replaceAll(storeName, values) {
  const db = await openDB();
  const store = db.transaction(storeName, "readwrite").objectStore(storeName);
  await wrap(store.clear());
  await Promise.all(values.map((v) => wrap(store.put(v))));
}

export async function del(storeName, key) {
  const db = await openDB();
  return wrap(tx(db, storeName, "readwrite").delete(key));
}

export { STORES };
