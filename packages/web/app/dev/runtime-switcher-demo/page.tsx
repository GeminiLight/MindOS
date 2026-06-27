'use client';

import { useEffect, useMemo, useState } from 'react';
import AskHeader from '@/components/ask/AskHeader';
import { useWalkthroughStore, WALKTHROUGH_DONE_STORAGE_KEY } from '@/lib/stores/walkthrough-store';
import type { AgentRuntimeDescriptor, AgentRuntimeIdentity, ChatSession, RuntimeSessionBinding } from '@/lib/types';

const CHECKED_AT = '2026-06-10T00:00:00.000Z';

export default function RuntimeSwitcherDemoPage() {
  const [selectedRuntime, setSelectedRuntime] = useState<AgentRuntimeIdentity | null>(null);
  const runtimes = useMemo<Array<AgentRuntimeIdentity & Partial<Pick<AgentRuntimeDescriptor, 'status' | 'availability' | 'installCmd' | 'packageName'>>>>(() => [
    {
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      status: 'available',
      availability: {
        checkedAt: CHECKED_AT,
        sources: ['native-health'],
        reason: 'Codex detected at /opt/homebrew/bin/codex.',
        diagnosticHints: [
          'Local runtime detection succeeded.',
        ],
      },
    },
    {
      id: 'claude',
      name: 'Claude Code',
      kind: 'claude',
      status: 'available',
      availability: {
        checkedAt: CHECKED_AT,
        sources: ['native-health'],
        reason: 'Claude Code detected at /opt/homebrew/bin/claude.',
        diagnosticHints: [
          'Local runtime detection succeeded.',
        ],
      },
    },
  ], []);
  const binding = useMemo<RuntimeSessionBinding | null>(() => selectedRuntime?.kind === 'claude'
    ? {
        kind: 'claude-session',
        runtime: 'claude',
        runtimeId: 'claude',
        externalSessionId: 'session_1234567890abcdef',
        cwd: '/Users/moonshot/projects/product/mindos-dev',
        status: 'active',
        updatedAt: 1,
      }
    : null, [selectedRuntime]);
  const sessions = useMemo<ChatSession[]>(() => [
    {
      id: 'session-product-docs',
      title: '我们来看看现在的产品文档',
      source: 'quick',
      createdAt: 1,
      updatedAt: 2,
      messages: [
        {
          role: 'user',
          content: '我们来看看现在的产品文档',
        },
      ],
    },
    {
      id: 'session-project-plan',
      title: '项目计划书 / BP',
      source: 'quick',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
    },
  ], []);
  const acpRuntimes = useMemo<Array<AgentRuntimeIdentity & Partial<Pick<AgentRuntimeDescriptor, 'status' | 'availability' | 'description' | 'binaryPath'>>>>(() => [
    {
      id: 'opencode',
      name: 'OpenCode',
      kind: 'acp',
      status: 'available',
      description: 'ACP coding agent.',
      binaryPath: '/opt/homebrew/bin/opencode',
    },
    {
      id: 'aider',
      name: 'Aider',
      kind: 'acp',
      status: 'available',
      description: 'ACP-compatible pair programming agent.',
      binaryPath: '/opt/homebrew/bin/aider',
    },
    {
      id: 'cursor-agent',
      name: 'Cursor Agent',
      kind: 'acp',
      status: 'available',
      description: 'ACP coding agent.',
      binaryPath: '/Applications/Cursor.app',
    },
  ], []);

  useEffect(() => {
    const dismissWalkthrough = () => {
      const mindRootId = document.documentElement.dataset.mindRootId;
      try {
        localStorage.setItem(WALKTHROUGH_DONE_STORAGE_KEY, '1');
        if (mindRootId) localStorage.setItem(`${WALKTHROUGH_DONE_STORAGE_KEY}:${mindRootId}`, '1');
      } catch {}
      useWalkthroughStore.setState({ status: 'dismissed' });
    };
    dismissWalkthrough();
    const dismissTimers = [150, 400, 900].map((delay) => window.setTimeout(dismissWalkthrough, delay));
    const timer = window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Change agent"]')?.click();
      window.setTimeout(() => {
        document.querySelector<HTMLButtonElement>('button[aria-label="Show more ACP agents"]')?.click();
      }, 150);
    }, 500);
    return () => {
      window.clearTimeout(timer);
      dismissTimers.forEach(window.clearTimeout);
    };
  }, []);

  return (
    <main className="min-h-[calc(100vh-var(--app-titlebar-h))] max-w-[100vw] overflow-x-hidden bg-background text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-var(--app-titlebar-h))] w-full max-w-5xl flex-col justify-center px-6 py-8">
        <div className="mb-10 text-center text-sm text-muted-foreground/55">
          You think here, Agents act there
        </div>
        <section className="min-h-[520px] overflow-hidden rounded-xl border border-border/60 bg-background shadow-xl shadow-foreground/5">
          <AskHeader
            isPanel={false}
            showHistory={false}
            onToggleHistory={() => {}}
            onReset={() => {}}
            isLoading={false}
            maximized
            onMaximize={() => {}}
            sessions={sessions}
            activeSessionId="session-product-docs"
            onLoadSession={() => {}}
            onDeleteSession={() => {}}
            onRenameSession={() => {}}
            onTogglePinSession={() => {}}
            messages={sessions[0]?.messages ?? []}
            selectedAgentRuntime={selectedRuntime}
            onSelectAgentRuntime={setSelectedRuntime}
            runtimeSessionBinding={binding}
            nativeRuntimes={runtimes}
            notInstalledAgents={[]}
            agentLoading={false}
            agentLoadingByKind={{ codex: false, claude: false }}
            agentErrorByKind={{}}
            acpRuntimes={acpRuntimes}
          />
          <div className="px-16 py-12">
            <div className="max-w-3xl rounded-lg border border-border/50 bg-card/70 px-6 py-5 shadow-sm">
              <p className="text-lg leading-8 text-foreground">
                除，缺&quot;痛点根&quot;这一锚）？还是先到这儿，等开写项目计划书时统一取用？
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
