import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import "./SyncStatus.css";

const RETRY_INTERVAL_MS = 20000;

export default function SyncStatus({ onSynced }) {
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [pending, setPending] = useState(0);
  const lastPendingRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function refreshCount() {
      const count = await api.getPendingSyncCount();
      if (!cancelled) setPending(count);
    }

    async function trySync() {
      const before = await api.getPendingSyncCount();
      if (before === 0) return;
      await api.flushOfflineQueue();
      const after = await api.getPendingSyncCount();
      if (!cancelled) setPending(after);
      if (before > 0 && after < before) onSynced?.();
    }

    refreshCount();
    trySync();

    const unsubscribe = api.subscribeSyncStatus(refreshCount);

    function handleOnline() {
      setIsOnline(true);
      trySync();
    }
    function handleOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // iOS Safari (especially installed PWAs) doesn't reliably fire
    // online/offline, so poll as a safety net whenever there's work to do.
    const interval = setInterval(() => {
      if (navigator.onLine) trySync();
    }, RETRY_INTERVAL_MS);

    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    lastPendingRef.current = pending;
  }, [pending]);

  if (isOnline && pending === 0) return null;

  return (
    <div className={`sync-pill ${!isOnline ? "sync-pill--offline" : "sync-pill--pending"}`}>
      <span className="sync-pill__dot" />
      {!isOnline ? "Offline" : `Syncing ${pending} change${pending === 1 ? "" : "s"}…`}
    </div>
  );
}
