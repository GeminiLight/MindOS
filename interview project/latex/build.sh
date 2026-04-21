#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist"

mkdir -p "$OUT_DIR"

latexmk -xelatex -interaction=nonstopmode -halt-on-error \
  -output-directory="$OUT_DIR" \
  "$SCRIPT_DIR/mindos-interview-report.tex"

echo "Generated PDF: $OUT_DIR/mindos-interview-report.pdf"
