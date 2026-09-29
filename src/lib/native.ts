// ─── Runtime detection for the Android APK (Capacitor) build ────────────────
// The Capacitor runtime injects a window.Capacitor global inside the native
// WebView; on the ordinary web it is undefined. Detecting through the global
// keeps @capacitor/core out of the web bundle entirely.

interface CapGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
}

function cap(): CapGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapGlobal }).Capacitor;
}

/** True inside the Android/iOS shell, false in every normal browser. */
export const IS_NATIVE: boolean = cap()?.isNativePlatform?.() ?? false;

/** The CapacitorHttp plugin stub injected at runtime (CORS-free native HTTP). */
export interface NativeHttp {
  request(opts: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    data?: unknown;
    connectTimeout?: number;
    readTimeout?: number;
  }): Promise<{ status: number; data: unknown }>;
}

export function nativeHttp(): NativeHttp | null {
  if (!IS_NATIVE) return null;
  const plugin = cap()?.Plugins?.CapacitorHttp;
  return (plugin as NativeHttp | undefined) ?? null;
}

/**
 * Warm lazily-imported modules shortly after boot, inside the APK only.
 *
 * Every asset in the shell is served locally, and the boot graph demonstrably
 * loads (the app is running) — but a stale WebView HTTP cache entry from an
 * app update could 404 a chunk that is requested on demand minutes later
 * (this is how "Failed to load chunk …" hit the old supabase sign-in path).
 * Loading the remaining lazy chunk (pdfjs-dist) at launch, with retries,
 * moves any such failure to a moment where a restart is obvious instead of
 * mid-import. On the web this is a no-op — lazy loading stays as-is there.
 */
export function prewarmNativeModules(): void {
  if (!IS_NATIVE) return;
  const attempt = (n: number): void => {
    void import("pdfjs-dist")
      .then((m) => {
        m.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      })
      .catch(() => {
        if (n > 0) window.setTimeout(() => attempt(n - 1), 5000);
      });
  };
  window.setTimeout(() => attempt(4), 2500);
}
