#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHOT_LIST="$SCRIPT_DIR/shotlist.txt"
OUTPUT="$SCRIPT_DIR/mindos-walkthrough.mp4"
TMP_DIR="$(mktemp -d /tmp/mindos-walkthrough.XXXXXX)"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

ln -sf "$SCRIPT_DIR/../screenshots/00-product-loop.png" "$TMP_DIR/00-product-loop.png"
ln -sf "$SCRIPT_DIR/../screenshots/01-home.png" "$TMP_DIR/01-home.png"
ln -sf "$SCRIPT_DIR/../screenshots/02-chat.png" "$TMP_DIR/02-chat.png"
ln -sf "$SCRIPT_DIR/../screenshots/03-dashboard.png" "$TMP_DIR/03-dashboard.png"
ln -sf "$SCRIPT_DIR/../screenshots/04-echo.png" "$TMP_DIR/04-echo.png"
ln -sf "$SCRIPT_DIR/../screenshots/05-agents-page.png" "$TMP_DIR/05-agents-page.png"

cat > "$SHOT_LIST" <<LIST
file '$TMP_DIR/00-product-loop.png'
duration 3
file '$TMP_DIR/01-home.png'
duration 3
file '$TMP_DIR/02-chat.png'
duration 3
file '$TMP_DIR/03-dashboard.png'
duration 3
file '$TMP_DIR/04-echo.png'
duration 3
file '$TMP_DIR/05-agents-page.png'
duration 3
file '$TMP_DIR/05-agents-page.png'
LIST

ffmpeg -y \
  -f concat \
  -safe 0 \
  -i "$SHOT_LIST" \
  -vf "scale=1600:900:force_original_aspect_ratio=decrease,pad=1600:900:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p" \
  -r 30 \
  -pix_fmt yuv420p \
  "$OUTPUT"

echo "Generated: $OUTPUT"
