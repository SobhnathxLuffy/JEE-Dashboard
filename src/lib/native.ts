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
