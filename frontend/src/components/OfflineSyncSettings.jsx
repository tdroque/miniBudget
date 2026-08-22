import { useEffect, useState } from "react";
import { api } from "../api";
import "./OfflineSyncSettings.css";

const SERVER_STATUS_LABEL = {
  reachable: "Reachable",
  unreachable: "Unreachable",
  "server-error": "Responding with errors",
  offline: "Offline",
};

function statusTone(ok) {
  return ok ? "status-value--ok" : "status-value--warn";
}

export default function OfflineSyncSettings() {
  const [forced, setForced] = useState(() => api.isOfflineModeForced());
  const [deviceOnline, setDeviceOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [serverStatus, setServerStatus] = useState("offline");
  const [checkingServer, setCheckingServer] = useState(true);
  const [pending, setPending] = useState(0);
  const [lastError, setLastError] = useState(() => api.getLastConnectionError());
  const [failedOps, setFailedOps] = useState([]);
  const [syncing, setSyncing] = useState(false);

  async function refreshSyncState() {
    setPending(await api.getPendingSyncCount());
    setLastError(api.getLastConnectionError());
    setFailedOps(await api.getFailedSyncOps());
  }

  async function pingServer() {
    setCheckingServer(true);
    const status = await api.checkServerReachable();
    setServerStatus(status);
    setCheckingServer(false);
  }

  useEffect(() => {
    refreshSyncState();
    pingServer();

    const unsubscribeQueue = api.subscribeSyncStatus(refreshSyncState);
    const unsubscribePref = api.subscribeOfflineModePreference(() => {
      setForced(api.isOfflineModeForced());
      pingServer();
    });

    function handleOnline() {
      setDeviceOnline(true);
      pingServer();
    }
    function handleOffline() {
      setDeviceOnline(false);
      setServerStatus("offline");
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const interval = setInterval(pingServer, 15000);

    return () => {
      unsubscribeQueue();
      unsubscribePref();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleToggle(e) {
    const value = e.target.checked;
    api.setOfflineModeForced(value);
    setForced(value);
    if (value) {
      setServerStatus("offline");
    } else {
      pingServer();
      api.flushOfflineQueue().then(refreshSyncState);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    await api.flushOfflineQueue();
    await refreshSyncState();
    setSyncing(false);
  }

  async function handleClearFailures() {
    await api.clearFailedSyncOps();
    setFailedOps([]);
  }

  const needsSync = pending > 0;

  return (
    <section className="card">
      <h2 className="section-title">Offline &amp; sync</h2>

      <label className="switch-row">
        <div className="switch-row__text">
          <span className="switch-row__label">Offline mode</span>
          <span className="switch-row__hint">
            Force Mini Budget to act as if there's no connection — everything queues locally instead of hitting the
            server. Useful for flights, testing, or just knowing your changes are safe either way.
          </span>
        </div>
        <span className="switch">
          <input type="checkbox" checked={forced} onChange={handleToggle} aria-label="Toggle offline mode" />
          <span className="switch__track">
            <span className="switch__thumb" />
          </span>
        </span>
      </label>

      <div className="status-grid">
        <div className="status-row">
          <span className="status-row__label">Device network</span>
          <span className={`status-value ${statusTone(deviceOnline)}`}>{deviceOnline ? "Online" : "Offline"}</span>
        </div>
        <div className="status-row">
          <span className="status-row__label">App mode</span>
          <span className={`status-value ${statusTone(!forced)}`}>{forced ? "Forced offline" : "Live"}</span>
        </div>
        <div className="status-row">
          <span className="status-row__label">Server</span>
          <span className={`status-value ${checkingServer ? "status-value--checking" : statusTone(serverStatus === "reachable")}`}>
            {checkingServer ? "Checking…" : SERVER_STATUS_LABEL[serverStatus] || "Unknown"}
          </span>
        </div>
        <div className="status-row">
          <span className="status-row__label">Sync status</span>
          <span className={`status-value ${needsSync ? "status-value--warn" : "status-value--ok"}`}>
            {needsSync ? `${pending} change${pending === 1 ? "" : "s"} waiting to sync` : "Everything's synced"}
          </span>
        </div>
      </div>

      <button
        className="btn btn--sm"
        onClick={handleSyncNow}
        disabled={forced || syncing || pending === 0 || !deviceOnline}
      >
        {syncing ? "Syncing…" : "Sync now"}
      </button>

      {lastError && (
        <div className="banner banner--error sync-diagnostic">
          <span>Couldn't reach the server to sync: {lastError.message}</span>
          <button
            className="banner__dismiss"
            onClick={() => {
              api.clearLastConnectionError();
              setLastError(null);
            }}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {failedOps.length > 0 && (
        <div className="failed-ops">
          <div className="failed-ops__header">
            <h3>Sync issues</h3>
            <button className="btn btn--sm btn--ghost" onClick={handleClearFailures}>
              Clear
            </button>
          </div>
          <p className="text-muted">
            These changes were rejected by the server and couldn't be synced — they're kept locally on your device
            so nothing important vanished, but they won't be retried automatically.
          </p>
          <ul className="failed-ops__list">
            {failedOps.map((f) => (
              <li key={f.id}>
                <span className="failed-ops__meta">
                  {f.method} {f.resource} · {new Date(f.failedAt).toLocaleString()}
                </span>
                <span className="failed-ops__error">{f.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
