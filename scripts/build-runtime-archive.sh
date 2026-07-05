#!/bin/bash
# Build a minimal MindOS runtime archive for Desktop Core Hot Update.
# Output: /tmp/mindos-runtime-{VERSION}.tar.gz (pre-built, ~30-40MB)
#
# Directory structure matches what ProcessManager + analyzeMindOsLayout expect:
#   packages/web/.next/standalone/server.js
#   packages/web/.next/standalone/node_modules/
#   packages/web/.next/standalone/.next/server/
#   packages/web/.next/standalone/.next/static/
#   packages/web/.next/standalone/public/
#   packages/web/.next/static/       (isBundledRuntimeIntact checks this)
#   packages/web/public/
#   dist/protocols/mcp-server/index.cjs
#   package.json
#   bin/ templates/ skills/
set -euo pipefail

VERSION=$(node -p "require('./packages/mindos/package.json').version")
WORK="/tmp/mindos-runtime-build-$$"
ARCHIVE="/tmp/mindos-runtime-${VERSION}.tar.gz"
rm -rf "$WORK"

find_claude_sdk_native_packages() {
  find "$1" -type d \( \
    -path '*/node_modules/@anthropic-ai/claude-agent-sdk-*' -o \
    -path '*/__node_modules/@anthropic-ai/claude-agent-sdk-*' -o \
    -path '*/.pnpm/@anthropic-ai+claude-agent-sdk-*' \
  \) -print 2>/dev/null || true
}

prune_claude_sdk_native_packages() {
  local root="$1"
  local removed=0
  while IFS= read -r package_dir; do
    [ -z "$package_dir" ] && continue
    rm -rf "$package_dir"
    removed=$((removed + 1))
  done < <(find_claude_sdk_native_packages "$root")
  if [ "$removed" -gt 0 ]; then
    echo "  Removed ${removed} Claude Agent SDK native package(s)"
  fi
}

echo "📦 Building MindOS runtime v${VERSION}..."

# ── Web server (standalone Next.js) ──
echo "  Materializing standalone runtime dependencies..."
node -e "import('./packages/desktop/scripts/prepare-mindos-bundle.mjs').then((m) => m.materializeStandaloneAssets('packages/web', { runtimeDependencySeeds: m.RUNTIME_DEPENDENCY_SEEDS }))"

echo "  Copying standalone..."
mkdir -p "$WORK/packages/web/.next"
# Copy the entire standalone tree (server.js + node_modules + .next/server + .next/static + public)
# IMPORTANT: --no-dereference preserves symlinks as-is instead of following them.
# Next.js standalone creates node_modules/node_modules -> ../../node_modules symlinks
# that cause infinite recursion with plain cp -r (blowing up from ~30MB to 2GB+).
cp -R -P packages/web/.next/standalone "$WORK/packages/web/.next/standalone"
# Remove symlinks inside node_modules — they point to paths outside standalone
# and are not needed at runtime (standalone has all traced deps already).
find "$WORK/packages/web/.next/standalone/node_modules" -type l -delete 2>/dev/null || true
# Remove dev artifacts that sneak into standalone
rm -rf "$WORK/packages/web/.next/standalone/.next/cache" \
       "$WORK/packages/web/.next/standalone/.next/dev" \
       "$WORK/packages/web/.next/standalone/.next/diagnostics" \
       "$WORK/packages/web/.next/standalone/.next/types" \
       "$WORK/packages/web/.next/standalone/__tests__" \
       "$WORK/packages/web/.next/standalone/.next/lock"

# Strip dev-only files from node_modules to reduce archive size
echo "  Stripping dev-only files from node_modules..."
STANDALONE_NM="$WORK/packages/web/.next/standalone/node_modules"
if [ -d "$STANDALONE_NM" ]; then
  # TypeScript declaration files (only needed for IDE, not runtime)
  find "$STANDALONE_NM" -name '*.d.ts' -delete
  find "$STANDALONE_NM" -name '*.d.cts' -delete
  find "$STANDALONE_NM" -name '*.d.mts' -delete
  find "$STANDALONE_NM" -name '*.d.ts.map' -delete
  # Source maps (debugging only)
  find "$STANDALONE_NM" -name '*.js.map' -delete
  find "$STANDALONE_NM" -name '*.mjs.map' -delete
  find "$STANDALONE_NM" -name '*.cjs.map' -delete
  # Keep runtime .ts sources: built-in PI extensions such as pi-subagents and
  # pi-schedule-prompt ship TS-only entrypoints that are loaded through jiti.
  # Markdown docs inside packages
  find "$STANDALONE_NM" -name 'README.md' -delete
  find "$STANDALONE_NM" -name 'CHANGELOG.md' -delete
  find "$STANDALONE_NM" -name 'LICENSE' -delete
  find "$STANDALONE_NM" -name 'LICENSE.md' -delete
  # Empty directories left after deletion
  find "$STANDALONE_NM" -type d -empty -delete 2>/dev/null || true
  # Remove packages not needed at runtime
  rm -rf "$STANDALONE_NM/typescript"       # Only needed for type-checking, not runtime
  rm -rf "$STANDALONE_NM/@types"           # TypeScript type definitions
  rm -rf "$STANDALONE_NM/caniuse-lite"     # Browser compat data, not needed server-side
