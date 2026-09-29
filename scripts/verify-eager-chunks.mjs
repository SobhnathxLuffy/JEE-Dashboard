#!/usr/bin/env node
// Verifies that supabase-js (the auth path) is part of the EAGERLY loaded
// chunk closure of out/index.html — i.e. reachable through <script src> tags
// and the "static/chunks/…" references those chunks embed (static-import
// edges). If it is, no runtime chunk fetch can fail before sign-in works.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = "out";
const chunksDir = path.join(root, "_next", "static", "chunks");
const html = readFileSync(path.join(root, "index.html"), "utf8");

const entry = [...html.matchAll(/\/_next\/static\/chunks\/([^"]+\.js)/g)].map((m) => m[1]);
const read = (f) => readFileSync(path.join(chunksDir, f), "utf8");

// BFS over static chunk-reference edges
const eager = new Set(entry);
const queue = [...entry];
while (queue.length) {
  const f = queue.shift();
  if (!f.endsWith(".js")) continue;
  let src;
  try {
    src = read(f);
  } catch {
    continue;
  }
  for (const m of src.matchAll(/"static\/chunks\/([^"]+\.js)"/g)) {
    if (!eager.has(m[1])) {
      eager.add(m[1]);
      queue.push(m[1]);
    }
  }
}

const all = readdirSync(chunksDir).filter((f) => f.endsWith(".js") && !f.endsWith(".map"));
const lazy = all.filter((f) => !eager.has(f));

console.log("entry chunks (index.html):", entry.join(", "));
console.log("\neager closure size:", eager.size, "/ all chunks:", all.length);
console.log("lazy chunks (runtime-fetched):", lazy.join(", ") || "(none)");

const markers = [
  ["supabase createClient", "createClient"],
  ["supabase storageKey jee-sync-auth", "jee-sync-auth"],
];
let ok = true;
for (const [label, needle] of markers) {
  const inEager = [...eager].some((f) => f.endsWith(".js") && read(f).includes(needle));
  console.log(`${inEager ? "✓" : "✗"} ${label} is in the EAGER graph`);
  if (!inEager) ok = false;
}
console.log(`\n${ok ? "PASS" : "FAIL"}: auth path needs no runtime chunk fetch`);
process.exit(ok ? 0 : 1);
