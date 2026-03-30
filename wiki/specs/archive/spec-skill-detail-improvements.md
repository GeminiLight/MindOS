<!-- Created: 2026-03-30 | Status: Implemented -->

# Spec: Skill Detail Panel Improvements

## Problem

The skill detail popover had two UX issues:

1. **Content was raw text** — SKILL.md content was dumped in a `<pre>` block with no structure. Users couldn't quickly scan trigger conditions vs operating instructions.

2. **No agent management** — To add/remove agents from a skill, users had to navigate to a different section. The detail panel only showed agent avatars as read-only.

## Solution

### 1. Structured Content Rendering

Parse SKILL.md into meaningful sections:

| Section | Source | Rendering |
|---------|--------|-----------|
| **Trigger Conditions** | `description` field from frontmatter | Card with muted background |
| **Instructions** | Markdown body (after stripping YAML frontmatter) | Rendered markdown with headings, lists, code blocks |
| **Connected Agents** | `agentNames` prop | Avatars with add/remove buttons |
| **File Path** | `skill.path` | Monospace code block |

Built a minimal markdown renderer (no external deps):
- Headings (h1-h4)
- Bold, italic, inline code
- Fenced code blocks
- Lists (unordered + ordered)
- Horizontal rules

Expandable content: instructions section defaults to `max-h-60` with "View All" toggle.

### 2. Agent Management in Panel

Added directly to the Connected Agents section:

- **Add button** — Shows available agents (those not already assigned)
- **Agent picker** — Click to assign agent to skill
- **Remove button** — X on each agent avatar to remove

Props added to `SkillDetailPopover`:
- `allAgentNames?: string[]` — all connected agents for add picker
- `onAddAgent?: (skillName, agentName) => void`
- `onRemoveAgent?: (skillName, agentName) => void`

All new props are optional, so existing callers work without changes.

## Changes

| File | Change |
|------|--------|
| `app/components/agents/SkillDetailPopover.tsx` | Full rewrite: structured sections, markdown renderer, agent management UI |
| `app/components/agents/AgentsSkillsSection.tsx` | Pass `allAgentNames` to popover |

## Section Layout

```
┌─ Skill Detail ──────────────────────┐
│ [icon] skill-name                    │
│  user · coding                       │
├──────────────────────────────────────┤
│                                      │
│ TRIGGER CONDITIONS                   │
│ ┌──────────────────────────────────┐ │
│ │ Description text from frontmatter│ │
│ └──────────────────────────────────┘ │
│                                      │
│ ┌────────┐ ┌────────┐               │
│ │Enabled ✓│ │Coding  │               │
│ └────────┘ └────────┘               │
│                                      │
│ CONNECTED AGENTS          [+ Add]    │
│ [Claude] [Codex] [Gemini]           │
│                                      │
│ INSTRUCTIONS                [Copy]   │
│ ┌──────────────────────────────────┐ │
│ │ ## Core Principles               │ │
│ │ - Treat repo as source of truth  │ │
│ │ - ...                            │ │
│ │              [View All]          │ │
│ └──────────────────────────────────┘ │
│                                      │
│ FILE PATH                            │
│ skills/mindos/SKILL.md               │
├──────────────────────────────────────┤
│ [Enabled ✓ toggle]    [Delete]       │
└──────────────────────────────────────┘
```
