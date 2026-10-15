#!/usr/bin/env node
/**
 * Patch dist/manifest.json for Chrome Web Store upload (production hosts only).
 * Source manifest keeps localhost for dev; store zip must not request localhost.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve(process.cwd(), "dist/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const isLocalhost = (pattern) =>
  typeof pattern === "string" && /^https?:\/\/localhost(:\d+)?\//i.test(pattern);

if (Array.isArray(manifest.host_permissions)) {
  manifest.host_permissions = manifest.host_permissions.filter((p) => !isLocalhost(p));
}

if (Array.isArray(manifest.content_scripts)) {
  for (const entry of manifest.content_scripts) {
    if (Array.isArray(entry.matches)) {
      entry.matches = entry.matches.filter((p) => !isLocalhost(p));
    }
  }
}

delete manifest.browser_specific_settings;

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Patched dist/manifest.json for Chrome Web Store (no localhost, no gecko block)");
