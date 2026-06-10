import ToolCallBlock from '@/components/ask/ToolCallBlock';
import type { ToolCallPart } from '@/lib/types';

const parts: ToolCallPart[] = [
  {
    type: 'tool-call',
    toolCallId: 'claude-bash-approval',
    toolName: 'Bash',
    runtime: 'claude',
    state: 'running',
    input: {
      command: 'mindos file delete "Profile.md"',
      description: 'Delete the profile note',
    },
    runtimePermission: {
      runId: 'demo-run',
      requestId: 'demo-claude-permission',
      runtime: 'claude',
      status: 'waiting',
      options: [
        { id: 'accept', label: 'Allow once', description: 'Run this command once.', intent: 'allow' },
        { id: 'decline', label: 'Deny', description: 'Reject this command.', intent: 'deny' },
      ],
      reason: 'Claude Code requested permission to run this command.',
    },
  },
  {
    type: 'tool-call',
    toolCallId: 'claude-bash-done',
    toolName: 'Bash',
    runtime: 'claude',
    state: 'done',
    input: {
      command: 'mindos file read "Profile.md"',
      description: 'Read the profile note',
    },
    output: 'Profile.md loaded.',
  },
  {
    type: 'tool-call',
    toolCallId: 'codex-command-done',
    toolName: 'Bash',
    runtime: 'codex',
    state: 'done',
    input: 'mindos search "permission"',
    output: 'Found 3 notes.',
  },
  {
    type: 'tool-call',
    toolCallId: 'codex-permission',
    toolName: 'Bash',
    runtime: 'codex',
    state: 'running',
    input: {
      command: 'mindos file write "Notes.md"',
      reason: 'Codex requested write access for this command.',
    },
    runtimePermission: {
      runId: 'demo-run',
      requestId: 'demo-permission',
      runtime: 'codex',
      status: 'waiting',
      options: [
        { id: 'accept', label: 'Allow once', description: 'Run this command once.', intent: 'allow' },
        { id: 'acceptForSession', label: 'Allow session', description: 'Allow matching requests for this Codex session.', intent: 'allow' },
        { id: 'decline', label: 'Deny', description: 'Reject this command.', intent: 'deny' },
      ],
      reason: 'Codex requested write access for this command.',
    },
  },
];

export default function NativeRuntimeToolDemoPage() {
  return (
    <main className="box-border min-h-screen max-w-[100vw] overflow-x-hidden bg-background py-8 text-foreground">
      <div className="mx-6 box-border flex w-[calc(100vw_-_48px)] min-w-0 max-w-[calc(100vw_-_48px)] flex-col gap-6 sm:mx-auto sm:w-full sm:max-w-4xl">
        <header className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            MindOS Agent Demo
          </p>
          <h1 className="text-2xl font-semibold tracking-normal">
            Native Runtime Tool Preview
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            Approvals render inline in the Chat Panel.
          </p>
        </header>

        <section className="min-w-0 space-y-2">
          {parts.map(part => <ToolCallBlock key={part.toolCallId} part={part} />)}
        </section>
      </div>
    </main>
  );
}
