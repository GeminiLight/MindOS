# Post-task hooks

After completing a task, check the conditions below. If one matches, make a **one-line** proposal to the user. If none match, end quietly.

## Discipline

1. Do not propose after simple operations (rename, append one line, read-only queries).
2. **At most 1 proposal per task** — pick the highest priority match.
3. One sentence + specific target file/path. Only expand if the user says yes.
4. Check `user-skill-rules.md` suppression section first — skip any suppressed hook.
5. If the user asked for **no suggestions / quiet mode** for this turn or session, skip all hooks.

## Default hooks

### Experience capture (priority: high)
- **Condition**: task involved debugging, troubleshooting, or took multiple rounds to resolve.
- **Propose**: "Record this experience to {related experience file}?"
- **Format**: problem → cause → solution → rule

### Consistency sync (priority: high)
- **Condition**: edited file A, and A is referenced by other files (check via `get_backlinks`).
- **Propose**: "{B} references what you just changed — sync it?"

### Linked update (priority: medium)
- **Condition**: changed a CSV/TODO item status, and related docs exist.
- **Propose**: "Sync the corresponding info in {related doc}?"

### Structure classification (priority: medium)
- **Condition**: created a new file in a temporary location or inbox.
- **Propose**: "Move this to {recommended directory}?"

### Pattern extraction (priority: low)
- **Condition**: 3+ structurally similar operations in the current session.
- **Propose**: "This operation repeated multiple times — create an SOP?"

### SOP drift (priority: medium)
- **Condition**: task was executed following an existing SOP, but actual steps diverged from documented steps.
- **Propose**: "Execution diverged from {SOP file} — update the SOP?"
- **Action**: update divergent steps, append new pitfalls, set `<!-- last-used: -->` to today.

### Conversation retrospective (priority: low)
- **Condition**: session >10 turns and involved decisions, trade-offs, or lessons.
- **Propose**: "This conversation had some decisions worth capturing — do a retrospective?"

## User-defined hooks

Add your own below, same format:

```markdown
### Weekly report material (priority: medium)
- Condition: updated a Project-related file.
- Propose: "Record this change in the weekly report?"
```
