#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/pdf"

mkdir -p "$OUT_DIR"

for f in "$SCRIPT_DIR"/*.svg; do
  base="$(basename "$f" .svg)"
  rsvg-convert -f pdf -o "$OUT_DIR/$base.pdf" "$f"
done

echo "Exported SVG PDFs to: $OUT_DIR"
