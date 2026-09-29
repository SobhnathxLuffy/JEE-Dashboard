import type { CapacitorConfig } from "@capacitor/cli";

// Android APK shell for the JEE Study App (see scripts/build-mobile.mjs).
// webDir "out" = static export produced by MOBILE_EXPORT=1 next build.
const config: CapacitorConfig = {
  appId: "com.sobhnathx.jeestudy",
  appName: "JEE Study",
  webDir: "out",
  server: {
    // https scheme → IndexedDB, crypto and fetch behave like a real origin
    androidScheme: "https",
  },
};

export default config;
