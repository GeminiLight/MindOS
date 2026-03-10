# CONFIG Guide

This file explains template config in human-readable form.

## Scope

- Locale scope: `templates/en/`.
- Related machine-readable file: `templates/en/CONFIG.json`.

## Read Rule

- `CONFIG.json` and `CONFIG.md` must be read together.
- They are complementary and have no priority relationship.
- JSON provides structured values; MD provides explanatory intent.

## Key Settings

### `languagePreference`

- `preferredLanguage`: global language preference
- `supportedLanguages`: selectable language options
- `folderNamingLanguage`: language used for folder/filename generation
- `contentWritingLanguage`: language used for generated writing content
- `enforceLocalizedNaming`: whether localized naming is enforced (en template defaults to English naming)

### `filename`

- `emojiPrefixDefault`: whether new filenames default to emoji prefix
- `allowEmojiPrefix`: whether emoji prefix is allowed in filenames
- `exampleSuffixSingle`: suffix for single example files (default `_example`)
- `exampleSuffixCollection`: suffix for example collection folders (default `_examples`)

### `structure`

- `requireFirstLevelReadme`: whether first-level directories must include `README.md`
- `recommendFirstLevelInstruction`: whether first-level directories are recommended to include `INSTRUCTION.md`

### `document.title`

- `emojiEnabled`: whether generated titles allow emoji by default
- `defaultHeadingLevel`: default heading level for generated titles (currently `2`)

### `protocol`

- `readMode`: config read mode
- `priorityBetweenConfigAndDoc`: relationship between config values and docs (`none` means no priority)
- `notes`: protocol notes

## Directory Naming and Level Rules (Semantic Layer in CONFIG.md)

These rules are directory naming semantics, documented in `CONFIG.md`:

- First-level directories (direct children of project root) default to `emoji + name`.
- Second-level and deeper directories default to no emoji.
- Directory naming language is controlled by `languagePreference.folderNamingLanguage`.
- Whether content filenames use emoji prefix is controlled by `filename.*`.

Current template convention (en):

- First-level examples: `👤 Profile/`, `📝 Notes/`, `🔗 Connections/`, `🔄 Workflows/`, `📚 Resources/`, `🚀 Projects/`
- Second-level examples: `Family/`, `Friends/`, `Classmates/`, `Colleagues/` (no emoji)

When naming policy changes:

1. Update semantic rules in `CONFIG.md` first.
2. Then sync `README.md`, `INSTRUCTION.md`, and actual directory structure.

## Change Rules

1. Update `templates/en/CONFIG.json` and `templates/zh/CONFIG.json` together when keys change.
2. Keep semantic parity across both locales.
3. Update both locale `CONFIG.md` files when keys are added/removed/renamed.
4. Do not document defaults here that conflict with JSON values.
