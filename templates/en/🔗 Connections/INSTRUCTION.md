# Connections Instruction Set

This directory stores reusable relationship context for agent collaboration.

## Authority and Priority

- Rule precedence in this directory:
  `root INSTRUCTION.md` > `this INSTRUCTION.md` > `README.md` > content files.
- If any conflict appears, root rules win.

## Local Rules

- Maintain overview index at root: `Connections Overview.csv`.
- Each person must have one markdown file under a category folder:
  `Family/`, `Friends/`, `Classmates/`, `Colleagues/`.
- `MdPath` in overview CSV must be relative and point to an existing file.
- Example content is reference-only and not production user data.

## Execution Order

1. Read root `INSTRUCTION.md`
2. Read this file (`🔗 Connections/INSTRUCTION.md`)
3. Read `🔗 Connections/README.md` and `Connections Overview.csv`
4. Read target person `*.md` files under category folders
5. Execute

## CSV Schema

`Connections Overview.csv` header:

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

- `Category` values: `Family|Friends|Classmates|Colleagues`
- `MdPath` must be relative (for example, `Friends/Jane_Doe.md`)
- `UpdatedAt` must use `YYYY-MM-DD`

## Consistency Rules

- On add: create person `*.md` and append one row to `Connections Overview.csv`.
- On rename/move/delete: update `MdPath` and all affected references.
- On category move: update folder location, `Category`, and `MdPath`.

## Example Naming Rules

- Example files must be placed in category folders, named `🧪_example_xxx.md`.
- Any file/folder containing `_example` or `_examples` is not user production data.
