# UI Wireframes & State Flow — Workflow Skill/ACP Integration

## State 1: Initial View (No Metadata)

```
┌─ Workflow: Code Review ─────────────────────────────────┐
│                                                           │
│ Code review workflow for sprint releases.                │
│                                                           │
│ ████████░░░░░░░░░░  0/3 done    [ Run next ]  [ Reset ] │
│                                                           │
│ ┌─ ○ Step 1: Run tests                            ─────┐ │
│ │ Execute all test suites and report failures.   │Run │ │
│ │                                                  │Skip│ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─ ○ Step 2: Code review                          ─────┐ │
│ │ Review the diff against checklist.             │Skip │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─ ○ Step 3: Update docs                          ─────┐ │
│ │ Update CHANGELOG and README.                   │Skip │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

## State 2: View WITH Metadata (Frontmatter + Skill/Agent)

```
┌─ Workflow: Code Review ─────────────────────────────────┐
│                                                           │
│ Code review workflow for sprint releases.                │
│                                                           │
│ ████████░░░░░░░░░░  0/3 done    [ Run next ]  [ Reset ] │
│                                                           │
│ ┌─ ○ Step 1: Run tests                      [🤖 cursor] ─┐ │
│ │ Execute all test suites and report failures.           │
│ │                                          │ Run │ Skip │ │
│ └────────────────────────────────────────────────────────┘ │
│ ┌─ ○ Step 2: Code review       [🎓 code-review][🤖 C-Code] ┐ │
│ │ Review the diff against checklist.                     │
│ │                                           │ Skip │ Skip │ │
│ └────────────────────────────────────────────────────────┘ │
│ ┌─ ○ Step 3: Update docs         [🎓 document-release]   ─┐ │
│ │ Update CHANGELOG and README.                           │
│ │                                           │ Skip │ Skip │ │
│ └────────────────────────────────────────────────────────┘ │
│                                                           │
│ Legend:                                                  │
│ 🎓 Skill (domain knowledge injected into prompt)        │
│ 🤖 Agent (delegate to specific AI agent)                │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

## State 3: Step Running — Delegating to Agent

```
┌─ Workflow: Code Review ─────────────────────────────────┐
│                                                           │
│ ████████░░░░░░░░░░  0/3 done    [ ○ ← Running ] [ Reset ] │
│                                                           │
│ ┌─ ✓ Step 1: Run tests                      [🤖 cursor] ─┐ │
│ │ ┌─────────────────────────────────────────────────────┐ │ │
│ │ │ Test Results:                                       │ │ │
│ │ │ • src/components: 24 tests passed                  │ │ │
│ │ │ • src/lib: 18 tests passed                         │ │ │
│ │ │ • e2e: 5 tests passed                              │ │ │
│ │ │ Total: 47 tests in 3.2s, all green ✓              │ │ │
│ │ └─────────────────────────────────────────────────────┘ │ │
│ │                                      [ Collapse ]  [ ] │ │
│ └────────────────────────────────────────────────────────┘ │
│ ┌─ ◌ Step 2: Code review       [🎓 code-review][🤖 C-Code] ┐ │
│ │ ┌─ Delegating to Claude-Code... (◌) ────────────────┐ │
│ │ │ ✨ AI Output (streaming...)                        │ │
│ │ │                                                     │ │
│ │ │ ## Code Review Results                             │ │
│ │ │ ### Security                                       │ │
│ │ │ ✓ No hardcoded secrets                            │ │
│ │ │ ✓ Input validation present                        │ │
│ │ │                                                     │ │
│ │ │ ### Performance                                    │ │
│ │ │ ⚠️ Consider optimizing...                          │ │ │
│ │ └─────────────────────────────────────────────────────┘ │ │
│ └────────────────────────────────────────────────────────┘ │
│ ┌─ ○ Step 3: Update docs         [🎓 document-release]   ─┐ │
│ │ Update CHANGELOG and README.                           │
│ └────────────────────────────────────────────────────────┘ │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

## State 4: Step Complete with Skill-Enhanced Output

```
┌─ Workflow: Code Review ─────────────────────────────────┐
│                                                           │
│ ███████████████░░░  2/3 done    [ Run next ]  [ Reset ] │
│                                                           │
│ ┌─ ✓ Step 1: Run tests                      [🤖 cursor] ─┐ │
│ │ ▼ Test Results:... [ Collapse ]                      │ │
│ └────────────────────────────────────────────────────────┘ │
│ ┌─ ✓ Step 2: Code review       [🎓 code-review][🤖 C-Code] ┐ │
│ │ ✨ AI Output (skill context applied)                 │ │
│ │                                                        │ │
│ │ ## Code Review Results                                │ │
│ │ Reviewed against: code-review-quality checklist      │ │
│ │                                                        │ │
│ │ ### Correctness ✓                                     │ │
│ │ - All error paths handled                            │ │
│ │ - No missing return statements                       │ │
│ │                                                        │ │
│ │ ### Maintainability ✓                                 │ │
│ │ - Clear naming, no abbreviations                     │ │
│ │ - Functions <50 lines                                │ │
│ │                                                        │ │
│ │ ### Rating: 8.5/10 ✨                                 │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─ ○ Step 3: Update docs         [🎓 document-release]   ─┐ │
│ │ Update CHANGELOG and README.                           │
│ │                                          │ Run │ Skip │ │
│ └────────────────────────────────────────────────────────┘ │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

