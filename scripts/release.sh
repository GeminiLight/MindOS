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

# 3. Verify Next.js build
echo "🔨 Verifying Next.js build..."
cd app
if npx next build 2>&1 | tail -5; then
  echo "   ✅ Next.js build succeeded"
else
  echo "❌ Next.js build failed"
  exit 1
fi
cd ..
echo "🩺 Verifying standalone server (/api/health)..."
if node scripts/verify-standalone.mjs; then
  echo "   ✅ Standalone smoke OK"
else
  echo "❌ Standalone verify failed (trace / serverExternalPackages?)"
  exit 1
fi
# Restore any files modified by next build (e.g. next-env.d.ts)
git checkout -- . 2>/dev/null || true
echo ""

# 4. Smoke test: pack → install in temp dir → verify CLI works
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

# 5. Bump version (creates commit + tag automatically)
echo "📦 Bumping version ($BUMP)..."
npm version "$BUMP" -m "%s"
VERSION="v$(node -p "require('./package.json').version")"
echo "   Version: $VERSION"
echo ""

# 6. Push commit + tag
echo "🚀 Pushing to origin..."
git push origin main
git push origin "$VERSION"
echo ""

# 7. Wait for CI
# Flow: tag push → sync-to-mindos (syncs code + tag to public repo) → public repo publish-npm
if command -v gh &>/dev/null; then
  echo "⏳ Waiting for sync → publish pipeline..."
  echo "   mindos-dev tag push → sync-to-mindos → GeminiLight/MindOS tag → npm publish"
  TIMEOUT=120
  ELAPSED=0
  RUN_ID=""

  # Watch the sync workflow on mindos-dev
  while [ -z "$RUN_ID" ] && [ "$ELAPSED" -lt 30 ]; do
    sleep 3
    ELAPSED=$((ELAPSED + 3))
    RUN_ID=$(gh run list --workflow=sync-to-mindos.yml --limit=1 --json databaseId,headBranch --jq ".[0].databaseId" 2>/dev/null || true)
  done

  if [ -n "$RUN_ID" ]; then
    gh run watch "$RUN_ID" --exit-status && echo "✅ Synced $VERSION to GeminiLight/MindOS" || echo "❌ Sync failed — check: gh run view $RUN_ID --log"
    echo "   npm publish will be triggered on GeminiLight/MindOS."
    echo "   Check: https://github.com/GeminiLight/MindOS/actions"
  else
    echo "⚠️  Could not find CI run. Check manually:"
    echo "   Sync:    https://github.com/GeminiLight/mindos-dev/actions"
    echo "   Publish: https://github.com/GeminiLight/MindOS/actions"
  fi
else
  echo "💡 Release pipeline: mindos-dev → sync → GeminiLight/MindOS → npm publish"
  echo "   Check sync:    https://github.com/GeminiLight/mindos-dev/actions"
  echo "   Check publish: https://github.com/GeminiLight/MindOS/actions"
fi
