# MindOS: ACP, Skills, MCP, and Workflow Plugin Integration Report
**Date**: 2026-03-31  
**Scope**: Full investigation of ACP (Agent Communication Protocol), Skills system, MCP tools exposure, and current Workflow plugin implementation

---

## EXECUTIVE SUMMARY

### 1. ACP (Agent Communication Protocol) — FULLY IMPLEMENTED ✅
MindOS implements ACP as a **JSON-RPC 2.0 subprocess bridge** for agent-to-agent delegation. One agent spawns another agent as a subprocess and communicates via stdin/stdout.

### 2. Skills System — DISCOVERY ONLY (No Execution API) ⚠️
Skills exist as `.md` files that are **discovered and scanned**, but there is **NO programmatic execution endpoint**. Skills are:
- Loaded into the system prompt as context
- Made available to agents via the MindOS Skill framework
- NOT callable via `/api/skills` (API only does CRUD + list)

### 3. MCP (Model Context Protocol) — FULLY INTEGRATED ✅
MCP tools are **dynamically discovered and exposed** as agent tools at runtime via `createMcporterAgentTools()`. They flow into `/api/ask` and become available to the LLM.

### 4. Current Workflow Plugin — SIMPLE, NO TOOL INTEGRATION ⚠️
WorkflowRenderer calls `/api/ask` with a **plain text prompt** (no tool context). It constructs prompts step-by-step but does NOT explicitly pass tools, MCP context, or skill context—relying on default system context.

---

## DETAILED FINDINGS

### SECTION 1: ACP (Agent Communication Protocol)

#### 1.1 Overview
ACP enables agent-to-agent communication via **JSON-RPC 2.0 over stdio**. MindOS spawns an agent subprocess and sends/receives JSON messages.

#### 1.2 Architecture Files

**Type Definitions**: `/app/lib/acp/types.ts` (141 lines)
- `AcpTransportType`: 'stdio' | 'npx' | 'uvx' | 'binary'
- `AcpCapabilities`: { streaming, toolCalls, multiTurn, cancellation }
- `AcpSession`: { id, agentId, state, cwd, createdAt, lastActivityAt }
- `AcpPromptRequest/Response`: Message format
- `AcpToolCall`: { id, name, arguments }
- `AcpRegistryEntry`: Agent definition (id, name, description, transport, command, packageName, tags, homepage)

**Session Manager**: `/app/lib/acp/session.ts` (297 lines)
- `createSession(agentId, options)` — Spawn agent, initialize, return session
- `createSessionFromEntry(entry, options)` — Direct entry-based creation
- `prompt(sessionId, text)` — Send message, wait for response (60s timeout)
- `promptStream(sessionId, text, onUpdate)` — Streaming response with callback
- `cancelPrompt(sessionId)` — Cancel active session
- `closeSession(sessionId)` — Kill subprocess, cleanup
- `getSession(sessionId)`, `getActiveSessions()`, `closeAllSessions()`

**Process Spawning**: `/app/lib/acp/subprocess.ts` (TBD — not fully read)
- Spawns agent process based on `AcpTransportType`
- Handles JSON-RPC communication
- Error recovery + subprocess lifecycle

#### 1.3 How Workflow Could Use ACP

**Pattern 1: Direct ACP Call from Workflow**
```typescript
// In WorkflowRenderer or backend
const session = await createSession('gemini-cli', { cwd: getMindRoot() });
const response = await prompt(session.id, `Execute step: ${step.body}`);
await closeSession(session.id);
```

**Pattern 2: ACP Tools in Agent Tools**
```typescript
// Already implemented in /app/lib/agent/tools.ts
// acpTools array contains:
// - list_acp_agents(tag?: string) → List available agents
// - call_acp_agent(agent_id, message) → Send message to agent
```

#### 1.4 API Endpoints

**Session API**: `/app/app/api/acp/session/route.ts`
- `GET /api/acp/session` — List active sessions
- `POST /api/acp/session` — Create session (optionally send prompt in one-shot mode)
- `DELETE /api/acp/session` — Close session

