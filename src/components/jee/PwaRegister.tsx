"use client";

// Registers the offline-shell service worker (F1). Delayed so it never competes
// with the first paint; failures are silent — the app works fine without it.
// Also requests persistent storage so the browser never evicts the IndexedDB
// study data under disk pressure (localhost origins qualify once granted).
import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const id = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
      try {
        if (navigator.storage && navigator.storage.persist) {
          navigator.storage.persist().catch(() => {});
        }
      } catch {
        /* storage persistence is best-effort */
      }
    }, 1200);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}
