#!/usr/bin/env bash
# gen-icons.sh - Convert SVG icons to PNG for browser extension
# Tries rsvg-convert first (better SVG rendering), falls back to ImageMagick convert.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$SCRIPT_DIR/../src/icons"
OUT_DIR="$SRC_DIR"

SIZES=(16 32 48 128)

if command -v rsvg-convert &>/dev/null; then
  echo "Using rsvg-convert"
  for size in "${SIZES[@]}"; do
    rsvg-convert -w "$size" -h "$size" \
      "$SRC_DIR/icon-${size}.svg" \
      -o "$OUT_DIR/icon-${size}.png"
    echo "  Created icon-${size}.png"
  done
elif command -v convert &>/dev/null; then
  echo "Using ImageMagick convert"
  for size in "${SIZES[@]}"; do
    convert -background none -density 300 \
      -resize "${size}x${size}" \
      "$SRC_DIR/icon-${size}.svg" \
      "$OUT_DIR/icon-${size}.png"
    echo "  Created icon-${size}.png"
  done
else
  echo "Error: Neither rsvg-convert nor ImageMagick convert found." >&2
  echo "Install one of:" >&2
  echo "  apt install librsvg2-bin    # for rsvg-convert" >&2
  echo "  apt install imagemagick     # for convert" >&2
  exit 1
fi

echo "Done. PNGs written to $OUT_DIR"