## State 5: Error — Skill Not Found

```
┌─ Workflow: Code Review ─────────────────────────────────┐
│                                                           │
│ ████████░░░░░░░░░░  1/3 done    [          ]  [ Reset ] │
│                                                           │
│ ┌─ ✓ Step 1: Run tests                      [🤖 cursor] ─┐ │
│ │ ▼ Test Results: ...                                   │ │
│ └────────────────────────────────────────────────────────┘ │
│ ┌─ ✗ Step 2: Code review       [🎓 ??][🤖 claude-code]  ┐ │
│ │ ⚠️ Skill 'unknown-skill' not found                     │ │
│ │ Available skills: code-review-quality, ...            │ │
│ │ [ Fix & Retry ]                                      │ │
│ └────────────────────────────────────────────────────────┘ │
│ ┌─ ○ Step 3: Update docs         [🎓 document-release]   ─┐ │
│ │ Update CHANGELOG and README.                           │
│ └────────────────────────────────────────────────────────┘ │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

## State 6: Error — Agent Unavailable

```
┌─ Workflow: Code Review ─────────────────────────────────┐
│                                                           │
│ ████████░░░░░░░░░░  1/3 done    [          ]  [ Reset ] │
│                                                           │
│ ┌─ ✓ Step 1: Run tests                      [🤖 cursor] ─┐ │
│ │ Test Results: ...                                     │ │
│ └────────────────────────────────────────────────────────┘ │
│ ┌─ ✗ Step 2: Code review       [🎓 code-review][🤖 ??]  ┐ │
│ │ ✗ Agent 'unknown-agent' not available                 │ │
│ │ Available agents: cursor, claude-code, mindos        │ │
│ │ [ Retry ]  [ Use Alternative ]                      │ │
│ └────────────────────────────────────────────────────────┘ │
│ ┌─ ○ Step 3: Update docs         [🎓 document-release]   ─┐ │
│ │ Update CHANGELOG and README.                           │
│ └────────────────────────────────────────────────────────┘ │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

---

## State Flow Diagram

```
                              ┌─── [Empty State] ───┐
                              │  No steps defined   │
                              └─────────────────────┘

                                  ↑
                    [Frontmatter parsed + steps parsed]

┌─────────────────────────────────────────────────────────────────┐
│                    [Initial State: All Pending]                  │
│  • Progress: 0%                                                  │
│  • All steps visible, no badges yet (or badges show default)    │
│  • UI: Run Next button enabled                                  │
└─────────────────────────────────────────────────────────────────┘
                                ↓
                          [User clicks Run]
                                ↓
                    ┌─ Determine execution mode ─┐
                    │                             │
        ┌─ Has agent metadata? ─┐    ┌─ Has skill? ─┐
        │                        │    │              │
       YES                       NO   │              │
        │                        │    │              │
        ↓                        ↓    ↓              ↓
   [ACP Delegation]      [/api/ask]  [Read Skill]  [Use Skill in Prompt]
   • POST /api/acp/session         • GET /api/skills
   • Stream response               • Inject to system prompt
                                   • POST /api/ask
        │                        │    │              │
        └────────────┬──────────┘    └──────┬───────┘
                     ↓
              [Step Running]
           • Status: running
           • Icon: spinner
           • Output streaming
                     ↓
         ┌─── Does response OK? ───┐
         │                          │
        YES                        NO
         │                          │
         ↓                          ↓
      [Success]                  [Error]
      • Status: done              • Status: error
      • Icon: ✓                    • Icon: ✗
      • Output rendered           • Error message shown
         │                          │
         └──────────┬───────────────┘
                    ↓
         [Step Complete]
         • Can expand/collapse
         • Next step becomes active
                    ↓
      ┌─── Is this last step? ───┐
      │                           │
     NO                          YES
      │                           │
      ↓                           ↓
   [Loop to next    [Workflow Complete]
     pending step]   • All done
                    • Progress: 100%
                    • "All steps complete" msg
```

---

## Component Hierarchy for Badges

```
<WorkflowRenderer>
  └─ <div> progress header
  └─ <div> steps list
      └─ <StepCard> (NEW: with metadata UI)
          ├─ <div> header
          │  ├─ <StatusIcon />
          │  ├─ <span> heading
          │  ├─ <div> badges (NEW)          ← NEW: display skill/agent
          │  │  ├─ <Badge emoji="🎓" text="code-review-quality" />
          │  │  └─ <Badge emoji="🤖" text="claude-code" />
          │  └─ <div> action buttons
          └─ <div> body (conditional)
          └─ <div> output (conditional)
```

### Badge Component

```typescript
<Badge emoji="🎓" text="code-review-quality" variant="skill" />
renders as:
┌──────────────────────────────┐
│ 🎓 code-review-quality       │
└──────────────────────────────┘
font-size: 0.7rem, color: muted, bg: subtle hover effect
```

---

## Interaction Model

### How User Interacts with Metadata

**Reading**:
- Glance at badges to know step's execution context
- Hover badge to see tooltip: "This step will use Cursor agent" or "Skill: code-review-quality"

**Editing**:
- User modifies frontmatter/comments directly in markdown
- Saves file → WorkflowRenderer re-parses → badges update

**Debugging**:
- User hovers error badge (红色 ✗) to see error details
- Clicks "Retry" or "Use Alternative" to recover
