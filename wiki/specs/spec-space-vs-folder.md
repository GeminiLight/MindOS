<!-- Created: 2026-03-30 | Status: Implemented -->

# Spec: Space vs Regular Folder

## Problem

Previously, `createFile()` unconditionally called `scaffoldIfNewSpace()`, which auto-generated `INSTRUCTION.md` + `README.md` in any new top-level directory. This meant:

- Creating `Projects/demo/test.md` would auto-create `Projects/INSTRUCTION.md` + `Projects/README.md`
- Every new folder silently became a Space
- Users accumulated governance files they never asked for
- Maintenance burden: orphaned README/INSTRUCTION files cluttering the tree

## Design Decision

**Spaces are intentional, not accidental.**

| | Space | Folder |
|--|--|--|
| Definition | Knowledge partition with agent governance | Plain directory for organization |
| Marker | Contains `INSTRUCTION.md` | No `INSTRUCTION.md` |
| Created via | `mindos_create_space` or "Convert to Space" | `mindos_create_file` (parent dirs auto-created) |
| Governance | INSTRUCTION.md rules apply to all agents | No agent rules |
| README | Auto-generated with description | None (unless user creates one) |

## Solution

Removed `scaffoldIfNewSpace()` from two call sites:

1. **`app/lib/core/fs-ops.ts:createFile()`** — no longer scaffolds
2. **`app/app/api/file/import/route.ts`** — no longer scaffolds after import

Space creation is now **explicit only**:
- `CreateSpaceModal` → calls `createSpaceFilesystem()` (creates README + INSTRUCTION)
- Right-click "Convert to Space" → calls `convertToSpace()` (creates README + INSTRUCTION)

## Changes

| File | Change |
|------|--------|
| `app/lib/core/fs-ops.ts` | Removed `scaffoldIfNewSpace()` call from `createFile()` |
| `app/app/api/file/import/route.ts` | Removed `scaffoldIfNewSpace()` import and call |
| `skills/mindos/SKILL.md` | Clarified `create_file` vs `create_space` tool descriptions |
| `skills/mindos-zh/SKILL.md` | Chinese version sync |
| `app/data/skills/mindos/SKILL.md` | Built-in copy sync |
| `app/data/skills/mindos-zh/SKILL.md` | Built-in copy sync |
| `mcp/src/index.ts` | Updated `mindos_create_file` tool description |
| `app/lib/agent/tools.ts` | Updated `create_file` agent tool description |

## User Impact

- No more accidental Spaces
- Cleaner knowledge base structure
- Fewer files to maintain
- Spaces are now a deliberate architectural choice
