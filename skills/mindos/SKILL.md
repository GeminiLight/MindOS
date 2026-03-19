---
name: mindos
description: >
  MindOS knowledge base operation guide, only for agent tasks on files inside the MindOS knowledge base.
  Trigger only when the target files are inside the MindOS knowledge base directory.
  Typical requests: "update notes", "search knowledge base", "organize files", "execute SOP",
  "review with our standards", "handoff to another agent", "sync decisions", "append CSV",
  "retrospective", "distill this conversation", "capture key learnings", "update related docs adaptively",
  "route this to the right files", "update everything related", "sync this across my knowledge base".
  Do NOT trigger when: the target is a local code repository file (e.g. /code/xxx/wiki/*.md),
  the user provides an absolute path that is not under MindOS mindRoot,
  or the task involves modifying project source code or project documentation.
---

# MindOS Skill

Load operating rules from the knowledge base, then execute the user's task.

## Protocol

1. Read `.agents/skills/mindos/skill-rules.md` — operating rules.
   - If not found: fall back to `mindos_bootstrap` (or read root INSTRUCTION.md
     + README.md). Inform user: "Run `mindos init-skills` for full skill rules."
2. If `.agents/skills/mindos/user-rules.md` exists and is non-empty:
   read it. User rules override default rules on conflict.
3. Execute task following loaded rules. After completion, evaluate proactive hooks.
