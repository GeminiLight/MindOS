import AgentPlanBlock from '@/components/ask/AgentPlanBlock';
import ToolCallBlock from '@/components/ask/ToolCallBlock';
import type { AgentPlanPart, ToolCallPart } from '@/lib/types';

const runningPlan: AgentPlanPart = {
  type: 'agent-plan',
  runtime: 'acp',
  entries: [
    { content: 'Read spec-acp-first-agent-integration.md', status: 'completed' },
    { content: 'Parse ACP diff blocks and carry them across the lane', status: 'completed' },
    { content: 'Render file changes inline in chat', status: 'in_progress' },
    { content: 'Report token usage and session cost', status: 'pending' },
  ],
};

const finishedPlan: AgentPlanPart = {
  type: 'agent-plan',
  runtime: 'acp',
  entries: [
    { content: 'Audit the retrieval adapters', status: 'completed' },
    { content: 'Remove the unused packages', status: 'completed' },
  ],
};

/**
 * Preview for file changes reported by external ACP agents (Claude Code, Codex,
 * Gemini …). Before `tool_diff` these edits rendered as an opaque tool row.
 */
const parts: ToolCallPart[] = [
  {
    type: 'tool-call',
    toolCallId: 'acp-edit',
    toolName: 'Edit',
    runtime: 'acp',
    state: 'done',
    input: { path: 'notes/weekly-review.md' },
    output: 'Applied edit',
    diffs: [{
      path: '/mind/notes/weekly-review.md',
      oldText: '# Weekly review\n\n- Ship the retrieval cleanup\n- Draft the ACP spec\n- TODO: decide on Obsidian\n',
      newText: '# Weekly review\n\n- Ship the retrieval cleanup\n- Draft the ACP spec\n- Land diff passthrough for external agents\n- TODO: decide on Obsidian\n',
    }],
  },
  {
    type: 'tool-call',
    toolCallId: 'acp-multi-edit',
    toolName: 'Edit',
    runtime: 'acp',
    state: 'done',
    input: { path: 'packages/web' },
    diffs: [
      {
        path: '/mind/projects/mindos/sse.ts',
        oldText: "export type Event =\n  | { type: 'tool_start' }\n  | { type: 'tool_end' };\n",
        newText: "export type Event =\n  | { type: 'tool_start' }\n  | { type: 'tool_diff' }\n  | { type: 'tool_end' };\n",
      },
      {
        path: '/mind/projects/mindos/notes.md',
        oldText: '',
        newText: '# Migration notes\n\nACP is now the primary lane.\n',
      },
    ],
  },
  {
    type: 'tool-call',
    toolCallId: 'acp-truncated',
    toolName: 'Write',
    runtime: 'acp',
    state: 'done',
    input: { path: 'vendor/bundle.js' },
    diffs: [{
      path: '/mind/vendor/bundle.js',
      oldText: 'const a = 1;\n',
      newText: 'const a = 2;\n',
      truncated: true,
    }],
  },
];

export default function AcpToolDiffDemoPage() {
  return (
    <main className="box-border min-h-[calc(100vh-var(--app-titlebar-h))] max-w-[100vw] overflow-x-hidden bg-background py-8 text-foreground">
      <div className="mx-6 box-border flex w-[calc(100vw_-_48px)] min-w-0 max-w-[calc(100vw_-_48px)] flex-col gap-6 sm:mx-auto sm:w-full sm:max-w-4xl">
        <header className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            MindOS Agent Demo
          </p>
          <h1 className="text-2xl font-semibold tracking-normal">
            External Agent Plan and File Changes
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            Structured ACP diffs render inline in the Chat Panel, using the same
            line-diff algorithm as the Changes review.
          </p>
        </header>

        <section className="min-w-0 space-y-2">
          <AgentPlanBlock part={runningPlan} />
          <AgentPlanBlock part={finishedPlan} />
          {parts.map(part => <ToolCallBlock key={part.toolCallId} part={part} />)}
        </section>
      </div>
    </main>
  );
}
