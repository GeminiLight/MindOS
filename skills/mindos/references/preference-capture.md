# Preference capture (`user-preferences.md`)

## When to capture

The user expresses a preference correction (e.g. "don't do X", "next time remember…", "this should go in… not in…").

## Confirm-then-write flow

1. **First occurrence of a new preference**: propose the rule and target file before writing.
   - "Record this preference to `user-preferences.md`? Rule: _{summary}_"
   - Write only after user confirms.
2. **Repeated confirmation on similar category**: after the user confirms the same category of preference 3+ times, auto-write future rules in that category without asking. Add an `auto-confirm: true` flag to the category header in `user-preferences.md`.
3. **User explicitly grants blanket permission** (e.g. "just record preferences directly"): set a top-level `auto-confirm-all: true` flag and skip confirmation for all future captures.

## File location

- Target: `.mindos/user-preferences.md` in the knowledge base (read by `mindos_bootstrap` when present).
- If the file does not exist, create it with the template below on first confirmed write.

## File template

```markdown
# User Skill Rules
<!-- auto-confirm-all: false -->

## Preferences
<!-- Group by category. Mark auto-confirm: true on categories confirmed 3+ times. -->

## Suppressed Hooks
<!-- List post-task hooks the user has opted out of. -->
```

## Rule format

Each rule is a bullet under its category:

```markdown
### {Category}
<!-- auto-confirm: false -->
- {Rule description} — _{date captured}_
```
