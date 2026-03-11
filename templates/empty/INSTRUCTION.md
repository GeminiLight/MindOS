# MindOS Instruction Set

This file defines the base operating rules for collaboration between humans and agents inside the knowledge base.

> This file contains stable rules. Variable content (structure details, preferences, SOP specifics) should live in dedicated files.
>
> Terms: `MUST` = mandatory, `SHOULD` = strongly recommended.

---

## 1. Bootstrap Order

When entering a knowledge base, load context in this order:

1. Read root `INSTRUCTION.md` (this file)
2. Read root `README.md` (index and navigation)
3. Read `CONFIG.json` and `CONFIG.md` together (config values + semantic explanation)
4. Route to the target directory
5. If target directory has `INSTRUCTION.md`, read it first
6. Then read target `README.md` and target files
7. Execute

Step 1 is **MUST**. Steps 2-6 are **SHOULD**, and must not be skipped for write/delete/rename operations.

---

## 2. File Roles and Priority

### 2.1 File Roles

| File | Role |
|------|------|
| Root `INSTRUCTION.md` | Global immutable rules and precedence |
| Subdirectory `INSTRUCTION.md` | Local execution rules for that directory |
| `README.md` | Navigation and usage guidance |
| Regular content files | Business content (SOPs, profiles, records) |

### 2.2 Priority (Strict)

`root INSTRUCTION.md` > `subdirectory INSTRUCTION.md` > `README.md` > `regular content files`

- Resolve conflicts using this exact order.
- `README.md` cannot override any `INSTRUCTION.md` rule.

### 2.3 README.md Standard

Each first-level directory (such as `👤 Profile/`, `🔗 Connections/`, `🔄 Workflows/`) should include a `README.md` with:

1. **One-line purpose** (directory responsibility)
2. **📁 Structure** (file tree + short notes)
3. **💡 Usage** (what each file/subdirectory is for)

Rules like update policy, execution boundaries, and precedence belong to `INSTRUCTION.md`, not to README standards.

---

## 3. How to Create Subdirectory INSTRUCTION.md

Create it only when local rules are reusable and meaningful. Avoid creating them by default.

### 3.1 Good Cases

- Multiple files under one directory share execution constraints
- The directory has its own schema or safety boundary
- The directory is high-frequency and mistakes are costly

### 3.2 Avoid Cases

- Pure structural description (put in README)
- One-off notes with no reuse
- Highly unstable rules with no fixed boundary

### 3.3 Standard Steps

1. Create `INSTRUCTION.md` in the target directory
2. Write only local rules; do not duplicate root rules
3. Explicitly state: if conflict exists, root rules win
4. Add one line in that directory README usage section: read local `INSTRUCTION.md` before execution

### 3.4 Minimal Template

```markdown
# <Domain> Instruction Set

## Goal
- Local goal for this directory

## Local Rules
- Rule 1
- Rule 2

## Execution Order
1. Root `INSTRUCTION.md`
2. Local `INSTRUCTION.md`
3. Local `README.md` and target files

## Boundary
- Root rules win on conflict
```

### 3.5 Recommendation for First-Level Directories (Project Root Children)

- First-level directories are direct children of the project root, for example: `🔗 Connections/`, `🔄 Workflows/`, `👤 Profile/`, `📚 Resources/`.
- It is recommended that these first-level directories provide a lightweight `INSTRUCTION.md` by default.
- A lightweight version should include at least:
  - Directory goal
  - Local rules (2-5 items)
  - Execution order (root rules -> local rules -> README/target files)
  - Conflict fallback statement (root rules win)
- If a first-level directory truly has no stable rules, you may skip it temporarily; once repeated constraints appear, add it immediately.

---

## 4. Filesystem Rules

### 4.1 File Types

- Documents: `.md`
- Data: `.csv`
- Config: `.json`

### 4.2 Naming

- Content files: optional `emoji + name`
- Directories: follow `languagePreference.folderNamingLanguage`; zh templates default to Chinese naming, en templates default to English naming.
- System files: `README.md`, `INSTRUCTION.md`, `TODO.md`, `CHANGELOG.md`, `CONFIG.json`, `CONFIG.md`

### 4.3 Read-Before-Write

- **MUST** read target file before writing
- **SHOULD** verify CSV header before append

---

## 5. Sync and Change Rules

### 5.1 Must Sync

- Add/delete/rename first-level directory: update root `README.md`
- Delete/rename files: update all references

### 5.2 Should Sync

- Add new files: update that directory README tree
- CSV row append: no README sync required

---

## 6. Safety Boundaries

- **MUST** not delete files unless user explicitly requests
- **MUST** not store secrets (keys, tokens, passwords)
- Confirm before bulk delete or structural reorganization

---

## 7. Tracking

- `TODO.md`: pending tasks
- `CHANGELOG.md`: completed items (reverse chronological)

---

## 8. Example Data Isolation (Naming Convention)

- Example files/directories must use `_example` or `_examples` in naming.
- Do not use `.example` or `.examples` to avoid hidden-file semantic confusion.
- Any content containing `_example` or `_examples` is example-only, not user production data.
- Example content may demonstrate structure/style, but must not be treated as real facts for execution.

---

## 9. CONFIG Read Protocol

- `CONFIG.json` and `CONFIG.md` must be read together.
- They are complementary and have no priority relationship.
- `CONFIG.json` provides structured config values; `CONFIG.md` provides semantic explanation and intent.
