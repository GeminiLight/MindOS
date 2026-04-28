#!/usr/bin/env bash
#
# parse-syncinclude.sh — Parse .syncinclude and export shell variables.
#
# Usage:
#   eval "$(scripts/parse-syncinclude.sh)"
#   # Now you have: SYNC_DIRS, ROOT_FILES, WIKI_EXCLUDES, GLOBAL_EXCLUDES, BLOCKED_PATTERNS
#
# Or source it:
#   source <(scripts/parse-syncinclude.sh)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SYNCFILE="$REPO_ROOT/.syncinclude"

if [ ! -f "$SYNCFILE" ]; then
  echo "echo '::error::.syncinclude not found at $SYNCFILE'" >&2
  exit 1
fi

# ─── Parser ───────────────────────────────────────────────────────────────────
# Simple YAML-subset parser: reads "section:" headers and "  - value" items.
# No external dependencies (no yq/python needed).

current_section=""
DIRS=()
FILES=()
WIKI_EX=()
GLOBAL_EX=()
BLOCKED=()

while IFS= read -r line; do
  # Skip comments and blank lines
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// /}" ]] && continue

  # Section header (no leading whitespace, ends with colon)
  if [[ "$line" =~ ^([a-z_]+): ]]; then
    current_section="${BASH_REMATCH[1]}"
    continue
  fi

  # List item (leading whitespace + dash)
  if [[ "$line" =~ ^[[:space:]]+-[[:space:]]+(.*) ]]; then
    value="${BASH_REMATCH[1]}"
    # Strip surrounding quotes
    value="${value#\"}"
    value="${value%\"}"
    value="${value#\'}"
    value="${value%\'}"

    case "$current_section" in
      directories)    DIRS+=("$value") ;;
      root_files)     FILES+=("$value") ;;
      wiki_exclude)   WIKI_EX+=("$value") ;;
      global_exclude) GLOBAL_EX+=("$value") ;;
      blocked_patterns) BLOCKED+=("$value") ;;
    esac
  fi
done < "$SYNCFILE"

# ─── Output ───────────────────────────────────────────────────────────────────
# Print shell variable assignments that can be eval'd by the caller.

# Space-separated lists (for simple iteration)
echo "SYNC_DIRS='${DIRS[*]:-}'"
echo "ROOT_FILES='${FILES[*]:-}'"

# Build rsync --exclude flags
wiki_excludes=""
for ex in "${WIKI_EX[@]:-}"; do
  [ -n "$ex" ] && wiki_excludes="$wiki_excludes --exclude='$ex'"
done
echo "WIKI_EXCLUDES='$wiki_excludes'"

global_excludes=""
for ex in "${GLOBAL_EX[@]:-}"; do
  [ -n "$ex" ] && global_excludes="$global_excludes --exclude='$ex'"
done
echo "GLOBAL_EXCLUDES='$global_excludes'"

# Newline-separated for safe iteration (patterns may contain spaces/globs)
blocked_str=""
for pat in "${BLOCKED[@]:-}"; do
  [ -n "$pat" ] && blocked_str="$blocked_str$pat"$'\n'
done
# Use heredoc-style to safely pass patterns with special chars
cat <<BLOCKED_EOF
BLOCKED_PATTERNS='$(echo -n "$blocked_str")'
BLOCKED_EOF
