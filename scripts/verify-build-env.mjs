#!/usr/bin/env node
/**
 * Fail the build if dist still points at the wrong API (common when .env wasn't loaded).
 * Usage: node scripts/verify-build-env.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
const distChunk = resolve(root, "dist/chunks");

if (!existsSync(envPath)) {
  console.error("Missing .env — copy .env.staging or .env.example first.");
  process.exit(1);
}

const env = readFileSync(envPath, "utf8");
const apiMatch = env.match(/^VITE_API_BASE_URL=(.+)$/m);
const expectedApi = (apiMatch?.[1] ?? "").trim();
if (!expectedApi) {
  console.error("VITE_API_BASE_URL not set in .env");
  process.exit(1);
}

import { readdirSync } from "node:fs";
const chunks = readdirSync(distChunk).filter((f) => f.endsWith(".js"));
let found = false;
for (const file of chunks) {
  const text = readFileSync(resolve(distChunk, file), "utf8");
  if (text.includes(expectedApi)) {
    found = true;
    break;
  }
}

if (!found) {
  console.error(
    `dist/ does not contain ${expectedApi}. Rebuild with: npm run build`,
  );
  process.exit(1);
}

if (expectedApi.includes("8001")) {
  const stale = readFileSync(resolve(distChunk, chunks[0]), "utf8");
  if (stale.includes("http://localhost:8000") && !stale.includes("8001")) {
    console.error("dist/ still targets :8000 — stop npm run dev and rebuild.");
    process.exit(1);
  }
}

console.log(`OK: dist built for ${expectedApi}`);
