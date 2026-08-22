// A manual override so the person can force the app into offline mode —
// for testing, a flight, or just wanting everything to queue up instead of
// hitting the network. This is a UI preference (not app data), so plain
// localStorage is the right tool here, unlike the actual offline dataset
// which lives in IndexedDB via offline/db.js.

const KEY = "ledger:forceOffline";

const listeners = new Set();
function notify() {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      /* ignore listener errors */
    }
  });
}

export function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function isForcedOffline() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setForcedOffline(value) {
  try {
    if (value) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — the toggle just won't persist across reloads */
  }
  notify();
}

/** What the app should actually behave as, combining the manual override
 * with the browser's real connectivity signal. */
export function effectiveOnline() {
  if (isForcedOffline()) return false;
  return typeof navigator === "undefined" ? true : navigator.onLine;
}
