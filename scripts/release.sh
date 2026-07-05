#!/usr/bin/env bash
set -euo pipefail

# ── Usage ────────────────────────────────────────────────────────────────
# npm run release [patch|minor|major]   (default: patch)
# ─────────────────────────────────────────────────────────────────────────

BUMP="${1:-patch}"
REPO_ROOT="$(pwd -P)"

# 1. Ensure clean working tree
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌ Working tree is not clean. Commit or stash changes first."
  exit 1
fi

# 2. Run tests
echo "🧪 Running tests..."
pnpm run test:release
echo ""

# 3. Verify Next.js build
echo "🔨 Verifying Next.js build..."
pnpm --filter @geminilight/mindos build
if pnpm --filter @mindos/web run build 2>&1 | tail -5; then
  echo "   ✅ Next.js build succeeded"
else
  echo "❌ Next.js build failed"
  exit 1
fi
echo "🩺 Verifying standalone server (/api/health)..."
node scripts/prepare-standalone.mjs
node scripts/prepare-static-web.mjs
if node scripts/verify-standalone.mjs; then
  echo "   ✅ Standalone smoke OK"
else
  echo "❌ Standalone verify failed (trace / serverExternalPackages?)"
  exit 1
fi
echo ""

# 4. Smoke test: pack → install in temp dir → verify CLI works
echo "🔍 Smoke testing package..."
if ! command -v bun >/dev/null 2>&1; then
  echo "❌ Bun is required to build single-binary platform packages. Install Bun 1.2.17+ and retry."
  exit 1
fi
SMOKE_DIR=$(mktemp -d)
node scripts/stage-product-package.mjs
node scripts/build-platform-packages.mjs --current --out "$SMOKE_DIR/platforms"
PLATFORM_KEY=$(node -e "const fs=require('node:fs'); const p=process.platform==='win32'?'windows':process.platform; const musl=p==='linux'&&fs.existsSync('/etc/alpine-release'); console.log(p+'-'+process.arch+(musl?'-musl':''))")
TARBALL=$(cd packages/mindos && npm pack --pack-destination "$SMOKE_DIR" 2>/dev/null | tail -1)
TARBALL_PATH="$SMOKE_DIR/$TARBALL"
PLATFORM_TARBALL=$(cd "$SMOKE_DIR/platforms/$PLATFORM_KEY" && npm pack --pack-destination "$SMOKE_DIR" --ignore-scripts 2>/dev/null | tail -1)
PLATFORM_TARBALL_PATH="$SMOKE_DIR/$PLATFORM_TARBALL"

if [ ! -f "$TARBALL_PATH" ] || [ ! -f "$PLATFORM_TARBALL_PATH" ]; then
  echo "❌ npm pack failed — tarball not found"
  rm -rf "$SMOKE_DIR"
  exit 1
fi

TARBALL_SIZE=$(du -sh "$TARBALL_PATH" | cut -f1)
PLATFORM_TARBALL_SIZE=$(du -sh "$PLATFORM_TARBALL_PATH" | cut -f1)
echo "   📦 Tarball: $TARBALL ($TARBALL_SIZE)"
echo "   📦 Platform: $PLATFORM_TARBALL ($PLATFORM_TARBALL_SIZE)"

# Install from tarball in isolation (production deps only)
cd "$SMOKE_DIR"
npm init -y --silent >/dev/null 2>&1
# Omit registry optional deps here because this pre-bump smoke uses the current
# package version; stale published platform packages can otherwise affect bin links.
npm install "$PLATFORM_TARBALL_PATH" "$TARBALL_PATH" --ignore-scripts --omit=optional >/dev/null 2>&1
npm rebuild --bin-links >/dev/null 2>&1

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

AGENT_HOME=$(mktemp -d)
if PATH="$SMOKE_DIR/node_modules/.bin:$PATH" HOME="$AGENT_HOME" NODE_ENV=test "$SMOKE_DIR/node_modules/.bin/mindos" mcp install codex -g -y >/tmp/mindos-release-agent-install.log 2>&1; then
  AGENT_DOCTOR=$(PATH="$SMOKE_DIR/node_modules/.bin:$PATH" HOME="$AGENT_HOME" NODE_ENV=test "$SMOKE_DIR/node_modules/.bin/mindos" doctor agents codex --json 2>&1 || true)
  if ! echo "$AGENT_DOCTOR" | grep -q '"ready":true'; then
    echo "❌ 'mindos doctor agents codex --json' did not report ready after install"
    echo "$AGENT_DOCTOR"
    rm -rf "$AGENT_HOME" "$SMOKE_DIR"
    exit 1
  fi
  if [ ! -f "$AGENT_HOME/.agents/skills/mindos/SKILL.md" ]; then
    echo "❌ Codex Skill was not installed from packaged runtime"
    rm -rf "$AGENT_HOME" "$SMOKE_DIR"
    exit 1
  fi
else
  echo "❌ 'mindos mcp install codex -g -y' failed in release smoke"
  cat /tmp/mindos-release-agent-install.log
  rm -rf "$AGENT_HOME" "$SMOKE_DIR"
  exit 1
fi
rm -rf "$AGENT_HOME" /tmp/mindos-release-agent-install.log
echo "   ✅ agent install + doctor readiness works"

# Verify key files are present in the installed main package
for f in bin/mindos-shim.cjs dist/index.js dist/protocols/acp/index.js dist/protocols/mcp-server/index.cjs; do
  if [ ! -f "$SMOKE_DIR/node_modules/@geminilight/mindos/$f" ]; then
    echo "❌ Missing file in package: $f"
    rm -rf "$SMOKE_DIR"
    exit 1
  fi
done
for f in bin/mindos runtime-manifest.json package.json; do
  if [ ! -f "$SMOKE_DIR/node_modules/@geminilight/mindos-$PLATFORM_KEY/$f" ]; then
    echo "❌ Missing file in platform package: $f"
    rm -rf "$SMOKE_DIR"
    exit 1
  fi
done
if [ -d "$SMOKE_DIR/node_modules/@geminilight/mindos-$PLATFORM_KEY/_standalone" ]; then
  echo "❌ Platform package exposes _standalone; expected Bun single-binary layout"
  rm -rf "$SMOKE_DIR"
  exit 1
fi
echo "   ✅ Main + platform key files present"

# Cleanup. Leave the temp install directory before deleting it so subsequent
# git operations never run from a removed working directory.
cd "$REPO_ROOT"
rm -rf "$SMOKE_DIR"
echo "   🟢 Smoke test passed"
echo ""

# 5. Bump version in the private root and published product package
echo "📦 Bumping version ($BUMP)..."
npm version "$BUMP" --no-git-tag-version
(cd packages/mindos && npm version "$BUMP" --no-git-tag-version)
node scripts/sync-platform-package-versions.mjs
pnpm install --lockfile-only
VERSION="v$(node -p "require('./packages/mindos/package.json').version")"
git add package.json packages/mindos/package.json packages/mindos-platforms/*/package.json pnpm-lock.yaml
git commit -m "$VERSION"
git tag "$VERSION"
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
