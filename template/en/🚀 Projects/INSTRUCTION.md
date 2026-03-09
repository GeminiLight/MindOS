# Directory Instruction Set

## Goal

- Define local execution rules for this first-level directory.

## Local Rules

- Read root `INSTRUCTION.md` first.
- Then read this directory `README.md` for navigation.
- Keep edits minimal, structured, and traceable.
- Keep product projects in `Products/`, research projects in `Research/`, and inactive projects in `Archived/`.

## Execution Order

1. Root `INSTRUCTION.md`
2. This directory `INSTRUCTION.md`
3. This directory `README.md` and target files

## Boundary

- Root rules win on conflict.

## Sync Rules (Projects)

- On new product project: create one folder under `Products/`.
- On new research project: create one folder under `Research/`.
- On archive: move project to `Archived/` and sync affected references.
- On rename/delete/move: update this directory `README.md` and all path references.
