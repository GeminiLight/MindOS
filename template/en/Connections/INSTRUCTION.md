# Connections Instruction Set

This directory stores reusable relationship context for agent collaboration.

## Authority and Priority

- Rule precedence in this directory:
  `root INSTRUCTION.md` > `this INSTRUCTION.md` > `README.md` > content files.
- If any conflict appears, root rules win.

## Execution Order

1. Read root `INSTRUCTION.md`
2. Read this file (`Connections/INSTRUCTION.md`)
3. Read `Connections/README.md` and `Connections.csv`
4. Read target person `*.md` files under category folders
5. Execute

## Storage Structure (Required)

### 1) Root Overview CSV (Required)

Maintain `Connections.csv` at `Connections/` root.

Purpose:
- Fast machine-readable index of all contacts
- Tracks category, status, last interaction, and detail file path

### 2) Person Detail Markdown (Required)

Each person must have an individual `*.md` file under one category folder:
- `Family/`
- `Friends/`
- `Classmates/`
- `Colleagues/`
- `Mentors/`

Recommended filename: `First_Last.md` (for example, `Jane_Doe.md`).

## CSV Schema

`Connections.csv` header should be:

- `Name`
- `Category`
- `Relationship`
- `CurrentRole`
- `Location`
- `Status`
- `LastInteraction`
- `MdPath`
- `UpdatedAt`

Rules:
- `Category` values: `Family|Friends|Classmates|Colleagues|Mentors`
- `MdPath` must be relative (for example, `Friends/Jane_Doe.md`)
- `UpdatedAt` must use `YYYY-MM-DD`

## Person Markdown Minimum Fields

Each person file should include:

- `Name`
- `Relationship`
- `Current Role`
- `Location`
- `Communication Preference`
- `Last Interaction`
- `Next Action`
- `Notes`

## Consistency Rules

- On add: create person `*.md` and append one row to `Connections.csv`.
- On rename/move/delete: update `MdPath` in `Connections.csv`.
- On category move: update both folder location and `Category`/`MdPath`.

## Privacy Rules

- Do not store passwords, private keys, IDs, bank information, or sensitive medical details.
- Avoid highly sensitive personal details unless strictly required.
- Assume multiple agents may read this data; keep only required context.

## Example Naming Rules

- `Connections_examples.csv` and `_examples/` are example-only.
- Any file/folder containing `_example` or `_examples` is not user production data.
