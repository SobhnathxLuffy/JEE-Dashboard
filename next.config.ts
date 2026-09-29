import type { NextConfig } from "next";

// MOBILE_EXPORT=1 → static export for the Android APK (Capacitor webDir).
// The /api/ai proxy route is moved aside by scripts/build-mobile.mjs before
// this build (export cannot serve API routes; on device the AI calls go
// straight to the provider through CapacitorHttp instead).
const nextConfig: NextConfig = {
  output: process.env.MOBILE_EXPORT === "1" ? "export" : "standalone",
  // mobile builds compile into their own distDir — never touch the dev
  // server's .next or the standalone server's artifacts
  distDir: process.env.MOBILE_EXPORT === "1" ? ".next-mobile" : ".next",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
