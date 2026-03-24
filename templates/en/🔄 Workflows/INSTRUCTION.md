# Workflows Instruction Set

## Goal

- Define local execution rules for `🔄 Workflows/`.
- Ensure SOP documents are executable, reusable, and maintainable.

## Local Rules

- Read root `INSTRUCTION.md` first, then this file.
- Workflow documents must be step-oriented; avoid concept-only descriptions.
- Each subdirectory should focus on a single scenario (e.g. Research, Media, Information, Configurations, Startup).
- When a workflow involves commands or operation sequences, prefer the smallest directly executable steps.

## Execution Order

1. Root `INSTRUCTION.md`
2. This directory `INSTRUCTION.md`
3. This directory `README.md` and target files

## Boundary

- Root rules win on conflict.

## Sync Rules (Workflows)

- When adding a new scenario subdirectory: update `🔄 Workflows/README.md` structure tree.
- When renaming or moving an SOP: update all reference paths.
- When a workflow is replaced or deprecated: mark status in the relevant doc to prevent executing stale SOPs.
