# Spec: YAML-Based Workflow Renderer

## 目标

创建一个**YAML-native** 的 Workflow 渲染器，将工作流定义为结构化的 `.workflow.yaml` 文件。支持 Skills、MCP Tools、Agent 委派，提供可视化执行界面。

---

## 文件格式

### Schema

```yaml
# Example: Sprint Release.workflow.yaml
title: Sprint Release Workflow
description: Weekly sprint release process with multi-agent review

# Global configuration
skills:
  - software-architecture
  - document-release
tools:
  - git
  - npm
  - github

# Step definitions
steps:
  - id: test                    # unique step ID
    name: Run tests             # display name
    description: |              # (optional) step description
      Execute full test suite and report results.
    
    agent: cursor               # (optional) delegate to agent
    skill: null                 # (optional) use specific skill
    tools: [npm, github]        # (optional) override global tools
    
    prompt: |                   # (required) execution prompt
      Execute the full test suite.
      Report any failures with:
      - Test name
      - Failure reason
      - Suggestion to fix
    
    timeout: 60                 # (optional) execution timeout in seconds, default 60
    
  - id: review
    name: Code review
    agent: claude-code
    skill: code-review-quality
    prompt: |
      Review the recent changes.
      Use the code-review-quality checklist.
      
      Focus areas:
      - Security
      - Performance
      - Maintainability

  - id: docs
    name: Update documentation
    skill: document-release
    prompt: |
      Update CHANGELOG and README based on shipped changes.
      Follow the document-release skill template.
```

### Schema Validation (TypeScript)

```typescript
interface WorkflowYaml {
  title: string;
  description?: string;
  skills?: string[];
  tools?: string[];
  steps: WorkflowStep[];
}

interface WorkflowStep {
  id: string;                    // unique within workflow
  name: string;                  // display name
  description?: string;          // optional description
  agent?: string;                // e.g., 'cursor', 'claude-code', 'mindos'
  skill?: string;                // e.g., 'code-review-quality'
  tools?: string[];              // override global tools
  prompt: string;                // required execution prompt
  timeout?: number;              // seconds, default 60
}

interface WorkflowStepRuntime extends WorkflowStep {
  index: number;                 // 0-based step index
  status: StepStatus;            // pending | running | done | error | skipped
  output: string;                // AI output
  error?: string;                // error message if status=error
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
}

type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';
```

---

## Renderer Registration

### Manifest

```typescript
// app/components/renderers/workflow-yaml/manifest.ts
export const manifest: RendererDefinition = {
  id: 'workflow-yaml',
  name: 'Workflow Runner',
  description: 'YAML-based executable workflows with Skill & Agent support.',
  author: 'MindOS',
  icon: '⚡',
  tags: ['workflow', 'automation', 'yaml', 'steps'],
  builtin: true,
  entryPath: 'Workflows/',
  match: ({ extension, filePath }) => 
    extension === 'yaml' || extension === 'yml' 
    ? /\.workflow\.(yaml|yml)$/i.test(filePath)
    : false,
  load: () => import('./WorkflowYamlRenderer').then(m => ({ 
    default: m.WorkflowYamlRenderer 
  })),
};
```

### File Matching

- Match: `*.workflow.yaml`, `*.workflow.yml`
- Examples:
  - ✅ `Sprint Release.workflow.yaml`
  - ✅ `weekly_review.workflow.yml`
  - ❌ `todo.yaml` (not `.workflow.yaml`)
  - ❌ `workflow.md` (old markdown format, handled by old renderer)

---

## Parser Implementation

### Core Functions

**`parseWorkflowYaml(content: string): ParseResult`**
- Input: Raw file content (YAML string)
- Output: `{ workflow: WorkflowYaml | null, errors: string[] }`
- Handles: YAML parsing errors, schema validation

**`validateWorkflowSchema(obj: any): ValidationResult`**
- Validates structure against schema
- Returns: `{ valid: boolean, errors: string[] }`

**`enrichWorkflowSteps(workflow: WorkflowYaml): WorkflowStepRuntime[]`**
- Adds runtime fields: index, status='pending', output='', error=undefined

---

## Execution Paths

### Path 1: Regular Step (No Agent)

```
User clicks Run
  ↓
Determine execution mode: No agent → /api/ask path
  ↓
Fetch skill if defined
  ↓
Build system prompt with skill context
  ↓
POST /api/ask { messages: [...], skill_context: ... }
  ↓
Stream response to UI
  ↓
Mark step done or error
```

