// Same tiny IndexedDB wrapper as Mini Budget's offline/db.js, with this
// app's stores. Separate DB name so the two apps never collide even if they
// end up served from the same origin.
const DB_NAME = "race-budget-offline";
const DB_VERSION = 1;

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
      for (const name of ["races", "costs", "limits", "categories"]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "queueId", autoIncrement: true });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("failures")) db.createObjectStore("failures", { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function store(db, name, mode) {
  return db.transaction(name, mode).objectStore(name);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(name) {
  const db = await openDB();
  return wrap(store(db, name, "readonly").getAll());
}

export async function get(name, key) {
  const db = await openDB();
  return wrap(store(db, name, "readonly").get(key));
}

export async function put(name, value) {
  const db = await openDB();
  return wrap(store(db, name, "readwrite").put(value));
}

export async function replaceAll(name, values) {
  const db = await openDB();
  const s = db.transaction(name, "readwrite").objectStore(name);
  await wrap(s.clear());
  await Promise.all(values.map((v) => wrap(s.put(v))));
}

export async function del(name, key) {
  const db = await openDB();
  return wrap(store(db, name, "readwrite").delete(key));
}
