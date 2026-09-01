import ToolCallBlock from '@/components/ask/ToolCallBlock';
import type { ToolCallPart } from '@/lib/types';

const EXAMPLE_PROMPT = `请精心 review 当前 worktree 里 MindOS Agent / Chat Panel 的改动。

请从三个互相独立的角度检查：
1. UI 状态与用户心智是否一致；
2. pi-subagents / ACP / A2A / Codex / Claude Code 的边界是否混淆；
3. focused tests 和 typecheck 是否覆盖关键路径。

最后合并结论，只列 blocking issues、修复建议和已验证证据。`;

const subagentExamples: ToolCallPart[] = [
  {
    type: 'tool-call',
    toolCallId: 'demo-subagent-list',
    toolName: 'subagent',
    state: 'done',
    input: {
      action: 'list',
      agentScope: 'both',
    },
    output: JSON.stringify({
      status: 'done',
      summary: 'Available agents: reviewer, tester, researcher',
    }),
  },
  {
    type: 'tool-call',
    toolCallId: 'demo-subagent-parallel',
    toolName: 'subagent',
    state: 'running',
    input: {
      workflowScript: `return runs.all([
  { key: 'ui-review', agent: 'reviewer', task: 'Review Chat Panel UI state and wording for subagent tool calls. Report only blocking UX issues and concrete fixes.', cwd: '/Users/moonshot/projects/product/mindos-dev' },
  { key: 'boundary-review', agent: 'researcher', task: 'Check whether pi-subagents, ACP, A2A, Codex, and Claude Code boundaries are mixed in prompt/spec/UI wording.', cwd: '/Users/moonshot/projects/product/mindos-dev' },
  { key: 'focused-tests', agent: 'tester', task: 'Run focused tests for prompt contracts, pi-subagents loading, and ToolCallBlock subagent rendering.', cwd: '/Users/moonshot/projects/product/mindos-dev' },
]);`,
      globalConcurrencyLimit: 3,
      context: 'fresh',
      worktree: false,
      timeoutMs: 120000,
    },
  },
  {
    type: 'tool-call',
    toolCallId: 'demo-subagent-status',
    toolName: 'subagent',
    state: 'done',
    input: {
      action: 'status',
      id: 'subagent_run_ui_review_01',
    },
    output: JSON.stringify({
      status: 'running',
      runId: 'subagent_run_ui_review_01',
    }),
  },
  {
    type: 'tool-call',
    toolCallId: 'demo-subagent-single',
    toolName: 'subagent',
    state: 'done',
    input: {
      agent: 'reviewer',
      task: 'Review packages/web/components/ask/ToolCallBlock.tsx for regressions introduced by subagent-specific rendering.',
      cwd: '/Users/moonshot/projects/product/mindos-dev',
      context: 'fresh',
    },
    output: 'No blocking issues found. Verified single, parallel, and status rendering paths stay inside ToolCallBlock.',
  },
];

export default function SubagentDemoPage() {
  return (
    <main className="min-h-[calc(100vh-var(--app-titlebar-h))] bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
        <header className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            MindOS Agent Demo
          </p>
          <h1 className="text-2xl font-semibold tracking-normal">
            Subagent Tool Call Preview
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            This page uses the same ToolCallBlock component as the Chat Panel. The prompt below is an example that should make MindOS Agent consider independent subagent delegation.
          </p>
        </header>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Prompt to try</h2>
            <pre className="whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-4 text-sm leading-6 text-foreground">
              {EXAMPLE_PROMPT}
            </pre>
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Expected tool-call UI</h2>
            <div className="space-y-2">
              {subagentExamples.map(part => (
                <ToolCallBlock key={part.toolCallId} part={part} />
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
