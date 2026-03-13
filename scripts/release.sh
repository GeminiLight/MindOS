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
