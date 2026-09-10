#!/usr/bin/env bash
# Copy Flint Apply mark icons and text wordmarks from smart-resume into the extension.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRAND="${SMART_RESUME_BRAND_DIR:-$ROOT/../smart-resume/frontend/public/brand}"

for size in 16 32 48 128; do
  src="$BRAND/mark-${size}.png"
  dst="$ROOT/icons/icon${size}.png"
  if [[ ! -f "$src" ]]; then
    echo "Missing $src" >&2
    exit 1
  fi
  cp "$src" "$dst"
done

mkdir -p "$ROOT/brand"
# Text-only wordmarks (wide PNGs — not the square gmail lockups with icon + text).
cp "$BRAND/flintapply-wordmark-light-256w.png" "$ROOT/brand/wordmark-light-256.png"
cp "$BRAND/flintapply-wordmark-light-512w.png" "$ROOT/brand/wordmark-light-512.png"

echo "Synced Flint Apply icons and wordmarks from $BRAND"
