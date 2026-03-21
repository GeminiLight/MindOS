#!/usr/bin/env bash
set -euo pipefail

# ── Usage ────────────────────────────────────────────────────────────────
# npm run release [patch|minor|major]   (default: patch)
# ─────────────────────────────────────────────────────────────────────────

BUMP="${1:-patch}"

# 1. Ensure clean working tree
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌ Working tree is not clean. Commit or stash changes first."
  exit 1
fi

# 2. Run tests
echo "🧪 Running tests..."
npm test
echo ""

# 3. Smoke test: pack → install in temp dir → verify CLI works
echo "🔍 Smoke testing package..."
SMOKE_DIR=$(mktemp -d)
TARBALL=$(npm pack --pack-destination "$SMOKE_DIR" 2>/dev/null | tail -1)
TARBALL_PATH="$SMOKE_DIR/$TARBALL"

if [ ! -f "$TARBALL_PATH" ]; then
  echo "❌ npm pack failed — tarball not found"
  rm -rf "$SMOKE_DIR"
  exit 1
fi

TARBALL_SIZE=$(du -sh "$TARBALL_PATH" | cut -f1)
echo "   📦 Tarball: $TARBALL ($TARBALL_SIZE)"

# Install from tarball in isolation (production deps only)
cd "$SMOKE_DIR"
npm init -y --silent >/dev/null 2>&1
npm install "$TARBALL_PATH" --ignore-scripts >/dev/null 2>&1

# Verify bin entry exists and is executable
if [ ! -f "$SMOKE_DIR/node_modules/.bin/mindos" ]; then
  echo "❌ 'mindos' binary not found after install"
  rm -rf "$SMOKE_DIR"
  exit 1
fi

# Verify --version works
INSTALLED_VERSION=$("$SMOKE_DIR/node_modules/.bin/mindos" --version 2>&1 || true)
if [ -z "$INSTALLED_VERSION" ]; then
  echo "❌ 'mindos --version' returned empty"
  rm -rf "$SMOKE_DIR"
  exit 1
fi
echo "   ✅ mindos --version → $INSTALLED_VERSION"

# Verify --help works (exits 0, produces output)
HELP_OUTPUT=$("$SMOKE_DIR/node_modules/.bin/mindos" --help 2>&1 || true)
if ! echo "$HELP_OUTPUT" | grep -qi "mindos"; then
  echo "❌ 'mindos --help' did not produce expected output"
  rm -rf "$SMOKE_DIR"
  exit 1
fi
echo "   ✅ mindos --help works"

# Verify key files are present in the installed package
for f in bin/cli.js app/package.json app/next.config.ts skills/mindos/SKILL.md; do
  if [ ! -f "$SMOKE_DIR/node_modules/@geminilight/mindos/$f" ]; then
    echo "❌ Missing file in package: $f"
    rm -rf "$SMOKE_DIR"
    exit 1
  fi
done
echo "   ✅ Key files present"

# Cleanup
rm -rf "$SMOKE_DIR"
cd - >/dev/null
echo "   🟢 Smoke test passed"
echo ""

# 3. Bump version (creates commit + tag automatically)
echo "📦 Bumping version ($BUMP)..."
npm version "$BUMP" -m "%s"
VERSION="v$(node -p "require('./package.json').version")"
echo "   Version: $VERSION"
echo ""

# 4. Push commit + tag
echo "🚀 Pushing to origin..."
git push origin main
git push origin "$VERSION"
echo ""

# 5. Wait for CI (if gh is available)
if command -v gh &>/dev/null; then
  echo "⏳ Waiting for CI publish workflow..."
  TIMEOUT=120
  ELAPSED=0
  RUN_ID=""

  # Wait for the workflow run to appear
  while [ -z "$RUN_ID" ] && [ "$ELAPSED" -lt 30 ]; do
    sleep 3
    ELAPSED=$((ELAPSED + 3))
    RUN_ID=$(gh run list --workflow=publish-npm.yml --limit=1 --json databaseId,headBranch --jq ".[0].databaseId" 2>/dev/null || true)
  done

  if [ -n "$RUN_ID" ]; then
    gh run watch "$RUN_ID" --exit-status && echo "✅ Published $VERSION to npm" || echo "❌ CI failed — check: gh run view $RUN_ID --log"
  else
    echo "⚠️  Could not find CI run. Check manually: https://github.com/GeminiLight/mindos-dev/actions"
  fi
else
  echo "💡 Install 'gh' CLI to auto-watch CI status."
  echo "   Check publish status: https://github.com/GeminiLight/mindos-dev/actions"
fi