### Path 2: Agent-Delegated Step

```
User clicks Run
  ↓
Determine execution mode: Has agent → ACP path
  ↓
Fetch skill if defined
  ↓
Build prompt with skill context
  ↓
POST /api/acp/session { agentId: 'cursor', prompt: ... }
  ↓
Create ACP session, stream response
  ↓
Close session
  ↓
Mark step done or error
```

### Path 3: Tool-Advisory Step

```
User clicks Run
  ↓
Fetch skill if defined
  ↓
Build system prompt with:
  - step.prompt
  - skill context (if skill defined)
  - [Future] tool advisory comment (informational only)
  ↓
POST /api/ask (LLM auto-selects from available MCP tools)
  ↓
Stream response
```

---

## UI Design

### Layout

```
┌─ Workflow: Sprint Release ────────────────────────────────┐
│ Weekly sprint release process with multi-agent review     │
│                                                            │
│ ███████░░░░░░░░  1/3 done        [Run next] [Reset] [Edit]│
│                                                            │
│ ┌─ ○ test                    [🤖 cursor] ─────────────────┐│
│ │ Execute full test suite and report results.            ││
│ │                                      │ Run │ Skip      ││
│ └────────────────────────────────────────────────────────┘│
│ ┌─ ○ review  [🎓 code-review][🤖 claude-code] ──────────┐│
│ │ Review the recent changes using the checklist.         ││
│ │                                      │ Skip            ││
│ └────────────────────────────────────────────────────────┘│
│ ┌─ ○ docs              [🎓 document-release] ────────────┐│
│ │ Update CHANGELOG and README.                           ││
│ │                                      │ Skip            ││
│ └────────────────────────────────────────────────────────┘│
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Components

- **WorkflowYamlRenderer**: Main container
- **StepCard**: Individual step (name, badges, buttons, output)
- **Badge**: Skill/Agent indicator (🎓 skill_name, 🤖 agent_name)
- **ProgressHeader**: Title, progress bar, action buttons
- **ErrorBoundary**: Catch rendering errors

---

## Backward Compatibility

Keep existing Markdown renderer as `workflow` (old), add new `workflow-yaml`.

Migration path:
1. User can have both `.md` and `.yaml` workflows
2. New UI recommends `.yaml` for new workflows
3. Provide migration tool (UI button: "Convert to YAML")

---

## Validation & Error Handling

### Parser Errors

```yaml
❌ title: missing
  error: "Missing required field 'title'"
❌ steps: empty
  error: "Workflow must have at least 1 step"
❌ step.prompt: empty
  error: "Step 'review': missing required field 'prompt'"
❌ skill: unknown
  error: "Step 'review': skill 'unknown-skill' not found"
❌ agent: unknown
  error: "Step 'test': agent 'unknown-agent' not registered"
```

### Runtime Errors

```
❌ Skill fetch failed → "Failed to read skill 'code-review-quality': 404"
❌ ACP session timeout → "Agent 'cursor' failed to respond after 60s"
❌ Execution abort → "Execution cancelled by user"
❌ Network error → "Connection failed, retry available"
```

---

## Acceptance Criteria

| # | Criterion | How to verify |
|---|-----------|---------------|
| 1 | YAML parsing works | Parse valid workflow file, get correct structure |
| 2 | Schema validation | Invalid YAML rejected with clear error |
| 3 | Skill injection | Step with skill includes skill content in prompt |
| 4 | Agent delegation | Step with agent creates ACP session, not /api/ask |
| 5 | Progress tracking | Progress bar updates correctly, counters accurate |
| 6 | UI displays badges | Skill/Agent badges visible on each step |
| 7 | Error recovery | Error steps show message, user can retry |
| 8 | Skill not found | Graceful error, doesn't crash |
| 9 | Agent not found | Graceful error, doesn't crash |
| 10 | Backward compat | Old `.workflow.md` files still work via old renderer |
| 11 | i18n complete | All UI strings translated (en/zh) |
| 12 | Tests pass | `npx vitest run` all green |

---

## Implementation Order

1. **Types + Validator** (./types.ts, ./validator.ts)
2. **Parser** (./parser.ts with js-yaml)
3. **i18n module** (app/lib/i18n/modules/workflow.ts)
4. **Manifest** (./manifest.ts)
5. **UI Components** (./components/)
6. **Main renderer** (./WorkflowYamlRenderer.tsx)
7. **Tests** (__tests__)
8. **Integration** (register, auto-discovery)