fi
# Copy static assets at top level (isBundledRuntimeIntact checks packages/web/.next/static/)
cp -r packages/web/.next/static "$WORK/packages/web/.next/static"
# Copy public assets
mkdir -p "$WORK/packages/web"
cp -r packages/web/public "$WORK/packages/web/public"
# Copy skill definitions (not included in standalone output, needed at runtime)
if [ -d packages/web/data/skills ]; then
  mkdir -p "$WORK/packages/web/data"
  cp -r packages/web/data/skills "$WORK/packages/web/data/skills"
fi

# ── MCP server ──
echo "  Copying MCP..."
pnpm --filter @geminilight/mindos build
mkdir -p "$WORK/dist/protocols/mcp-server"
cp packages/mindos/dist/protocols/mcp-server/index.cjs "$WORK/dist/protocols/mcp-server/"

# ── Metadata + auxiliary files ──
echo "  Copying metadata..."
cp packages/mindos/package.json "$WORK/"
[ -d packages/mindos/bin ] && cp -r packages/mindos/bin "$WORK/"
[ -d packages/mindos/src ] && cp -r packages/mindos/src "$WORK/"
[ -d templates ] && cp -r templates "$WORK/"
[ -d skills ] && cp -r skills "$WORK/"
node scripts/runtime-manifest.mjs \
  --root "$WORK" \
  --platform runtime-archive \
  --layout runtime-archive \
  --package-name "@geminilight/mindos-runtime"
prune_claude_sdk_native_packages "$WORK"

# ── Package (flat, no outer directory) ──
echo "  Creating archive..."
# Use POSIX format to avoid GNU @LongLink extensions that our Windows JS
# tar parser must handle. --posix uses pax headers for paths > 100 chars,
# which the parser also supports, but keeping paths representable in ustar
# prefix+name (up to 255 chars) is preferred for maximum compatibility.
tar czf "$ARCHIVE" --posix -C "$WORK" .

# ── Self-validation ──
echo "  Validating..."
VERIFY="/tmp/mindos-runtime-verify-$$"
rm -rf "$VERIFY" && mkdir -p "$VERIFY"
tar xzf "$ARCHIVE" -C "$VERIFY"

ERRORS=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if [ ! -e "$VERIFY/$f" ]; then
    echo "  ❌ MISSING: $f"
    ERRORS=$((ERRORS + 1))
  fi
done < <(node packages/desktop/scripts/print-runtime-health-paths.mjs)

if [ ! -e "$VERIFY/runtime-manifest.json" ]; then
  echo "  ❌ MISSING: runtime-manifest.json"
  ERRORS=$((ERRORS + 1))
fi

for f in skills/mindos/SKILL.md skills/mindos-zh/SKILL.md packages/web/data/skills/mindos/SKILL.md packages/web/data/skills/mindos-zh/SKILL.md; do
  if [ ! -e "$VERIFY/$f" ]; then
    echo "  ❌ MISSING: $f"
    ERRORS=$((ERRORS + 1))
  fi
done

# Verify version in package.json matches
PKG_VER=$(node -p "require('$VERIFY/package.json').version" 2>/dev/null || echo "")
if [ "$PKG_VER" != "$VERSION" ]; then
  echo "  ❌ Version mismatch: package.json=$PKG_VER, expected=$VERSION"
  ERRORS=$((ERRORS + 1))
fi

if BAD_CLAUDE_NATIVE=$(find_claude_sdk_native_packages "$VERIFY" | head -20); [ -n "$BAD_CLAUDE_NATIVE" ]; then
  echo "  ❌ Claude Agent SDK native package(s) should not be bundled:"
  echo "$BAD_CLAUDE_NATIVE" | sed 's/^/     /'
  ERRORS=$((ERRORS + 1))
fi

rm -rf "$VERIFY" "$WORK"

if [ "$ERRORS" -gt 0 ]; then
  echo "❌ Validation failed with $ERRORS error(s)"
  exit 1
fi

# ── Output info ──
if command -v sha256sum >/dev/null 2>&1; then
  SHA256=$(sha256sum "$ARCHIVE" | cut -d' ' -f1)
else
  SHA256=$(shasum -a 256 "$ARCHIVE" | cut -d' ' -f1)
fi

if command -v numfmt >/dev/null 2>&1; then
  SIZE_HUMAN=$(stat -c%s "$ARCHIVE" | numfmt --to=iec)
  SIZE_BYTES=$(stat -c%s "$ARCHIVE")
elif command -v stat >/dev/null 2>&1; then
  SIZE_BYTES=$(stat -f%z "$ARCHIVE" 2>/dev/null || stat -c%s "$ARCHIVE" 2>/dev/null)
  SIZE_HUMAN="${SIZE_BYTES} bytes"
fi

MAX_RUNTIME_ARCHIVE_BYTES="${MINDOS_MAX_RUNTIME_ARCHIVE_BYTES:-125829120}"
if [ "$SIZE_BYTES" -gt "$MAX_RUNTIME_ARCHIVE_BYTES" ]; then
  echo "❌ Runtime archive is too large: ${SIZE_BYTES} bytes (limit ${MAX_RUNTIME_ARCHIVE_BYTES} bytes)"
  echo "   Check for package-internal node_modules, _standalone, .next, or other generated artifacts in bundled dependencies."
  exit 1
fi

echo ""
echo "✅ mindos-runtime-${VERSION}.tar.gz"
echo "   Size:   ${SIZE_HUMAN} (${SIZE_BYTES} bytes)"
echo "   SHA256: ${SHA256}"
echo "   Path:   ${ARCHIVE}"