**One-Shot Example**:
```json
POST /api/acp/session
{
  "agentId": "gemini-cli",
  "prompt": "Find all markdown files in the knowledge base"
}
// Response:
{
  "session": { "id": "ses-gemini-cli-1711900000", "state": "idle", ... },
  "response": { "text": "Found X files...", "done": true }
}
```

#### 1.5 Agent Registry
**File**: `/app/lib/acp/registry.ts` (TBD)
- Fetches public ACP registry (default: https://registry.agenthub.io)
- Caches agents locally
- Provides `getAcpAgents()`, `findAcpAgent(id)`

**Common agents**: Gemini CLI, Claude, OpenAI ChatGPT, GitHub Copilot (registered in public registry)

---

### SECTION 2: Skills System

#### 2.1 Overview
Skills are **Markdown files with YAML frontmatter** that define reusable workflows or instructions. They are NOT executable directly via API—they are:
1. Discovered at startup
2. Scanned into file system
3. Injected into system prompts
4. Made available to agents as context

#### 2.2 Skill Definition Format

**File**: `/skills/{skill-name}/SKILL.md` (or user: `{mindRoot}/.skills/{skill-name}/SKILL.md`)

```markdown
---
name: my-skill
description: Does something useful
---

## Implementation
Instructions for the agent...

## Examples
- Example 1: ...
```

#### 2.3 Skills API Endpoints

**File**: `/app/app/api/skills/route.ts` (140 lines)

**GET /api/skills**
- Returns all skills scanned from 4 directories:
  - `/app/data/skills/{name}/SKILL.md` (builtin)
  - `/skills/{name}/SKILL.md` (builtin)
  - `{mindRoot}/.skills/{name}/SKILL.md` (user)
  - `~/.mindos/skills/{name}/SKILL.md` (legacy)
- Response: `{ skills: SkillInfo[] }`
- **No pagination**—all 144+ skills returned

**POST /api/skills**
- **Actions**: 'create', 'update', 'delete', 'toggle', 'read', 'read-native'
- **create**: Create new user skill in `{mindRoot}/.skills/{name}/SKILL.md`
- **update**: Update existing user skill content
- **delete**: Delete user skill
- **toggle**: Enable/disable skill (stored in settings)
- **read**: Get skill content by name
- **read-native**: Read builtin skill by path

**Example Requests**:
```json
POST /api/skills
{
  "action": "read",
  "name": "mindos"
}
// Response: { "content": "---\nname: mindos\n..." }

POST /api/skills
{
  "action": "toggle",
  "name": "my-skill",
  "enabled": false
}
// Response: { "ok": true }
```

#### 2.4 Where Skills Are Used

**In System Prompts**: `/app/lib/agent/prompt.ts`
- Skill content is loaded and injected into `AGENT_SYSTEM_PROMPT`
- Agents see skill instructions as context

**In Agent Tools**: Skills are NOT executable tools—they are instructions.
- `acpTools` can call other agents to execute skills
- But MindOS's built-in agent doesn't directly "execute" a skill
- Instead, skills modify the agent's behavior via system prompt context

**In Ask Panel**: `/app/components/ask/AskContent.tsx`
- User can select a skill before sending a message
- Skill content is prepended to the user's message
- Goes to `/api/ask` which includes it in system context

#### 2.5 Skills Are NOT Callable as Tools

**IMPORTANT**: There is NO `/api/skills/execute` endpoint. You cannot do:
```json
POST /api/skills/execute
{
  "skillName": "research-topic",
  "params": { "topic": "AI" }
}
// ❌ This endpoint does NOT exist
```

**Instead**, skills must be:
1. Selected in Ask UI (prepend to message)
2. OR mentioned in system prompt
3. OR invoked via ACP if another agent has them

---

### SECTION 3: MCP (Model Context Protocol)

#### 3.1 Overview
MCP tools are **dynamically discovered at runtime** from external processes/services (via stdio or HTTP). They are exposed as agent tools in `/api/ask`.

#### 3.2 MCP Integration Points

**Runtime Library**: `/app/lib/pi-integration/mcporter.ts` (100+ lines)
- Uses `mcporter` ESM library (dynamic import)
- Singleton runtime: `getRuntime()` returns `createRuntime({ configPath, clientInfo })`
- Config location: `~/.mindos/mcp.json`

**Agent Tools Bridge**: `/app/lib/agent/tools.ts` (699 lines)

**Function**: `getRequestScopedTools()` (lines 190-211)
```typescript
export async function getRequestScopedTools(): Promise<AgentTool<any>[]> {
  const baseTools = [...knowledgeBaseTools, ...a2aTools, ...acpTools];
  try {
    const result = await listMcporterServers();  // ← Get all MCP servers
    const okServers = (result.servers ?? []).filter((server) => server.status === 'ok');
    if (okServers.length === 0) return baseTools;

    // Fetch tool definitions from each server
    const detailedServers = await Promise.all(
      okServers.map(async (server) => {
        try {
          return await listMcporterTools(server.name);
        } catch {
          return server;
        }
      })
    );

    // Convert to AgentTool format
    const dynamicMcpTools = createMcporterAgentTools(detailedServers);
    if (dynamicMcpTools.length === 0) return baseTools;
    return [...baseTools, ...dynamicMcpTools];
  } catch {
    return baseTools;
  }
}
```

**Tool Array Assembly** (lines 191):
```typescript
const baseTools = [
  ...knowledgeBaseTools,      // 20 KB tools (list_files, read_file, search, etc.)
  ...a2aTools,                // Agent-to-Agent tools
  ...acpTools                 // ACP agent tools
];
// + dynamicMcpTools (discovered from ~/.mindos/mcp.json)
```

#### 3.3 How MCP Tools Flow to /api/ask

**File**: `/app/app/api/ask/route.ts` (639 lines)

**Line 452**:
```typescript
const requestTools = isOrganizeMode 
  ? getOrganizeTools() 
  : await getRequestScopedTools();
```

**Line 453**:
```typescript
const customTools = toPiCustomToolDefinitions(requestTools);
```

**Line 487**:
```typescript
await createAgentSession({
  // ... other config ...
  tools: [],                 // ← pi-coding-agent built-ins (disabled)
  customTools,               // ← MindOS custom tools (20 KB + MCP + A2A)
});
```

**Result**: All tools (KB + MCP + A2A + ACP) are available to the LLM in `/api/ask`.

#### 3.4 MCP Server Configuration

**Location**: `~/.mindos/mcp.json`

Example:
```json
{
  "mcpServers": {
    "my-research-server": {
      "command": "python",
      "args": ["/path/to/server.py"],
      "transport": "stdio"
    },
    "web-search": {
      "command": "npx",
      "args": ["@example/web-search-mcp"],
      "transport": "stdio"
    }
  }
}
```

#### 3.5 Workflow Could Access MCP Tools

MCP tools are **automatically available** in `/api/ask` calls. When WorkflowRenderer calls:
```typescript
const res = await fetch('/api/ask', {
  method: 'POST',
  body: JSON.stringify({
    messages: [{ role: 'user', content: prompt }],
    currentFile: filePath,
  }),
});
```

The LLM inside `/api/ask` has access to:
- MCP tools (if configured in `~/.mindos/mcp.json`)
- KB tools (list_files, read_file, write_file, etc.)
- ACP tools (call_acp_agent, list_acp_agents)
- A2A tools (delegation to other agents)

---

### SECTION 4: Current Workflow Plugin Implementation

#### 4.1 Architecture

**File**: `/app/components/renderers/workflow/WorkflowRenderer.tsx` (410 lines)

**Parser** (lines 27-72):
- Extracts title, description from H1 + intro lines
- Parses workflow steps from H2 headings + body text
- Builds `WorkflowStep[]` array

**Step Execution** (lines 111-162):
```typescript
async function runStepWithAI(
  step: WorkflowStep,
  filePath: string,
  allStepsSummary: string,
  onChunk: (chunk: string) => void,
  signal: AbortSignal,
): Promise<void> {
  // 1. Build plain text prompt
  const prompt = `You are executing step ${step.index + 1} of a SOP/Workflow: "${step.heading}".

Context of the full workflow:
${allStepsSummary}

Current step instructions:
${step.body}

Execute this step concisely. Provide:
1. What you did / what the output is
2. Any decisions made
3. What the next step should watch out for

Be specific and actionable. Format in Markdown.`;

  // 2. Call /api/ask (SIMPLE POST, no tools context)
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      currentFile: filePath,
    }),
    signal,
  });

  // 3. Stream response
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const raw = decoder.decode(value, { stream: true });
    // Parse SSE format and accumulate text
  }
}
```

#### 4.2 What WorkflowRenderer Currently Does

1. ✅ Parses workflow Markdown (title, steps)
2. ✅ Executes steps sequentially via `/api/ask`
3. ✅ Streams AI output to UI
4. ✅ Tracks step status (pending, running, done, error)
5. ❌ Does NOT explicitly use MCP tools
6. ❌ Does NOT explicitly use Skills
7. ❌ Does NOT use ACP for delegation
8. ❌ Does NOT pass tool context to `/api/ask`

#### 4.3 Current Flow

```
WorkflowRenderer
  ↓
User clicks "Run next step"
  ↓
runStepWithAI() called
  ↓
Builds plain text prompt (step heading + body)
  ↓
fetch('/api/ask', { messages: [{ role: 'user', content: prompt }] })
  ↓
/api/ask handler calls getRequestScopedTools()
  ↓
Available tools automatically: KB + MCP + A2A + ACP
  ↓
LLM processes prompt with available tools
  ↓
Streams response back to WorkflowRenderer
  ↓
UI displays AI output for step
```

#### 4.4 Tools Available to Workflow (Automatically)

Even though WorkflowRenderer doesn't explicitly request them, `/api/ask` includes:

**KB Tools** (20):
- list_files, read_file, read_file_chunk, search, get_recent, etc.
- write_file, create_file, delete_file, etc.

**MCP Tools** (dynamic):
- Any tools from servers in `~/.mindos/mcp.json`
- E.g., web_search, web_fetch, etc.

**ACP Tools** (2):
- list_acp_agents
- call_acp_agent

**A2A Tools** (2):
- send_message
- get_task

---

## KEY INTEGRATION OPPORTUNITIES FOR WORKFLOW

### Opportunity 1: Explicitly Inject Tool Context
Currently: LLM infers which tools to use  
**Better**: Pass `toolContext` or `requestedTools` param to `/api/ask`

```typescript
await fetch('/api/ask', {
  method: 'POST',
  body: JSON.stringify({
    messages: [...],
    currentFile: filePath,
    requestedTools: ['search', 'read_file', 'web_search'],  // ← Explicit
  }),
});
```

### Opportunity 2: Use Skills Framework
Currently: Skills are context-only  
**Better**: Prepend selected skills to system prompt

```typescript
const skillContext = `
## Available Skills
${selectedSkills.map(s => s.content).join('\n\n---\n\n')}
`;
const enhancedPrompt = skillContext + '\n\n' + originalPrompt;
```

### Opportunity 3: Support ACP Delegation
Currently: Workflow runs in single agent  
**Better**: Allow workflow to offload steps to other agents

```typescript
if (step.delegation?.agentId) {
  const session = await createSession(step.delegation.agentId);
  const response = await prompt(session.id, step.body);
  await closeSession(session.id);
} else {
  // Use /api/ask as fallback
}
```

### Opportunity 4: Add Workflow Metadata
Currently: No machine-readable step definitions  
**Better**: Support YAML frontmatter in workflow files

```markdown
---
title: "Code Review Workflow"
description: "Review pull requests"
defaultTools:
  - read_file
  - search
  - call_acp_agent
steps:
  - title: "Fetch PR Details"
    delegation: "github-cli"
  - title: "Analyze Code"
    tools: ["search", "read_file"]
---

## Step 1: ...
```

---

## EXACT FILE PATHS & APIs

| System | Main File | Key Function | API Endpoint |
|--------|-----------|--------------|--------------|
| **ACP** | `/app/lib/acp/session.ts` | `createSession()`, `prompt()` | `/api/acp/session` |
| **Skills** | `/app/app/api/skills/route.ts` | GET all, POST CRUD | `/api/skills` |
| **MCP** | `/app/lib/pi-integration/mcporter.ts` | `getRuntime()`, `listMcporterServers()` | `/api/mcp/status` |
| **Tools Assembly** | `/app/lib/agent/tools.ts` | `getRequestScopedTools()` | (internal) |
| **Ask Handler** | `/app/app/api/ask/route.ts` | POST request with messages | `/api/ask` |
| **Workflow** | `/app/components/renderers/workflow/WorkflowRenderer.tsx` | `runStepWithAI()` | Uses `/api/ask` |

---

## IMPLEMENTATION CHECKLIST FOR WORKFLOW PLUGIN ENHANCEMENT

- [ ] **Phase 1: Audit** (Done ✅)
  - [x] Understand ACP architecture
  - [x] Map Skills discovery flow
  - [x] Document MCP tool exposure
  - [x] Review current Workflow implementation

- [ ] **Phase 2: Design** (Recommended)
  - [ ] Design workflow metadata format (YAML frontmatter)
  - [ ] Specify tool context parameter for `/api/ask`
  - [ ] Plan skill injection mechanism
  - [ ] Design ACP delegation syntax

- [ ] **Phase 3: Implementation** (Suggested)
  - [ ] Add workflow metadata parsing
  - [ ] Implement tool context passing
  - [ ] Add skill selection UI to workflow
  - [ ] Add optional ACP delegation support

- [ ] **Phase 4: Testing**
  - [ ] Test with MCP tools (search, fetch)
  - [ ] Test with Skills context injection
  - [ ] Test with ACP delegation
  - [ ] End-to-end workflow execution

---

## RECOMMENDATIONS

1. **Use `/api/ask` as primary execution engine**—it already has all tools (MCP, KB, A2A, ACP)
2. **Add workflow metadata** (YAML frontmatter) for tool selection
3. **Implement skill injection** for context-aware step execution
4. **Optional: Support ACP delegation** for multi-agent workflows
5. **Keep simple prompting** (don't over-engineer)—LLM naturally explores available tools

---

## APPENDIX: Code Snippets for Integration

### Call ACP Agent from Workflow
```typescript
import { createSession, prompt, closeSession } from '@/lib/acp/session';

const session = await createSession('gemini-cli', { cwd: getMindRoot() });
try {
  const response = await prompt(session.id, `Execute: ${step.body}`);
  step.output = response.text;
} finally {
  await closeSession(session.id);
}
```

### Get Current Tools
```typescript
import { getRequestScopedTools } from '@/lib/agent/tools';

const tools = await getRequestScopedTools();
console.log('Available tools:', tools.map(t => t.name));
// Output: 20 KB tools + N MCP tools + A2A tools + ACP tools
```

### List Available Skills
```typescript
const res = await fetch('/api/skills');
const { skills } = await res.json();
console.log('Available skills:', skills.map(s => s.name));
```

### Call /api/ask with Tool Hints
```typescript
const res = await fetch('/api/ask', {
  method: 'POST',
  body: JSON.stringify({
    messages: [{ role: 'user', content: prompt }],
    currentFile: filePath,
    // Optional: Could add these if /api/ask supported them:
    // requestedTools: ['search', 'web_fetch'],
    // skillContext: skillContent,
  }),
});
```

