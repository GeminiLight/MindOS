# CONFIG Guide

This file explains template config in human-readable form.

## Scope

- Locale scope: `template/en/`.
- Related machine-readable file: `template/en/CONFIG.json`.

## Read Rule

- `CONFIG.json` and `CONFIG.md` must be read together.
- They are complementary and have no priority relationship.
- JSON provides structured values; MD provides explanatory intent.

## Key Settings

### `filename`

- `emojiPrefixDefault`: whether new filenames default to emoji prefix
- `allowEmojiPrefix`: whether emoji prefix is allowed in filenames
- `exampleSuffixSingle`: suffix for single example files (default `_example`)
- `exampleSuffixCollection`: suffix for example collection folders (default `_examples`)

### `structure`

- `requireFirstLevelReadme`: whether first-level directories must include `README.md`
- `recommendFirstLevelInstruction`: whether first-level directories are recommended to include `INSTRUCTION.md`
- `syncEnAndZhStructure`: whether `en` and `zh` structures must remain isomorphic

### `document.title`

- `emojiEnabled`: whether generated titles allow emoji by default
- `defaultHeadingLevel`: default heading level for generated titles (currently `2`)

### `connections`

- `requireRootCsv`: whether `Connections/` requires a root CSV
- `rootCsvName`: official index CSV filename
- `examplesCsvName`: example index CSV filename
- `onePersonOneMarkdown`: whether each person must have one markdown profile

### `profile`

- `minimalFiles`: minimal core file set for Profile

## Change Rules

1. Update `template/en/CONFIG.json` and `template/zh/CONFIG.json` together when keys change.
2. Keep semantic parity across both locales.
3. Update both locale `CONFIG.md` files when keys are added/removed/renamed.
4. Do not document defaults here that conflict with JSON values.
