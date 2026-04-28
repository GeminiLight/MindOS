# Resources Directory Instruction Set

## Goal

- Define local execution rules for `📚 Resources/`.
- Standardize maintenance of AI resource index CSV files.

## Local Rules

- Read root `INSTRUCTION.md` first, then this file.
- This directory is CSV-first; avoid unindexed temporary documents.
- Reuse existing CSV themes before creating new ones.
- Validate header and field semantics before appending rows.

## Execution Order

1. Root `INSTRUCTION.md`
2. This directory `INSTRUCTION.md`
3. This directory `README.md` and target files

## Boundary

- Root rules win on conflict.

## Sync Rules (Resources)

- On add/rename of CSV files: update `📚 Resources/README.md` structure and usage.
- On schema changes: sync field semantics across related CSV files.
- After bulk changes: run `rg` to clean stale references.
