"use client";

import { useSyncExternalStore } from "react";
import { AppRoot } from "@/components/jee/App";

const emptySubscribe = () => () => {};

export default function Home() {
  // true only on the client — IndexedDB must never run during SSR
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  if (!mounted) {
    return (
      <div className="min-h-screen grid place-items-center bg-stone-50">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-emerald-700 text-white grid place-items-center font-black mx-auto mb-4">
            JEE
          </div>
          <p className="text-sm text-stone-400">loading local data…</p>
        </div>
      </div>
    );
  }

  return <AppRoot />;
}
