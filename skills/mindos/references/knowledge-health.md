# Knowledge Health Check

When the user asks to check KB health, detect conflicts, or audit knowledge quality, follow this guide.

## Dimensions

### 1. Contradictions / Conflicts

Two or more files state conflicting facts about the same topic (e.g., one says "rate limit = 100/min", another says "rate limit = 200/min" without distinguishing context).

**Detection procedure:**
1. Identify the topic scope (user may specify, or scan recent edits)
2. Search for all files related to the topic (2-4 keyword variants)
3. Read each hit and extract key claims/decisions
4. Compare claims across files — flag any pair that contradicts
5. Present conflicts to user with file paths and quotes

**Resolution:** Ask user which version is authoritative. Update or annotate the non-authoritative file to reference the correct source. Never silently overwrite.

### 2. Orphan References

A file links to another file that no longer exists (broken `[[link]]` or markdown link).

**Detection procedure:**
1. List all files in KB
2. For each file, extract all internal links (markdown links, wiki-links)
3. Check if each link target exists
4. Report broken links with source file path and line

**Resolution:** Either remove the dead link, or recreate the missing file if the content is recoverable from git history.

### 3. Stale / Outdated Content

Files with explicit date markers (e.g., "Last verified: 2025-01-15") that are significantly old, or files whose topic has clearly evolved but the file hasn't been updated.

**Detection procedure:**
1. Search for date markers: "Last verified", "Last updated", "截止日期", "更新时间"
2. Flag any file where the marker date is >90 days old
3. Also check `mindos file history <path>` — files untouched for >6 months with active topics are suspects

**Resolution:** Present the list to user. For each stale file, ask: still accurate? update? archive?

### 4. Duplicate Content

Two files covering the same topic with substantial overlap, neither referencing the other.

**Detection procedure:**
1. Search for the topic from multiple angles
2. If two files return as top results for the same query, read both
3. Compare: are they covering the same ground? Is one a superset of the other?
4. Flag duplicates with a similarity summary

**Resolution:** Merge into one authoritative file. Convert the other into a redirect/link. Never delete without confirmation.

### 5. Orphan Files

Files that no other file references — isolated knowledge that may be hard to discover.

**Detection procedure:**
1. For each file, run `mindos file backlinks <path>`
2. Files with zero backlinks AND not in a well-indexed directory (no README listing them) are orphan candidates
3. Exclude governance files (INSTRUCTION.md, README.md) and root-level files

**Resolution:** Suggest adding links from relevant parent documents or READMEs.

### 6. Structural Issues

- Files in wrong directories (content doesn't match the directory's topic)
- Inbox files that have been sitting >7 days (aging)
- Missing READMEs in directories with >3 files
- Inconsistent naming conventions within a directory

**Detection procedure:**
1. Bootstrap the KB tree
2. For each directory: check if README exists, read a sample of files to verify topic consistency
3. Check Inbox for aging files (>7 days)
4. Spot-check naming patterns per directory

## Health Report Format

Present findings as a structured report:

```markdown
# Knowledge Health Report — {date}

## Summary
- Contradictions found: N
- Broken links: N
- Stale files (>90 days): N
- Duplicates suspected: N
- Orphan files: N
- Structural issues: N
- **Overall health: {Good / Needs Attention / Critical}**

## Contradictions
1. `file-a.md` vs `file-b.md` — {description}
   ...

## Broken Links
1. `source.md` line N → `missing-target.md` (not found)
   ...

## Stale Content
1. `old-file.md` — Last updated: {date}, {N} days ago
   ...

(... other sections ...)

## Recommended Actions
1. {Highest priority fix}
2. ...
```

## Scope Control

- **Quick check**: User says "check health" / "快速检查" → Run dimensions 1-3 only (contradictions, orphan refs, stale)
- **Full audit**: User says "full audit" / "全面审计" → Run all 6 dimensions
- **Targeted check**: User specifies a topic or directory → Scope to that area only

Always confirm scope with user before starting a full audit on large KBs.
