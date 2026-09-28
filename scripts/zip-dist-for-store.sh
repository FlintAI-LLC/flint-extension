#!/usr/bin/env bash
# Zip dist/ for Chrome Web Store (manifest.json at archive root).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/dist/manifest.json').version")"
OUT="$ROOT/flint-apply-extension-v${VERSION}.zip"
rm -f "$OUT"
(cd "$ROOT/dist" && zip -r "$OUT" .)
echo "Wrote $OUT"
