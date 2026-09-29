#!/usr/bin/env node
// ─── Static-export build for the Android APK (Capacitor webDir) ────────────
//
// 1. moves src/app/api aside — `output: "export"` cannot serve API routes
//    (on the device, AI calls go straight to the provider via CapacitorHttp)
// 2. runs `MOBILE_EXPORT=1 next build` → distDir `.next-mobile` (Next 16
//    writes the export site directly there, isolated from the dev server's
//    .next) and assembles out/ from it
// 3. restores the api dir in ALL paths (finally)
// 4. `npx cap sync android` — copies out/ into the native project
import { execSync } from "node:child_process";
import { cpSync, existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const apiDir = path.join(root, "src", "app", "api");
const backup = path.join(root, ".mobile-api-backup");

const run = (cmd, env = {}) =>
  execSync(cmd, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });

const hadApi = existsSync(apiDir);
if (hadApi) {
  rmSync(backup, { recursive: true, force: true });
  renameSync(apiDir, backup);
}
try {
  run("npx next build", { MOBILE_EXPORT: "1" });
  // Next 16 emits the static export straight into the distDir — assemble out/
  rmSync(path.join(root, "out"), { recursive: true, force: true });
  cpSync(path.join(root, ".next-mobile"), path.join(root, "out"), { recursive: true });
  if (!existsSync(path.join(root, "out", "index.html"))) {
    throw new Error("static export did not produce out/index.html");
  }
} finally {
  if (existsSync(backup)) {
    if (existsSync(apiDir)) rmSync(backup, { recursive: true, force: true });
    else renameSync(backup, apiDir);
  }
}
if (existsSync(path.join(root, "android"))) {
  run("npx cap sync android");
}
console.log("\n✓ mobile export ready → out/");
