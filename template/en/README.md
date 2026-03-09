# My Mind

Root entry of your personal knowledge system. Agents should read this index before execution.

## 📁 Structure

```bash
my-mind/
├── INSTRUCTION.md   # Global rules (highest priority)
├── README.md        # Root index (this file)
├── TODO.md          # Pending tasks
├── CHANGELOG.md     # Completed log (reverse chronological)
├── Profile/         # Identity, preferences, goals, current focus
├── Notes/           # Quick capture and temporary notes
├── Connections/     # Relationship context
├── Configurations/  # Environment and tooling SOPs
├── Workflows/       # Workflow SOPs
├── Resources/       # External resource collections (CSV)
└── Projects/        # Project documents
```

## 💡 Usage

- Bootstrap read order: `INSTRUCTION.md` -> `README.md`
- Capture first in `Notes/`, then move stable content to domain folders
- Directories that need regular updates: `Profile/`, `Connections/`, `Projects/`

## 📐 Update Rules

- If first-level directories are added/removed/renamed, update this file
- If files are deleted/renamed, update all related references
