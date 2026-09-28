"use client";

// Registers the offline-shell service worker (F1). Delayed so it never competes
// with the first paint; failures are silent — the app works fine without it.
import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const id = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }, 1200);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}
