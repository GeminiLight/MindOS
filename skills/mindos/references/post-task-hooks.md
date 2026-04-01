# Post-task hooks — propose format

Conditions are listed in SKILL.md. Read this file only when a hook has already triggered.

## Propose format

One sentence + specific target file/path. Only expand if the user says yes.

| Hook | Propose template |
|------|-----------------|
| Experience capture | "Record this experience to {related experience file}?" — Format: problem → cause → solution → rule |
| Consistency sync | "{B} references what you just changed — sync it?" |
| SOP drift | "Execution diverged from {SOP file} — update the SOP?" — Action: update diverged steps, append pitfalls, set `<!-- last-used: -->` to today |
| Linked update | "Sync the corresponding info in {related doc}?" |
| Structure classification | "Move this to {recommended directory}?" |
| Pattern extraction | "This operation repeated multiple times — create an SOP?" |
| Conversation retrospective | "This conversation had some decisions worth capturing — do a retrospective?" |

## User-defined hooks

Add your own below, same format:

```markdown
### Weekly report material (priority: medium)
- Condition: updated a Project-related file.
- Propose: "Record this change in the weekly report?"
```
