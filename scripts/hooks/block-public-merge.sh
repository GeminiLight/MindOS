#!/bin/bash
# ─── Guard: block merge from public repo ─────────────────────────────────────
# Shared logic used by both pre-merge-commit and prepare-commit-msg hooks.
#
# Merging public/main into mindos-dev deletes private-only files
# (.syncinclude, sync-to-mindos.yml, wiki/, etc.) because the public
# repo doesn't carry them. Use cherry-pick instead:
#
#   git fetch public
#   git cherry-pick <commit>

set -e

if [ "$ALLOW_PUBLIC_MERGE" = "1" ]; then
  exit 0
fi

MERGE_HEAD=$(cat .git/MERGE_HEAD 2>/dev/null || true)
if [ -z "$MERGE_HEAD" ]; then
  exit 0
fi

for remote in $(git remote); do
  REMOTE_URL=$(git remote get-url "$remote" 2>/dev/null || echo "")
  if echo "$REMOTE_URL" | grep -qi "GeminiLight/MindOS\.git\|GeminiLight/mindos\.git"; then
    if git branch -r --contains "$MERGE_HEAD" 2>/dev/null | grep -q "^  ${remote}/"; then
      echo ""
      echo "  ❌ BLOCKED: Merging from public repo ($remote) is forbidden."
      echo ""
      echo "  Merging public/main deletes private-only files:"
      echo "    .syncinclude, sync-to-mindos.yml, wiki/, etc."
      echo ""
      echo "  Use cherry-pick instead:"
      echo "    git fetch $remote"
      echo "    git cherry-pick <commit>"
      echo ""
      echo "  To force (dangerous): ALLOW_PUBLIC_MERGE=1 git merge $remote/main"
      echo ""
      exit 1
    fi
  fi
done
